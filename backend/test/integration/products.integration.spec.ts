import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../../src/app.module';
import {
  cleanDatabase,
  setupTestDatabase,
  teardownTestDatabase,
  getTestPrismaClient,
} from '../helpers/test-database';
import { createTestApp, generateTestJWT, authHeader } from '../helpers/test-utils';
import { createTenantWithUser, createTestProduct } from '../helpers/test-factories';
import { PrismaClient } from '@prisma/client';

describe('Products API (Integration)', () => {
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

  describe('POST /api/v1/products', () => {
    it('creates a product without SKU', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/products')
        .set(authHeader(token))
        .send({ name: 'Widget' })
        .expect(201);

      expect(response.body.name).toBe('Widget');
      expect(response.body).not.toHaveProperty('_computed');
    });

    it('creates a product with SKU (uppercased)', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/products')
        .set(authHeader(token))
        .send({ name: 'Widget', sku: 'wid-001' })
        .expect(201);

      expect(response.body.sku).toBe('WID-001');
    });

    it('rejects duplicate SKU', async () => {
      await createTestProduct(prisma, tenantId, userId, { name: 'Widget 1', sku: 'WID-001' });

      await request(app.getHttpServer())
        .post('/api/v1/products')
        .set(authHeader(token))
        .send({ name: 'Widget 2', sku: 'WID-001' })
        .expect(409);
    });

    it('rejects invalid SKU format', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/products')
        .set(authHeader(token))
        .send({ name: 'Widget', sku: 'invalid sku!' })
        .expect(400);
    });

    it('rejects missing name', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/products')
        .set(authHeader(token))
        .send({ sku: 'WID-001' })
        .expect(400);
    });

    it('requires authentication', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/products')
        .send({ name: 'Widget' })
        .expect(401);
    });
  });

  describe('GET /api/v1/products', () => {
    beforeEach(async () => {
      await createTestProduct(prisma, tenantId, userId, { name: 'Electronics Widget', category: 'Electronics' });
      await createTestProduct(prisma, tenantId, userId, { name: 'Furniture Chair', category: 'Furniture' });
    });

    it('returns paginated list', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/products')
        .set(authHeader(token))
        .expect(200);

      expect(response.body.data).toHaveLength(2);
      expect(response.body.meta.total).toBe(2);
    });

    it('filters by category', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/products?category=Electronics')
        .set(authHeader(token))
        .expect(200);

      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0].category).toBe('Electronics');
    });

    it('filters by search (matches name and sku)', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/products?search=widget')
        .set(authHeader(token))
        .expect(200);

      expect(response.body.data).toHaveLength(1);
    });

    it('sorts by createdAt desc', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/products?sortBy=createdAt&sortOrder=desc')
        .set(authHeader(token))
        .expect(200);

      expect(response.body.data).toHaveLength(2);
      expect(new Date(response.body.data[0].createdAt).getTime()).toBeGreaterThanOrEqual(
        new Date(response.body.data[1].createdAt).getTime(),
      );
    });

    it('isolates by tenant', async () => {
      const { tenant: t2, user: u2 } = await createTenantWithUser(prisma);
      await createTestProduct(prisma, t2.id, u2.id, { name: 'Other Product' });

      const response = await request(app.getHttpServer())
        .get('/api/v1/products')
        .set(authHeader(token))
        .expect(200);

      expect(response.body.data).toHaveLength(2);
    });
  });

  describe('GET /api/v1/products/:id', () => {
    it('returns a single product', async () => {
      const product = await createTestProduct(prisma, tenantId, userId, { name: 'Test Product' });

      const response = await request(app.getHttpServer())
        .get(`/api/v1/products/${product.id}`)
        .set(authHeader(token))
        .expect(200);

      expect(response.body.id).toBe(product.id);
      expect(response.body).not.toHaveProperty('_computed');
    });

    it('returns 404 for cross-tenant access', async () => {
      const { tenant: t2, user: u2 } = await createTenantWithUser(prisma);
      const other = await createTestProduct(prisma, t2.id, u2.id, { name: 'Other' });

      await request(app.getHttpServer())
        .get(`/api/v1/products/${other.id}`)
        .set(authHeader(token))
        .expect(404);
    });
  });

  describe('PATCH /api/v1/products/:id', () => {
    it('updates product fields', async () => {
      const product = await createTestProduct(prisma, tenantId, userId, { name: 'Original' });

      const response = await request(app.getHttpServer())
        .patch(`/api/v1/products/${product.id}`)
        .set(authHeader(token))
        .send({ name: 'Updated', category: 'New Category' })
        .expect(200);

      expect(response.body.name).toBe('Updated');
      expect(response.body.category).toBe('New Category');
    });

    it('avgCost is not updatable via PATCH', async () => {
      const product = await createTestProduct(prisma, tenantId, userId, { name: 'Test', avgCost: 100 });

      // avgCost is not in UpdateProductDto (whitelist: true strips it)
      const response = await request(app.getHttpServer())
        .patch(`/api/v1/products/${product.id}`)
        .set(authHeader(token))
        .send({ avgCost: 999 })
        .expect(400); // Forbidden property due to whitelist
    });
  });

  describe('PATCH /api/v1/products/:id/status', () => {
    it('updates product status', async () => {
      const product = await createTestProduct(prisma, tenantId, userId, { name: 'Active Product' });

      const response = await request(app.getHttpServer())
        .patch(`/api/v1/products/${product.id}/status`)
        .set(authHeader(token))
        .send({ status: 'INACTIVE' })
        .expect(200);

      expect(response.body.status).toBe('INACTIVE');
    });
  });

  // ─── Wave 3 — SKU case-insensitive uniqueness ────────────────────────────────

  describe('Wave 3 — SKU uniqueness constraint (Task 3.1)', () => {
    it('rejects duplicate SKU case-insensitively (via DB unique index)', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/products')
        .set(authHeader(token))
        .send({ name: 'Widget A', sku: 'SKU-001' })
        .expect(201);

      // Same SKU, different case — DB unique index on lower(sku) catches this
      await request(app.getHttpServer())
        .post('/api/v1/products')
        .set(authHeader(token))
        .send({ name: 'Widget B', sku: 'sku-001' })
        .expect(409);
    });
  });
});
