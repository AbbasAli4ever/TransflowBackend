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
import { CreateCustomerDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';
import { ListCustomersQueryDto } from './dto/list-customers-query.dto';
import { UpdateStatusDto } from '../common/dto/update-status.dto';

@Injectable()
export class CustomersService {
  constructor(private prisma: PrismaService) {}

  async create(dto: CreateCustomerDto) {
    const tenantId = getContext()?.tenantId;
    if (!tenantId) throw new UnauthorizedException();
    const createdBy = getContext()?.userId;

    try {
      const customer = await this.prisma.customer.create({
        data: { tenantId, createdBy, ...dto },
      });
      return customer;
    } catch (e: any) {
      if (e.code === 'P2002') throw new ConflictException('Customer name already exists');
      throw e;
    }
  }

  async findAll(query: ListCustomersQueryDto) {
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

    const [customers, total] = await Promise.all([
      this.prisma.customer.findMany({
        where,
        skip,
        take: limit,
        orderBy: { [sortBy]: sortOrder },
      }),
      this.prisma.customer.count({ where }),
    ]);

    return paginateResponse(customers, total, page, limit);
  }

  async findOne(id: string) {
    const tenantId = getContext()?.tenantId;
    if (!tenantId) throw new UnauthorizedException();

    const customer = await this.prisma.customer.findFirst({
      where: { id, tenantId },
    });
    if (!customer) throw new NotFoundException('Customer not found');

    return customer;
  }

  async update(id: string, dto: UpdateCustomerDto) {
    const tenantId = getContext()?.tenantId;
    if (!tenantId) throw new UnauthorizedException();

    if (Object.keys(dto).filter((k) => (dto as any)[k] !== undefined).length === 0) {
      throw new BadRequestException('At least one field must be provided for update');
    }

    const existing = await this.prisma.customer.findFirst({
      where: { id, tenantId },
    });
    if (!existing) throw new NotFoundException('Customer not found');

    try {
      const updated = await this.prisma.customer.update({
        where: { id, tenantId },
        data: dto,
      });
      return updated;
    } catch (e: any) {
      if (e.code === 'P2002') throw new ConflictException('Customer name already exists');
      throw e;
    }
  }

  async updateStatus(id: string, dto: UpdateStatusDto) {
    const tenantId = getContext()?.tenantId;
    if (!tenantId) throw new UnauthorizedException();

    const existing = await this.prisma.customer.findFirst({
      where: { id, tenantId },
    });
    if (!existing) throw new NotFoundException('Customer not found');

    // Task 6.2: block deactivation when customer has an open AR balance
    if (dto.status === 'INACTIVE') {
      const balanceRows = await this.prisma.$queryRaw<Array<{ balance: bigint }>>`
        SELECT COALESCE(SUM(CASE WHEN entry_type = 'AR_INCREASE' THEN amount ELSE -amount END), 0)::bigint AS balance
        FROM ledger_entries
        WHERE tenant_id = ${tenantId}::uuid AND customer_id = ${id}::uuid
      `;
      if (safeMoney(balanceRows[0]?.balance) > 0) {
        throw new BadRequestException('Cannot deactivate customer with outstanding receivable balance');
      }
    }

    const [updated] = await this.prisma.$transaction([
      this.prisma.customer.update({ where: { id, tenantId }, data: { status: dto.status } }),
      this.prisma.statusChangeLog.create({
        data: {
          tenantId,
          entityType: 'CUSTOMER',
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

    const customer = await this.prisma.customer.findFirst({
      where: { id, tenantId },
    });
    if (!customer) throw new NotFoundException('Customer not found');

    const result = await this.prisma.$queryRaw<
      Array<{ ar_increase: bigint; ar_payments: bigint; ar_returns: bigint }>
    >`
      SELECT
        COALESCE(SUM(CASE WHEN le.entry_type = 'AR_INCREASE' THEN le.amount ELSE 0 END), 0) AS ar_increase,
        COALESCE(SUM(CASE WHEN le.entry_type = 'AR_DECREASE' AND t.type != 'CUSTOMER_RETURN' THEN le.amount ELSE 0 END), 0) AS ar_payments,
        COALESCE(SUM(CASE WHEN le.entry_type = 'AR_DECREASE' AND t.type = 'CUSTOMER_RETURN' THEN le.amount ELSE 0 END), 0) AS ar_returns
      FROM ledger_entries le
      JOIN transactions t ON t.id = le.transaction_id
      WHERE le.tenant_id = ${tenantId}::uuid AND le.customer_id = ${id}::uuid
    `;

    const arIncrease = safeMoney(result[0]?.ar_increase);
    const arPayments = safeMoney(result[0]?.ar_payments);
    const arReturns = safeMoney(result[0]?.ar_returns);

    return {
      customerId: id,
      totalSales: arIncrease,
      totalPayments: arPayments,
      totalReturns: arReturns,
      currentBalance: arIncrease - arPayments - arReturns,
    };
  }

  async getOpenDocuments(id: string) {
    const tenantId = getContext()?.tenantId;
    if (!tenantId) throw new UnauthorizedException();

    const customer = await this.prisma.customer.findFirst({
      where: { id, tenantId },
    });
    if (!customer) throw new NotFoundException('Customer not found');

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
        AND t.customer_id = ${id}::uuid
        AND t.type = 'SALE'
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
        AND le.customer_id = ${id}::uuid
        AND le.entry_type = 'AR_DECREASE'
        AND t.type = 'CUSTOMER_RETURN'
        AND t.status = 'POSTED'
    `;
    const unappliedCredits = safeMoney(creditRows[0]?.return_credits);

    return {
      customerId: id,
      customerName: customer.name,
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
