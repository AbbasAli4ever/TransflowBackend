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
          lines: [{ productId: product.id, quantity: 10, unitCost: 500 }],
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
          lines: [{ productId: product.id, quantity: 2, unitCost: 1000 }],
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
          lines: [{ productId: product.id, quantity: 5, unitCost: 1000, discountAmount: 250 }],
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
          lines: [{ productId: product.id, quantity: 1, unitCost: 100 }],
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
          lines: [{ productId: product.id, quantity: 1, unitCost: 100 }],
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
          lines: [{ productId: product.id, quantity: 1, unitCost: 100 }],
        })
        .expect(422);
    });

    it('rejects unknown productId (404)', async () => {
      const supplier = await createTestSupplier(prisma, tenantId, userId);

      await request(app.getHttpServer())
        .post('/api/v1/transactions/purchases/draft')
        .set(authHeader(token))
        .send({
          supplierId: supplier.id,
          transactionDate: new Date().toISOString().split('T')[0],
          lines: [{ productId: uuid(), quantity: 1, unitCost: 100 }],
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
          lines: [{ productId: product.id, quantity: 2, unitCost: 100, discountAmount: 300 }],
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
          lines: [{ productId: product.id, quantity: 3, unitPrice: 2000 }],
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
          lines: [{ productId: product.id, quantity: 1, unitPrice: 500 }],
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
          lines: [{ productId: product.id, quantity: 1, unitPrice: 500 }],
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
          lines: [{ productId: product.id, quantity: 1, unitPrice: 500 }],
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
            lines: [{ productId: product.id, quantity: 1, unitCost: 100 }],
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
        .send({ supplierId: supplier.id, transactionDate: today, lines: [{ productId: product.id, quantity: 1, unitCost: 100 }] });

      await request(app.getHttpServer())
        .post('/api/v1/transactions/sales/draft')
        .set(authHeader(token))
        .send({ customerId: customer.id, transactionDate: today, lines: [{ productId: product.id, quantity: 1, unitPrice: 200 }] });

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
        .send({ supplierId: supplier.id, transactionDate: today, lines: [{ productId: product.id, quantity: 1, unitCost: 100 }] });

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
        .send({ supplierId: supplier2.id, transactionDate: today, lines: [{ productId: product2.id, quantity: 1, unitCost: 100 }] });

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
          lines: [{ productId: product.id, quantity: 5, unitCost: 300 }],
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
        .send({ supplierId: supplier2.id, transactionDate: today, lines: [{ productId: product2.id, quantity: 1, unitCost: 100 }] })
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
