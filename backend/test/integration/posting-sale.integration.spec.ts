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

describe('Posting — SALE (Integration)', () => {
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

  async function createSaleDraft(customerId: string, productId: string, qty: number, unitPrice: number) {
    const res = await request(app.getHttpServer())
      .post('/api/v1/transactions/sales/draft')
      .set(authHeader(token))
      .send({
        customerId,
        transactionDate: new Date().toISOString().split('T')[0],
        lines: [{ productId, quantity: qty, unitPrice }],
      })
      .expect(201);
    return res.body;
  }

  // ─── FULL FLOW ─────────────────────────────────────────────────────────────

  describe('Full posting flow', () => {
    it('posts a sale with no payment', async () => {
      const supplier = await createTestSupplier(prisma, tenantId, userId);
      const customer = await createTestCustomer(prisma, tenantId, userId);
      const product = await createTestProduct(prisma, tenantId, userId);

      // First stock up
      await createAndPostPurchase(app, token, {
        supplierId: supplier.id,
        lines: [{ productId: product.id, quantity: 20, unitCost: 500 }],
      });

      const saleDraft = await createSaleDraft(customer.id, product.id, 5, 800);

      const res = await request(app.getHttpServer())
        .post(`/api/v1/transactions/${saleDraft.id}/post`)
        .set(authHeader(token))
        .send({ idempotencyKey: uuid() })
        .expect(200);

      expect(res.body.status).toBe('POSTED');
      const year = new Date().getFullYear();
      expect(res.body.documentNumber).toBe(`SAL-${year}-0001`);
      expect(res.body.series).toBe(String(year));
      expect(res.body.paidNow).toBe(0);
    });

    it('creates SALE_OUT movements with product avgCost as unitCostAtTime', async () => {
      const supplier = await createTestSupplier(prisma, tenantId, userId);
      const customer = await createTestCustomer(prisma, tenantId, userId);
      const product = await createTestProduct(prisma, tenantId, userId);

      // Purchase 10 units @ 600
      await createAndPostPurchase(app, token, {
        supplierId: supplier.id,
        lines: [{ productId: product.id, quantity: 10, unitCost: 600 }],
      });

      // Verify avgCost is set
      const updatedProduct = await prisma.product.findFirst({ where: { id: product.id } });
      expect(updatedProduct!.avgCost).toBe(600);

      const saleDraft = await createSaleDraft(customer.id, product.id, 3, 1000);
      const res = await request(app.getHttpServer())
        .post(`/api/v1/transactions/${saleDraft.id}/post`)
        .set(authHeader(token))
        .send({ idempotencyKey: uuid() })
        .expect(200);

      expect(res.body.inventoryMovements).toHaveLength(1);
      expect(res.body.inventoryMovements[0].movementType).toBe('SALE_OUT');
      expect(res.body.inventoryMovements[0].quantity).toBe(3);
      expect(res.body.inventoryMovements[0].unitCostAtTime).toBe(600);
    });

    it('creates AR_INCREASE ledger entry', async () => {
      const supplier = await createTestSupplier(prisma, tenantId, userId);
      const customer = await createTestCustomer(prisma, tenantId, userId);
      const product = await createTestProduct(prisma, tenantId, userId);

      await createAndPostPurchase(app, token, {
        supplierId: supplier.id,
        lines: [{ productId: product.id, quantity: 10, unitCost: 300 }],
      });

      const saleDraft = await createSaleDraft(customer.id, product.id, 5, 700);
      const res = await request(app.getHttpServer())
        .post(`/api/v1/transactions/${saleDraft.id}/post`)
        .set(authHeader(token))
        .send({ idempotencyKey: uuid() })
        .expect(200);

      const arEntry = res.body.ledgerEntries.find((e: any) => e.entryType === 'AR_INCREASE');
      expect(arEntry).toBeDefined();
      expect(arEntry.amount).toBe(3500); // 5 * 700
      expect(arEntry.customerId).toBe(customer.id);
    });

    it('posts a sale with received payment', async () => {
      const supplier = await createTestSupplier(prisma, tenantId, userId);
      const customer = await createTestCustomer(prisma, tenantId, userId);
      const product = await createTestProduct(prisma, tenantId, userId);
      const account = await createTestPaymentAccount(prisma, tenantId, userId);

      await createAndPostPurchase(app, token, {
        supplierId: supplier.id,
        lines: [{ productId: product.id, quantity: 10, unitCost: 300 }],
      });

      const saleDraft = await createSaleDraft(customer.id, product.id, 4, 600);
      const res = await request(app.getHttpServer())
        .post(`/api/v1/transactions/${saleDraft.id}/post`)
        .set(authHeader(token))
        .send({ idempotencyKey: uuid(), receivedNow: 1200, paymentAccountId: account.id })
        .expect(200);

      expect(res.body.paidNow).toBe(1200);
      expect(res.body.paymentEntries).toHaveLength(1);
      expect(res.body.paymentEntries[0].entryType).toBe('MONEY_IN');
      expect(res.body.paymentEntries[0].direction).toBe('IN');
      expect(res.body.paymentEntries[0].amount).toBe(1200);

      const arDecrease = res.body.ledgerEntries.find((e: any) => e.entryType === 'AR_DECREASE');
      expect(arDecrease).toBeDefined();
      expect(arDecrease.amount).toBe(1200);
    });
  });

  // ─── INSUFFICIENT STOCK ────────────────────────────────────────────────────

  describe('Insufficient stock', () => {
    it('returns 422 when no stock at all', async () => {
      const customer = await createTestCustomer(prisma, tenantId, userId);
      const product = await createTestProduct(prisma, tenantId, userId);

      const saleDraft = await createSaleDraft(customer.id, product.id, 5, 1000);

      const res = await request(app.getHttpServer())
        .post(`/api/v1/transactions/${saleDraft.id}/post`)
        .set(authHeader(token))
        .send({ idempotencyKey: uuid() })
        .expect(422);

      expect(res.body.message).toContain('Insufficient stock');
      expect(res.body.errors).toHaveLength(1);
      expect(res.body.errors[0].productId).toBe(product.id);
      expect(res.body.errors[0].available).toBe(0);
      expect(res.body.errors[0].required).toBe(5);
    });

    it('returns 422 when stock is insufficient (not zero)', async () => {
      const supplier = await createTestSupplier(prisma, tenantId, userId);
      const customer = await createTestCustomer(prisma, tenantId, userId);
      const product = await createTestProduct(prisma, tenantId, userId);

      // Stock up 3 units
      await createAndPostPurchase(app, token, {
        supplierId: supplier.id,
        lines: [{ productId: product.id, quantity: 3, unitCost: 500 }],
      });

      const saleDraft = await createSaleDraft(customer.id, product.id, 5, 700);
      const res = await request(app.getHttpServer())
        .post(`/api/v1/transactions/${saleDraft.id}/post`)
        .set(authHeader(token))
        .send({ idempotencyKey: uuid() })
        .expect(422);

      expect(res.body.errors[0].available).toBe(3);
      expect(res.body.errors[0].required).toBe(5);
    });

    it('collects all insufficient stock errors before throwing', async () => {
      const customer = await createTestCustomer(prisma, tenantId, userId);
      const product1 = await createTestProduct(prisma, tenantId, userId, { name: 'P1' });
      const product2 = await createTestProduct(prisma, tenantId, userId, { name: 'P2' });

      const saleDraftRes = await request(app.getHttpServer())
        .post('/api/v1/transactions/sales/draft')
        .set(authHeader(token))
        .send({
          customerId: customer.id,
          transactionDate: new Date().toISOString().split('T')[0],
          lines: [
            { productId: product1.id, quantity: 5, unitPrice: 500 },
            { productId: product2.id, quantity: 3, unitPrice: 700 },
          ],
        })
        .expect(201);

      const res = await request(app.getHttpServer())
        .post(`/api/v1/transactions/${saleDraftRes.body.id}/post`)
        .set(authHeader(token))
        .send({ idempotencyKey: uuid() })
        .expect(422);

      expect(res.body.errors).toHaveLength(2);
    });

    it('succeeds when stock exactly matches required quantity', async () => {
      const supplier = await createTestSupplier(prisma, tenantId, userId);
      const customer = await createTestCustomer(prisma, tenantId, userId);
      const product = await createTestProduct(prisma, tenantId, userId);

      await createAndPostPurchase(app, token, {
        supplierId: supplier.id,
        lines: [{ productId: product.id, quantity: 5, unitCost: 400 }],
      });

      const saleDraft = await createSaleDraft(customer.id, product.id, 5, 600);
      await request(app.getHttpServer())
        .post(`/api/v1/transactions/${saleDraft.id}/post`)
        .set(authHeader(token))
        .send({ idempotencyKey: uuid() })
        .expect(200);
    });

    it('transaction is NOT posted when stock check fails (rollback)', async () => {
      const customer = await createTestCustomer(prisma, tenantId, userId);
      const product = await createTestProduct(prisma, tenantId, userId);
      const saleDraft = await createSaleDraft(customer.id, product.id, 10, 500);

      await request(app.getHttpServer())
        .post(`/api/v1/transactions/${saleDraft.id}/post`)
        .set(authHeader(token))
        .send({ idempotencyKey: uuid() })
        .expect(422);

      // Transaction should remain DRAFT
      const txn = await prisma.transaction.findFirst({ where: { id: saleDraft.id } });
      expect(txn!.status).toBe('DRAFT');

      // No movements should exist
      const movements = await prisma.inventoryMovement.findMany({ where: { tenantId } });
      expect(movements).toHaveLength(0);
    });
  });

  // ─── SALE DOC NUMBERS ──────────────────────────────────────────────────────

  describe('Document numbers for sales', () => {
    it('generates SAL-YYYY-0001 for first sale', async () => {
      const supplier = await createTestSupplier(prisma, tenantId, userId);
      const customer = await createTestCustomer(prisma, tenantId, userId);
      const product = await createTestProduct(prisma, tenantId, userId);

      await createAndPostPurchase(app, token, {
        supplierId: supplier.id,
        lines: [{ productId: product.id, quantity: 10, unitCost: 300 }],
      });

      const saleDraft = await createSaleDraft(customer.id, product.id, 2, 500);
      const res = await request(app.getHttpServer())
        .post(`/api/v1/transactions/${saleDraft.id}/post`)
        .set(authHeader(token))
        .send({ idempotencyKey: uuid() })
        .expect(200);

      const year = new Date().getFullYear();
      expect(res.body.documentNumber).toBe(`SAL-${year}-0001`);
    });

    it('purchase and sale doc numbers are independent counters', async () => {
      const supplier = await createTestSupplier(prisma, tenantId, userId);
      const customer = await createTestCustomer(prisma, tenantId, userId);
      const product = await createTestProduct(prisma, tenantId, userId);
      const year = new Date().getFullYear();

      const purchase = await createAndPostPurchase(app, token, {
        supplierId: supplier.id,
        lines: [{ productId: product.id, quantity: 20, unitCost: 300 }],
      });
      expect(purchase.documentNumber).toBe(`PUR-${year}-0001`);

      const saleDraft = await createSaleDraft(customer.id, product.id, 5, 500);
      const saleRes = await request(app.getHttpServer())
        .post(`/api/v1/transactions/${saleDraft.id}/post`)
        .set(authHeader(token))
        .send({ idempotencyKey: uuid() })
        .expect(200);
      expect(saleRes.body.documentNumber).toBe(`SAL-${year}-0001`);
    });
  });
});
