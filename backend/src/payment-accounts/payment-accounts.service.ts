import {
  Injectable,
  UnauthorizedException,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { getContext } from '../common/request-context';
import { paginateResponse } from '../common/utils/paginate';
import { safeMoney } from '../common/utils/money';
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
      return account;
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

    return paginateResponse(accounts, total, page, limit);
  }

  async findOne(id: string) {
    const tenantId = getContext()?.tenantId;
    if (!tenantId) throw new UnauthorizedException();

    const account = await this.prisma.paymentAccount.findFirst({
      where: { id, tenantId },
    });
    if (!account) throw new NotFoundException('Payment account not found');

    return account;
  }

  async update(id: string, dto: UpdatePaymentAccountDto) {
    const tenantId = getContext()?.tenantId;
    if (!tenantId) throw new UnauthorizedException();

    if (Object.keys(dto).filter((k) => (dto as any)[k] !== undefined).length === 0) {
      throw new BadRequestException('At least one field must be provided for update');
    }

    const existing = await this.prisma.paymentAccount.findFirst({
      where: { id, tenantId },
    });
    if (!existing) throw new NotFoundException('Payment account not found');

    try {
      const updated = await this.prisma.paymentAccount.update({
        where: { id, tenantId },
        data: dto,
      });
      return updated;
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

    // Task 6.2: block deactivation when account has a non-zero balance
    if (dto.status === 'INACTIVE') {
      const balanceRows = await this.prisma.$queryRaw<Array<{ balance: bigint }>>`
        SELECT (${existing.openingBalance} + COALESCE(SUM(CASE WHEN direction = 'IN' THEN amount ELSE -amount END), 0))::bigint AS balance
        FROM payment_entries
        WHERE tenant_id = ${tenantId}::uuid AND payment_account_id = ${id}::uuid
      `;
      const bal = safeMoney(balanceRows[0]?.balance);
      if (bal !== 0) {
        throw new BadRequestException('Cannot deactivate payment account with non-zero balance');
      }
    }

    const [updated] = await this.prisma.$transaction([
      this.prisma.paymentAccount.update({ where: { id, tenantId }, data: { status: dto.status } }),
      this.prisma.statusChangeLog.create({
        data: {
          tenantId,
          entityType: 'PAYMENT_ACCOUNT',
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

    const totalIn = safeMoney(result[0]?.total_in);
    const totalOut = safeMoney(result[0]?.total_out);
    const currentBalance = account.openingBalance + totalIn - totalOut;

    return {
      paymentAccountId: id,
      openingBalance: account.openingBalance,
      totalIn,
      totalOut,
      currentBalance,
    };
  }

}
