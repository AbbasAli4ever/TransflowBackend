import { SuppliersService } from './suppliers.service';
import { PrismaService } from '../prisma/prisma.service';
import { ConflictException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import * as requestContext from '../common/request-context';

const mockContext = { tenantId: 'tenant-1', userId: 'user-1' };

jest.spyOn(requestContext, 'getContext').mockReturnValue(mockContext as any);

describe('SuppliersService', () => {
  let service: SuppliersService;
  let prisma: any;

  beforeEach(() => {
    prisma = {
      supplier: {
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

    service = new SuppliersService(prisma as PrismaService);
  });

  describe('create', () => {
    it('throws ConflictException on duplicate name (P2002 from DB constraint)', async () => {
      prisma.supplier.create.mockRejectedValue(Object.assign(new Error('Unique constraint'), { code: 'P2002' }));

      await expect(
        service.create({ name: 'Acme' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('creates supplier without _computed', async () => {
      prisma.supplier.create.mockResolvedValue({
        id: 'sup-1',
        tenantId: 'tenant-1',
        name: 'Acme',
        phone: null,
        address: null,
        notes: null,
        status: 'ACTIVE',
        createdBy: 'user-1',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await service.create({ name: 'Acme' });

      expect(result.name).toBe('Acme');
      expect(result).not.toHaveProperty('_computed');
    });
  });

  describe('findAll', () => {
    it('returns paginated list with currentBalance', async () => {
      const supplier = { id: 'sup-1', name: 'Acme', tenantId: 'tenant-1' };
      prisma.supplier.findMany.mockResolvedValue([supplier]);
      prisma.supplier.count.mockResolvedValue(1);
      prisma.$queryRaw.mockResolvedValueOnce([
        { entity_id: 'sup-1', total_increase: 5000n, total_decrease: 2000n },
      ]);

      const result = await service.findAll({ page: 1, limit: 20 });

      expect(result.data).toHaveLength(1);
      expect(result.meta.total).toBe(1);
      expect(result.meta.totalPages).toBe(1);
      expect(result.data[0]).toHaveProperty('currentBalance', 3000);
    });

    it('returns empty list without calling balance query', async () => {
      prisma.supplier.findMany.mockResolvedValue([]);
      prisma.supplier.count.mockResolvedValue(0);

      const result = await service.findAll({ page: 1, limit: 20 });

      expect(result.data).toHaveLength(0);
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
    });
  });

  describe('findOne', () => {
    it('throws NotFoundException when not found', async () => {
      prisma.supplier.findFirst.mockResolvedValue(null);

      await expect(service.findOne('nonexistent-id')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('returns supplier without _computed', async () => {
      const supplier = { id: 'sup-1', name: 'Acme', tenantId: 'tenant-1' };
      prisma.supplier.findFirst.mockResolvedValue(supplier);

      const result = await service.findOne('sup-1');

      expect(result.name).toBe('Acme');
      expect(result).not.toHaveProperty('_computed');
    });
  });

  describe('update', () => {
    it('throws NotFoundException when not found', async () => {
      prisma.supplier.findFirst.mockResolvedValue(null);

      await expect(service.update('nonexistent', { name: 'New' })).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws ConflictException on duplicate name (P2002 from DB constraint)', async () => {
      prisma.supplier.findFirst.mockResolvedValue({ id: 'sup-1', name: 'Original' });
      prisma.supplier.update.mockRejectedValue(Object.assign(new Error('Unique constraint'), { code: 'P2002' }));

      await expect(service.update('sup-1', { name: 'New Name' })).rejects.toBeInstanceOf(ConflictException);
    });

    it('updates and returns without _computed', async () => {
      const existing = { id: 'sup-1', name: 'Original', tenantId: 'tenant-1' };
      prisma.supplier.findFirst.mockResolvedValue(existing);
      prisma.supplier.update.mockResolvedValue({ ...existing, name: 'Updated' });

      const result = await service.update('sup-1', { name: 'Updated' });

      expect(result.name).toBe('Updated');
      expect(result).not.toHaveProperty('_computed');
    });
  });

  describe('updateStatus', () => {
    it('throws NotFoundException when not found', async () => {
      prisma.supplier.findFirst.mockResolvedValue(null);

      await expect(
        service.updateStatus('nonexistent', { status: 'INACTIVE' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('updates status', async () => {
      const existing = { id: 'sup-1', name: 'Acme', status: 'ACTIVE', tenantId: 'tenant-1' };
      prisma.supplier.findFirst.mockResolvedValue(existing);
      prisma.supplier.update.mockResolvedValue({ ...existing, status: 'INACTIVE' });

      const result = await service.updateStatus('sup-1', { status: 'INACTIVE' });

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
