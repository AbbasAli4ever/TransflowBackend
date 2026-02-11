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
    };

    service = new SuppliersService(prisma as PrismaService);
  });

  describe('create', () => {
    it('throws ConflictException on duplicate name', async () => {
      prisma.supplier.findFirst.mockResolvedValue({ id: 'existing' });

      await expect(
        service.create({ name: 'Acme' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('creates supplier and returns with _computed', async () => {
      prisma.supplier.findFirst.mockResolvedValue(null);
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
      expect(result._computed).toBeDefined();
      expect(result._computed.totalPurchases).toBe(0);
      expect(result._computed.currentBalance).toBe(0);
    });
  });

  describe('findAll', () => {
    it('returns paginated list', async () => {
      const supplier = { id: 'sup-1', name: 'Acme', tenantId: 'tenant-1' };
      prisma.supplier.findMany.mockResolvedValue([supplier]);
      prisma.supplier.count.mockResolvedValue(1);

      const result = await service.findAll({ page: 1, limit: 20 });

      expect(result.data).toHaveLength(1);
      expect(result.meta.total).toBe(1);
      expect(result.meta.totalPages).toBe(1);
    });
  });

  describe('findOne', () => {
    it('throws NotFoundException when not found', async () => {
      prisma.supplier.findFirst.mockResolvedValue(null);

      await expect(service.findOne('nonexistent-id')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('returns supplier with _computed', async () => {
      const supplier = { id: 'sup-1', name: 'Acme', tenantId: 'tenant-1' };
      prisma.supplier.findFirst.mockResolvedValue(supplier);

      const result = await service.findOne('sup-1');

      expect(result.name).toBe('Acme');
      expect(result._computed).toBeDefined();
    });
  });

  describe('update', () => {
    it('throws NotFoundException when not found', async () => {
      prisma.supplier.findFirst.mockResolvedValue(null);

      await expect(service.update('nonexistent', { name: 'New' })).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws ConflictException on duplicate name', async () => {
      prisma.supplier.findFirst
        .mockResolvedValueOnce({ id: 'sup-1', name: 'Original' })
        .mockResolvedValueOnce({ id: 'sup-2', name: 'New Name' }); // conflict

      await expect(service.update('sup-1', { name: 'New Name' })).rejects.toBeInstanceOf(ConflictException);
    });

    it('updates and returns with _computed', async () => {
      const existing = { id: 'sup-1', name: 'Original', tenantId: 'tenant-1' };
      prisma.supplier.findFirst
        .mockResolvedValueOnce(existing)
        .mockResolvedValueOnce(null); // no conflict

      prisma.supplier.update.mockResolvedValue({ ...existing, name: 'Updated' });

      const result = await service.update('sup-1', { name: 'Updated' });

      expect(result.name).toBe('Updated');
      expect(result._computed).toBeDefined();
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
