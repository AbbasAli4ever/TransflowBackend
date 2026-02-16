import {
  Injectable,
  UnauthorizedException,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { getContext } from '../common/request-context';
import { safeMoney } from '../common/utils/money';
import { paginateResponse } from '../common/utils/paginate';
import { CreateSupplierDto } from './dto/create-supplier.dto';
import { UpdateSupplierDto } from './dto/update-supplier.dto';
import { ListSuppliersQueryDto } from './dto/list-suppliers-query.dto';
import { UpdateStatusDto } from '../common/dto/update-status.dto';

@Injectable()
export class SuppliersService {
  constructor(private prisma: PrismaService) {}

  async create(dto: CreateSupplierDto) {
    const tenantId = getContext()?.tenantId;
    if (!tenantId) throw new UnauthorizedException();
    const createdBy = getContext()?.userId;

    try {
      const supplier = await this.prisma.supplier.create({
        data: { tenantId, createdBy, ...dto },
      });
      return supplier;
    } catch (e: any) {
      if (e.code === 'P2002') throw new ConflictException('Supplier name already exists');
      throw e;
    }
  }

  async findAll(query: ListSuppliersQueryDto) {
    const tenantId = getContext()?.tenantId;
    if (!tenantId) throw new UnauthorizedException();

    const { page, limit, search, status = 'ACTIVE', sortBy = 'name', sortOrder = 'asc' } = query;
    const skip = (page - 1) * limit;

    const where: any = { tenantId };

    if (status !== 'ALL') {
      where.status = status;
    }

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [suppliers, total] = await Promise.all([
      this.prisma.supplier.findMany({
        where,
        skip,
        take: limit,
        orderBy: { [sortBy]: sortOrder },
      }),
      this.prisma.supplier.count({ where }),
    ]);

    return paginateResponse(suppliers, total, page, limit);
  }

  async findOne(id: string) {
    const tenantId = getContext()?.tenantId;
    if (!tenantId) throw new UnauthorizedException();

    const supplier = await this.prisma.supplier.findFirst({
      where: { id, tenantId },
    });
    if (!supplier) throw new NotFoundException('Supplier not found');

    return supplier;
  }

  async update(id: string, dto: UpdateSupplierDto) {
    const tenantId = getContext()?.tenantId;
    if (!tenantId) throw new UnauthorizedException();

    if (Object.keys(dto).filter((k) => (dto as any)[k] !== undefined).length === 0) {
      throw new BadRequestException('At least one field must be provided for update');
    }

    const existing = await this.prisma.supplier.findFirst({
      where: { id, tenantId },
    });
    if (!existing) throw new NotFoundException('Supplier not found');

    try {
      const updated = await this.prisma.supplier.update({
        where: { id, tenantId },
        data: dto,
      });
      return updated;
    } catch (e: any) {
      if (e.code === 'P2002') throw new ConflictException('Supplier name already exists');
      throw e;
    }
  }

  async updateStatus(id: string, dto: UpdateStatusDto) {
    const tenantId = getContext()?.tenantId;
    if (!tenantId) throw new UnauthorizedException();

    const existing = await this.prisma.supplier.findFirst({
      where: { id, tenantId },
    });
    if (!existing) throw new NotFoundException('Supplier not found');

    // Task 6.2: block deactivation when supplier has an open AP balance
    if (dto.status === 'INACTIVE') {
      const balanceRows = await this.prisma.$queryRaw<Array<{ balance: bigint }>>`
        SELECT COALESCE(SUM(CASE WHEN entry_type = 'AP_INCREASE' THEN amount ELSE -amount END), 0)::bigint AS balance
        FROM ledger_entries
        WHERE tenant_id = ${tenantId}::uuid AND supplier_id = ${id}::uuid
      `;
      if (safeMoney(balanceRows[0]?.balance) > 0) {
        throw new BadRequestException('Cannot deactivate supplier with outstanding payable balance');
      }
    }

    const [updated] = await this.prisma.$transaction([
      this.prisma.supplier.update({ where: { id, tenantId }, data: { status: dto.status } }),
      this.prisma.statusChangeLog.create({
        data: {
          tenantId,
          entityType: 'SUPPLIER',
          entityId: id,
          actorUserId: getContext()?.userId ?? null,
          previousStatus: existing.status,
          newStatus: dto.status,
          reason: dto.reason ?? null,
        },
      }),
    ]);

    return updated;
  }

  async getBalance(id: string) {
    const tenantId = getContext()?.tenantId;
    if (!tenantId) throw new UnauthorizedException();

    const supplier = await this.prisma.supplier.findFirst({
      where: { id, tenantId },
    });
    if (!supplier) throw new NotFoundException('Supplier not found');

    const result = await this.prisma.$queryRaw<
      Array<{ ap_increase: bigint; ap_payments: bigint; ap_returns: bigint }>
    >`
      SELECT
        COALESCE(SUM(CASE WHEN le.entry_type = 'AP_INCREASE' THEN le.amount ELSE 0 END), 0) AS ap_increase,
        COALESCE(SUM(CASE WHEN le.entry_type = 'AP_DECREASE' AND t.type != 'SUPPLIER_RETURN' THEN le.amount ELSE 0 END), 0) AS ap_payments,
        COALESCE(SUM(CASE WHEN le.entry_type = 'AP_DECREASE' AND t.type = 'SUPPLIER_RETURN'  THEN le.amount ELSE 0 END), 0) AS ap_returns
      FROM ledger_entries le
      JOIN transactions t ON t.id = le.transaction_id
      WHERE le.tenant_id = ${tenantId}::uuid AND le.supplier_id = ${id}::uuid
    `;

    const totalPurchases = safeMoney(result[0]?.ap_increase);
    const totalPayments = safeMoney(result[0]?.ap_payments);
    const totalReturns = safeMoney(result[0]?.ap_returns);

    return {
      supplierId: id,
      totalPurchases,
      totalPayments,
      totalReturns,
      currentBalance: totalPurchases - totalPayments - totalReturns,
    };
  }

  async getOpenDocuments(id: string) {
    const tenantId = getContext()?.tenantId;
    if (!tenantId) throw new UnauthorizedException();

    const supplier = await this.prisma.supplier.findFirst({
      where: { id, tenantId },
    });
    if (!supplier) throw new NotFoundException('Supplier not found');

    const rows = await this.prisma.$queryRaw<
      Array<{
        id: string;
        document_number: string;
        transaction_date: Date;
        total_amount: bigint;
        paid_amount: bigint;
        outstanding: bigint;
      }>
    >`
      SELECT
        t.id,
        t.document_number,
        t.transaction_date,
        t.total_amount,
        COALESCE(SUM(a.amount_applied), 0) AS paid_amount,
        t.total_amount - COALESCE(SUM(a.amount_applied), 0) AS outstanding
      FROM transactions t
      LEFT JOIN allocations a ON a.applies_to_transaction_id = t.id AND a.tenant_id = ${tenantId}::uuid
      WHERE t.tenant_id = ${tenantId}::uuid
        AND t.supplier_id = ${id}::uuid
        AND t.type = 'PURCHASE'
        AND t.status = 'POSTED'
      GROUP BY t.id, t.document_number, t.transaction_date, t.total_amount
      HAVING t.total_amount - COALESCE(SUM(a.amount_applied), 0) > 0
      ORDER BY t.transaction_date ASC
    `;

    const totalOutstanding = rows.reduce((sum, r) => sum + safeMoney(r.outstanding), 0);

    const creditRows = await this.prisma.$queryRaw<Array<{ return_credits: bigint }>>`
      SELECT COALESCE(SUM(le.amount), 0)::bigint AS return_credits
      FROM ledger_entries le
      JOIN transactions t ON t.id = le.transaction_id
      WHERE le.tenant_id = ${tenantId}::uuid
        AND le.supplier_id = ${id}::uuid
        AND le.entry_type = 'AP_DECREASE'
        AND t.type = 'SUPPLIER_RETURN'
        AND t.status = 'POSTED'
    `;
    const unappliedCredits = safeMoney(creditRows[0]?.return_credits);

    return {
      supplierId: id,
      supplierName: supplier.name,
      totalOutstanding,
      unappliedCredits,
      netOutstanding: Math.max(0, totalOutstanding - unappliedCredits),
      documents: rows.map((r) => ({
        id: r.id,
        documentNumber: r.document_number,
        transactionDate: r.transaction_date,
        totalAmount: safeMoney(r.total_amount),
        paidAmount: safeMoney(r.paid_amount),
        outstanding: safeMoney(r.outstanding),
      })),
    };
  }

}
