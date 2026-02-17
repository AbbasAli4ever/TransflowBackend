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
} from '../helpers/test-factories';
import { PrismaClient } from '@prisma/client';

describe('Balance & Stock Queries (Integration)', () => {
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

  // ─── PRODUCT STOCK ─────────────────────────────────────────────────────────

  describe('GET /api/v1/products/:id/stock', () => {
    it('returns zero stock for new product', async () => {
      const product = await createTestProduct(prisma, tenantId, userId);

      const res = await request(app.getHttpServer())
        .get(`/api/v1/products/${product.id}/stock`)
        .set(authHeader(token))
        .expect(200);

      expect(res.body.productId).toBe(product.id);
      expect(res.body.totalStock).toBe(0);
    });

    it('returns correct stock after a purchase', async () => {
      const supplier = await createTestSupplier(prisma, tenantId, userId);
      const product = await createTestProduct(prisma, tenantId, userId);

      await createAndPostPurchase(app, token, {
        supplierId: supplier.id,
        lines: [{ variantId: product.variants[0].id, quantity: 15, unitCost: 400 }],
      });

      const res = await request(app.getHttpServer())
        .get(`/api/v1/products/${product.id}/stock`)
        .set(authHeader(token))
        .expect(200);

      expect(res.body.totalStock).toBe(15);
      expect(res.body.variants[0].avgCost).toBe(400);
    });

    it('returns reduced stock after a sale', async () => {
      const supplier = await createTestSupplier(prisma, tenantId, userId);
      const customer = await createTestCustomer(prisma, tenantId, userId);
      const product = await createTestProduct(prisma, tenantId, userId);

      await createAndPostPurchase(app, token, {
        supplierId: supplier.id,
        lines: [{ variantId: product.variants[0].id, quantity: 10, unitCost: 500 }],
      });

      // Create and post a sale
      const saleDraft = await request(app.getHttpServer())
        .post('/api/v1/transactions/sales/draft')
        .set(authHeader(token))
        .send({
          customerId: customer.id,
          transactionDate: new Date().toISOString().split('T')[0],
          lines: [{ variantId: product.variants[0].id, quantity: 4, unitPrice: 800 }],
        })
        .expect(201);

      await request(app.getHttpServer())
        .post(`/api/v1/transactions/${saleDraft.body.id}/post`)
        .set(authHeader(token))
        .send({ idempotencyKey: uuid() })
        .expect(200);

      const res = await request(app.getHttpServer())
        .get(`/api/v1/products/${product.id}/stock`)
        .set(authHeader(token))
        .expect(200);

      expect(res.body.totalStock).toBe(6); // 10 - 4
    });

    it('returns 404 for unknown product', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/products/00000000-0000-0000-0000-000000000099/stock')
        .set(authHeader(token))
        .expect(404);
    });

    it('tenant isolation: cannot query other tenant product stock (404)', async () => {
      const { tenant: t2, user: u2 } = await createTenantWithUser(prisma);
      const product2 = await createTestProduct(prisma, t2.id, u2.id);

      await request(app.getHttpServer())
        .get(`/api/v1/products/${product2.id}/stock`)
        .set(authHeader(token))
        .expect(404);
    });
  });

  // ─── SUPPLIER BALANCE ──────────────────────────────────────────────────────

  describe('GET /api/v1/suppliers/:id/balance', () => {
    it('returns zero balance for supplier with no transactions', async () => {
      const supplier = await createTestSupplier(prisma, tenantId, userId);

      const res = await request(app.getHttpServer())
        .get(`/api/v1/suppliers/${supplier.id}/balance`)
        .set(authHeader(token))
        .expect(200);

      expect(res.body.supplierId).toBe(supplier.id);
      expect(res.body.totalPurchases).toBe(0);
      expect(res.body.totalPayments).toBe(0);
      expect(res.body.totalReturns).toBe(0);
      expect(res.body.currentBalance).toBe(0);
    });

    it('reflects purchase total in balance', async () => {
      const supplier = await createTestSupplier(prisma, tenantId, userId);
      const product = await createTestProduct(prisma, tenantId, userId);

      await createAndPostPurchase(app, token, {
        supplierId: supplier.id,
        lines: [{ variantId: product.variants[0].id, quantity: 10, unitCost: 500 }],
      });

      const res = await request(app.getHttpServer())
        .get(`/api/v1/suppliers/${supplier.id}/balance`)
        .set(authHeader(token))
        .expect(200);

      expect(res.body.totalPurchases).toBe(5000);
      expect(res.body.totalPayments).toBe(0);
      expect(res.body.totalReturns).toBe(0);
      expect(res.body.currentBalance).toBe(5000);
    });

    it('reflects partial payment in balance', async () => {
      const supplier = await createTestSupplier(prisma, tenantId, userId);
      const product = await createTestProduct(prisma, tenantId, userId);
      const account = await createTestPaymentAccount(prisma, tenantId, userId);

      await createAndPostPurchase(app, token, {
        supplierId: supplier.id,
        lines: [{ variantId: product.variants[0].id, quantity: 10, unitCost: 1000 }],
        paidNow: 3000,
        paymentAccountId: account.id,
      });

      const res = await request(app.getHttpServer())
        .get(`/api/v1/suppliers/${supplier.id}/balance`)
        .set(authHeader(token))
        .expect(200);

      expect(res.body.totalPurchases).toBe(10000);
      expect(res.body.totalPayments).toBe(3000);
      expect(res.body.totalReturns).toBe(0);
      expect(res.body.currentBalance).toBe(7000);
    });

    it('accumulates across multiple purchases', async () => {
      const supplier = await createTestSupplier(prisma, tenantId, userId);
      const product = await createTestProduct(prisma, tenantId, userId);

      await createAndPostPurchase(app, token, {
        supplierId: supplier.id,
        lines: [{ variantId: product.variants[0].id, quantity: 5, unitCost: 1000 }],
      });

      await createAndPostPurchase(app, token, {
        supplierId: supplier.id,
        lines: [{ variantId: product.variants[0].id, quantity: 3, unitCost: 2000 }],
      });

      const res = await request(app.getHttpServer())
        .get(`/api/v1/suppliers/${supplier.id}/balance`)
        .set(authHeader(token))
        .expect(200);

      expect(res.body.totalPurchases).toBe(11000); // 5000 + 6000
      expect(res.body.currentBalance).toBe(11000);
    });

    it('returns 404 for unknown supplier', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/suppliers/00000000-0000-0000-0000-000000000099/balance')
        .set(authHeader(token))
        .expect(404);
    });

    it('tenant isolation: cannot query other tenant supplier balance (404)', async () => {
      const { tenant: t2, user: u2 } = await createTenantWithUser(prisma);
      const supplier2 = await createTestSupplier(prisma, t2.id, u2.id);

      await request(app.getHttpServer())
        .get(`/api/v1/suppliers/${supplier2.id}/balance`)
        .set(authHeader(token))
        .expect(404);
    });
  });

  // ─── CUSTOMER BALANCE ──────────────────────────────────────────────────────

  describe('GET /api/v1/customers/:id/balance', () => {
    it('returns zero balance for customer with no transactions', async () => {
      const customer = await createTestCustomer(prisma, tenantId, userId);

      const res = await request(app.getHttpServer())
        .get(`/api/v1/customers/${customer.id}/balance`)
        .set(authHeader(token))
        .expect(200);

      expect(res.body.customerId).toBe(customer.id);
      expect(res.body.totalSales).toBe(0);
      expect(res.body.totalPayments).toBe(0);
      expect(res.body.currentBalance).toBe(0);
    });

    it('reflects sale total in balance', async () => {
      const supplier = await createTestSupplier(prisma, tenantId, userId);
      const customer = await createTestCustomer(prisma, tenantId, userId);
      const product = await createTestProduct(prisma, tenantId, userId);

      await createAndPostPurchase(app, token, {
        supplierId: supplier.id,
        lines: [{ variantId: product.variants[0].id, quantity: 20, unitCost: 300 }],
      });

      const saleDraft = await request(app.getHttpServer())
        .post('/api/v1/transactions/sales/draft')
        .set(authHeader(token))
        .send({
          customerId: customer.id,
          transactionDate: new Date().toISOString().split('T')[0],
          lines: [{ variantId: product.variants[0].id, quantity: 8, unitPrice: 600 }],
        })
        .expect(201);

      await request(app.getHttpServer())
        .post(`/api/v1/transactions/${saleDraft.body.id}/post`)
        .set(authHeader(token))
        .send({ idempotencyKey: uuid() })
        .expect(200);

      const res = await request(app.getHttpServer())
        .get(`/api/v1/customers/${customer.id}/balance`)
        .set(authHeader(token))
        .expect(200);

      expect(res.body.totalSales).toBe(4800); // 8 * 600
      expect(res.body.totalPayments).toBe(0);
      expect(res.body.currentBalance).toBe(4800);
    });

    it('reflects payment received in balance', async () => {
      const supplier = await createTestSupplier(prisma, tenantId, userId);
      const customer = await createTestCustomer(prisma, tenantId, userId);
      const product = await createTestProduct(prisma, tenantId, userId);
      const account = await createTestPaymentAccount(prisma, tenantId, userId);

      await createAndPostPurchase(app, token, {
        supplierId: supplier.id,
        lines: [{ variantId: product.variants[0].id, quantity: 10, unitCost: 200 }],
      });

      const saleDraft = await request(app.getHttpServer())
        .post('/api/v1/transactions/sales/draft')
        .set(authHeader(token))
        .send({
          customerId: customer.id,
          transactionDate: new Date().toISOString().split('T')[0],
          lines: [{ variantId: product.variants[0].id, quantity: 5, unitPrice: 500 }],
        })
        .expect(201);

      await request(app.getHttpServer())
        .post(`/api/v1/transactions/${saleDraft.body.id}/post`)
        .set(authHeader(token))
        .send({ idempotencyKey: uuid(), receivedNow: 1000, paymentAccountId: account.id })
        .expect(200);

      const res = await request(app.getHttpServer())
        .get(`/api/v1/customers/${customer.id}/balance`)
        .set(authHeader(token))
        .expect(200);

      expect(res.body.totalSales).toBe(2500); // 5 * 500
      expect(res.body.totalPayments).toBe(1000);
      expect(res.body.currentBalance).toBe(1500);
    });

    it('returns 404 for unknown customer', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/customers/00000000-0000-0000-0000-000000000099/balance')
        .set(authHeader(token))
        .expect(404);
    });

    it('tenant isolation: cannot query other tenant customer balance (404)', async () => {
      const { tenant: t2, user: u2 } = await createTenantWithUser(prisma);
      const customer2 = await createTestCustomer(prisma, t2.id, u2.id);

      await request(app.getHttpServer())
        .get(`/api/v1/customers/${customer2.id}/balance`)
        .set(authHeader(token))
        .expect(404);
    });
  });

  // ─── PAYMENT ACCOUNT BALANCE ───────────────────────────────────────────────

  describe('GET /api/v1/payment-accounts/:id/balance', () => {
    it('returns openingBalance when no transactions', async () => {
      const account = await createTestPaymentAccount(prisma, tenantId, userId, {
        openingBalance: 5000,
      });

      const res = await request(app.getHttpServer())
        .get(`/api/v1/payment-accounts/${account.id}/balance`)
        .set(authHeader(token))
        .expect(200);

      expect(res.body.paymentAccountId).toBe(account.id);
      expect(res.body.openingBalance).toBe(5000);
      expect(res.body.totalIn).toBe(0);
      expect(res.body.totalOut).toBe(0);
      expect(res.body.currentBalance).toBe(5000);
    });

    it('decreases after paying a supplier (MONEY_OUT)', async () => {
      const supplier = await createTestSupplier(prisma, tenantId, userId);
      const product = await createTestProduct(prisma, tenantId, userId);
      const account = await createTestPaymentAccount(prisma, tenantId, userId, {
        openingBalance: 10000,
      });

      await createAndPostPurchase(app, token, {
        supplierId: supplier.id,
        lines: [{ variantId: product.variants[0].id, quantity: 5, unitCost: 1000 }],
        paidNow: 3000,
        paymentAccountId: account.id,
      });

      const res = await request(app.getHttpServer())
        .get(`/api/v1/payment-accounts/${account.id}/balance`)
        .set(authHeader(token))
        .expect(200);

      expect(res.body.openingBalance).toBe(10000);
      expect(res.body.totalOut).toBe(3000);
      expect(res.body.totalIn).toBe(0);
      expect(res.body.currentBalance).toBe(7000); // 10000 - 3000
    });

    it('increases after receiving payment from customer (MONEY_IN)', async () => {
      const supplier = await createTestSupplier(prisma, tenantId, userId);
      const customer = await createTestCustomer(prisma, tenantId, userId);
      const product = await createTestProduct(prisma, tenantId, userId);
      const account = await createTestPaymentAccount(prisma, tenantId, userId, {
        openingBalance: 1000,
      });

      await createAndPostPurchase(app, token, {
        supplierId: supplier.id,
        lines: [{ variantId: product.variants[0].id, quantity: 10, unitCost: 200 }],
      });

      const saleDraft = await request(app.getHttpServer())
        .post('/api/v1/transactions/sales/draft')
        .set(authHeader(token))
        .send({
          customerId: customer.id,
          transactionDate: new Date().toISOString().split('T')[0],
          lines: [{ variantId: product.variants[0].id, quantity: 5, unitPrice: 500 }],
        })
        .expect(201);

      await request(app.getHttpServer())
        .post(`/api/v1/transactions/${saleDraft.body.id}/post`)
        .set(authHeader(token))
        .send({ idempotencyKey: uuid(), receivedNow: 2000, paymentAccountId: account.id })
        .expect(200);

      const res = await request(app.getHttpServer())
        .get(`/api/v1/payment-accounts/${account.id}/balance`)
        .set(authHeader(token))
        .expect(200);

      expect(res.body.openingBalance).toBe(1000);
      expect(res.body.totalIn).toBe(2000);
      expect(res.body.totalOut).toBe(0);
      expect(res.body.currentBalance).toBe(3000); // 1000 + 2000
    });

    it('handles both in and out correctly', async () => {
      const supplier = await createTestSupplier(prisma, tenantId, userId);
      const customer = await createTestCustomer(prisma, tenantId, userId);
      const product = await createTestProduct(prisma, tenantId, userId);
      const account = await createTestPaymentAccount(prisma, tenantId, userId, {
        openingBalance: 5000,
      });

      // Pay supplier 2000 out
      await createAndPostPurchase(app, token, {
        supplierId: supplier.id,
        lines: [{ variantId: product.variants[0].id, quantity: 10, unitCost: 500 }],
        paidNow: 2000,
        paymentAccountId: account.id,
      });

      // Receive 1500 from customer
      const saleDraft = await request(app.getHttpServer())
        .post('/api/v1/transactions/sales/draft')
        .set(authHeader(token))
        .send({
          customerId: customer.id,
          transactionDate: new Date().toISOString().split('T')[0],
          lines: [{ variantId: product.variants[0].id, quantity: 5, unitPrice: 700 }],
        })
        .expect(201);

      await request(app.getHttpServer())
        .post(`/api/v1/transactions/${saleDraft.body.id}/post`)
        .set(authHeader(token))
        .send({ idempotencyKey: uuid(), receivedNow: 1500, paymentAccountId: account.id })
        .expect(200);

      const res = await request(app.getHttpServer())
        .get(`/api/v1/payment-accounts/${account.id}/balance`)
        .set(authHeader(token))
        .expect(200);

      expect(res.body.totalOut).toBe(2000);
      expect(res.body.totalIn).toBe(1500);
      expect(res.body.currentBalance).toBe(4500); // 5000 - 2000 + 1500
    });

    it('returns 404 for unknown payment account', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/payment-accounts/00000000-0000-0000-0000-000000000099/balance')
        .set(authHeader(token))
        .expect(404);
    });

    it('tenant isolation: cannot query other tenant account balance (404)', async () => {
      const { tenant: t2, user: u2 } = await createTenantWithUser(prisma);
      const account2 = await createTestPaymentAccount(prisma, t2.id, u2.id);

      await request(app.getHttpServer())
        .get(`/api/v1/payment-accounts/${account2.id}/balance`)
        .set(authHeader(token))
        .expect(404);
    });
  });
});
