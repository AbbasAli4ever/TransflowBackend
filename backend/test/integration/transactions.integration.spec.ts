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
  createAndPostSale,
} from '../helpers/test-factories';
import { PrismaClient } from '@prisma/client';

describe('Transactions API — Draft & Read (Integration)', () => {
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

  // ─── PURCHASE DRAFT ────────────────────────────────────────────────────────

  describe('POST /api/v1/transactions/purchases/draft', () => {
    it('creates a PURCHASE draft', async () => {
      const supplier = await createTestSupplier(prisma, tenantId, userId);
      const product = await createTestProduct(prisma, tenantId, userId, { name: 'Widget' });

      const res = await request(app.getHttpServer())
        .post('/api/v1/transactions/purchases/draft')
        .set(authHeader(token))
        .send({
          supplierId: supplier.id,
          transactionDate: new Date().toISOString().split('T')[0],
          lines: [{ variantId: product.variants[0].id, quantity: 10, unitCost: 500 }],
        })
        .expect(201);

      expect(res.body.id).toBeDefined();
      expect(res.body.type).toBe('PURCHASE');
      expect(res.body.status).toBe('DRAFT');
      expect(res.body.documentNumber).toBeNull();
      expect(res.body.totalAmount).toBe(5000);
      expect(res.body.subtotal).toBe(5000);
      expect(res.body.discountTotal).toBe(0);
      expect(res.body.supplierId).toBe(supplier.id);
      expect(res.body.transactionLines).toHaveLength(1);
      expect(res.body.transactionLines[0].unitCost).toBe(500);
      expect(res.body.transactionLines[0].quantity).toBe(10);
    });

    it('applies delivery fee to totalAmount', async () => {
      const supplier = await createTestSupplier(prisma, tenantId, userId);
      const product = await createTestProduct(prisma, tenantId, userId);

      const res = await request(app.getHttpServer())
        .post('/api/v1/transactions/purchases/draft')
        .set(authHeader(token))
        .send({
          supplierId: supplier.id,
          transactionDate: new Date().toISOString().split('T')[0],
          lines: [{ variantId: product.variants[0].id, quantity: 2, unitCost: 1000 }],
          deliveryFee: 200,
        })
        .expect(201);

      expect(res.body.totalAmount).toBe(2200);
      expect(res.body.deliveryFee).toBe(200);
    });

    it('applies line discount correctly', async () => {
      const supplier = await createTestSupplier(prisma, tenantId, userId);
      const product = await createTestProduct(prisma, tenantId, userId);

      const res = await request(app.getHttpServer())
        .post('/api/v1/transactions/purchases/draft')
        .set(authHeader(token))
        .send({
          supplierId: supplier.id,
          transactionDate: new Date().toISOString().split('T')[0],
          lines: [{ variantId: product.variants[0].id, quantity: 5, unitCost: 1000, discountAmount: 250 }],
        })
        .expect(201);

      expect(res.body.discountTotal).toBe(250);
      expect(res.body.subtotal).toBe(4750);
      expect(res.body.totalAmount).toBe(4750);
      expect(res.body.transactionLines[0].lineTotal).toBe(4750);
    });

    it('rejects future transactionDate', async () => {
      const supplier = await createTestSupplier(prisma, tenantId, userId);
      const product = await createTestProduct(prisma, tenantId, userId);
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 1);

      await request(app.getHttpServer())
        .post('/api/v1/transactions/purchases/draft')
        .set(authHeader(token))
        .send({
          supplierId: supplier.id,
          transactionDate: futureDate.toISOString().split('T')[0],
          lines: [{ variantId: product.variants[0].id, quantity: 1, unitCost: 100 }],
        })
        .expect(400);
    });

    it('rejects unknown supplierId (404)', async () => {
      const product = await createTestProduct(prisma, tenantId, userId);

      await request(app.getHttpServer())
        .post('/api/v1/transactions/purchases/draft')
        .set(authHeader(token))
        .send({
          supplierId: uuid(),
          transactionDate: new Date().toISOString().split('T')[0],
          lines: [{ variantId: product.variants[0].id, quantity: 1, unitCost: 100 }],
        })
        .expect(404);
    });

    it('rejects inactive supplier (422)', async () => {
      const supplier = await createTestSupplier(prisma, tenantId, userId);
      await prisma.supplier.update({ where: { id: supplier.id }, data: { status: 'INACTIVE' } });
      const product = await createTestProduct(prisma, tenantId, userId);

      await request(app.getHttpServer())
        .post('/api/v1/transactions/purchases/draft')
        .set(authHeader(token))
        .send({
          supplierId: supplier.id,
          transactionDate: new Date().toISOString().split('T')[0],
          lines: [{ variantId: product.variants[0].id, quantity: 1, unitCost: 100 }],
        })
        .expect(422);
    });

    it('rejects unknown variantId (404)', async () => {
      const supplier = await createTestSupplier(prisma, tenantId, userId);

      await request(app.getHttpServer())
        .post('/api/v1/transactions/purchases/draft')
        .set(authHeader(token))
        .send({
          supplierId: supplier.id,
          transactionDate: new Date().toISOString().split('T')[0],
          lines: [{ variantId: uuid(), quantity: 1, unitCost: 100 }],
        })
        .expect(404);
    });

    it('rejects discount exceeding line total (400)', async () => {
      const supplier = await createTestSupplier(prisma, tenantId, userId);
      const product = await createTestProduct(prisma, tenantId, userId);

      await request(app.getHttpServer())
        .post('/api/v1/transactions/purchases/draft')
        .set(authHeader(token))
        .send({
          supplierId: supplier.id,
          transactionDate: new Date().toISOString().split('T')[0],
          lines: [{ variantId: product.variants[0].id, quantity: 2, unitCost: 100, discountAmount: 300 }],
        })
        .expect(400);
    });

    it('rejects empty lines array (400)', async () => {
      const supplier = await createTestSupplier(prisma, tenantId, userId);

      await request(app.getHttpServer())
        .post('/api/v1/transactions/purchases/draft')
        .set(authHeader(token))
        .send({
          supplierId: supplier.id,
          transactionDate: new Date().toISOString().split('T')[0],
          lines: [],
        })
        .expect(400);
    });

    it('rejects missing required fields (400)', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/transactions/purchases/draft')
        .set(authHeader(token))
        .send({})
        .expect(400);
    });
  });

  // ─── SALE DRAFT ────────────────────────────────────────────────────────────

  describe('POST /api/v1/transactions/sales/draft', () => {
    it('creates a SALE draft', async () => {
      const customer = await createTestCustomer(prisma, tenantId, userId);
      const product = await createTestProduct(prisma, tenantId, userId, { name: 'Gadget' });

      const res = await request(app.getHttpServer())
        .post('/api/v1/transactions/sales/draft')
        .set(authHeader(token))
        .send({
          customerId: customer.id,
          transactionDate: new Date().toISOString().split('T')[0],
          lines: [{ variantId: product.variants[0].id, quantity: 3, unitPrice: 2000 }],
        })
        .expect(201);

      expect(res.body.id).toBeDefined();
      expect(res.body.type).toBe('SALE');
      expect(res.body.status).toBe('DRAFT');
      expect(res.body.documentNumber).toBeNull();
      expect(res.body.totalAmount).toBe(6000);
      expect(res.body.customerId).toBe(customer.id);
      expect(res.body.transactionLines).toHaveLength(1);
      expect(res.body.transactionLines[0].unitPrice).toBe(2000);
    });

    it('rejects future transactionDate', async () => {
      const customer = await createTestCustomer(prisma, tenantId, userId);
      const product = await createTestProduct(prisma, tenantId, userId);
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 1);

      await request(app.getHttpServer())
        .post('/api/v1/transactions/sales/draft')
        .set(authHeader(token))
        .send({
          customerId: customer.id,
          transactionDate: futureDate.toISOString().split('T')[0],
          lines: [{ variantId: product.variants[0].id, quantity: 1, unitPrice: 500 }],
        })
        .expect(400);
    });

    it('rejects unknown customerId (404)', async () => {
      const product = await createTestProduct(prisma, tenantId, userId);

      await request(app.getHttpServer())
        .post('/api/v1/transactions/sales/draft')
        .set(authHeader(token))
        .send({
          customerId: uuid(),
          transactionDate: new Date().toISOString().split('T')[0],
          lines: [{ variantId: product.variants[0].id, quantity: 1, unitPrice: 500 }],
        })
        .expect(404);
    });

    it('rejects inactive customer (422)', async () => {
      const customer = await createTestCustomer(prisma, tenantId, userId);
      await prisma.customer.update({ where: { id: customer.id }, data: { status: 'INACTIVE' } });
      const product = await createTestProduct(prisma, tenantId, userId);

      await request(app.getHttpServer())
        .post('/api/v1/transactions/sales/draft')
        .set(authHeader(token))
        .send({
          customerId: customer.id,
          transactionDate: new Date().toISOString().split('T')[0],
          lines: [{ variantId: product.variants[0].id, quantity: 1, unitPrice: 500 }],
        })
        .expect(422);
    });
  });

  // ─── LIST ──────────────────────────────────────────────────────────────────

  describe('GET /api/v1/transactions', () => {
    it('lists transactions with pagination', async () => {
      const supplier = await createTestSupplier(prisma, tenantId, userId);
      const product = await createTestProduct(prisma, tenantId, userId);
      const today = new Date().toISOString().split('T')[0];

      // Create two purchase drafts
      for (let i = 0; i < 2; i++) {
        await request(app.getHttpServer())
          .post('/api/v1/transactions/purchases/draft')
          .set(authHeader(token))
          .send({
            supplierId: supplier.id,
            transactionDate: today,
            lines: [{ variantId: product.variants[0].id, quantity: 1, unitCost: 100 }],
          });
      }

      const res = await request(app.getHttpServer())
        .get('/api/v1/transactions')
        .set(authHeader(token))
        .expect(200);

      expect(res.body.data).toHaveLength(2);
      expect(res.body.meta.total).toBe(2);
    });

    it('filters by type=PURCHASE', async () => {
      const supplier = await createTestSupplier(prisma, tenantId, userId);
      const customer = await createTestCustomer(prisma, tenantId, userId);
      const product = await createTestProduct(prisma, tenantId, userId);
      const today = new Date().toISOString().split('T')[0];

      await request(app.getHttpServer())
        .post('/api/v1/transactions/purchases/draft')
        .set(authHeader(token))
        .send({ supplierId: supplier.id, transactionDate: today, lines: [{ variantId: product.variants[0].id, quantity: 1, unitCost: 100 }] });

      await request(app.getHttpServer())
        .post('/api/v1/transactions/sales/draft')
        .set(authHeader(token))
        .send({ customerId: customer.id, transactionDate: today, lines: [{ variantId: product.variants[0].id, quantity: 1, unitPrice: 200 }] });

      const res = await request(app.getHttpServer())
        .get('/api/v1/transactions?type=PURCHASE')
        .set(authHeader(token))
        .expect(200);

      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].type).toBe('PURCHASE');
    });

    it('filters by status=DRAFT', async () => {
      const supplier = await createTestSupplier(prisma, tenantId, userId);
      const product = await createTestProduct(prisma, tenantId, userId);
      const today = new Date().toISOString().split('T')[0];

      await request(app.getHttpServer())
        .post('/api/v1/transactions/purchases/draft')
        .set(authHeader(token))
        .send({ supplierId: supplier.id, transactionDate: today, lines: [{ variantId: product.variants[0].id, quantity: 1, unitCost: 100 }] });

      const res = await request(app.getHttpServer())
        .get('/api/v1/transactions?status=DRAFT')
        .set(authHeader(token))
        .expect(200);

      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].status).toBe('DRAFT');
    });

    it('tenant isolation: cannot see other tenant transactions', async () => {
      const { tenant: t2, user: u2 } = await createTenantWithUser(prisma);
      const supplier2 = await createTestSupplier(prisma, t2.id, u2.id);
      const product2 = await createTestProduct(prisma, t2.id, u2.id);
      const token2 = generateTestJWT({ userId: u2.id, tenantId: t2.id, email: u2.email, role: u2.role });
      const today = new Date().toISOString().split('T')[0];

      await request(app.getHttpServer())
        .post('/api/v1/transactions/purchases/draft')
        .set(authHeader(token2))
        .send({ supplierId: supplier2.id, transactionDate: today, lines: [{ variantId: product2.variants[0].id, quantity: 1, unitCost: 100 }] });

      const res = await request(app.getHttpServer())
        .get('/api/v1/transactions')
        .set(authHeader(token))
        .expect(200);

      expect(res.body.data).toHaveLength(0);
    });
  });

  // ─── GET ONE ───────────────────────────────────────────────────────────────

  describe('GET /api/v1/transactions/:id', () => {
    it('returns transaction with lines', async () => {
      const supplier = await createTestSupplier(prisma, tenantId, userId);
      const product = await createTestProduct(prisma, tenantId, userId);

      const draftRes = await request(app.getHttpServer())
        .post('/api/v1/transactions/purchases/draft')
        .set(authHeader(token))
        .send({
          supplierId: supplier.id,
          transactionDate: new Date().toISOString().split('T')[0],
          lines: [{ variantId: product.variants[0].id, quantity: 5, unitCost: 300 }],
        })
        .expect(201);

      const res = await request(app.getHttpServer())
        .get(`/api/v1/transactions/${draftRes.body.id}`)
        .set(authHeader(token))
        .expect(200);

      expect(res.body.id).toBe(draftRes.body.id);
      expect(res.body.transactionLines).toHaveLength(1);
      expect(res.body.supplier).toBeDefined();
      expect(res.body.supplier.id).toBe(supplier.id);
    });

    it('returns 404 for unknown id', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/transactions/00000000-0000-0000-0000-000000000099')
        .set(authHeader(token))
        .expect(404);
    });

    it('tenant isolation: cannot see other tenant transaction (404)', async () => {
      const { tenant: t2, user: u2 } = await createTenantWithUser(prisma);
      const supplier2 = await createTestSupplier(prisma, t2.id, u2.id);
      const product2 = await createTestProduct(prisma, t2.id, u2.id);
      const token2 = generateTestJWT({ userId: u2.id, tenantId: t2.id, email: u2.email, role: u2.role });
      const today = new Date().toISOString().split('T')[0];

      const draftRes = await request(app.getHttpServer())
        .post('/api/v1/transactions/purchases/draft')
        .set(authHeader(token2))
        .send({ supplierId: supplier2.id, transactionDate: today, lines: [{ variantId: product2.variants[0].id, quantity: 1, unitCost: 100 }] })
        .expect(201);

      await request(app.getHttpServer())
        .get(`/api/v1/transactions/${draftRes.body.id}`)
        .set(authHeader(token))
        .expect(404);
    });

    it('rejects unauthenticated request (401)', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/transactions/00000000-0000-0000-0000-000000000001')
        .expect(401);
    });
  });
});

