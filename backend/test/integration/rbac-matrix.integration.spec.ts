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
  createAndPostPurchase,
  createAndPostSale,
  createAndPostSupplierPayment,
  createAndPostCustomerPayment,
} from '../helpers/test-factories';
import { PrismaClient } from '@prisma/client';

/**
 * RBAC Matrix Tests
 *
 * Role capabilities:
 *   OWNER — full access to everything
 *   ADMIN — most things except user management (role/status changes) and tenant settings
 *   STAFF — can create/view standard transactions (purchases, sales, payments, returns)
 *           CANNOT: create suppliers/customers/products/payment-accounts, adjustments,
 *                   user management, reports
 */
describe('RBAC Matrix (Integration)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;

  let tenantId: string;
  let userId: string;

  let ownerToken: string;
  let adminToken: string;
  let staffToken: string;

  let adminUserId: string;
  let staffUserId: string;

  beforeAll(async () => {
    await setupTestDatabase();
    app = await createTestApp({ imports: [AppModule] });
    prisma = getTestPrismaClient();
  });

  beforeEach(async () => {
    await cleanDatabase();

    // OWNER
    const { tenant, user } = await createTenantWithUser(prisma);
    tenantId = tenant.id;
    userId = user.id;
    ownerToken = generateTestJWT({ userId: user.id, tenantId, email: user.email, role: 'OWNER' });

    // ADMIN — same tenant
    const adminUser = await prisma.user.create({
      data: {
        id: uuid(),
        tenantId,
        fullName: 'Admin User',
        email: `admin-${uuid().substring(0, 8)}@test.com`,
        passwordHash: 'irrelevant-for-jwt-tests',
        role: 'ADMIN',
        status: 'ACTIVE',
      },
    });
    adminUserId = adminUser.id;
    adminToken = generateTestJWT({ userId: adminUser.id, tenantId, email: adminUser.email, role: 'ADMIN' });

    // STAFF — same tenant
    const staffUser = await prisma.user.create({
      data: {
        id: uuid(),
        tenantId,
        fullName: 'Staff User',
        email: `staff-${uuid().substring(0, 8)}@test.com`,
        passwordHash: 'irrelevant-for-jwt-tests',
        role: 'STAFF',
        status: 'ACTIVE',
      },
    });
    staffUserId = staffUser.id;
    staffToken = generateTestJWT({ userId: staffUser.id, tenantId, email: staffUser.email, role: 'STAFF' });
  });

  afterAll(async () => {
    await teardownTestDatabase();
    await app.close();
  });

  // ─── POST /suppliers ──────────────────────────────────────────────────────────

  describe('POST /api/v1/suppliers', () => {
    const supplierBody = () => ({ name: `Supplier ${uuid().substring(0, 8)}` });

    it('OWNER → 201', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/suppliers')
        .set(authHeader(ownerToken))
        .send(supplierBody())
        .expect(201);
    });

    it('ADMIN → 201', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/suppliers')
        .set(authHeader(adminToken))
        .send(supplierBody())
        .expect(201);
    });

    it('STAFF → 403', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/suppliers')
        .set(authHeader(staffToken))
        .send(supplierBody())
        .expect(403);
    });
  });

  // ─── POST /customers ──────────────────────────────────────────────────────────

  describe('POST /api/v1/customers', () => {
    const customerBody = () => ({ name: `Customer ${uuid().substring(0, 8)}` });

    it('OWNER → 201', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/customers')
        .set(authHeader(ownerToken))
        .send(customerBody())
        .expect(201);
    });

    it('ADMIN → 201', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/customers')
        .set(authHeader(adminToken))
        .send(customerBody())
        .expect(201);
    });

    it('STAFF → 403', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/customers')
        .set(authHeader(staffToken))
        .send(customerBody())
        .expect(403);
    });
  });

  // ─── POST /products ───────────────────────────────────────────────────────────

  describe('POST /api/v1/products', () => {
    const productBody = () => ({ name: `Product ${uuid().substring(0, 8)}` });

    it('OWNER → 201', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/products')
        .set(authHeader(ownerToken))
        .send(productBody())
        .expect(201);
    });

    it('ADMIN → 201', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/products')
        .set(authHeader(adminToken))
        .send(productBody())
        .expect(201);
    });

    it('STAFF → 403', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/products')
        .set(authHeader(staffToken))
        .send(productBody())
        .expect(403);
    });
  });

  // ─── POST /payment-accounts ───────────────────────────────────────────────────

  describe('POST /api/v1/payment-accounts', () => {
    const accountBody = () => ({ name: `Account ${uuid().substring(0, 8)}`, type: 'CASH' });

    it('OWNER → 201', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/payment-accounts')
        .set(authHeader(ownerToken))
        .send(accountBody())
        .expect(201);
    });

    it('ADMIN → 201', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/payment-accounts')
        .set(authHeader(adminToken))
        .send(accountBody())
        .expect(201);
    });

    it('STAFF → 403', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/payment-accounts')
        .set(authHeader(staffToken))
        .send(accountBody())
        .expect(403);
    });
  });

  // ─── POST /transactions/purchases/draft ───────────────────────────────────────

  describe('POST /api/v1/transactions/purchases/draft', () => {
    it('OWNER → 201', async () => {
      const supplier = await createTestSupplier(prisma, tenantId, userId);
      const product = await createTestProduct(prisma, tenantId, userId);

      await request(app.getHttpServer())
        .post('/api/v1/transactions/purchases/draft')
        .set(authHeader(ownerToken))
        .send({
          supplierId: supplier.id,
          transactionDate: new Date().toISOString().split('T')[0],
          lines: [{ variantId: product.variants[0].id, quantity: 1, unitCost: 100 }],
        })
        .expect(201);
    });

    it('ADMIN → 201', async () => {
      const supplier = await createTestSupplier(prisma, tenantId, userId);
      const product = await createTestProduct(prisma, tenantId, userId);

      await request(app.getHttpServer())
        .post('/api/v1/transactions/purchases/draft')
        .set(authHeader(adminToken))
        .send({
          supplierId: supplier.id,
          transactionDate: new Date().toISOString().split('T')[0],
          lines: [{ variantId: product.variants[0].id, quantity: 1, unitCost: 100 }],
        })
        .expect(201);
    });

    it('STAFF → 201 (staff can create purchase drafts)', async () => {
      const supplier = await createTestSupplier(prisma, tenantId, userId);
      const product = await createTestProduct(prisma, tenantId, userId);

      await request(app.getHttpServer())
        .post('/api/v1/transactions/purchases/draft')
        .set(authHeader(staffToken))
        .send({
          supplierId: supplier.id,
          transactionDate: new Date().toISOString().split('T')[0],
          lines: [{ variantId: product.variants[0].id, quantity: 1, unitCost: 100 }],
        })
        .expect(201);
    });
  });

  // ─── POST /transactions/adjustments/draft ─────────────────────────────────────

  describe('POST /api/v1/transactions/adjustments/draft', () => {
    it('OWNER → 201', async () => {
      const product = await createTestProduct(prisma, tenantId, userId);

      await request(app.getHttpServer())
        .post('/api/v1/transactions/adjustments/draft')
        .set(authHeader(ownerToken))
        .send({
          transactionDate: new Date().toISOString().split('T')[0],
          lines: [{ variantId: product.variants[0].id, quantity: 1, direction: 'IN', reason: 'test' }],
        })
        .expect(201);
    });

    it('ADMIN → 201', async () => {
      const product = await createTestProduct(prisma, tenantId, userId);

      await request(app.getHttpServer())
        .post('/api/v1/transactions/adjustments/draft')
        .set(authHeader(adminToken))
        .send({
          transactionDate: new Date().toISOString().split('T')[0],
          lines: [{ variantId: product.variants[0].id, quantity: 1, direction: 'IN', reason: 'test' }],
        })
        .expect(201);
    });

    it('STAFF → 403', async () => {
      const product = await createTestProduct(prisma, tenantId, userId);

      await request(app.getHttpServer())
        .post('/api/v1/transactions/adjustments/draft')
        .set(authHeader(staffToken))
        .send({
          transactionDate: new Date().toISOString().split('T')[0],
          lines: [{ variantId: product.variants[0].id, quantity: 1, direction: 'IN', reason: 'test' }],
        })
        .expect(403);
    });
  });

  // ─── GET /users ───────────────────────────────────────────────────────────────

  describe('GET /api/v1/users', () => {
    it('OWNER → 200', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/users')
        .set(authHeader(ownerToken))
        .expect(200);
    });

    it('ADMIN → 200', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/users')
        .set(authHeader(adminToken))
        .expect(200);
    });

    it('STAFF → 403', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/users')
        .set(authHeader(staffToken))
        .expect(403);
    });
  });

  // ─── PATCH /users/:id/role ─────────────────────────────────────────────────────

  describe('PATCH /api/v1/users/:id/role', () => {
    it('OWNER → 200 (can change another user role)', async () => {
      await request(app.getHttpServer())
        .patch(`/api/v1/users/${staffUserId}/role`)
        .set(authHeader(ownerToken))
        .send({ role: 'ADMIN' })
        .expect(200);
    });

    it('ADMIN → 403', async () => {
      await request(app.getHttpServer())
        .patch(`/api/v1/users/${staffUserId}/role`)
        .set(authHeader(adminToken))
        .send({ role: 'ADMIN' })
        .expect(403);
    });

    it('STAFF → 403', async () => {
      await request(app.getHttpServer())
        .patch(`/api/v1/users/${adminUserId}/role`)
        .set(authHeader(staffToken))
        .send({ role: 'STAFF' })
        .expect(403);
    });
  });

  // ─── PATCH /users/:id/status ───────────────────────────────────────────────────

  describe('PATCH /api/v1/users/:id/status', () => {
    it('OWNER → 200 (can deactivate a user)', async () => {
      await request(app.getHttpServer())
        .patch(`/api/v1/users/${staffUserId}/status`)
        .set(authHeader(ownerToken))
        .send({ status: 'INACTIVE' })
        .expect(200);
    });

    it('ADMIN → 403', async () => {
      await request(app.getHttpServer())
        .patch(`/api/v1/users/${staffUserId}/status`)
        .set(authHeader(adminToken))
        .send({ status: 'INACTIVE' })
        .expect(403);
    });

    it('STAFF → 403', async () => {
      await request(app.getHttpServer())
        .patch(`/api/v1/users/${adminUserId}/status`)
        .set(authHeader(staffToken))
        .send({ status: 'INACTIVE' })
        .expect(403);
    });
  });

  // ─── PATCH /auth/tenant ────────────────────────────────────────────────────────

  describe('PATCH /api/v1/auth/tenant', () => {
    it('OWNER → 200 (can update tenant settings)', async () => {
      await request(app.getHttpServer())
        .patch('/api/v1/auth/tenant')
        .set(authHeader(ownerToken))
        .send({ name: 'Updated Tenant Name' })
        .expect(200);
    });

    it('ADMIN → 403', async () => {
      await request(app.getHttpServer())
        .patch('/api/v1/auth/tenant')
        .set(authHeader(adminToken))
        .send({ name: 'Updated Tenant Name' })
        .expect(403);
    });

    it('STAFF → 403', async () => {
      await request(app.getHttpServer())
        .patch('/api/v1/auth/tenant')
        .set(authHeader(staffToken))
        .send({ name: 'Updated Tenant Name' })
        .expect(403);
    });
  });

  // ─── GET /reports/profit-loss ─────────────────────────────────────────────────

  describe('GET /api/v1/reports/profit-loss', () => {
    const query = '?dateFrom=2026-01-01&dateTo=2026-01-31';

    it('OWNER → 200', async () => {
      await request(app.getHttpServer())
        .get(`/api/v1/reports/profit-loss${query}`)
        .set(authHeader(ownerToken))
        .expect(200);
    });

    it('ADMIN → 200', async () => {
      await request(app.getHttpServer())
        .get(`/api/v1/reports/profit-loss${query}`)
        .set(authHeader(adminToken))
        .expect(200);
    });

    it('STAFF → 403', async () => {
      await request(app.getHttpServer())
        .get(`/api/v1/reports/profit-loss${query}`)
        .set(authHeader(staffToken))
        .expect(403);
    });
  });

  // ─── GET /reports/trial-balance ───────────────────────────────────────────────

  describe('GET /api/v1/reports/trial-balance', () => {
    it('OWNER → 200', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/reports/trial-balance')
        .set(authHeader(ownerToken))
        .expect(200);
    });

    it('ADMIN → 200', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/reports/trial-balance')
        .set(authHeader(adminToken))
        .expect(200);
    });

    it('STAFF → 403', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/reports/trial-balance')
        .set(authHeader(staffToken))
        .expect(403);
    });
  });
});
