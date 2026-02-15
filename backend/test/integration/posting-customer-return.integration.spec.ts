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
  createTestProduct,
  createTestPaymentAccount,
  createAndPostPurchase,
  createAndPostSale,
} from '../helpers/test-factories';
import { PrismaClient } from '@prisma/client';

describe('Posting — CUSTOMER_RETURN (Integration)', () => {
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

  // helper to create and post a customer return draft
  async function createAndPostCustomerReturn(options: {
    customerId: string;
    lines: Array<{ sourceTransactionLineId: string; quantity: number }>;
    returnHandling?: 'REFUND_NOW' | 'STORE_CREDIT';
    paymentAccountId?: string;
    idempotencyKey?: string;
  }) {
    const transactionDate = new Date().toISOString().split('T')[0];

    const draftRes = await request(app.getHttpServer())
      .post('/api/v1/transactions/customer-returns/draft')
      .set(authHeader(token))
      .send({
        customerId: options.customerId,
        transactionDate,
        lines: options.lines,
      })
      .expect(201);

    const postRes = await request(app.getHttpServer())
      .post(`/api/v1/transactions/${draftRes.body.id}/post`)
      .set(authHeader(token))
      .send({
        idempotencyKey: options.idempotencyKey || uuid(),
        returnHandling: options.returnHandling,
        paymentAccountId: options.paymentAccountId,
      })
      .expect(200);

    return postRes.body;
  }

  // ─── DRAFT CREATION ──────────────────────────────────────────────────────────

  describe('Draft creation', () => {
    it('creates a CUSTOMER_RETURN draft (201)', async () => {
      const customer = await createTestCustomer(prisma, tenantId, userId);
      const { supplier, product } = await setupProductWithStock(customer);

      const sale = await createAndPostSale(app, token, {
        customerId: customer.id,
        lines: [{ productId: product.id, quantity: 5, unitPrice: 2000 }],
      });
      const sourceLine = sale.transactionLines[0];

      const res = await request(app.getHttpServer())
        .post('/api/v1/transactions/customer-returns/draft')
        .set(authHeader(token))
        .send({
          customerId: customer.id,
          transactionDate: new Date().toISOString().split('T')[0],
          lines: [{ sourceTransactionLineId: sourceLine.id, quantity: 2 }],
        })
        .expect(201);

      expect(res.body.type).toBe('CUSTOMER_RETURN');
      expect(res.body.status).toBe('DRAFT');
      expect(res.body.customerId).toBe(customer.id);
      expect(res.body.totalAmount).toBe(4000); // 2 * 2000
    });

    it('returns 404 for unknown customer', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/transactions/customer-returns/draft')
        .set(authHeader(token))
        .send({
          customerId: uuid(),
          transactionDate: new Date().toISOString().split('T')[0],
          lines: [{ sourceTransactionLineId: uuid(), quantity: 1 }],
        })
        .expect(404);
    });

    it('returns 422 when source line not from this customer (422)', async () => {
      const customer1 = await createTestCustomer(prisma, tenantId, userId);
      const customer2 = await createTestCustomer(prisma, tenantId, userId);
      const product = await createTestProduct(prisma, tenantId, userId);
      const supplier = await (await import('../helpers/test-factories')).createTestSupplier(prisma, tenantId, userId);

      await createAndPostPurchase(app, token, {
        supplierId: supplier.id,
        lines: [{ productId: product.id, quantity: 10, unitCost: 1000 }],
      });

      const sale = await createAndPostSale(app, token, {
        customerId: customer2.id,
        lines: [{ productId: product.id, quantity: 3, unitPrice: 2000 }],
      });
      const sourceLine = sale.transactionLines[0];

      await request(app.getHttpServer())
        .post('/api/v1/transactions/customer-returns/draft')
        .set(authHeader(token))
        .send({
          customerId: customer1.id,
          transactionDate: new Date().toISOString().split('T')[0],
          lines: [{ sourceTransactionLineId: sourceLine.id, quantity: 1 }],
        })
        .expect(422);
    });

    it('returns 422 when return quantity exceeds sale quantity', async () => {
      const customer = await createTestCustomer(prisma, tenantId, userId);
      const { product } = await setupProductWithStock(customer);

      const sale = await createAndPostSale(app, token, {
        customerId: customer.id,
        lines: [{ productId: product.id, quantity: 2, unitPrice: 2000 }],
      });
      const sourceLine = sale.transactionLines[0];

      await request(app.getHttpServer())
        .post('/api/v1/transactions/customer-returns/draft')
        .set(authHeader(token))
        .send({
          customerId: customer.id,
          transactionDate: new Date().toISOString().split('T')[0],
          lines: [{ sourceTransactionLineId: sourceLine.id, quantity: 5 }],
        })
        .expect(422);
    });
  });

  // ─── POSTING ─────────────────────────────────────────────────────────────────

  describe('Posting', () => {
    it('posts with STORE_CREDIT: CRN doc, AR_DECREASE, CUSTOMER_RETURN_IN movement, no payment entry', async () => {
      const customer = await createTestCustomer(prisma, tenantId, userId);
      const { product } = await setupProductWithStock(customer);

      const sale = await createAndPostSale(app, token, {
        customerId: customer.id,
        lines: [{ productId: product.id, quantity: 5, unitPrice: 2000 }],
      });
      const sourceLine = sale.transactionLines[0];

      const ret = await createAndPostCustomerReturn({
        customerId: customer.id,
        lines: [{ sourceTransactionLineId: sourceLine.id, quantity: 2 }],
        returnHandling: 'STORE_CREDIT',
      });

      expect(ret.status).toBe('POSTED');
      expect(ret.documentNumber).toMatch(/^CRN-\d{4}-\d{4}$/);
      expect(ret.totalAmount).toBe(4000); // 2 * 2000

      const ledger = await prisma.ledgerEntry.findMany({ where: { transactionId: ret.id } });
      expect(ledger).toHaveLength(1);
      expect(ledger[0].entryType).toBe('AR_DECREASE');
      expect(ledger[0].amount).toBe(4000);

      const movements = await prisma.inventoryMovement.findMany({ where: { transactionId: ret.id } });
      expect(movements).toHaveLength(1);
      expect(movements[0].movementType).toBe('CUSTOMER_RETURN_IN');
      expect(movements[0].quantity).toBe(2);

      const payments = await prisma.paymentEntry.findMany({ where: { transactionId: ret.id } });
      expect(payments).toHaveLength(0);
    });

    it('posts with REFUND_NOW: creates MONEY_OUT payment entry', async () => {
      const customer = await createTestCustomer(prisma, tenantId, userId);
      const { product } = await setupProductWithStock(customer);
      const account = await createTestPaymentAccount(prisma, tenantId, userId);

      const sale = await createAndPostSale(app, token, {
        customerId: customer.id,
        lines: [{ productId: product.id, quantity: 5, unitPrice: 2000 }],
      });
      const sourceLine = sale.transactionLines[0];

      const ret = await createAndPostCustomerReturn({
        customerId: customer.id,
        lines: [{ sourceTransactionLineId: sourceLine.id, quantity: 3 }],
        returnHandling: 'REFUND_NOW',
        paymentAccountId: account.id,
      });

      const payments = await prisma.paymentEntry.findMany({ where: { transactionId: ret.id } });
      expect(payments).toHaveLength(1);
      expect(payments[0].entryType).toBe('MONEY_OUT');
      expect(payments[0].direction).toBe('OUT');
      expect(payments[0].amount).toBe(6000); // 3 * 2000
      expect(payments[0].customerId).toBe(customer.id);
    });

    it('REFUND_NOW without paymentAccountId returns 400', async () => {
      const customer = await createTestCustomer(prisma, tenantId, userId);
      const { product } = await setupProductWithStock(customer);

      const sale = await createAndPostSale(app, token, {
        customerId: customer.id,
        lines: [{ productId: product.id, quantity: 5, unitPrice: 2000 }],
      });
      const sourceLine = sale.transactionLines[0];

      const draftRes = await request(app.getHttpServer())
        .post('/api/v1/transactions/customer-returns/draft')
        .set(authHeader(token))
        .send({
          customerId: customer.id,
          transactionDate: new Date().toISOString().split('T')[0],
          lines: [{ sourceTransactionLineId: sourceLine.id, quantity: 1 }],
        })
        .expect(201);

      await request(app.getHttpServer())
        .post(`/api/v1/transactions/${draftRes.body.id}/post`)
        .set(authHeader(token))
        .send({ idempotencyKey: uuid(), returnHandling: 'REFUND_NOW' })
        .expect(400);
    });

    it('generates CRN-YYYY-0001 for first return', async () => {
      const customer = await createTestCustomer(prisma, tenantId, userId);
      const { product } = await setupProductWithStock(customer);

      const sale = await createAndPostSale(app, token, {
        customerId: customer.id,
        lines: [{ productId: product.id, quantity: 5, unitPrice: 2000 }],
      });
      const sourceLine = sale.transactionLines[0];

      const ret = await createAndPostCustomerReturn({
        customerId: customer.id,
        lines: [{ sourceTransactionLineId: sourceLine.id, quantity: 1 }],
        returnHandling: 'STORE_CREDIT',
      });

      const year = new Date().getFullYear();
      expect(ret.documentNumber).toBe(`CRN-${year}-0001`);
    });

    it('returns 422 when over-returning at draft creation time', async () => {
      const customer = await createTestCustomer(prisma, tenantId, userId);
      const { product } = await setupProductWithStock(customer);

      const sale = await createAndPostSale(app, token, {
        customerId: customer.id,
        lines: [{ productId: product.id, quantity: 3, unitPrice: 2000 }],
      });
      const sourceLine = sale.transactionLines[0];

      await createAndPostCustomerReturn({
        customerId: customer.id,
        lines: [{ sourceTransactionLineId: sourceLine.id, quantity: 2 }],
        returnHandling: 'STORE_CREDIT',
      });

      // Try to return 2 more (only 1 left)
      await request(app.getHttpServer())
        .post('/api/v1/transactions/customer-returns/draft')
        .set(authHeader(token))
        .send({
          customerId: customer.id,
          transactionDate: new Date().toISOString().split('T')[0],
          lines: [{ sourceTransactionLineId: sourceLine.id, quantity: 2 }],
        })
        .expect(422);
    });
  });

  // ─── HELPER ──────────────────────────────────────────────────────────────────

  async function setupProductWithStock(customer: any) {
    const { createTestSupplier } = await import('../helpers/test-factories');
    const supplier = await createTestSupplier(prisma, tenantId, userId);
    const product = await createTestProduct(prisma, tenantId, userId);

    // Purchase to put stock in
    await createAndPostPurchase(app, token, {
      supplierId: supplier.id,
      lines: [{ productId: product.id, quantity: 100, unitCost: 1000 }],
    });

    return { supplier, product };
  }
});
