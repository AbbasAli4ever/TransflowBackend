import {
  Injectable,
  UnauthorizedException,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { getContext } from '../common/request-context';
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

    const duplicate = await this.prisma.customer.findFirst({
      where: { tenantId, name: { equals: dto.name, mode: 'insensitive' } },
    });
    if (duplicate) throw new ConflictException('Customer name already exists');

    const customer = await this.prisma.customer.create({
      data: { tenantId, createdBy, ...dto },
    });

    return this.withComputed(customer);
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

    return paginateResponse(customers.map(c => this.withComputed(c)), total, page, limit);
  }

  async findOne(id: string) {
    const tenantId = getContext()?.tenantId;
    if (!tenantId) throw new UnauthorizedException();

    const customer = await this.prisma.customer.findFirst({
      where: { id, tenantId },
    });
    if (!customer) throw new NotFoundException('Customer not found');

    return this.withComputed(customer);
  }

  async update(id: string, dto: UpdateCustomerDto) {
    const tenantId = getContext()?.tenantId;
    if (!tenantId) throw new UnauthorizedException();

    const existing = await this.prisma.customer.findFirst({
      where: { id, tenantId },
    });
    if (!existing) throw new NotFoundException('Customer not found');

    if (dto.name && dto.name.toLowerCase() !== existing.name.toLowerCase()) {
      const duplicate = await this.prisma.customer.findFirst({
        where: { tenantId, name: { equals: dto.name, mode: 'insensitive' }, NOT: { id } },
      });
      if (duplicate) throw new ConflictException('Customer name already exists');
    }

    const updated = await this.prisma.customer.update({
      where: { id, tenantId },
      data: dto,
    });

    return this.withComputed(updated);
  }

  async updateStatus(id: string, dto: UpdateStatusDto) {
    const tenantId = getContext()?.tenantId;
    if (!tenantId) throw new UnauthorizedException();

    const existing = await this.prisma.customer.findFirst({
      where: { id, tenantId },
    });
    if (!existing) throw new NotFoundException('Customer not found');

    const updated = await this.prisma.customer.update({
      where: { id, tenantId },
      data: { status: dto.status },
    });

    return this.withComputed(updated);
  }

  async getBalance(id: string) {
    const tenantId = getContext()?.tenantId;
    if (!tenantId) throw new UnauthorizedException();

    const customer = await this.prisma.customer.findFirst({
      where: { id, tenantId },
    });
    if (!customer) throw new NotFoundException('Customer not found');

    const result = await this.prisma.$queryRaw<
      Array<{ ar_increase: bigint; ar_decrease: bigint }>
    >`
      SELECT
        COALESCE(SUM(CASE WHEN entry_type = 'AR_INCREASE' THEN amount ELSE 0 END), 0) AS ar_increase,
        COALESCE(SUM(CASE WHEN entry_type = 'AR_DECREASE' THEN amount ELSE 0 END), 0) AS ar_decrease
      FROM ledger_entries
      WHERE tenant_id = ${tenantId}::uuid AND customer_id = ${id}::uuid
    `;

    const arIncrease = Number(result[0]?.ar_increase ?? 0);
    const arDecrease = Number(result[0]?.ar_decrease ?? 0);

    return {
      customerId: id,
      totalSales: arIncrease,
      totalReceived: arDecrease,
      currentBalance: arIncrease - arDecrease,
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

    const totalOutstanding = rows.reduce((sum, r) => sum + Number(r.outstanding), 0);

    return {
      customerId: id,
      customerName: customer.name,
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

  private withComputed(customer: any) {
    return {
      ...customer,
      _computed: {
        totalSales: 0,
        currentBalance: 0,
        lastSaleDate: null,
      },
    };
  }
}
