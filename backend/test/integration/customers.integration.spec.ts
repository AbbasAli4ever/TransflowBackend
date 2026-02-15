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
import { createTenantWithUser, createTestCustomer } from '../helpers/test-factories';
import { PrismaClient } from '@prisma/client';

describe('Customers API (Integration)', () => {
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

  describe('POST /api/v1/customers', () => {
    it('creates a customer', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/customers')
        .set(authHeader(token))
        .send({ name: 'Big Corp' })
        .expect(201);

      expect(response.body.name).toBe('Big Corp');
      expect(response.body.id).toBeDefined();
      expect(response.body.tenantId).toBe(tenantId);
      expect(response.body).not.toHaveProperty('_computed');
    });

    it('rejects duplicate name', async () => {
      await createTestCustomer(prisma, tenantId, userId, { name: 'Big Corp' });

      await request(app.getHttpServer())
        .post('/api/v1/customers')
        .set(authHeader(token))
        .send({ name: 'Big Corp' })
        .expect(409);
    });

    it('rejects missing name', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/customers')
        .set(authHeader(token))
        .send({})
        .expect(400);
    });

    it('requires authentication', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/customers')
        .send({ name: 'Test' })
        .expect(401);
    });
  });

  describe('GET /api/v1/customers', () => {
    beforeEach(async () => {
      await createTestCustomer(prisma, tenantId, userId, { name: 'Alpha Customer' });
      await createTestCustomer(prisma, tenantId, userId, { name: 'Beta Customer' });
    });

    it('returns paginated list', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/customers')
        .set(authHeader(token))
        .expect(200);

      expect(response.body.data).toHaveLength(2);
      expect(response.body.meta.total).toBe(2);
    });

    it('filters by search', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/customers?search=alpha')
        .set(authHeader(token))
        .expect(200);

      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0].name).toBe('Alpha Customer');
    });

    it('isolates by tenant', async () => {
      const { tenant: t2, user: u2 } = await createTenantWithUser(prisma);
      await createTestCustomer(prisma, t2.id, u2.id, { name: 'Other Tenant Customer' });

      const response = await request(app.getHttpServer())
        .get('/api/v1/customers')
        .set(authHeader(token))
        .expect(200);

      expect(response.body.data).toHaveLength(2);
    });
  });

  describe('GET /api/v1/customers/:id', () => {
    it('returns a single customer', async () => {
      const customer = await createTestCustomer(prisma, tenantId, userId, { name: 'Test Customer' });

      const response = await request(app.getHttpServer())
        .get(`/api/v1/customers/${customer.id}`)
        .set(authHeader(token))
        .expect(200);

      expect(response.body.id).toBe(customer.id);
      expect(response.body).not.toHaveProperty('_computed');
    });

    it('returns 404 for cross-tenant access', async () => {
      const { tenant: t2, user: u2 } = await createTenantWithUser(prisma);
      const other = await createTestCustomer(prisma, t2.id, u2.id, { name: 'Other' });

      await request(app.getHttpServer())
        .get(`/api/v1/customers/${other.id}`)
        .set(authHeader(token))
        .expect(404);
    });
  });

  describe('PATCH /api/v1/customers/:id', () => {
    it('updates customer fields', async () => {
      const customer = await createTestCustomer(prisma, tenantId, userId, { name: 'Original' });

      const response = await request(app.getHttpServer())
        .patch(`/api/v1/customers/${customer.id}`)
        .set(authHeader(token))
        .send({ name: 'Updated', phone: '+92300 1111111' })
        .expect(200);

      expect(response.body.name).toBe('Updated');
      expect(response.body.phone).toBe('+92300 1111111');
    });
  });

  describe('PATCH /api/v1/customers/:id/status', () => {
    it('updates customer status', async () => {
      const customer = await createTestCustomer(prisma, tenantId, userId, { name: 'Active' });

      const response = await request(app.getHttpServer())
        .patch(`/api/v1/customers/${customer.id}/status`)
        .set(authHeader(token))
        .send({ status: 'INACTIVE' })
        .expect(200);

      expect(response.body.status).toBe('INACTIVE');
    });
  });

  // ─── Wave 3 — DB-level uniqueness enforcement ────────────────────────────────

  describe('Wave 3 — Uniqueness constraint (Task 3.1 / 3.2)', () => {
    it('rejects duplicate customer name case-insensitively (via DB unique index)', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/customers')
        .set(authHeader(token))
        .send({ name: 'Zara Store' })
        .expect(201);

      await request(app.getHttpServer())
        .post('/api/v1/customers')
        .set(authHeader(token))
        .send({ name: 'ZARA STORE' })
        .expect(409);
    });

    it('concurrent duplicate customer creation returns 409 (not 500)', async () => {
      const [r1, r2] = await Promise.all([
        request(app.getHttpServer())
          .post('/api/v1/customers')
          .set(authHeader(token))
          .send({ name: 'Race Customer' }),
        request(app.getHttpServer())
          .post('/api/v1/customers')
          .set(authHeader(token))
          .send({ name: 'Race Customer' }),
      ]);
      const statuses = [r1.status, r2.status].sort();
      expect(statuses).toContain(201);
      expect(statuses).toContain(409);
    });
  });
});
