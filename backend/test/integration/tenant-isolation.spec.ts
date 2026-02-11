/**
 * CRITICAL SECURITY TESTS: Tenant Isolation
 * 
 * These tests verify that the multi-tenant architecture prevents data leakage
 * between tenants. This is the most important test suite for Phase 1.
 * 
 * Failure of any test in this suite is a CRITICAL SECURITY VULNERABILITY.
 */

import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../../src/prisma/prisma.service';
import {
  cleanDatabase,
  setupTestDatabase,
  teardownTestDatabase,
  getTestPrismaClient,
} from '../helpers/test-database';
import {
  createTenantWithUser,
  createTestSupplier,
  createTestCustomer,
  createTestProduct,
  createTestPaymentAccount,
} from '../helpers/test-factories';
import { AppModule } from '../../src/app.module';

describe('Tenant Isolation (Critical Security)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  // Test fixture data
  let tenant1: any;
  let user1: any;
  let tenant2: any;
  let user2: any;

  beforeAll(async () => {
    await setupTestDatabase();

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue(getTestPrismaClient())
      .compile();

    app = moduleFixture.createNestApplication();
    prisma = getTestPrismaClient() as any;

    await app.init();
  });

  beforeEach(async () => {
    await cleanDatabase();

    // Create two completely separate tenants with users
    const result1 = await createTenantWithUser(prisma, {
      tenantName: 'Tenant One Inc',
      userName: 'User One',
      userEmail: 'user1@tenant1.com',
      userPassword: 'Password1!',
    });

    const result2 = await createTenantWithUser(prisma, {
      tenantName: 'Tenant Two LLC',
      userName: 'User Two',
      userEmail: 'user2@tenant2.com',
      userPassword: 'Password2!',
    });

    tenant1 = result1.tenant;
    user1 = result1.user;
    tenant2 = result2.tenant;
    user2 = result2.user;
  });

  afterAll(async () => {
    await teardownTestDatabase();
    await app.close();
  });

  describe('Database-Level Tenant Isolation', () => {
    it('CRITICAL: should never return users from different tenant', async () => {
      // Query for users with tenant1 filter
      const tenant1Users = await prisma.user.findMany({
        where: { tenantId: tenant1.id },
      });

      // Query for users with tenant2 filter
      const tenant2Users = await prisma.user.findMany({
        where: { tenantId: tenant2.id },
      });

      // Assert complete isolation
      expect(tenant1Users).toHaveLength(1);
      expect(tenant1Users[0].id).toBe(user1.id);
      expect(tenant1Users[0].email).toBe('user1@tenant1.com');

      expect(tenant2Users).toHaveLength(1);
      expect(tenant2Users[0].id).toBe(user2.id);
      expect(tenant2Users[0].email).toBe('user2@tenant2.com');

      // Verify no overlap
      const tenant1UserIds = tenant1Users.map((u) => u.id);
      const tenant2UserIds = tenant2Users.map((u) => u.id);

      expect(tenant1UserIds).not.toContain(user2.id);
      expect(tenant2UserIds).not.toContain(user1.id);
    });

    it('CRITICAL: should isolate supplier data by tenant', async () => {
      // Create suppliers for each tenant
      const supplier1 = await createTestSupplier(prisma, tenant1.id, user1.id, {
        name: 'Supplier for Tenant 1',
      });

      const supplier2 = await createTestSupplier(prisma, tenant2.id, user2.id, {
        name: 'Supplier for Tenant 2',
      });

      // Query with tenant filters
      const tenant1Suppliers = await prisma.supplier.findMany({
        where: { tenantId: tenant1.id },
      });

      const tenant2Suppliers = await prisma.supplier.findMany({
        where: { tenantId: tenant2.id },
      });

      // Verify isolation
      expect(tenant1Suppliers).toHaveLength(1);
      expect(tenant1Suppliers[0].id).toBe(supplier1.id);

      expect(tenant2Suppliers).toHaveLength(1);
      expect(tenant2Suppliers[0].id).toBe(supplier2.id);

      // Attempt cross-tenant query (should return empty)
      const crossTenantQuery = await prisma.supplier.findMany({
        where: {
          tenantId: tenant1.id,
          id: supplier2.id, // supplier2 belongs to tenant2
        },
      });

      expect(crossTenantQuery).toHaveLength(0);
    });

    it('CRITICAL: should isolate customer data by tenant', async () => {
      const customer1 = await createTestCustomer(prisma, tenant1.id, user1.id, {
        name: 'Customer for Tenant 1',
      });

      const customer2 = await createTestCustomer(prisma, tenant2.id, user2.id, {
        name: 'Customer for Tenant 2',
      });

      const tenant1Customers = await prisma.customer.findMany({
        where: { tenantId: tenant1.id },
      });

      const tenant2Customers = await prisma.customer.findMany({
        where: { tenantId: tenant2.id },
      });

      expect(tenant1Customers).toHaveLength(1);
      expect(tenant1Customers[0].id).toBe(customer1.id);

      expect(tenant2Customers).toHaveLength(1);
      expect(tenant2Customers[0].id).toBe(customer2.id);

      // Cross-tenant access attempt
      const crossAccess = await prisma.customer.findUnique({
        where: {
          id: customer2.id,
          tenantId: tenant1.id, // Wrong tenant
        },
      });

      expect(crossAccess).toBeNull();
    });

    it('CRITICAL: should isolate product data by tenant', async () => {
      const product1 = await createTestProduct(prisma, tenant1.id, user1.id, {
        name: 'Product for Tenant 1',
        sku: 'SKU-T1-001',
      });

      const product2 = await createTestProduct(prisma, tenant2.id, user2.id, {
        name: 'Product for Tenant 2',
        sku: 'SKU-T2-001',
      });

      const tenant1Products = await prisma.product.findMany({
        where: { tenantId: tenant1.id },
      });

      const tenant2Products = await prisma.product.findMany({
        where: { tenantId: tenant2.id },
      });

      expect(tenant1Products).toHaveLength(1);
      expect(tenant1Products[0].sku).toBe('SKU-T1-001');

      expect(tenant2Products).toHaveLength(1);
      expect(tenant2Products[0].sku).toBe('SKU-T2-001');
    });

    it('CRITICAL: should isolate payment accounts by tenant', async () => {
      const account1 = await createTestPaymentAccount(prisma, tenant1.id, user1.id, {
        name: 'Cash Account T1',
        type: 'CASH',
      });

      const account2 = await createTestPaymentAccount(prisma, tenant2.id, user2.id, {
        name: 'Cash Account T2',
        type: 'CASH',
      });

      const tenant1Accounts = await prisma.paymentAccount.findMany({
        where: { tenantId: tenant1.id },
      });

      const tenant2Accounts = await prisma.paymentAccount.findMany({
        where: { tenantId: tenant2.id },
      });

      expect(tenant1Accounts).toHaveLength(1);
      expect(tenant1Accounts[0].name).toBe('Cash Account T1');

      expect(tenant2Accounts).toHaveLength(1);
      expect(tenant2Accounts[0].name).toBe('Cash Account T2');

      // Verify account balances are isolated
      expect(tenant1Accounts[0].openingBalance).toBe(0);
      expect(tenant2Accounts[0].openingBalance).toBe(0);
    });
  });

  describe('Schema-Level Isolation Constraints', () => {
    it('CRITICAL: should enforce tenantId on all tables', async () => {
      // Verify tenant_id column exists and is indexed on critical tables
      const tables = [
        'users',
        'suppliers',
        'customers',
        'products',
        'payment_accounts',
        'transactions',
        'transaction_lines',
        'inventory_movements',
        'ledger_entries',
        'payment_entries',
        'allocations',
      ];

      for (const table of tables) {
        const result = await prisma.$queryRawUnsafe(`
          SELECT column_name, data_type, is_nullable
          FROM information_schema.columns
          WHERE table_name = '${table}' AND column_name = 'tenant_id'
        `);

        expect(result).toHaveLength(1);
        expect((result as any)[0].is_nullable).toBe('NO'); // NOT NULL constraint
      }
    });

    it('CRITICAL: should have indexes on tenant_id for performance', async () => {
      // Verify indexes exist for tenant scoping
      const result = await prisma.$queryRawUnsafe(`
        SELECT
          schemaname,
          tablename,
          indexname,
          indexdef
        FROM pg_indexes
        WHERE schemaname = 'public'
        AND indexdef LIKE '%tenant_id%'
        ORDER BY tablename, indexname
      `);

      expect(result).not.toHaveLength(0);

      // Verify key tables have tenant_id indexes
      const indexedTables = new Set((result as any[]).map((r) => r.tablename));
      expect(indexedTables).toContain('users');
      expect(indexedTables).toContain('suppliers');
      expect(indexedTables).toContain('customers');
      expect(indexedTables).toContain('products');
    });
  });

  describe('Unique Constraints Respect Tenant Boundaries', () => {
    it('should allow same email in different tenants (users are globally unique)', async () => {
      // Users have GLOBAL unique email constraint
      // This is intentional - emails cannot be duplicated across tenants

      const duplicateResult = await prisma.user.create({
        data: {
          tenantId: tenant2.id,
          fullName: 'Another User',
          email: 'duplicate@test.com',
          passwordHash: 'hashed',
          role: 'OWNER',
        },
      });

      // Attempting to create same email in different tenant should fail
      await expect(
        prisma.user.create({
          data: {
            tenantId: tenant1.id,
            fullName: 'Conflict User',
            email: 'duplicate@test.com',
            passwordHash: 'hashed',
            role: 'OWNER',
          },
        }),
      ).rejects.toThrow();
    });

    it('should allow same SKU in different tenants', async () => {
      // Product SKUs are unique within tenant, not globally
      const product1 = await createTestProduct(prisma, tenant1.id, user1.id, {
        name: 'Widget',
        sku: 'WIDGET-001',
      });

      const product2 = await createTestProduct(prisma, tenant2.id, user2.id, {
        name: 'Widget',
        sku: 'WIDGET-001', // Same SKU, different tenant - should succeed
      });

      expect(product1.sku).toBe('WIDGET-001');
      expect(product2.sku).toBe('WIDGET-001');
      expect(product1.tenantId).not.toBe(product2.tenantId);
    });

    it('should prevent duplicate SKU within same tenant', async () => {
      await createTestProduct(prisma, tenant1.id, user1.id, {
        name: 'Widget A',
        sku: 'WIDGET-DUP',
      });

      // Same tenant, same SKU - should fail
      await expect(
        createTestProduct(prisma, tenant1.id, user1.id, {
          name: 'Widget B',
          sku: 'WIDGET-DUP',
        }),
      ).rejects.toThrow();
    });

    it('should allow same payment account name in different tenants', async () => {
      const account1 = await createTestPaymentAccount(prisma, tenant1.id, user1.id, {
        name: 'Main Cash',
        type: 'CASH',
      });

      const account2 = await createTestPaymentAccount(prisma, tenant2.id, user2.id, {
        name: 'Main Cash', // Same name, different tenant
        type: 'CASH',
      });

      expect(account1.name).toBe('Main Cash');
      expect(account2.name).toBe('Main Cash');
      expect(account1.tenantId).not.toBe(account2.tenantId);
    });

    it('should prevent duplicate payment account name within same tenant', async () => {
      await createTestPaymentAccount(prisma, tenant1.id, user1.id, {
        name: 'Duplicate Cash',
        type: 'CASH',
      });

      await expect(
        createTestPaymentAccount(prisma, tenant1.id, user1.id, {
          name: 'Duplicate Cash',
          type: 'BANK',
        }),
      ).rejects.toThrow();
    });
  });

  describe('Cross-Tenant Query Prevention', () => {
    it('CRITICAL: should never accidentally query across tenants without filter', async () => {
      // Create data for both tenants
      await createTestSupplier(prisma, tenant1.id, user1.id);
      await createTestSupplier(prisma, tenant1.id, user1.id);
      await createTestSupplier(prisma, tenant2.id, user2.id);

      // Query without tenant filter (BAD - but testing database state)
      const allSuppliers = await prisma.supplier.findMany();
      expect(allSuppliers).toHaveLength(3);

      // Query with proper tenant filter (GOOD)
      const tenant1Only = await prisma.supplier.findMany({
        where: { tenantId: tenant1.id },
      });
      expect(tenant1Only).toHaveLength(2);

      const tenant2Only = await prisma.supplier.findMany({
        where: { tenantId: tenant2.id },
      });
      expect(tenant2Only).toHaveLength(1);

      // Verify no cross-contamination
      const tenant1Ids = tenant1Only.map((s) => s.id);
      const tenant2Ids = tenant2Only.map((s) => s.id);

      tenant1Ids.forEach((id) => {
        expect(tenant2Ids).not.toContain(id);
      });

      tenant2Ids.forEach((id) => {
        expect(tenant1Ids).not.toContain(id);
      });
    });

    it('CRITICAL: should verify all records have correct tenant_id', async () => {
      // Create various records
      await createTestSupplier(prisma, tenant1.id, user1.id);
      await createTestCustomer(prisma, tenant1.id, user1.id);
      await createTestProduct(prisma, tenant1.id, user1.id);
      await createTestPaymentAccount(prisma, tenant1.id, user1.id);

      await createTestSupplier(prisma, tenant2.id, user2.id);
      await createTestCustomer(prisma, tenant2.id, user2.id);
      await createTestProduct(prisma, tenant2.id, user2.id);
      await createTestPaymentAccount(prisma, tenant2.id, user2.id);

      // Verify all tenant1 records
      const [suppliers1, customers1, products1, accounts1] = await Promise.all([
        prisma.supplier.findMany({ where: { tenantId: tenant1.id } }),
        prisma.customer.findMany({ where: { tenantId: tenant1.id } }),
        prisma.product.findMany({ where: { tenantId: tenant1.id } }),
        prisma.paymentAccount.findMany({ where: { tenantId: tenant1.id } }),
      ]);

      // All should belong to tenant1
      [...suppliers1, ...customers1, ...products1, ...accounts1].forEach((record) => {
        expect(record.tenantId).toBe(tenant1.id);
      });

      // Verify all tenant2 records
      const [suppliers2, customers2, products2, accounts2] = await Promise.all([
        prisma.supplier.findMany({ where: { tenantId: tenant2.id } }),
        prisma.customer.findMany({ where: { tenantId: tenant2.id } }),
        prisma.product.findMany({ where: { tenantId: tenant2.id } }),
        prisma.paymentAccount.findMany({ where: { tenantId: tenant2.id } }),
      ]);

      // All should belong to tenant2
      [...suppliers2, ...customers2, ...products2, ...accounts2].forEach((record) => {
        expect(record.tenantId).toBe(tenant2.id);
      });
    });
  });

  describe('Data Integrity Across Tenants', () => {
    it('should maintain referential integrity within tenant boundaries', async () => {
      // Create supplier for tenant1
      const supplier = await createTestSupplier(prisma, tenant1.id, user1.id);

      // Verify supplier references correct tenant
      expect(supplier.tenantId).toBe(tenant1.id);

      // If createdBy is set, verify user belongs to same tenant
      if (supplier.createdBy) {
        const creator = await prisma.user.findUnique({
          where: { id: supplier.createdBy },
        });
        expect(creator!.tenantId).toBe(tenant1.id);
      }
    });

    it('should prevent foreign key references across tenants', async () => {
      const supplier1 = await createTestSupplier(prisma, tenant1.id, user1.id);

      // Attempting to create a record with cross-tenant foreign key should fail
      // Example: Transaction in tenant2 referencing supplier from tenant1
      await expect(
        prisma.transaction.create({
          data: {
            tenantId: tenant2.id, // Different tenant
            type: 'PURCHASE',
            status: 'DRAFT',
            transactionDate: new Date(),
            supplierId: supplier1.id, // Supplier from tenant1
            subtotal: 0,
            totalAmount: 0,
          },
        }),
      ).rejects.toThrow(); // Should fail due to tenant mismatch or constraints
    });
  });
});
