import { PaymentAccountsService } from './payment-accounts.service';
import { PrismaService } from '../prisma/prisma.service';
import { ConflictException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import * as requestContext from '../common/request-context';

const mockContext = { tenantId: 'tenant-1', userId: 'user-1' };

jest.spyOn(requestContext, 'getContext').mockReturnValue(mockContext as any);

describe('PaymentAccountsService', () => {
  let service: PaymentAccountsService;
  let prisma: any;

  beforeEach(() => {
    prisma = {
      paymentAccount: {
        findFirst: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
    };

    service = new PaymentAccountsService(prisma as PrismaService);
  });

  describe('create', () => {
    it('creates payment account and returns with _computed', async () => {
      prisma.paymentAccount.create.mockResolvedValue({
        id: 'acct-1',
        tenantId: 'tenant-1',
        name: 'Main Cash',
        type: 'CASH',
        status: 'ACTIVE',
        openingBalance: 0,
        createdBy: 'user-1',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await service.create({ name: 'Main Cash', type: 'CASH' });

      expect(result.name).toBe('Main Cash');
      expect(result.type).toBe('CASH');
      expect(result._computed).toBeDefined();
      expect(result._computed.currentBalance).toBe(0);
      expect(result._computed.totalIn).toBe(0);
      expect(result._computed.totalOut).toBe(0);
    });

    it('throws ConflictException on duplicate name (P2002)', async () => {
      prisma.paymentAccount.create.mockRejectedValue({ code: 'P2002' });

      await expect(
        service.create({ name: 'Duplicate', type: 'CASH' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('findAll', () => {
    it('returns paginated list', async () => {
      const account = { id: 'acct-1', name: 'Main Cash', type: 'CASH', tenantId: 'tenant-1' };
      prisma.paymentAccount.findMany.mockResolvedValue([account]);
      prisma.paymentAccount.count.mockResolvedValue(1);

      const result = await service.findAll({ page: 1, limit: 20 });

      expect(result.data).toHaveLength(1);
      expect(result.meta.total).toBe(1);
    });

    it('filters by type', async () => {
      prisma.paymentAccount.findMany.mockResolvedValue([]);
      prisma.paymentAccount.count.mockResolvedValue(0);

      await service.findAll({ page: 1, limit: 20, type: 'BANK' });

      expect(prisma.paymentAccount.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ type: 'BANK' }),
        }),
      );
    });
  });

  describe('findOne', () => {
    it('throws NotFoundException when not found', async () => {
      prisma.paymentAccount.findFirst.mockResolvedValue(null);

      await expect(service.findOne('nonexistent')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('returns account with _computed', async () => {
      prisma.paymentAccount.findFirst.mockResolvedValue({
        id: 'acct-1', name: 'Main Cash', type: 'CASH', tenantId: 'tenant-1',
      });

      const result = await service.findOne('acct-1');

      expect(result.name).toBe('Main Cash');
      expect(result._computed).toBeDefined();
    });
  });

  describe('update', () => {
    it('only allows name update', async () => {
      const existing = { id: 'acct-1', name: 'Main Cash', type: 'CASH', tenantId: 'tenant-1' };
      prisma.paymentAccount.findFirst.mockResolvedValue(existing);
      prisma.paymentAccount.update.mockResolvedValue({ ...existing, name: 'Petty Cash' });

      const result = await service.update('acct-1', { name: 'Petty Cash' });

      expect(result.name).toBe('Petty Cash');
    });

    it('throws ConflictException on duplicate name (P2002)', async () => {
      prisma.paymentAccount.findFirst.mockResolvedValue({ id: 'acct-1', name: 'Main Cash', tenantId: 'tenant-1' });
      prisma.paymentAccount.update.mockRejectedValue({ code: 'P2002' });

      await expect(
        service.update('acct-1', { name: 'Duplicate Name' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('updateStatus', () => {
    it('updates status', async () => {
      const existing = { id: 'acct-1', name: 'Main Cash', status: 'ACTIVE', tenantId: 'tenant-1' };
      prisma.paymentAccount.findFirst.mockResolvedValue(existing);
      prisma.paymentAccount.update.mockResolvedValue({ ...existing, status: 'INACTIVE' });

      const result = await service.updateStatus('acct-1', { status: 'INACTIVE' });

      expect(result.status).toBe('INACTIVE');
    });
  });

  describe('tenant isolation', () => {
    it('throws UnauthorizedException when no tenantId in context', async () => {
      jest.spyOn(requestContext, 'getContext').mockReturnValueOnce(undefined);

      await expect(service.create({ name: 'Test', type: 'CASH' })).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });
});
