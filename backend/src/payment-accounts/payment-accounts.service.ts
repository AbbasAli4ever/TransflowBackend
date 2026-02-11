import {
  Injectable,
  UnauthorizedException,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { getContext } from '../common/request-context';
import { paginateResponse } from '../common/utils/paginate';
import { CreatePaymentAccountDto } from './dto/create-payment-account.dto';
import { UpdatePaymentAccountDto } from './dto/update-payment-account.dto';
import { ListPaymentAccountsQueryDto } from './dto/list-payment-accounts-query.dto';
import { UpdateStatusDto } from '../common/dto/update-status.dto';

@Injectable()
export class PaymentAccountsService {
  constructor(private prisma: PrismaService) {}

  async create(dto: CreatePaymentAccountDto) {
    const tenantId = getContext()?.tenantId;
    if (!tenantId) throw new UnauthorizedException();
    const createdBy = getContext()?.userId;

    try {
      const account = await this.prisma.paymentAccount.create({
        data: {
          tenantId,
          createdBy,
          name: dto.name,
          type: dto.type,
          openingBalance: dto.openingBalance ?? 0,
        },
      });
      return this.withComputed(account);
    } catch (err: any) {
      if (err.code === 'P2002') throw new ConflictException('Payment account name already exists');
      throw err;
    }
  }

  async findAll(query: ListPaymentAccountsQueryDto) {
    const tenantId = getContext()?.tenantId;
    if (!tenantId) throw new UnauthorizedException();

    const { page, limit, type, status = 'ACTIVE' } = query;
    const skip = (page - 1) * limit;

    const where: any = { tenantId };

    if (status !== 'ALL') {
      where.status = status;
    }

    if (type) {
      where.type = type;
    }

    const [accounts, total] = await Promise.all([
      this.prisma.paymentAccount.findMany({
        where,
        skip,
        take: limit,
        orderBy: { name: 'asc' },
      }),
      this.prisma.paymentAccount.count({ where }),
    ]);

    return paginateResponse(accounts.map(a => this.withComputed(a)), total, page, limit);
  }

  async findOne(id: string) {
    const tenantId = getContext()?.tenantId;
    if (!tenantId) throw new UnauthorizedException();

    const account = await this.prisma.paymentAccount.findFirst({
      where: { id, tenantId },
    });
    if (!account) throw new NotFoundException('Payment account not found');

    return this.withComputed(account);
  }

  async update(id: string, dto: UpdatePaymentAccountDto) {
    const tenantId = getContext()?.tenantId;
    if (!tenantId) throw new UnauthorizedException();

    const existing = await this.prisma.paymentAccount.findFirst({
      where: { id, tenantId },
    });
    if (!existing) throw new NotFoundException('Payment account not found');

    try {
      const updated = await this.prisma.paymentAccount.update({
        where: { id, tenantId },
        data: dto,
      });
      return this.withComputed(updated);
    } catch (err: any) {
      if (err.code === 'P2002') throw new ConflictException('Payment account name already exists');
      throw err;
    }
  }

  async updateStatus(id: string, dto: UpdateStatusDto) {
    const tenantId = getContext()?.tenantId;
    if (!tenantId) throw new UnauthorizedException();

    const existing = await this.prisma.paymentAccount.findFirst({
      where: { id, tenantId },
    });
    if (!existing) throw new NotFoundException('Payment account not found');

    const updated = await this.prisma.paymentAccount.update({
      where: { id, tenantId },
      data: { status: dto.status },
    });

    return this.withComputed(updated);
  }

  async getBalance(id: string) {
    const tenantId = getContext()?.tenantId;
    if (!tenantId) throw new UnauthorizedException();

    const account = await this.prisma.paymentAccount.findFirst({
      where: { id, tenantId },
    });
    if (!account) throw new NotFoundException('Payment account not found');

    const result = await this.prisma.$queryRaw<
      Array<{ total_in: bigint; total_out: bigint }>
    >`
      SELECT
        COALESCE(SUM(CASE WHEN direction = 'IN' THEN amount ELSE 0 END), 0) AS total_in,
        COALESCE(SUM(CASE WHEN direction = 'OUT' THEN amount ELSE 0 END), 0) AS total_out
      FROM payment_entries
      WHERE tenant_id = ${tenantId}::uuid AND payment_account_id = ${id}::uuid
    `;

    const totalIn = Number(result[0]?.total_in ?? 0);
    const totalOut = Number(result[0]?.total_out ?? 0);
    const currentBalance = account.openingBalance + totalIn - totalOut;

    return {
      paymentAccountId: id,
      openingBalance: account.openingBalance,
      totalIn,
      totalOut,
      currentBalance,
    };
  }

  private withComputed(account: any) {
    return {
      ...account,
      _computed: {
        currentBalance: 0,
        totalIn: 0,
        totalOut: 0,
        lastTransactionDate: null,
      },
    };
  }
}
