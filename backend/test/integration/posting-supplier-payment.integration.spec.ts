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
  createTestProduct,
  createTestPaymentAccount,
  createAndPostPurchase,
  createAndPostSupplierPayment,
} from '../helpers/test-factories';
import { PrismaClient } from '@prisma/client';

describe('Posting — SUPPLIER_PAYMENT (Integration)', () => {
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

  // ─── DRAFT CREATION ─────────────────────────────────────────────────────────

  describe('Draft creation', () => {
    it('creates a SUPPLIER_PAYMENT draft (201)', async () => {
      const supplier = await createTestSupplier(prisma, tenantId, userId);
      const account = await createTestPaymentAccount(prisma, tenantId, userId);

      const res = await request(app.getHttpServer())
        .post('/api/v1/transactions/supplier-payments/draft')
        .set(authHeader(token))
        .send({
          supplierId: supplier.id,
          amount: 5000,
          paymentAccountId: account.id,
          transactionDate: new Date().toISOString().split('T')[0],
        })
        .expect(201);

      expect(res.body.type).toBe('SUPPLIER_PAYMENT');
      expect(res.body.status).toBe('DRAFT');
      expect(res.body.totalAmount).toBe(5000);
      expect(res.body.supplierId).toBe(supplier.id);
      expect(res.body.fromPaymentAccountId).toBe(account.id);
    });

    it('returns 404 for unknown supplier', async () => {
      const account = await createTestPaymentAccount(prisma, tenantId, userId);

      await request(app.getHttpServer())
        .post('/api/v1/transactions/supplier-payments/draft')
        .set(authHeader(token))
        .send({
          supplierId: uuid(),
          amount: 5000,
          paymentAccountId: account.id,
          transactionDate: new Date().toISOString().split('T')[0],
        })
        .expect(404);
    });

    it('returns 404 for unknown payment account', async () => {
      const supplier = await createTestSupplier(prisma, tenantId, userId);

      await request(app.getHttpServer())
        .post('/api/v1/transactions/supplier-payments/draft')
        .set(authHeader(token))
        .send({
          supplierId: supplier.id,
          amount: 5000,
          paymentAccountId: uuid(),
          transactionDate: new Date().toISOString().split('T')[0],
        })
        .expect(404);
    });

    it('validates amount must be at least 1', async () => {
      const supplier = await createTestSupplier(prisma, tenantId, userId);
      const account = await createTestPaymentAccount(prisma, tenantId, userId);

      await request(app.getHttpServer())
        .post('/api/v1/transactions/supplier-payments/draft')
        .set(authHeader(token))
        .send({
          supplierId: supplier.id,
          amount: 0,
          paymentAccountId: account.id,
          transactionDate: new Date().toISOString().split('T')[0],
        })
        .expect(400);
    });

    it('rejects future transactionDate', async () => {
      const supplier = await createTestSupplier(prisma, tenantId, userId);
      const account = await createTestPaymentAccount(prisma, tenantId, userId);

      const future = new Date();
      future.setDate(future.getDate() + 1);

      await request(app.getHttpServer())
        .post('/api/v1/transactions/supplier-payments/draft')
        .set(authHeader(token))
        .send({
          supplierId: supplier.id,
          amount: 5000,
          paymentAccountId: account.id,
          transactionDate: future.toISOString().split('T')[0],
        })
        .expect(400);
    });

    it('returns 401 without auth', async () => {
      const supplier = await createTestSupplier(prisma, tenantId, userId);
      const account = await createTestPaymentAccount(prisma, tenantId, userId);

      await request(app.getHttpServer())
        .post('/api/v1/transactions/supplier-payments/draft')
        .send({
          supplierId: supplier.id,
          amount: 5000,
          paymentAccountId: account.id,
          transactionDate: new Date().toISOString().split('T')[0],
        })
        .expect(401);
    });
  });

  // ─── POSTING — AUTO ALLOCATION ───────────────────────────────────────────────

  describe('Posting with auto-allocation', () => {
    it('posts a supplier payment and auto-allocates to the oldest purchase (SPY doc number)', async () => {
      const supplier = await createTestSupplier(prisma, tenantId, userId);
      const product = await createTestProduct(prisma, tenantId, userId);
      const account = await createTestPaymentAccount(prisma, tenantId, userId);

      // Create a posted purchase for 10,000
      await createAndPostPurchase(app, token, {
        supplierId: supplier.id,
        lines: [{ variantId: product.variants[0].id, quantity: 10, unitCost: 1000 }],
      });

      // Pay 10,000
      const payment = await createAndPostSupplierPayment(app, token, {
        supplierId: supplier.id,
        amount: 10000,
        paymentAccountId: account.id,
      });

      expect(payment.status).toBe('POSTED');
      expect(payment.documentNumber).toMatch(/^SPY-\d{4}-\d{4}$/);
      expect(payment.series).toBeDefined();

      // Verify ledger: AP_DECREASE
      const ledger = await prisma.ledgerEntry.findMany({
        where: { transactionId: payment.id },
      });
      expect(ledger).toHaveLength(1);
      expect(ledger[0].entryType).toBe('AP_DECREASE');
      expect(ledger[0].amount).toBe(10000);

      // Verify payment entry: MONEY_OUT
      const payments = await prisma.paymentEntry.findMany({
        where: { transactionId: payment.id },
      });
      expect(payments).toHaveLength(1);
      expect(payments[0].entryType).toBe('MONEY_OUT');
      expect(payments[0].direction).toBe('OUT');
      expect(payments[0].amount).toBe(10000);

      // Verify allocation created
      const allocations = await prisma.allocation.findMany({
        where: { paymentTransactionId: payment.id },
      });
      expect(allocations).toHaveLength(1);
      expect(allocations[0].amountApplied).toBe(10000);
    });

    it('auto-allocates across two purchases oldest-first', async () => {
      const supplier = await createTestSupplier(prisma, tenantId, userId);
      const product = await createTestProduct(prisma, tenantId, userId);
      const account = await createTestPaymentAccount(prisma, tenantId, userId);

      // Two purchases: 3000 and 5000
      const purchase1 = await createAndPostPurchase(app, token, {
        supplierId: supplier.id,
        lines: [{ variantId: product.variants[0].id, quantity: 3, unitCost: 1000 }],
        transactionDate: new Date(Date.now() - 86400000).toISOString().split('T')[0], // yesterday
      });
      const purchase2 = await createAndPostPurchase(app, token, {
        supplierId: supplier.id,
        lines: [{ variantId: product.variants[0].id, quantity: 5, unitCost: 1000 }],
      });

      // Pay 7000 — should fully cover purchase1 (3000) and partially cover purchase2 (4000)
      const payment = await createAndPostSupplierPayment(app, token, {
        supplierId: supplier.id,
        amount: 7000,
        paymentAccountId: account.id,
      });

      const allocations = await prisma.allocation.findMany({
        where: { paymentTransactionId: payment.id },
        orderBy: { amountApplied: 'asc' },
      });
      expect(allocations).toHaveLength(2);
      const amounts = allocations.map((a) => a.amountApplied).sort((a, b) => a - b);
      expect(amounts).toEqual([3000, 4000]);

      // purchase1 fully allocated, purchase2 has 1000 outstanding
      const alloc1 = allocations.find((a) => a.appliesToTransactionId === purchase1.id);
      expect(alloc1?.amountApplied).toBe(3000);
      const alloc2 = allocations.find((a) => a.appliesToTransactionId === purchase2.id);
      expect(alloc2?.amountApplied).toBe(4000);
    });

    it('allows unallocated credit (payment > total outstanding)', async () => {
      const supplier = await createTestSupplier(prisma, tenantId, userId);
      const product = await createTestProduct(prisma, tenantId, userId);
      const account = await createTestPaymentAccount(prisma, tenantId, userId);

      await createAndPostPurchase(app, token, {
        supplierId: supplier.id,
        lines: [{ variantId: product.variants[0].id, quantity: 1, unitCost: 3000 }],
      });

      // Pay more than outstanding
      const payment = await createAndPostSupplierPayment(app, token, {
        supplierId: supplier.id,
        amount: 5000,
        paymentAccountId: account.id,
      });

      const allocations = await prisma.allocation.findMany({
        where: { paymentTransactionId: payment.id },
      });
      // Only 3000 allocated, 2000 unallocated credit
      expect(allocations).toHaveLength(1);
      expect(allocations[0].amountApplied).toBe(3000);
    });

    it('allows zero allocations when supplier has no outstanding documents', async () => {
      const supplier = await createTestSupplier(prisma, tenantId, userId);
      const account = await createTestPaymentAccount(prisma, tenantId, userId);

      const payment = await createAndPostSupplierPayment(app, token, {
        supplierId: supplier.id,
        amount: 5000,
        paymentAccountId: account.id,
      });

      const allocations = await prisma.allocation.findMany({
        where: { paymentTransactionId: payment.id },
      });
      expect(allocations).toHaveLength(0);
      expect(payment.status).toBe('POSTED');
    });
  });

  // ─── POSTING — MANUAL ALLOCATIONS ───────────────────────────────────────────

  describe('Posting with manual allocations', () => {
    it('applies manual allocations correctly', async () => {
      const supplier = await createTestSupplier(prisma, tenantId, userId);
      const product = await createTestProduct(prisma, tenantId, userId);
      const account = await createTestPaymentAccount(prisma, tenantId, userId);

      const purchase1 = await createAndPostPurchase(app, token, {
        supplierId: supplier.id,
        lines: [{ variantId: product.variants[0].id, quantity: 3, unitCost: 1000 }],
      });
      const purchase2 = await createAndPostPurchase(app, token, {
        supplierId: supplier.id,
        lines: [{ variantId: product.variants[0].id, quantity: 5, unitCost: 1000 }],
      });

      const payment = await createAndPostSupplierPayment(app, token, {
        supplierId: supplier.id,
        amount: 6000,
        paymentAccountId: account.id,
        allocations: [
          { transactionId: purchase1.id, amount: 2000 },
          { transactionId: purchase2.id, amount: 4000 },
        ],
      });

      const allocations = await prisma.allocation.findMany({
        where: { paymentTransactionId: payment.id },
      });
      expect(allocations).toHaveLength(2);

      const alloc1 = allocations.find((a) => a.appliesToTransactionId === purchase1.id);
      expect(alloc1?.amountApplied).toBe(2000);
      const alloc2 = allocations.find((a) => a.appliesToTransactionId === purchase2.id);
      expect(alloc2?.amountApplied).toBe(4000);
    });

    it('rejects over-allocation on a single document (422)', async () => {
      const supplier = await createTestSupplier(prisma, tenantId, userId);
      const product = await createTestProduct(prisma, tenantId, userId);
      const account = await createTestPaymentAccount(prisma, tenantId, userId);

      const purchase = await createAndPostPurchase(app, token, {
        supplierId: supplier.id,
        lines: [{ variantId: product.variants[0].id, quantity: 2, unitCost: 1000 }],
      });

      // Draft a payment
      const draftRes = await request(app.getHttpServer())
        .post('/api/v1/transactions/supplier-payments/draft')
        .set(authHeader(token))
        .send({
          supplierId: supplier.id,
          amount: 5000,
          paymentAccountId: account.id,
          transactionDate: new Date().toISOString().split('T')[0],
        })
        .expect(201);

      // Try to allocate 3000 to a 2000 document
      await request(app.getHttpServer())
        .post(`/api/v1/transactions/${draftRes.body.id}/post`)
        .set(authHeader(token))
        .send({
          idempotencyKey: uuid(),
          allocations: [{ transactionId: purchase.id, amount: 3000 }],
        })
        .expect(422);
    });

    it('rejects total allocations exceeding payment amount (422)', async () => {
      const supplier = await createTestSupplier(prisma, tenantId, userId);
      const product = await createTestProduct(prisma, tenantId, userId);
      const account = await createTestPaymentAccount(prisma, tenantId, userId);

      const purchase1 = await createAndPostPurchase(app, token, {
        supplierId: supplier.id,
        lines: [{ variantId: product.variants[0].id, quantity: 5, unitCost: 1000 }],
      });
      const purchase2 = await createAndPostPurchase(app, token, {
        supplierId: supplier.id,
        lines: [{ variantId: product.variants[0].id, quantity: 5, unitCost: 1000 }],
      });

      const draftRes = await request(app.getHttpServer())
        .post('/api/v1/transactions/supplier-payments/draft')
        .set(authHeader(token))
        .send({
          supplierId: supplier.id,
          amount: 8000,
          paymentAccountId: account.id,
          transactionDate: new Date().toISOString().split('T')[0],
        })
        .expect(201);

      // 5000 + 5000 = 10000 > payment 8000
      await request(app.getHttpServer())
        .post(`/api/v1/transactions/${draftRes.body.id}/post`)
        .set(authHeader(token))
        .send({
          idempotencyKey: uuid(),
          allocations: [
            { transactionId: purchase1.id, amount: 5000 },
            { transactionId: purchase2.id, amount: 5000 },
          ],
        })
        .expect(422);
    });

    it('rejects allocation to wrong-supplier document (422)', async () => {
      const supplier1 = await createTestSupplier(prisma, tenantId, userId);
      const supplier2 = await createTestSupplier(prisma, tenantId, userId);
      const product = await createTestProduct(prisma, tenantId, userId);
      const account = await createTestPaymentAccount(prisma, tenantId, userId);

      // Purchase belongs to supplier2
      const purchase = await createAndPostPurchase(app, token, {
        supplierId: supplier2.id,
        lines: [{ variantId: product.variants[0].id, quantity: 5, unitCost: 1000 }],
      });

      const draftRes = await request(app.getHttpServer())
        .post('/api/v1/transactions/supplier-payments/draft')
        .set(authHeader(token))
        .send({
          supplierId: supplier1.id,
          amount: 5000,
          paymentAccountId: account.id,
          transactionDate: new Date().toISOString().split('T')[0],
        })
        .expect(201);

      await request(app.getHttpServer())
        .post(`/api/v1/transactions/${draftRes.body.id}/post`)
        .set(authHeader(token))
        .send({
          idempotencyKey: uuid(),
          allocations: [{ transactionId: purchase.id, amount: 5000 }],
        })
        .expect(422);
    });
  });

  // ─── IDEMPOTENCY ─────────────────────────────────────────────────────────────

  describe('Idempotency', () => {
    it('returns the same posted transaction on duplicate post with same key (200)', async () => {
      const supplier = await createTestSupplier(prisma, tenantId, userId);
      const account = await createTestPaymentAccount(prisma, tenantId, userId);

      const draftRes = await request(app.getHttpServer())
        .post('/api/v1/transactions/supplier-payments/draft')
        .set(authHeader(token))
        .send({
          supplierId: supplier.id,
          amount: 5000,
          paymentAccountId: account.id,
          transactionDate: new Date().toISOString().split('T')[0],
        })
        .expect(201);

      const key = uuid();

      const first = await request(app.getHttpServer())
        .post(`/api/v1/transactions/${draftRes.body.id}/post`)
        .set(authHeader(token))
        .send({ idempotencyKey: key })
        .expect(200);

      const second = await request(app.getHttpServer())
        .post(`/api/v1/transactions/${draftRes.body.id}/post`)
        .set(authHeader(token))
        .send({ idempotencyKey: key })
        .expect(200);

      expect(second.body.id).toBe(first.body.id);
      expect(second.body.documentNumber).toBe(first.body.documentNumber);
    });

    it('returns 409 when posting already-posted transaction with different key', async () => {
      const supplier = await createTestSupplier(prisma, tenantId, userId);
      const account = await createTestPaymentAccount(prisma, tenantId, userId);

      const draftRes = await request(app.getHttpServer())
        .post('/api/v1/transactions/supplier-payments/draft')
        .set(authHeader(token))
        .send({
          supplierId: supplier.id,
          amount: 5000,
          paymentAccountId: account.id,
          transactionDate: new Date().toISOString().split('T')[0],
        })
        .expect(201);

      await request(app.getHttpServer())
        .post(`/api/v1/transactions/${draftRes.body.id}/post`)
        .set(authHeader(token))
        .send({ idempotencyKey: uuid() })
        .expect(200);

      await request(app.getHttpServer())
        .post(`/api/v1/transactions/${draftRes.body.id}/post`)
        .set(authHeader(token))
        .send({ idempotencyKey: uuid() })
        .expect(409);
    });
  });

  // ─── DOCUMENT NUMBER SEQUENCE ────────────────────────────────────────────────

  describe('Document number sequence', () => {
    it('generates SPY-YYYY-0001 for first payment', async () => {
      const supplier = await createTestSupplier(prisma, tenantId, userId);
      const account = await createTestPaymentAccount(prisma, tenantId, userId);

      const payment = await createAndPostSupplierPayment(app, token, {
        supplierId: supplier.id,
        amount: 5000,
        paymentAccountId: account.id,
      });

      const year = new Date().getFullYear();
      expect(payment.documentNumber).toBe(`SPY-${year}-0001`);
    });

    it('increments to SPY-YYYY-0002 for second payment', async () => {
      const supplier = await createTestSupplier(prisma, tenantId, userId);
      const account = await createTestPaymentAccount(prisma, tenantId, userId);

      await createAndPostSupplierPayment(app, token, {
        supplierId: supplier.id,
        amount: 1000,
        paymentAccountId: account.id,
      });

      const second = await createAndPostSupplierPayment(app, token, {
        supplierId: supplier.id,
        amount: 2000,
        paymentAccountId: account.id,
      });

      const year = new Date().getFullYear();
      expect(second.documentNumber).toBe(`SPY-${year}-0002`);
    });
  });
});
