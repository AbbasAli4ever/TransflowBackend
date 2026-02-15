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
import { createTenantWithUser, createTestPaymentAccount } from '../helpers/test-factories';
import { PrismaClient } from '@prisma/client';

describe('Payment Accounts API (Integration)', () => {
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

  describe('POST /api/v1/payment-accounts', () => {
    it('creates a cash account', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/payment-accounts')
        .set(authHeader(token))
        .send({ name: 'Main Cash', type: 'CASH' })
        .expect(201);

      expect(response.body.name).toBe('Main Cash');
      expect(response.body.type).toBe('CASH');
      expect(response.body.openingBalance).toBe(0);
      expect(response.body).not.toHaveProperty('_computed');
    });

    it('creates account with opening balance', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/payment-accounts')
        .set(authHeader(token))
        .send({ name: 'Bank Account', type: 'BANK', openingBalance: 50000 })
        .expect(201);

      expect(response.body.openingBalance).toBe(50000);
    });

    it('creates account with negative opening balance', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/payment-accounts')
        .set(authHeader(token))
        .send({ name: 'Overdraft Account', type: 'BANK', openingBalance: -10000 })
        .expect(201);

      expect(response.body.openingBalance).toBe(-10000);
    });

    it('rejects duplicate name', async () => {
      await createTestPaymentAccount(prisma, tenantId, userId, { name: 'Main Cash', type: 'CASH' });

      await request(app.getHttpServer())
        .post('/api/v1/payment-accounts')
        .set(authHeader(token))
        .send({ name: 'Main Cash', type: 'WALLET' })
        .expect(409);
    });

    it('rejects invalid type', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/payment-accounts')
        .set(authHeader(token))
        .send({ name: 'Test', type: 'INVALID' })
        .expect(400);
    });

    it('rejects missing type', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/payment-accounts')
        .set(authHeader(token))
        .send({ name: 'Test' })
        .expect(400);
    });

    it('requires authentication', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/payment-accounts')
        .send({ name: 'Test', type: 'CASH' })
        .expect(401);
    });
  });

  describe('GET /api/v1/payment-accounts', () => {
    beforeEach(async () => {
      await createTestPaymentAccount(prisma, tenantId, userId, { name: 'Cash', type: 'CASH' });
      await createTestPaymentAccount(prisma, tenantId, userId, { name: 'Bank', type: 'BANK' });
    });

    it('returns paginated list', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/payment-accounts')
        .set(authHeader(token))
        .expect(200);

      expect(response.body.data).toHaveLength(2);
      expect(response.body.meta.total).toBe(2);
    });

    it('filters by type', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/payment-accounts?type=BANK')
        .set(authHeader(token))
        .expect(200);

      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0].type).toBe('BANK');
    });

    it('isolates by tenant', async () => {
      const { tenant: t2, user: u2 } = await createTenantWithUser(prisma);
      await createTestPaymentAccount(prisma, t2.id, u2.id, { name: 'Other Tenant Account' });

      const response = await request(app.getHttpServer())
        .get('/api/v1/payment-accounts')
        .set(authHeader(token))
        .expect(200);

      expect(response.body.data).toHaveLength(2);
    });
  });

  describe('GET /api/v1/payment-accounts/:id', () => {
    it('returns a single account', async () => {
      const account = await createTestPaymentAccount(prisma, tenantId, userId, {
        name: 'Test Account',
        type: 'CASH',
      });

      const response = await request(app.getHttpServer())
        .get(`/api/v1/payment-accounts/${account.id}`)
        .set(authHeader(token))
        .expect(200);

      expect(response.body.id).toBe(account.id);
      expect(response.body).not.toHaveProperty('_computed');
    });

    it('returns 404 for cross-tenant access', async () => {
      const { tenant: t2, user: u2 } = await createTenantWithUser(prisma);
      const other = await createTestPaymentAccount(prisma, t2.id, u2.id, { name: 'Other' });

      await request(app.getHttpServer())
        .get(`/api/v1/payment-accounts/${other.id}`)
        .set(authHeader(token))
        .expect(404);
    });
  });

  describe('PATCH /api/v1/payment-accounts/:id', () => {
    it('updates account name', async () => {
      const account = await createTestPaymentAccount(prisma, tenantId, userId, {
        name: 'Original Name',
        type: 'CASH',
      });

      const response = await request(app.getHttpServer())
        .patch(`/api/v1/payment-accounts/${account.id}`)
        .set(authHeader(token))
        .send({ name: 'Updated Name' })
        .expect(200);

      expect(response.body.name).toBe('Updated Name');
    });

    it('type is not updatable (stripped by whitelist)', async () => {
      const account = await createTestPaymentAccount(prisma, tenantId, userId, {
        name: 'Cash Account',
        type: 'CASH',
      });

      // type is not in UpdatePaymentAccountDto, whitelist: true rejects it
      await request(app.getHttpServer())
        .patch(`/api/v1/payment-accounts/${account.id}`)
        .set(authHeader(token))
        .send({ type: 'BANK' })
        .expect(400);
    });
  });

  describe('PATCH /api/v1/payment-accounts/:id/status', () => {
    it('updates account status', async () => {
      const account = await createTestPaymentAccount(prisma, tenantId, userId, {
        name: 'Active Account',
        type: 'CASH',
      });

      const response = await request(app.getHttpServer())
        .patch(`/api/v1/payment-accounts/${account.id}/status`)
        .set(authHeader(token))
        .send({ status: 'INACTIVE' })
        .expect(200);

      expect(response.body.status).toBe('INACTIVE');
    });
  });
});
