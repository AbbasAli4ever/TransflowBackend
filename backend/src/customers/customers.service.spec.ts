import { CustomersService } from './customers.service';
import { PrismaService } from '../prisma/prisma.service';
import { ConflictException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import * as requestContext from '../common/request-context';

const mockContext = { tenantId: 'tenant-1', userId: 'user-1' };

jest.spyOn(requestContext, 'getContext').mockReturnValue(mockContext as any);

describe('CustomersService', () => {
  let service: CustomersService;
  let prisma: any;

  beforeEach(() => {
    prisma = {
      customer: {
        findFirst: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      statusChangeLog: { create: jest.fn() },
      $queryRaw: jest.fn().mockResolvedValue([{ balance: 0n }]),
      $transaction: jest.fn().mockImplementation((args: any[]) =>
        Promise.all(args.map((op: any) => (typeof op?.then === 'function' ? op : Promise.resolve(op))))
      ),
    };

    service = new CustomersService(prisma as PrismaService);
  });

  describe('create', () => {
    it('throws ConflictException on duplicate name (P2002 from DB constraint)', async () => {
      prisma.customer.create.mockRejectedValue(Object.assign(new Error('Unique constraint'), { code: 'P2002' }));

      await expect(
        service.create({ name: 'Big Corp' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('creates customer without _computed', async () => {
      prisma.customer.create.mockResolvedValue({
        id: 'cust-1',
        tenantId: 'tenant-1',
        name: 'Big Corp',
        phone: null,
        address: null,
        notes: null,
        status: 'ACTIVE',
        createdBy: 'user-1',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await service.create({ name: 'Big Corp' });

      expect(result.name).toBe('Big Corp');
      expect(result).not.toHaveProperty('_computed');
    });
  });

  describe('findAll', () => {
    it('returns paginated list', async () => {
      const customer = { id: 'cust-1', name: 'Big Corp', tenantId: 'tenant-1' };
      prisma.customer.findMany.mockResolvedValue([customer]);
      prisma.customer.count.mockResolvedValue(1);

      const result = await service.findAll({ page: 1, limit: 20 });

      expect(result.data).toHaveLength(1);
      expect(result.meta.total).toBe(1);
    });
  });

  describe('findOne', () => {
    it('throws NotFoundException when not found', async () => {
      prisma.customer.findFirst.mockResolvedValue(null);

      await expect(service.findOne('nonexistent')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('returns customer without _computed', async () => {
      prisma.customer.findFirst.mockResolvedValue({ id: 'cust-1', name: 'Big Corp', tenantId: 'tenant-1' });

      const result = await service.findOne('cust-1');

      expect(result.name).toBe('Big Corp');
      expect(result).not.toHaveProperty('_computed');
    });
  });

  describe('update', () => {
    it('throws NotFoundException when not found', async () => {
      prisma.customer.findFirst.mockResolvedValue(null);

      await expect(service.update('nonexistent', { name: 'New' })).rejects.toBeInstanceOf(NotFoundException);
    });

    it('updates and returns with _computed', async () => {
      const existing = { id: 'cust-1', name: 'Original', tenantId: 'tenant-1' };
      prisma.customer.findFirst.mockResolvedValue(existing);
      prisma.customer.update.mockResolvedValue({ ...existing, name: 'Updated' });

      const result = await service.update('cust-1', { name: 'Updated' });

      expect(result.name).toBe('Updated');
    });
  });

  describe('updateStatus', () => {
    it('updates status', async () => {
      const existing = { id: 'cust-1', name: 'Big Corp', status: 'ACTIVE', tenantId: 'tenant-1' };
      prisma.customer.findFirst.mockResolvedValue(existing);
      prisma.customer.update.mockResolvedValue({ ...existing, status: 'INACTIVE' });

      const result = await service.updateStatus('cust-1', { status: 'INACTIVE' });

      expect(result.status).toBe('INACTIVE');
    });
  });

  describe('tenant isolation', () => {
    it('throws UnauthorizedException when no tenantId in context', async () => {
      jest.spyOn(requestContext, 'getContext').mockReturnValueOnce(undefined);

      await expect(service.create({ name: 'Test' })).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });
});
