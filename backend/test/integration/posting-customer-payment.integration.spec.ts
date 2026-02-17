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
  createTestCustomer,
  createTestSupplier,
  createTestProduct,
  createTestPaymentAccount,
  createAndPostPurchase,
} from '../helpers/test-factories';
import { PrismaClient } from '@prisma/client';

describe('Posting — CUSTOMER_PAYMENT (Integration)', () => {
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

  async function createAndPostSale(
    customerId: string,
    variantId: string,
    qty: number,
    unitPrice: number,
    supplierId: string,
  ) {
    // First we need stock — create a purchase for the product
    await createAndPostPurchase(app, token, {
      supplierId,
      lines: [{ variantId, quantity: qty * 2, unitCost: Math.floor(unitPrice * 0.5) }],
    });

    const draftRes = await request(app.getHttpServer())
      .post('/api/v1/transactions/sales/draft')
      .set(authHeader(token))
      .send({
        customerId,
        transactionDate: new Date().toISOString().split('T')[0],
        lines: [{ variantId, quantity: qty, unitPrice }],
      })
      .expect(201);

    const postRes = await request(app.getHttpServer())
      .post(`/api/v1/transactions/${draftRes.body.id}/post`)
      .set(authHeader(token))
      .send({ idempotencyKey: uuid() })
      .expect(200);

    return postRes.body;
  }

  async function createCustomerPaymentDraft(customerId: string, amount: number, accountId: string) {
    const res = await request(app.getHttpServer())
      .post('/api/v1/transactions/customer-payments/draft')
      .set(authHeader(token))
      .send({
        customerId,
        amount,
        paymentAccountId: accountId,
        transactionDate: new Date().toISOString().split('T')[0],
      })
      .expect(201);
    return res.body;
  }

  // ─── DRAFT CREATION ─────────────────────────────────────────────────────────

  describe('Draft creation', () => {
    it('creates a CUSTOMER_PAYMENT draft (201)', async () => {
      const customer = await createTestCustomer(prisma, tenantId, userId);
      const account = await createTestPaymentAccount(prisma, tenantId, userId);

      const res = await request(app.getHttpServer())
        .post('/api/v1/transactions/customer-payments/draft')
        .set(authHeader(token))
        .send({
          customerId: customer.id,
          amount: 5000,
          paymentAccountId: account.id,
          transactionDate: new Date().toISOString().split('T')[0],
        })
        .expect(201);

      expect(res.body.type).toBe('CUSTOMER_PAYMENT');
      expect(res.body.status).toBe('DRAFT');
      expect(res.body.totalAmount).toBe(5000);
      expect(res.body.customerId).toBe(customer.id);
      expect(res.body.fromPaymentAccountId).toBe(account.id);
    });

    it('returns 404 for unknown customer', async () => {
      const account = await createTestPaymentAccount(prisma, tenantId, userId);

      await request(app.getHttpServer())
        .post('/api/v1/transactions/customer-payments/draft')
        .set(authHeader(token))
        .send({
          customerId: uuid(),
          amount: 5000,
          paymentAccountId: account.id,
          transactionDate: new Date().toISOString().split('T')[0],
        })
        .expect(404);
    });

    it('rejects amount of 0 (400)', async () => {
      const customer = await createTestCustomer(prisma, tenantId, userId);
      const account = await createTestPaymentAccount(prisma, tenantId, userId);

      await request(app.getHttpServer())
        .post('/api/v1/transactions/customer-payments/draft')
        .set(authHeader(token))
        .send({
          customerId: customer.id,
          amount: 0,
          paymentAccountId: account.id,
          transactionDate: new Date().toISOString().split('T')[0],
        })
        .expect(400);
    });
  });

  // ─── POSTING — AUTO ALLOCATION ───────────────────────────────────────────────

  describe('Posting with auto-allocation', () => {
    it('posts a customer payment and creates AR_DECREASE + MONEY_IN + allocation (CPY doc)', async () => {
      const supplier = await createTestSupplier(prisma, tenantId, userId);
      const customer = await createTestCustomer(prisma, tenantId, userId);
      const product = await createTestProduct(prisma, tenantId, userId);
      const account = await createTestPaymentAccount(prisma, tenantId, userId);

      // Create an outstanding sale
      await createAndPostSale(customer.id, product.variants[0].id, 5, 2000, supplier.id);

      const draft = await createCustomerPaymentDraft(customer.id, 10000, account.id);

      const res = await request(app.getHttpServer())
        .post(`/api/v1/transactions/${draft.id}/post`)
        .set(authHeader(token))
        .send({ idempotencyKey: uuid() })
        .expect(200);

      expect(res.body.status).toBe('POSTED');
      expect(res.body.documentNumber).toMatch(/^CPY-\d{4}-\d{4}$/);

      // Ledger: AR_DECREASE
      const ledger = await prisma.ledgerEntry.findMany({
        where: { transactionId: res.body.id },
      });
      expect(ledger).toHaveLength(1);
      expect(ledger[0].entryType).toBe('AR_DECREASE');
      expect(ledger[0].amount).toBe(10000);

      // Payment entry: MONEY_IN
      const payments = await prisma.paymentEntry.findMany({
        where: { transactionId: res.body.id },
      });
      expect(payments).toHaveLength(1);
      expect(payments[0].entryType).toBe('MONEY_IN');
      expect(payments[0].direction).toBe('IN');
      expect(payments[0].amount).toBe(10000);

      // Allocation
      const allocations = await prisma.allocation.findMany({
        where: { paymentTransactionId: res.body.id },
      });
      expect(allocations).toHaveLength(1);
      expect(allocations[0].amountApplied).toBe(10000);
    });

    it('generates CPY-YYYY-0001 for first customer payment', async () => {
      const customer = await createTestCustomer(prisma, tenantId, userId);
      const account = await createTestPaymentAccount(prisma, tenantId, userId);

      const draft = await createCustomerPaymentDraft(customer.id, 5000, account.id);

      const res = await request(app.getHttpServer())
        .post(`/api/v1/transactions/${draft.id}/post`)
        .set(authHeader(token))
        .send({ idempotencyKey: uuid() })
        .expect(200);

      const year = new Date().getFullYear();
      expect(res.body.documentNumber).toBe(`CPY-${year}-0001`);
    });

    it('auto-allocates across two sales oldest-first', async () => {
      const supplier = await createTestSupplier(prisma, tenantId, userId);
      const customer = await createTestCustomer(prisma, tenantId, userId);
      const product = await createTestProduct(prisma, tenantId, userId);
      const account = await createTestPaymentAccount(prisma, tenantId, userId);

      // Pre-stock
      await createAndPostPurchase(app, token, {
        supplierId: supplier.id,
        lines: [{ variantId: product.variants[0].id, quantity: 100, unitCost: 500 }],
      });

      // Two sales
      const sale1Draft = await request(app.getHttpServer())
        .post('/api/v1/transactions/sales/draft')
        .set(authHeader(token))
        .send({
          customerId: customer.id,
          transactionDate: new Date(Date.now() - 86400000).toISOString().split('T')[0],
          lines: [{ variantId: product.variants[0].id, quantity: 3, unitPrice: 1000 }],
        })
        .expect(201);
      const sale1 = await request(app.getHttpServer())
        .post(`/api/v1/transactions/${sale1Draft.body.id}/post`)
        .set(authHeader(token))
        .send({ idempotencyKey: uuid() })
        .expect(200);

      const sale2Draft = await request(app.getHttpServer())
        .post('/api/v1/transactions/sales/draft')
        .set(authHeader(token))
        .send({
          customerId: customer.id,
          transactionDate: new Date().toISOString().split('T')[0],
          lines: [{ variantId: product.variants[0].id, quantity: 5, unitPrice: 1000 }],
        })
        .expect(201);
      const sale2 = await request(app.getHttpServer())
        .post(`/api/v1/transactions/${sale2Draft.body.id}/post`)
        .set(authHeader(token))
        .send({ idempotencyKey: uuid() })
        .expect(200);

      // Pay 7000
      const draft = await createCustomerPaymentDraft(customer.id, 7000, account.id);
      const payment = await request(app.getHttpServer())
        .post(`/api/v1/transactions/${draft.id}/post`)
        .set(authHeader(token))
        .send({ idempotencyKey: uuid() })
        .expect(200);

      const allocations = await prisma.allocation.findMany({
        where: { paymentTransactionId: payment.body.id },
      });
      expect(allocations).toHaveLength(2);

      const alloc1 = allocations.find((a) => a.appliesToTransactionId === sale1.body.id);
      expect(alloc1?.amountApplied).toBe(3000);
      const alloc2 = allocations.find((a) => a.appliesToTransactionId === sale2.body.id);
      expect(alloc2?.amountApplied).toBe(4000);
    });
  });

  // ─── POSTING — MANUAL ALLOCATIONS ───────────────────────────────────────────

  describe('Posting with manual allocations', () => {
    it('applies manual allocations to sale documents', async () => {
      const supplier = await createTestSupplier(prisma, tenantId, userId);
      const customer = await createTestCustomer(prisma, tenantId, userId);
      const product = await createTestProduct(prisma, tenantId, userId);
      const account = await createTestPaymentAccount(prisma, tenantId, userId);

      await createAndPostPurchase(app, token, {
        supplierId: supplier.id,
        lines: [{ variantId: product.variants[0].id, quantity: 20, unitCost: 500 }],
      });

      const sale1Draft = await request(app.getHttpServer())
        .post('/api/v1/transactions/sales/draft')
        .set(authHeader(token))
        .send({
          customerId: customer.id,
          transactionDate: new Date().toISOString().split('T')[0],
          lines: [{ variantId: product.variants[0].id, quantity: 5, unitPrice: 1000 }],
        })
        .expect(201);
      const sale1 = await request(app.getHttpServer())
        .post(`/api/v1/transactions/${sale1Draft.body.id}/post`)
        .set(authHeader(token))
        .send({ idempotencyKey: uuid() })
        .expect(200);

      const draft = await createCustomerPaymentDraft(customer.id, 3000, account.id);

      const res = await request(app.getHttpServer())
        .post(`/api/v1/transactions/${draft.id}/post`)
        .set(authHeader(token))
        .send({
          idempotencyKey: uuid(),
          allocations: [{ transactionId: sale1.body.id, amount: 3000 }],
        })
        .expect(200);

      const allocations = await prisma.allocation.findMany({
        where: { paymentTransactionId: res.body.id },
      });
      expect(allocations).toHaveLength(1);
      expect(allocations[0].appliesToTransactionId).toBe(sale1.body.id);
      expect(allocations[0].amountApplied).toBe(3000);
    });

    it('rejects allocation to wrong-customer document (422)', async () => {
      const supplier = await createTestSupplier(prisma, tenantId, userId);
      const customer1 = await createTestCustomer(prisma, tenantId, userId);
      const customer2 = await createTestCustomer(prisma, tenantId, userId);
      const product = await createTestProduct(prisma, tenantId, userId);
      const account = await createTestPaymentAccount(prisma, tenantId, userId);

      // Sale belongs to customer2
      await createAndPostPurchase(app, token, {
        supplierId: supplier.id,
        lines: [{ variantId: product.variants[0].id, quantity: 10, unitCost: 500 }],
      });

      const sale2Draft = await request(app.getHttpServer())
        .post('/api/v1/transactions/sales/draft')
        .set(authHeader(token))
        .send({
          customerId: customer2.id,
          transactionDate: new Date().toISOString().split('T')[0],
          lines: [{ variantId: product.variants[0].id, quantity: 5, unitPrice: 1000 }],
        })
        .expect(201);
      const sale2 = await request(app.getHttpServer())
        .post(`/api/v1/transactions/${sale2Draft.body.id}/post`)
        .set(authHeader(token))
        .send({ idempotencyKey: uuid() })
        .expect(200);

      const draft = await createCustomerPaymentDraft(customer1.id, 5000, account.id);

      await request(app.getHttpServer())
        .post(`/api/v1/transactions/${draft.id}/post`)
        .set(authHeader(token))
        .send({
          idempotencyKey: uuid(),
          allocations: [{ transactionId: sale2.body.id, amount: 5000 }],
        })
        .expect(422);
    });
  });

  // ─── IDEMPOTENCY ─────────────────────────────────────────────────────────────

  describe('Idempotency', () => {
    it('returns same transaction on duplicate post with same idempotency key', async () => {
      const customer = await createTestCustomer(prisma, tenantId, userId);
      const account = await createTestPaymentAccount(prisma, tenantId, userId);

      const draft = await createCustomerPaymentDraft(customer.id, 5000, account.id);
      const key = uuid();

      const first = await request(app.getHttpServer())
        .post(`/api/v1/transactions/${draft.id}/post`)
        .set(authHeader(token))
        .send({ idempotencyKey: key })
        .expect(200);

      const second = await request(app.getHttpServer())
        .post(`/api/v1/transactions/${draft.id}/post`)
        .set(authHeader(token))
        .send({ idempotencyKey: key })
        .expect(200);

      expect(second.body.id).toBe(first.body.id);
    });
  });
});
