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
  createAndPostSupplierPayment,
  createAndPostCustomerPayment,
} from '../helpers/test-factories';
import { PrismaClient } from '@prisma/client';

describe('Security & Input Validation (Integration)', () => {
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

  // ─── SQL Injection ────────────────────────────────────────────────────────────

  describe('SQL Injection safety (Prisma parameterized queries)', () => {
    it('supplier name with SQL injection string is stored safely and returns 201', async () => {
      const injectionName = "'; DROP TABLE suppliers; --";

      const res = await request(app.getHttpServer())
        .post('/api/v1/suppliers')
        .set(authHeader(token))
        .send({ name: injectionName })
        .expect(201);

      expect(res.body.name).toBe(injectionName);

      // Verify the database is still intact
      const listRes = await request(app.getHttpServer())
        .get('/api/v1/suppliers')
        .set(authHeader(token))
        .expect(200);

      expect(listRes.body.data.length).toBeGreaterThan(0);
    });

    it('search param with SQL injection string returns 200 with empty or normal results, no crash', async () => {
      const res = await request(app.getHttpServer())
        .get("/api/v1/suppliers?search='; DROP TABLE suppliers; --")
        .set(authHeader(token))
        .expect(200);

      expect(res.body.data).toBeDefined();
      expect(Array.isArray(res.body.data)).toBe(true);
    });

    it('non-UUID ID with SQL injection string is rejected by ParseUUIDPipe with 400', async () => {
      await request(app.getHttpServer())
        .get("/api/v1/suppliers/'; DROP TABLE-- ")
        .set(authHeader(token))
        .expect(400);
    });
  });

  // ─── XSS ─────────────────────────────────────────────────────────────────────

  describe('XSS: API stores raw strings (frontend responsible for encoding)', () => {
    it('supplier name with script tag is stored literally and retrieved unchanged', async () => {
      const scriptName = '<script>alert(1)</script>';

      const createRes = await request(app.getHttpServer())
        .post('/api/v1/suppliers')
        .set(authHeader(token))
        .send({ name: scriptName })
        .expect(201);

      const supplierId = createRes.body.id;

      const getRes = await request(app.getHttpServer())
        .get(`/api/v1/suppliers/${supplierId}`)
        .set(authHeader(token))
        .expect(200);

      expect(getRes.body.name).toBe(scriptName);
    });

    it('customer name with event handler attribute is stored literally', async () => {
      const xssName = '<img src=x onerror=alert(1)>';

      const res = await request(app.getHttpServer())
        .post('/api/v1/customers')
        .set(authHeader(token))
        .send({ name: xssName })
        .expect(201);

      expect(res.body.name).toBe(xssName);
    });

    it('notes field with javascript: prefix is stored without sanitization', async () => {
      const supplier = await createTestSupplier(prisma, tenantId, userId);
      const product = await createTestProduct(prisma, tenantId, userId);

      const res = await request(app.getHttpServer())
        .post('/api/v1/transactions/purchases/draft')
        .set(authHeader(token))
        .send({
          supplierId: supplier.id,
          transactionDate: new Date().toISOString().split('T')[0],
          lines: [{ variantId: product.variants[0].id, quantity: 1, unitCost: 100 }],
          notes: 'javascript:void(0)',
        })
        .expect(201);

      expect(res.body.notes).toBe('javascript:void(0)');
    });
  });

  // ─── Unicode ──────────────────────────────────────────────────────────────────

  describe('Unicode support (PostgreSQL UTF-8)', () => {
    it('Arabic supplier name is created and retrieved correctly', async () => {
      const arabicName = 'محل الأقمشة';

      const createRes = await request(app.getHttpServer())
        .post('/api/v1/suppliers')
        .set(authHeader(token))
        .send({ name: arabicName })
        .expect(201);

      const getRes = await request(app.getHttpServer())
        .get(`/api/v1/suppliers/${createRes.body.id}`)
        .set(authHeader(token))
        .expect(200);

      expect(getRes.body.name).toBe(arabicName);
    });

    it('Japanese customer name is created and retrieved correctly', async () => {
      const japaneseName = '顧客名前';

      const res = await request(app.getHttpServer())
        .post('/api/v1/customers')
        .set(authHeader(token))
        .send({ name: japaneseName })
        .expect(201);

      expect(res.body.name).toBe(japaneseName);
    });

    it('emoji in purchase notes is stored and retrieved correctly', async () => {
      const supplier = await createTestSupplier(prisma, tenantId, userId);
      const product = await createTestProduct(prisma, tenantId, userId);
      const emojiNotes = 'Order 🚀 confirmed';

      const draftRes = await request(app.getHttpServer())
        .post('/api/v1/transactions/purchases/draft')
        .set(authHeader(token))
        .send({
          supplierId: supplier.id,
          transactionDate: new Date().toISOString().split('T')[0],
          lines: [{ variantId: product.variants[0].id, quantity: 1, unitCost: 100 }],
          notes: emojiNotes,
        })
        .expect(201);

      expect(draftRes.body.notes).toBe(emojiNotes);
    });
  });

  // ─── Malformed Requests ───────────────────────────────────────────────────────

  describe('Malformed requests', () => {
    it('GET /suppliers/not-a-uuid → 400 (ParseUUIDPipe)', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/suppliers/not-a-uuid')
        .set(authHeader(token))
        .expect(400);
    });

    it('GET /transactions/not-a-uuid → 400 (ParseUUIDPipe)', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/transactions/not-a-uuid')
        .set(authHeader(token))
        .expect(400);
    });

    it('PUT /transactions/purchases/draft → 404 or 405 (method not allowed)', async () => {
      const res = await request(app.getHttpServer())
        .put('/api/v1/transactions/purchases/draft')
        .set(authHeader(token))
        .send({});

      expect([404, 405]).toContain(res.status);
    });

    it('extra/forbidden fields in POST /suppliers body → 400 (forbidNonWhitelisted)', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/suppliers')
        .set(authHeader(token))
        .send({
          name: 'Legit Supplier',
          injectedField: 'malicious value',
          __proto__: { isAdmin: true },
        })
        .expect(400);
    });

    it('Content-Type application/xml with JSON body → 400 or 415', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/suppliers')
        .set(authHeader(token))
        .set('Content-Type', 'application/xml')
        .send('<supplier><name>test</name></supplier>');

      expect([400, 415]).toContain(res.status);
    });

    it('notes field exactly 1000 chars → 200 (at boundary)', async () => {
      const supplier = await createTestSupplier(prisma, tenantId, userId);
      const product = await createTestProduct(prisma, tenantId, userId);
      const exactNotes = 'a'.repeat(1000);

      await request(app.getHttpServer())
        .post('/api/v1/transactions/purchases/draft')
        .set(authHeader(token))
        .send({
          supplierId: supplier.id,
          transactionDate: new Date().toISOString().split('T')[0],
          lines: [{ variantId: product.variants[0].id, quantity: 1, unitCost: 100 }],
          notes: exactNotes,
        })
        .expect(201);
    });

    it('notes field 1001 chars → 400 (over boundary)', async () => {
      const supplier = await createTestSupplier(prisma, tenantId, userId);
      const product = await createTestProduct(prisma, tenantId, userId);
      const overNotes = 'a'.repeat(1001);

      await request(app.getHttpServer())
        .post('/api/v1/transactions/purchases/draft')
        .set(authHeader(token))
        .send({
          supplierId: supplier.id,
          transactionDate: new Date().toISOString().split('T')[0],
          lines: [{ variantId: product.variants[0].id, quantity: 1, unitCost: 100 }],
          notes: overNotes,
        })
        .expect(400);
    });
  });
});