// ─── WAVE 1 — Posting Engine Integrity (Remediation Tests) ───────────────────

describe('Wave 1 — Posting Engine Invariants (Integration)', () => {
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

  const today = () => new Date().toISOString().split('T')[0];

  // ─── TASK 2.6 — Zero unit cost / price rejected at draft time ───────────────

  describe('Task 2.6 — Zero unit cost/price rejected (DTO validation)', () => {
    it('rejects PURCHASE draft with unitCost=0 (400)', async () => {
      const supplier = await createTestSupplier(prisma, tenantId, userId);
      const product = await createTestProduct(prisma, tenantId, userId);

      await request(app.getHttpServer())
        .post('/api/v1/transactions/purchases/draft')
        .set(authHeader(token))
        .send({
          supplierId: supplier.id,
          transactionDate: today(),
          lines: [{ variantId: product.variants[0].id, quantity: 5, unitCost: 0 }],
        })
        .expect(400);
    });

    it('accepts PURCHASE draft with unitCost=1 (201)', async () => {
      const supplier = await createTestSupplier(prisma, tenantId, userId);
      const product = await createTestProduct(prisma, tenantId, userId);

      await request(app.getHttpServer())
        .post('/api/v1/transactions/purchases/draft')
        .set(authHeader(token))
        .send({
          supplierId: supplier.id,
          transactionDate: today(),
          lines: [{ variantId: product.variants[0].id, quantity: 5, unitCost: 1 }],
        })
        .expect(201);
    });

    it('rejects SALE draft with unitPrice=0 (400)', async () => {
      const customer = await createTestCustomer(prisma, tenantId, userId);
      const product = await createTestProduct(prisma, tenantId, userId);

      await request(app.getHttpServer())
        .post('/api/v1/transactions/sales/draft')
        .set(authHeader(token))
        .send({
          customerId: customer.id,
          transactionDate: today(),
          lines: [{ variantId: product.variants[0].id, quantity: 3, unitPrice: 0 }],
        })
        .expect(400);
    });
  });

  // ─── TASK 2.4 — Duplicate sourceTransactionLineId rejected at draft time ────

  describe('Task 2.4 — Duplicate sourceTransactionLineId rejected in return drafts', () => {
    it('rejects SUPPLIER_RETURN draft with duplicate sourceTransactionLineId (422)', async () => {
      const supplier = await createTestSupplier(prisma, tenantId, userId);
      const product = await createTestProduct(prisma, tenantId, userId);
      const account = await createTestPaymentAccount(prisma, tenantId, userId);

      const purchase = await createAndPostPurchase(app, token, {
        supplierId: supplier.id,
        lines: [{ variantId: product.variants[0].id, quantity: 10, unitCost: 500 }],
        paidNow: 5000,
        paymentAccountId: account.id,
      });
      const sourceLineId = purchase.transactionLines[0].id;

      await request(app.getHttpServer())
        .post('/api/v1/transactions/supplier-returns/draft')
        .set(authHeader(token))
        .send({
          supplierId: supplier.id,
          transactionDate: today(),
          lines: [
            { sourceTransactionLineId: sourceLineId, quantity: 3 },
            { sourceTransactionLineId: sourceLineId, quantity: 2 },
          ],
        })
        .expect(422);
    });

    it('rejects CUSTOMER_RETURN draft with duplicate sourceTransactionLineId (422)', async () => {
      const supplier = await createTestSupplier(prisma, tenantId, userId);
      const customer = await createTestCustomer(prisma, tenantId, userId);
      const product = await createTestProduct(prisma, tenantId, userId);

      await createAndPostPurchase(app, token, {
        supplierId: supplier.id,
        lines: [{ variantId: product.variants[0].id, quantity: 10, unitCost: 500 }],
      });

      const sale = await createAndPostSale(app, token, {
        customerId: customer.id,
        lines: [{ variantId: product.variants[0].id, quantity: 8, unitPrice: 1000 }],
      });
      const sourceLineId = sale.transactionLines[0].id;

      await request(app.getHttpServer())
        .post('/api/v1/transactions/customer-returns/draft')
        .set(authHeader(token))
        .send({
          customerId: customer.id,
          transactionDate: today(),
          lines: [
            { sourceTransactionLineId: sourceLineId, quantity: 3 },
            { sourceTransactionLineId: sourceLineId, quantity: 2 },
          ],
        })
        .expect(422);
    });
  });

  // ─── TASK 2.5 — returnHandling required for CUSTOMER_RETURN posting ─────────

  describe('Task 2.5 — returnHandling required for CUSTOMER_RETURN posting', () => {
    it('rejects CUSTOMER_RETURN posting without returnHandling (400)', async () => {
      const supplier = await createTestSupplier(prisma, tenantId, userId);
      const customer = await createTestCustomer(prisma, tenantId, userId);
      const product = await createTestProduct(prisma, tenantId, userId);

      await createAndPostPurchase(app, token, {
        supplierId: supplier.id,
        lines: [{ variantId: product.variants[0].id, quantity: 10, unitCost: 500 }],
      });

      const sale = await createAndPostSale(app, token, {
        customerId: customer.id,
        lines: [{ variantId: product.variants[0].id, quantity: 5, unitPrice: 1000 }],
      });
      const sourceLineId = sale.transactionLines[0].id;

      const draftRes = await request(app.getHttpServer())
        .post('/api/v1/transactions/customer-returns/draft')
        .set(authHeader(token))
        .send({
          customerId: customer.id,
          transactionDate: today(),
          lines: [{ sourceTransactionLineId: sourceLineId, quantity: 2 }],
        })
        .expect(201);

      // Post without returnHandling
      await request(app.getHttpServer())
        .post(`/api/v1/transactions/${draftRes.body.id}/post`)
        .set(authHeader(token))
        .send({ idempotencyKey: uuid() })
        .expect(400);
    });

    it('accepts CUSTOMER_RETURN posting with STORE_CREDIT (200)', async () => {
      const supplier = await createTestSupplier(prisma, tenantId, userId);
      const customer = await createTestCustomer(prisma, tenantId, userId);
      const product = await createTestProduct(prisma, tenantId, userId);

      await createAndPostPurchase(app, token, {
        supplierId: supplier.id,
        lines: [{ variantId: product.variants[0].id, quantity: 10, unitCost: 500 }],
      });

      const sale = await createAndPostSale(app, token, {
        customerId: customer.id,
        lines: [{ variantId: product.variants[0].id, quantity: 5, unitPrice: 1000 }],
      });
      const sourceLineId = sale.transactionLines[0].id;

      const draftRes = await request(app.getHttpServer())
        .post('/api/v1/transactions/customer-returns/draft')
        .set(authHeader(token))
        .send({
          customerId: customer.id,
          transactionDate: today(),
          lines: [{ sourceTransactionLineId: sourceLineId, quantity: 2 }],
        })
        .expect(201);

      const postRes = await request(app.getHttpServer())
        .post(`/api/v1/transactions/${draftRes.body.id}/post`)
        .set(authHeader(token))
        .send({ idempotencyKey: uuid(), returnHandling: 'STORE_CREDIT' })
        .expect(200);

      expect(postRes.body.status).toBe('POSTED');
    });
  });

  // ─── TASK 2.1 — Stock check before SUPPLIER_RETURN posting ──────────────────

  describe('Task 2.1 — Stock check before SUPPLIER_RETURN_OUT posting', () => {
    it('rejects supplier return posting when stock < return qty (422)', async () => {
      const supplier = await createTestSupplier(prisma, tenantId, userId);
      const customer = await createTestCustomer(prisma, tenantId, userId);
      const product = await createTestProduct(prisma, tenantId, userId);

      // Purchase 5 units
      const purchase = await createAndPostPurchase(app, token, {
        supplierId: supplier.id,
        lines: [{ variantId: product.variants[0].id, quantity: 5, unitCost: 500 }],
      });

      // Sell 4 units — only 1 unit left in stock
      await createAndPostSale(app, token, {
        customerId: customer.id,
        lines: [{ variantId: product.variants[0].id, quantity: 4, unitPrice: 1000 }],
      });

      const sourceLineId = purchase.transactionLines[0].id;

      // Create a valid return draft for 3 units (3 <= 5 returnable from purchase)
      const draftRes = await request(app.getHttpServer())
        .post('/api/v1/transactions/supplier-returns/draft')
        .set(authHeader(token))
        .send({
          supplierId: supplier.id,
          transactionDate: today(),
          lines: [{ sourceTransactionLineId: sourceLineId, quantity: 3 }],
        })
        .expect(201);

      // Post should fail: only 1 unit in stock but trying to return 3
      await request(app.getHttpServer())
        .post(`/api/v1/transactions/${draftRes.body.id}/post`)
        .set(authHeader(token))
        .send({ idempotencyKey: uuid() })
        .expect(422);
    });

    it('allows supplier return posting when stock >= return qty (200)', async () => {
      const supplier = await createTestSupplier(prisma, tenantId, userId);
      const product = await createTestProduct(prisma, tenantId, userId);

      // Purchase 10 units, return 3 — stock is 10, sufficient
      const purchase = await createAndPostPurchase(app, token, {
        supplierId: supplier.id,
        lines: [{ variantId: product.variants[0].id, quantity: 10, unitCost: 500 }],
      });

      const sourceLineId = purchase.transactionLines[0].id;

      const draftRes = await request(app.getHttpServer())
        .post('/api/v1/transactions/supplier-returns/draft')
        .set(authHeader(token))
        .send({
          supplierId: supplier.id,
          transactionDate: today(),
          lines: [{ sourceTransactionLineId: sourceLineId, quantity: 3 }],
        })
        .expect(201);

      const postRes = await request(app.getHttpServer())
        .post(`/api/v1/transactions/${draftRes.body.id}/post`)
        .set(authHeader(token))
        .send({ idempotencyKey: uuid() })
        .expect(200);

      expect(postRes.body.status).toBe('POSTED');
    });
  });

  // ─── TASK 2.2 — Stock check before ADJUSTMENT_OUT posting ───────────────────

  describe('Task 2.2 — Stock check before ADJUSTMENT_OUT posting', () => {
    it('rejects ADJUSTMENT_OUT posting when stock < adjustment qty (422)', async () => {
      const product = await createTestProduct(prisma, tenantId, userId);
      // Product has 0 stock — trying to adjust out 5 should fail

      const draftRes = await request(app.getHttpServer())
        .post('/api/v1/transactions/adjustments/draft')
        .set(authHeader(token))
        .send({
          transactionDate: today(),
          lines: [{ variantId: product.variants[0].id, quantity: 5, direction: 'OUT', reason: 'damaged goods' }],
        })
        .expect(201);

      await request(app.getHttpServer())
        .post(`/api/v1/transactions/${draftRes.body.id}/post`)
        .set(authHeader(token))
        .send({ idempotencyKey: uuid() })
        .expect(422);
    });

    it('allows ADJUSTMENT_OUT posting when stock >= adjustment qty (200)', async () => {
      const supplier = await createTestSupplier(prisma, tenantId, userId);
      const product = await createTestProduct(prisma, tenantId, userId);

      // Purchase 10 units to build up stock
      await createAndPostPurchase(app, token, {
        supplierId: supplier.id,
        lines: [{ variantId: product.variants[0].id, quantity: 10, unitCost: 500 }],
      });

      const draftRes = await request(app.getHttpServer())
        .post('/api/v1/transactions/adjustments/draft')
        .set(authHeader(token))
        .send({
          transactionDate: today(),
          lines: [{ variantId: product.variants[0].id, quantity: 5, direction: 'OUT', reason: 'damaged goods' }],
        })
        .expect(201);

      const postRes = await request(app.getHttpServer())
        .post(`/api/v1/transactions/${draftRes.body.id}/post`)
        .set(authHeader(token))
        .send({ idempotencyKey: uuid() })
        .expect(200);

      expect(postRes.body.status).toBe('POSTED');
    });

    it('allows ADJUSTMENT_IN posting regardless of current stock (200)', async () => {
      const product = await createTestProduct(prisma, tenantId, userId);
      // No stock — but adjustment IN should always be allowed

      const draftRes = await request(app.getHttpServer())
        .post('/api/v1/transactions/adjustments/draft')
        .set(authHeader(token))
        .send({
          transactionDate: today(),
          lines: [{ variantId: product.variants[0].id, quantity: 5, direction: 'IN', reason: 'found stock' }],
        })
        .expect(201);

      const postRes = await request(app.getHttpServer())
        .post(`/api/v1/transactions/${draftRes.body.id}/post`)
        .set(authHeader(token))
        .send({ idempotencyKey: uuid() })
        .expect(200);

      expect(postRes.body.status).toBe('POSTED');
    });
  });

  // ─── TASK 2.3 — Role check: only OWNER/ADMIN can post adjustments ────────────

  describe('Task 2.3 — Role guard on ADJUSTMENT posting', () => {
    it('rejects ADJUSTMENT posting by STAFF role (403)', async () => {
      // Create STAFF user in the same tenant
      const staffUser = await prisma.user.create({
        data: {
          id: uuid(),
          tenantId,
          fullName: 'Staff User',
          email: `staff-${uuid().substring(0, 8)}@test.com`,
          passwordHash: 'hash',
          role: 'STAFF',
          status: 'ACTIVE',
        },
      });
      const staffToken = generateTestJWT({
        userId: staffUser.id,
        tenantId,
        email: staffUser.email,
        role: 'STAFF',
      });

      const product = await createTestProduct(prisma, tenantId, userId);
      const supplier = await createTestSupplier(prisma, tenantId, userId);

      // Build some stock first (using owner token)
      await createAndPostPurchase(app, token, {
        supplierId: supplier.id,
        lines: [{ variantId: product.variants[0].id, quantity: 10, unitCost: 500 }],
      });

      // Admin creates the draft (owner token)
      const draftRes = await request(app.getHttpServer())
        .post('/api/v1/transactions/adjustments/draft')
        .set(authHeader(token))
        .send({
          transactionDate: today(),
          lines: [{ variantId: product.variants[0].id, quantity: 3, direction: 'OUT', reason: 'damaged' }],
        })
        .expect(201);

      // Staff user tries to post — should be forbidden
      await request(app.getHttpServer())
        .post(`/api/v1/transactions/${draftRes.body.id}/post`)
        .set(authHeader(staffToken))
        .send({ idempotencyKey: uuid() })
        .expect(403);
    });

    it('allows ADJUSTMENT posting by OWNER role (200)', async () => {
      const supplier = await createTestSupplier(prisma, tenantId, userId);
      const product = await createTestProduct(prisma, tenantId, userId);

      await createAndPostPurchase(app, token, {
        supplierId: supplier.id,
        lines: [{ variantId: product.variants[0].id, quantity: 10, unitCost: 500 }],
      });

      const draftRes = await request(app.getHttpServer())
        .post('/api/v1/transactions/adjustments/draft')
        .set(authHeader(token))
        .send({
          transactionDate: today(),
          lines: [{ variantId: product.variants[0].id, quantity: 3, direction: 'OUT', reason: 'damaged' }],
        })
        .expect(201);

      const postRes = await request(app.getHttpServer())
        .post(`/api/v1/transactions/${draftRes.body.id}/post`)
        .set(authHeader(token))
        .send({ idempotencyKey: uuid() })
        .expect(200);

      expect(postRes.body.status).toBe('POSTED');
    });
  });

  // ─── TASK 2.7 — Revalidate entity status at payment posting time ─────────────

  describe('Task 2.7 — Entity active-status revalidation at posting time', () => {
    it('rejects SUPPLIER_PAYMENT posting when supplier is deactivated after draft (400)', async () => {
      const supplier = await createTestSupplier(prisma, tenantId, userId);
      const account = await createTestPaymentAccount(prisma, tenantId, userId);
      const product = await createTestProduct(prisma, tenantId, userId);

      // Build AP balance first
      await createAndPostPurchase(app, token, {
        supplierId: supplier.id,
        lines: [{ variantId: product.variants[0].id, quantity: 5, unitCost: 1000 }],
      });

      // Create supplier payment draft
      const draftRes = await request(app.getHttpServer())
        .post('/api/v1/transactions/supplier-payments/draft')
        .set(authHeader(token))
        .send({ supplierId: supplier.id, amount: 2000, paymentAccountId: account.id, transactionDate: today() })
        .expect(201);

      // Deactivate supplier between draft and post
      await prisma.supplier.update({ where: { id: supplier.id }, data: { status: 'INACTIVE' } });

      await request(app.getHttpServer())
        .post(`/api/v1/transactions/${draftRes.body.id}/post`)
        .set(authHeader(token))
        .send({ idempotencyKey: uuid() })
        .expect(400);
    });

    it('rejects SUPPLIER_PAYMENT posting when payment account is deactivated after draft (400)', async () => {
      const supplier = await createTestSupplier(prisma, tenantId, userId);
      const account = await createTestPaymentAccount(prisma, tenantId, userId);
      const product = await createTestProduct(prisma, tenantId, userId);

      await createAndPostPurchase(app, token, {
        supplierId: supplier.id,
        lines: [{ variantId: product.variants[0].id, quantity: 5, unitCost: 1000 }],
      });

      const draftRes = await request(app.getHttpServer())
        .post('/api/v1/transactions/supplier-payments/draft')
        .set(authHeader(token))
        .send({ supplierId: supplier.id, amount: 2000, paymentAccountId: account.id, transactionDate: today() })
        .expect(201);

      // Deactivate payment account between draft and post
      await prisma.paymentAccount.update({ where: { id: account.id }, data: { status: 'INACTIVE' } });

      await request(app.getHttpServer())
        .post(`/api/v1/transactions/${draftRes.body.id}/post`)
        .set(authHeader(token))
        .send({ idempotencyKey: uuid() })
        .expect(400);
    });

    it('rejects CUSTOMER_PAYMENT posting when customer is deactivated after draft (400)', async () => {
      const supplier = await createTestSupplier(prisma, tenantId, userId);
      const customer = await createTestCustomer(prisma, tenantId, userId);
      const account = await createTestPaymentAccount(prisma, tenantId, userId);
      const product = await createTestProduct(prisma, tenantId, userId);

      await createAndPostPurchase(app, token, {
        supplierId: supplier.id,
        lines: [{ variantId: product.variants[0].id, quantity: 10, unitCost: 500 }],
      });

      await createAndPostSale(app, token, {
        customerId: customer.id,
        lines: [{ variantId: product.variants[0].id, quantity: 5, unitPrice: 1000 }],
      });

      const draftRes = await request(app.getHttpServer())
        .post('/api/v1/transactions/customer-payments/draft')
        .set(authHeader(token))
        .send({ customerId: customer.id, amount: 2000, paymentAccountId: account.id, transactionDate: today() })
        .expect(201);

      // Deactivate customer between draft and post
      await prisma.customer.update({ where: { id: customer.id }, data: { status: 'INACTIVE' } });

      await request(app.getHttpServer())
        .post(`/api/v1/transactions/${draftRes.body.id}/post`)
        .set(authHeader(token))
        .send({ idempotencyKey: uuid() })
        .expect(400);
    });
  });
});
