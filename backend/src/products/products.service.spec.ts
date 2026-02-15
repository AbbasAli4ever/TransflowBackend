import { ProductsService } from './products.service';
import { PrismaService } from '../prisma/prisma.service';
import { ConflictException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import * as requestContext from '../common/request-context';

const mockContext = { tenantId: 'tenant-1', userId: 'user-1' };

jest.spyOn(requestContext, 'getContext').mockReturnValue(mockContext as any);

describe('ProductsService', () => {
  let service: ProductsService;
  let prisma: any;

  beforeEach(() => {
    prisma = {
      product: {
        findFirst: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      statusChangeLog: { create: jest.fn() },
      $queryRaw: jest.fn().mockResolvedValue([{ stock: 0n }]),
      $transaction: jest.fn().mockImplementation((args: any[]) =>
        Promise.all(args.map((op: any) => (typeof op?.then === 'function' ? op : Promise.resolve(op))))
      ),
    };

    service = new ProductsService(prisma as PrismaService);
  });

  describe('create', () => {
    it('creates product without _computed', async () => {
      prisma.product.create.mockResolvedValue({
        id: 'prod-1',
        tenantId: 'tenant-1',
        name: 'Widget',
        sku: 'WID-001',
        category: 'Electronics',
        unit: 'piece',
        avgCost: 0,
        status: 'ACTIVE',
        createdBy: 'user-1',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await service.create({ name: 'Widget', sku: 'WID-001' });

      expect(result.name).toBe('Widget');
      expect(result).not.toHaveProperty('_computed');
    });

    it('throws ConflictException on duplicate SKU (P2002)', async () => {
      prisma.product.create.mockRejectedValue({ code: 'P2002' });

      await expect(
        service.create({ name: 'Widget', sku: 'DUPE-SKU' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('findAll', () => {
    it('returns paginated list', async () => {
      const product = { id: 'prod-1', name: 'Widget', tenantId: 'tenant-1' };
      prisma.product.findMany.mockResolvedValue([product]);
      prisma.product.count.mockResolvedValue(1);

      const result = await service.findAll({ page: 1, limit: 20 });

      expect(result.data).toHaveLength(1);
      expect(result.meta.total).toBe(1);
    });

    it('filters by category', async () => {
      prisma.product.findMany.mockResolvedValue([]);
      prisma.product.count.mockResolvedValue(0);

      await service.findAll({ page: 1, limit: 20, category: 'Electronics' });

      expect(prisma.product.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ category: expect.any(Object) }),
        }),
      );
    });
  });

  describe('findOne', () => {
    it('throws NotFoundException when not found', async () => {
      prisma.product.findFirst.mockResolvedValue(null);

      await expect(service.findOne('nonexistent')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('update', () => {
    it('throws ConflictException on duplicate SKU (P2002)', async () => {
      prisma.product.findFirst.mockResolvedValue({ id: 'prod-1', name: 'Widget', tenantId: 'tenant-1' });
      prisma.product.update.mockRejectedValue({ code: 'P2002' });

      await expect(
        service.update('prod-1', { sku: 'EXISTING-SKU' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('updateStatus', () => {
    it('updates status', async () => {
      const existing = { id: 'prod-1', name: 'Widget', status: 'ACTIVE', tenantId: 'tenant-1' };
      prisma.product.findFirst.mockResolvedValue(existing);
      prisma.product.update.mockResolvedValue({ ...existing, status: 'INACTIVE' });

      const result = await service.updateStatus('prod-1', { status: 'INACTIVE' });

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
