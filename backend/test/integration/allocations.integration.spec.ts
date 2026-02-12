import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { v4 as uuid } from 'uuid';
import { AppModule } from '../../src/app.module';
import {
  cleanDatabase,
  setupTestDatabase,
  teardownTestDatabase,
  getTestPrismaClient,
} from '../helpers/test-database';
import { createTestApp, generateTestJWT, authHeader } from '../helpers/test-utils';
import {
  createTenantWithUser,
  createTestSupplier,
  createTestCustomer,
  createTestProduct,
  createTestPaymentAccount,
  createAndPostPurchase,
  createAndPostSupplierPayment,
} from '../helpers/test-factories';
import { PrismaClient } from '@prisma/client';

describe('Allocations — List & Filters (Integration)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let token: string;
  let tenantId: string;
  let userId: string;

  beforeAll(async () => {
    await setupTestDatabase();
    app = await createTestApp({ imports: [AppModule] });
    prisma = getTestPrismaClient();
  });

  beforeEach(async () => {
    await cleanDatabase();
    const { tenant, user } = await createTenantWithUser(prisma);
    tenantId = tenant.id;
    userId = user.id;
    token = generateTestJWT({ userId, tenantId, email: user.email, role: user.role });
  });

  afterAll(async () => {
    await teardownTestDatabase();
    await app.close();
  });

  // ─── LIST ALL ────────────────────────────────────────────────────────────────

  describe('GET /api/v1/transactions/allocations', () => {
    it('returns empty list when no allocations exist', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/transactions/allocations')
        .set(authHeader(token))
        .expect(200);

      expect(res.body.data).toHaveLength(0);
      expect(res.body.meta.total).toBe(0);
    });

    it('returns all allocations with related transactions', async () => {
      const supplier = await createTestSupplier(prisma, tenantId, userId);
      const product = await createTestProduct(prisma, tenantId, userId);
      const account = await createTestPaymentAccount(prisma, tenantId, userId);

      const purchase = await createAndPostPurchase(app, token, {
        supplierId: supplier.id,
        lines: [{ productId: product.id, quantity: 5, unitCost: 2000 }],
      });

      const payment = await createAndPostSupplierPayment(app, token, {
        supplierId: supplier.id,
        amount: 10000,
        paymentAccountId: account.id,
        allocations: [{ transactionId: purchase.id, amount: 10000 }],
      });

      const res = await request(app.getHttpServer())
        .get('/api/v1/transactions/allocations')
        .set(authHeader(token))
        .expect(200);

      expect(res.body.data).toHaveLength(1);
      expect(res.body.meta.total).toBe(1);

      const alloc = res.body.data[0];
      expect(alloc.amountApplied).toBe(10000);
      expect(alloc.paymentTransaction).toBeDefined();
      expect(alloc.paymentTransaction.id).toBe(payment.id);
      expect(alloc.paymentTransaction.documentNumber).toMatch(/^SPY-/);
      expect(alloc.appliesToTransaction).toBeDefined();
      expect(alloc.appliesToTransaction.id).toBe(purchase.id);
      expect(alloc.appliesToTransaction.documentNumber).toMatch(/^PUR-/);
    });

    it('filters by supplierId', async () => {
      const supplier1 = await createTestSupplier(prisma, tenantId, userId);
      const supplier2 = await createTestSupplier(prisma, tenantId, userId);
      const product = await createTestProduct(prisma, tenantId, userId);
      const account = await createTestPaymentAccount(prisma, tenantId, userId);

      // Purchases for both suppliers
      await createAndPostPurchase(app, token, {
        supplierId: supplier1.id,
        lines: [{ productId: product.id, quantity: 3, unitCost: 1000 }],
      });
      await createAndPostPurchase(app, token, {
        supplierId: supplier2.id,
        lines: [{ productId: product.id, quantity: 3, unitCost: 1000 }],
      });

      // Payments for both
      await createAndPostSupplierPayment(app, token, {
        supplierId: supplier1.id,
        amount: 3000,
        paymentAccountId: account.id,
      });
      await createAndPostSupplierPayment(app, token, {
        supplierId: supplier2.id,
        amount: 3000,
        paymentAccountId: account.id,
      });

      const res = await request(app.getHttpServer())
        .get(`/api/v1/transactions/allocations?supplierId=${supplier1.id}`)
        .set(authHeader(token))
        .expect(200);

      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].paymentTransaction.type).toBe('SUPPLIER_PAYMENT');
    });

    it('filters by purchaseId', async () => {
      const supplier = await createTestSupplier(prisma, tenantId, userId);
      const product = await createTestProduct(prisma, tenantId, userId);
      const account = await createTestPaymentAccount(prisma, tenantId, userId);

      const purchase1 = await createAndPostPurchase(app, token, {
        supplierId: supplier.id,
        lines: [{ productId: product.id, quantity: 3, unitCost: 1000 }],
      });
      const purchase2 = await createAndPostPurchase(app, token, {
        supplierId: supplier.id,
        lines: [{ productId: product.id, quantity: 3, unitCost: 1000 }],
      });

      await createAndPostSupplierPayment(app, token, {
        supplierId: supplier.id,
        amount: 3000,
        paymentAccountId: account.id,
        allocations: [{ transactionId: purchase1.id, amount: 3000 }],
      });
      await createAndPostSupplierPayment(app, token, {
        supplierId: supplier.id,
        amount: 3000,
        paymentAccountId: account.id,
        allocations: [{ transactionId: purchase2.id, amount: 3000 }],
      });

      const res = await request(app.getHttpServer())
        .get(`/api/v1/transactions/allocations?purchaseId=${purchase1.id}`)
        .set(authHeader(token))
        .expect(200);

      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].appliesToTransaction.id).toBe(purchase1.id);
    });

    it('paginates correctly', async () => {
      const supplier = await createTestSupplier(prisma, tenantId, userId);
      const product = await createTestProduct(prisma, tenantId, userId);
      const account = await createTestPaymentAccount(prisma, tenantId, userId);

      // Create 3 purchases and 3 payments (= 3 allocations)
      for (let i = 0; i < 3; i++) {
        const purchase = await createAndPostPurchase(app, token, {
          supplierId: supplier.id,
          lines: [{ productId: product.id, quantity: 1, unitCost: 1000 }],
        });
        await createAndPostSupplierPayment(app, token, {
          supplierId: supplier.id,
          amount: 1000,
          paymentAccountId: account.id,
          allocations: [{ transactionId: purchase.id, amount: 1000 }],
        });
      }

      const page1 = await request(app.getHttpServer())
        .get('/api/v1/transactions/allocations?page=1&limit=2')
        .set(authHeader(token))
        .expect(200);

      expect(page1.body.data).toHaveLength(2);
      expect(page1.body.meta.total).toBe(3);
      expect(page1.body.meta.page).toBe(1);

      const page2 = await request(app.getHttpServer())
        .get('/api/v1/transactions/allocations?page=2&limit=2')
        .set(authHeader(token))
        .expect(200);

      expect(page2.body.data).toHaveLength(1);
    });

    it('tenant isolation: cannot see allocations from another tenant', async () => {
      const { tenant: t2, user: u2 } = await createTenantWithUser(prisma);
      const t2Token = generateTestJWT({ userId: u2.id, tenantId: t2.id, email: u2.email, role: u2.role });

      const supplier2 = await createTestSupplier(prisma, t2.id, u2.id);
      const product2 = await createTestProduct(prisma, t2.id, u2.id);
      const account2 = await createTestPaymentAccount(prisma, t2.id, u2.id);

      const purchase2 = await createAndPostPurchase(app, t2Token, {
        supplierId: supplier2.id,
        lines: [{ productId: product2.id, quantity: 1, unitCost: 1000 }],
      });

      await createAndPostSupplierPayment(app, t2Token, {
        supplierId: supplier2.id,
        amount: 1000,
        paymentAccountId: account2.id,
        allocations: [{ transactionId: purchase2.id, amount: 1000 }],
      });

      // Tenant 1 should see 0 allocations
      const res = await request(app.getHttpServer())
        .get('/api/v1/transactions/allocations')
        .set(authHeader(token))
        .expect(200);

      expect(res.body.data).toHaveLength(0);
    });

    it('returns 401 without auth', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/transactions/allocations')
        .expect(401);
    });
  });
});
