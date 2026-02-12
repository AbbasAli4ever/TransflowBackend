import {
  Injectable,
  UnauthorizedException,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { getContext } from '../common/request-context';
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

    const duplicate = await this.prisma.supplier.findFirst({
      where: { tenantId, name: { equals: dto.name, mode: 'insensitive' } },
    });
    if (duplicate) throw new ConflictException('Supplier name already exists');

    const supplier = await this.prisma.supplier.create({
      data: { tenantId, createdBy, ...dto },
    });

    return this.withComputed(supplier);
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

    return paginateResponse(suppliers.map(s => this.withComputed(s)), total, page, limit);
  }

  async findOne(id: string) {
    const tenantId = getContext()?.tenantId;
    if (!tenantId) throw new UnauthorizedException();

    const supplier = await this.prisma.supplier.findFirst({
      where: { id, tenantId },
    });
    if (!supplier) throw new NotFoundException('Supplier not found');

    return this.withComputed(supplier);
  }

  async update(id: string, dto: UpdateSupplierDto) {
    const tenantId = getContext()?.tenantId;
    if (!tenantId) throw new UnauthorizedException();

    const existing = await this.prisma.supplier.findFirst({
      where: { id, tenantId },
    });
    if (!existing) throw new NotFoundException('Supplier not found');

    if (dto.name && dto.name.toLowerCase() !== existing.name.toLowerCase()) {
      const duplicate = await this.prisma.supplier.findFirst({
        where: { tenantId, name: { equals: dto.name, mode: 'insensitive' }, NOT: { id } },
      });
      if (duplicate) throw new ConflictException('Supplier name already exists');
    }

    const updated = await this.prisma.supplier.update({
      where: { id, tenantId },
      data: dto,
    });

    return this.withComputed(updated);
  }

  async updateStatus(id: string, dto: UpdateStatusDto) {
    const tenantId = getContext()?.tenantId;
    if (!tenantId) throw new UnauthorizedException();

    const existing = await this.prisma.supplier.findFirst({
      where: { id, tenantId },
    });
    if (!existing) throw new NotFoundException('Supplier not found');

    const updated = await this.prisma.supplier.update({
      where: { id, tenantId },
      data: { status: dto.status },
    });

    return this.withComputed(updated);
  }

  async getBalance(id: string) {
    const tenantId = getContext()?.tenantId;
    if (!tenantId) throw new UnauthorizedException();

    const supplier = await this.prisma.supplier.findFirst({
      where: { id, tenantId },
    });
    if (!supplier) throw new NotFoundException('Supplier not found');

    const result = await this.prisma.$queryRaw<
      Array<{ ap_increase: bigint; ap_decrease: bigint }>
    >`
      SELECT
        COALESCE(SUM(CASE WHEN entry_type = 'AP_INCREASE' THEN amount ELSE 0 END), 0) AS ap_increase,
        COALESCE(SUM(CASE WHEN entry_type = 'AP_DECREASE' THEN amount ELSE 0 END), 0) AS ap_decrease
      FROM ledger_entries
      WHERE tenant_id = ${tenantId}::uuid AND supplier_id = ${id}::uuid
    `;

    const apIncrease = Number(result[0]?.ap_increase ?? 0);
    const apDecrease = Number(result[0]?.ap_decrease ?? 0);

    return {
      supplierId: id,
      totalPurchases: apIncrease,
      totalPaid: apDecrease,
      currentBalance: apIncrease - apDecrease,
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

    const totalOutstanding = rows.reduce((sum, r) => sum + Number(r.outstanding), 0);

    return {
      supplierId: id,
      supplierName: supplier.name,
      totalOutstanding,
      documents: rows.map((r) => ({
        id: r.id,
        documentNumber: r.document_number,
        transactionDate: r.transaction_date,
        totalAmount: Number(r.total_amount),
        paidAmount: Number(r.paid_amount),
        outstanding: Number(r.outstanding),
      })),
    };
  }

  private withComputed(supplier: any) {
    return {
      ...supplier,
      _computed: {
        totalPurchases: 0,
        currentBalance: 0,
        lastPurchaseDate: null,
      },
    };
  }
}
