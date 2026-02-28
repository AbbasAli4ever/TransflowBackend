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
  createTestCustomer,
  createTestPaymentAccount,
} from '../helpers/test-factories';
import { PrismaClient } from '@prisma/client';

describe('Boundary Value & Input Validation (Integration)', () => {
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

  // ─── Negative Values ──────────────────────────────────────────────────────────

  describe('Negative value rejections', () => {
    it('unitCost: -1 on purchase draft → 400', async () => {
      const supplier = await createTestSupplier(prisma, tenantId, userId);
      const product = await createTestProduct(prisma, tenantId, userId);

      await request(app.getHttpServer())
        .post('/api/v1/transactions/purchases/draft')
        .set(authHeader(token))
        .send({
          supplierId: supplier.id,
          transactionDate: new Date().toISOString().split('T')[0],
          lines: [{ variantId: product.variants[0].id, quantity: 1, unitCost: -1 }],
        })
        .expect(400);
    });

    it('unitPrice: -1 on sale draft → 400', async () => {
      const customer = await createTestCustomer(prisma, tenantId, userId);
      const product = await createTestProduct(prisma, tenantId, userId);

      await request(app.getHttpServer())
        .post('/api/v1/transactions/sales/draft')
        .set(authHeader(token))
        .send({
          customerId: customer.id,
          transactionDate: new Date().toISOString().split('T')[0],
          lines: [{ variantId: product.variants[0].id, quantity: 1, unitPrice: -1 }],
        })
        .expect(400);
    });

    it('quantity: -1 on purchase draft → 400', async () => {
      const supplier = await createTestSupplier(prisma, tenantId, userId);
      const product = await createTestProduct(prisma, tenantId, userId);

      await request(app.getHttpServer())
        .post('/api/v1/transactions/purchases/draft')
        .set(authHeader(token))
        .send({
          supplierId: supplier.id,
          transactionDate: new Date().toISOString().split('T')[0],
          lines: [{ variantId: product.variants[0].id, quantity: -1, unitCost: 100 }],
        })
        .expect(400);
    });

    it('amount: -1 on supplier payment draft → 400', async () => {
      const supplier = await createTestSupplier(prisma, tenantId, userId);
      const account = await createTestPaymentAccount(prisma, tenantId, userId);

      await request(app.getHttpServer())
        .post('/api/v1/transactions/supplier-payments/draft')
        .set(authHeader(token))
        .send({
          supplierId: supplier.id,
          amount: -1,
          paymentAccountId: account.id,
          transactionDate: new Date().toISOString().split('T')[0],
        })
        .expect(400);
    });

    it('discountAmount: -1 on purchase draft → 400', async () => {
      const supplier = await createTestSupplier(prisma, tenantId, userId);
      const product = await createTestProduct(prisma, tenantId, userId);

      await request(app.getHttpServer())
        .post('/api/v1/transactions/purchases/draft')
        .set(authHeader(token))
        .send({
          supplierId: supplier.id,
          transactionDate: new Date().toISOString().split('T')[0],
          lines: [{ variantId: product.variants[0].id, quantity: 5, unitCost: 100, discountAmount: -1 }],
        })
        .expect(400);
    });
  });

  // ─── Float / Decimal Values ───────────────────────────────────────────────────

  describe('Float/decimal rejections (integers only)', () => {
    it('unitCost: 99.99 on purchase draft → 400', async () => {
      const supplier = await createTestSupplier(prisma, tenantId, userId);
      const product = await createTestProduct(prisma, tenantId, userId);

      await request(app.getHttpServer())
        .post('/api/v1/transactions/purchases/draft')
        .set(authHeader(token))
        .send({
          supplierId: supplier.id,
          transactionDate: new Date().toISOString().split('T')[0],
          lines: [{ variantId: product.variants[0].id, quantity: 1, unitCost: 99.99 }],
        })
        .expect(400);
    });

    it('quantity: 1.5 on purchase draft → 400', async () => {
      const supplier = await createTestSupplier(prisma, tenantId, userId);
      const product = await createTestProduct(prisma, tenantId, userId);

      await request(app.getHttpServer())
        .post('/api/v1/transactions/purchases/draft')
        .set(authHeader(token))
        .send({
          supplierId: supplier.id,
          transactionDate: new Date().toISOString().split('T')[0],
          lines: [{ variantId: product.variants[0].id, quantity: 1.5, unitCost: 100 }],
        })
        .expect(400);
    });
  });

  // ─── Zero Values ──────────────────────────────────────────────────────────────

  describe('Zero value handling', () => {
    it('quantity: 0 on purchase draft → 400', async () => {
      const supplier = await createTestSupplier(prisma, tenantId, userId);
      const product = await createTestProduct(prisma, tenantId, userId);

      await request(app.getHttpServer())
        .post('/api/v1/transactions/purchases/draft')
        .set(authHeader(token))
        .send({
          supplierId: supplier.id,
          transactionDate: new Date().toISOString().split('T')[0],
          lines: [{ variantId: product.variants[0].id, quantity: 0, unitCost: 100 }],
        })
        .expect(400);
    });

    it('amount: 0 on supplier payment draft → 400', async () => {
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

    it('discountAmount: 0 on purchase draft → 200 (valid zero discount)', async () => {
      const supplier = await createTestSupplier(prisma, tenantId, userId);
      const product = await createTestProduct(prisma, tenantId, userId);

      await request(app.getHttpServer())
        .post('/api/v1/transactions/purchases/draft')
        .set(authHeader(token))
        .send({
          supplierId: supplier.id,
          transactionDate: new Date().toISOString().split('T')[0],
          lines: [{ variantId: product.variants[0].id, quantity: 1, unitCost: 100, discountAmount: 0 }],
        })
        .expect(201);
    });

    it('deliveryFee: 0 on purchase draft → 200 (valid zero fee)', async () => {
      const supplier = await createTestSupplier(prisma, tenantId, userId);
      const product = await createTestProduct(prisma, tenantId, userId);

      await request(app.getHttpServer())
        .post('/api/v1/transactions/purchases/draft')
        .set(authHeader(token))
        .send({
          supplierId: supplier.id,
          transactionDate: new Date().toISOString().split('T')[0],
          lines: [{ variantId: product.variants[0].id, quantity: 1, unitCost: 100 }],
          deliveryFee: 0,
        })
        .expect(201);
    });
  });

  // ─── Wrong Types ──────────────────────────────────────────────────────────────

  describe('Wrong type rejections', () => {
    it('quantity: "five" (string) on purchase draft → 400', async () => {
      const supplier = await createTestSupplier(prisma, tenantId, userId);
      const product = await createTestProduct(prisma, tenantId, userId);

      await request(app.getHttpServer())
        .post('/api/v1/transactions/purchases/draft')
        .set(authHeader(token))
        .send({
          supplierId: supplier.id,
          transactionDate: new Date().toISOString().split('T')[0],
          lines: [{ variantId: product.variants[0].id, quantity: 'five', unitCost: 100 }],
        })
        .expect(400);
    });

    it('supplierId path param "not-a-uuid" → 400 (ParseUUIDPipe)', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/suppliers/not-a-uuid')
        .set(authHeader(token))
        .expect(400);
    });
  });

  // ─── Discount Edge Cases ──────────────────────────────────────────────────────

  describe('Discount boundary values', () => {
    it('discount exactly equals lineTotal (qty=5, unitCost=100, discount=500) → 201 (lineTotal=0)', async () => {
      const supplier = await createTestSupplier(prisma, tenantId, userId);
      const product = await createTestProduct(prisma, tenantId, userId);

      await request(app.getHttpServer())
        .post('/api/v1/transactions/purchases/draft')
        .set(authHeader(token))
        .send({
          supplierId: supplier.id,
          transactionDate: new Date().toISOString().split('T')[0],
          lines: [{ variantId: product.variants[0].id, quantity: 5, unitCost: 100, discountAmount: 500 }],
        })
        .expect(201);
    });

    it('discount exceeds lineTotal (qty=5, unitCost=100, discount=501) → 400', async () => {
      const supplier = await createTestSupplier(prisma, tenantId, userId);
      const product = await createTestProduct(prisma, tenantId, userId);

      await request(app.getHttpServer())
        .post('/api/v1/transactions/purchases/draft')
        .set(authHeader(token))
        .send({
          supplierId: supplier.id,
          transactionDate: new Date().toISOString().split('T')[0],
          lines: [{ variantId: product.variants[0].id, quantity: 5, unitCost: 100, discountAmount: 501 }],
        })
        .expect(400);
    });
  });

  // ─── Pagination Boundary ──────────────────────────────────────────────────────

  describe('Pagination boundary values', () => {
    it('page: 0 on GET /suppliers → 400', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/suppliers?page=0')
        .set(authHeader(token))
        .expect(400);
    });

    it('limit: 0 on GET /suppliers → 400', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/suppliers?limit=0')
        .set(authHeader(token))
        .expect(400);
    });

    it('limit: 101 on GET /suppliers → 400', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/suppliers?limit=101')
        .set(authHeader(token))
        .expect(400);
    });

    it('page: 9999 on GET /suppliers → 200 with empty data array', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/suppliers?page=9999')
        .set(authHeader(token))
        .expect(200);

      expect(res.body.data).toHaveLength(0);
    });
  });

  // ─── String Length Boundary ───────────────────────────────────────────────────

  describe('String length boundaries', () => {
    it('notes > 1000 chars on purchase draft → 400', async () => {
      const supplier = await createTestSupplier(prisma, tenantId, userId);
      const product = await createTestProduct(prisma, tenantId, userId);
      const oversizedNotes = 'x'.repeat(1001);

      await request(app.getHttpServer())
        .post('/api/v1/transactions/purchases/draft')
        .set(authHeader(token))
        .send({
          supplierId: supplier.id,
          transactionDate: new Date().toISOString().split('T')[0],
          lines: [{ variantId: product.variants[0].id, quantity: 1, unitCost: 100 }],
          notes: oversizedNotes,
        })
        .expect(400);
    });
  });
});
