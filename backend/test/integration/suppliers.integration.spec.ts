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
import { createTenantWithUser, createTestSupplier } from '../helpers/test-factories';
import { PrismaClient } from '@prisma/client';

describe('Suppliers API (Integration)', () => {
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

  describe('POST /api/v1/suppliers', () => {
    it('creates a supplier', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/suppliers')
        .set(authHeader(token))
        .send({ name: 'Acme Supplies' })
        .expect(201);

      expect(response.body.name).toBe('Acme Supplies');
      expect(response.body.id).toBeDefined();
      expect(response.body.tenantId).toBe(tenantId);
      expect(response.body).not.toHaveProperty('_computed');
    });

    it('rejects duplicate name (case-insensitive)', async () => {
      await createTestSupplier(prisma, tenantId, userId, { name: 'Acme Supplies' });

      await request(app.getHttpServer())
        .post('/api/v1/suppliers')
        .set(authHeader(token))
        .send({ name: 'ACME SUPPLIES' })
        .expect(409);
    });

    it('rejects missing name', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/suppliers')
        .set(authHeader(token))
        .send({})
        .expect(400);
    });

    it('rejects name too short', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/suppliers')
        .set(authHeader(token))
        .send({ name: 'A' })
        .expect(400);
    });

    it('requires authentication', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/suppliers')
        .send({ name: 'Acme' })
        .expect(401);
    });
  });

  describe('GET /api/v1/suppliers', () => {
    beforeEach(async () => {
      await createTestSupplier(prisma, tenantId, userId, { name: 'Alpha Supplier' });
      await createTestSupplier(prisma, tenantId, userId, { name: 'Beta Supplier' });
    });

    it('returns paginated list', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/suppliers')
        .set(authHeader(token))
        .expect(200);

      expect(response.body.data).toHaveLength(2);
      expect(response.body.meta.total).toBe(2);
      expect(response.body.meta.page).toBe(1);
    });

    it('filters by search', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/suppliers?search=alpha')
        .set(authHeader(token))
        .expect(200);

      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0].name).toBe('Alpha Supplier');
    });

    it('paginates correctly', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/suppliers?page=1&limit=1')
        .set(authHeader(token))
        .expect(200);

      expect(response.body.data).toHaveLength(1);
      expect(response.body.meta.totalPages).toBe(2);
    });

    it('isolates by tenant', async () => {
      const { tenant: t2, user: u2 } = await createTenantWithUser(prisma);
      await createTestSupplier(prisma, t2.id, u2.id, { name: 'Other Tenant Supplier' });

      const response = await request(app.getHttpServer())
        .get('/api/v1/suppliers')
        .set(authHeader(token))
        .expect(200);

      expect(response.body.data).toHaveLength(2); // only this tenant's
    });
  });

  describe('GET /api/v1/suppliers/:id', () => {
    it('returns a single supplier', async () => {
      const supplier = await createTestSupplier(prisma, tenantId, userId, { name: 'Test Supplier' });

      const response = await request(app.getHttpServer())
        .get(`/api/v1/suppliers/${supplier.id}`)
        .set(authHeader(token))
        .expect(200);

      expect(response.body.id).toBe(supplier.id);
      expect(response.body.name).toBe('Test Supplier');
      expect(response.body).not.toHaveProperty('_computed');
    });

    it('returns 404 for nonexistent supplier', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/suppliers/00000000-0000-0000-0000-000000000000')
        .set(authHeader(token))
        .expect(404);
    });

    it('returns 404 for cross-tenant access', async () => {
      const { tenant: t2, user: u2 } = await createTenantWithUser(prisma);
      const otherSupplier = await createTestSupplier(prisma, t2.id, u2.id, { name: 'Other' });

      await request(app.getHttpServer())
        .get(`/api/v1/suppliers/${otherSupplier.id}`)
        .set(authHeader(token))
        .expect(404);
    });
  });

  describe('PATCH /api/v1/suppliers/:id', () => {
    it('updates supplier fields', async () => {
      const supplier = await createTestSupplier(prisma, tenantId, userId, { name: 'Original' });

      const response = await request(app.getHttpServer())
        .patch(`/api/v1/suppliers/${supplier.id}`)
        .set(authHeader(token))
        .send({ name: 'Updated', phone: '+92300 9999999' })
        .expect(200);

      expect(response.body.name).toBe('Updated');
      expect(response.body.phone).toBe('+92300 9999999');
    });

    it('returns 404 for nonexistent supplier', async () => {
      await request(app.getHttpServer())
        .patch('/api/v1/suppliers/00000000-0000-0000-0000-000000000000')
        .set(authHeader(token))
        .send({ name: 'Updated' })
        .expect(404);
    });

    it('rejects duplicate name on update', async () => {
      await createTestSupplier(prisma, tenantId, userId, { name: 'Existing Supplier' });
      const supplier = await createTestSupplier(prisma, tenantId, userId, { name: 'Another Supplier' });

      await request(app.getHttpServer())
        .patch(`/api/v1/suppliers/${supplier.id}`)
        .set(authHeader(token))
        .send({ name: 'Existing Supplier' })
        .expect(409);
    });
  });

  describe('PATCH /api/v1/suppliers/:id/status', () => {
    it('updates supplier status', async () => {
      const supplier = await createTestSupplier(prisma, tenantId, userId, { name: 'Active Supplier' });

      const response = await request(app.getHttpServer())
        .patch(`/api/v1/suppliers/${supplier.id}/status`)
        .set(authHeader(token))
        .send({ status: 'INACTIVE' })
        .expect(200);

      expect(response.body.status).toBe('INACTIVE');
    });

    it('rejects invalid status', async () => {
      const supplier = await createTestSupplier(prisma, tenantId, userId, { name: 'Test' });

      await request(app.getHttpServer())
        .patch(`/api/v1/suppliers/${supplier.id}/status`)
        .set(authHeader(token))
        .send({ status: 'DELETED' })
        .expect(400);
    });
  });

  // ─── Wave 3 — DB-level uniqueness enforcement ────────────────────────────────

  describe('Wave 3 — Uniqueness constraint (Task 3.1 / 3.2)', () => {
    it('rejects duplicate supplier name case-insensitively (via DB unique index)', async () => {
      // First create succeeds
      await request(app.getHttpServer())
        .post('/api/v1/suppliers')
        .set(authHeader(token))
        .send({ name: 'Acme Corp' })
        .expect(201);

      // Second create with different case must fail with 409
      await request(app.getHttpServer())
        .post('/api/v1/suppliers')
        .set(authHeader(token))
        .send({ name: 'acme corp' })
        .expect(409);
    });

    it('rejects duplicate name on update (case-insensitive)', async () => {
      await createTestSupplier(prisma, tenantId, userId, { name: 'Alpha Sup' });
      const beta = await createTestSupplier(prisma, tenantId, userId, { name: 'Beta Sup' });

      await request(app.getHttpServer())
        .patch(`/api/v1/suppliers/${beta.id}`)
        .set(authHeader(token))
        .send({ name: 'ALPHA SUP' })
        .expect(409);
    });

    it('concurrent duplicate supplier creation returns 409 (not 500)', async () => {
      const [r1, r2] = await Promise.all([
        request(app.getHttpServer())
          .post('/api/v1/suppliers')
          .set(authHeader(token))
          .send({ name: 'Race Supplier' }),
        request(app.getHttpServer())
          .post('/api/v1/suppliers')
          .set(authHeader(token))
          .send({ name: 'Race Supplier' }),
      ]);
      const statuses = [r1.status, r2.status].sort();
      expect(statuses).toContain(201);
      expect(statuses).toContain(409);
    });
  });
});
