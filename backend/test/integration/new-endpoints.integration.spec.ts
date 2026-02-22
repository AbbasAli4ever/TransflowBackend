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
  createAndPostSupplierReturn,
} from '../helpers/test-factories';
import { PrismaClient } from '@prisma/client';

describe('New Endpoints (Integration)', () => {
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

  // ─── GET /api/v1/products/:id/movements ──────────────────────────────────────

  describe('GET /api/v1/products/:id/movements', () => {
    it('1. product with no movements → empty data, total 0', async () => {
      const product = await createTestProduct(prisma, tenantId, userId);

      const res = await request(app.getHttpServer())
        .get(`/api/v1/products/${product.id}/movements`)
        .set(authHeader(token))
        .expect(200);

      expect(res.body.data).toHaveLength(0);
      expect(res.body.meta.total).toBe(0);
    });

    it('2. after purchase: PURCHASE_IN row, quantityIn=qty, quantityOut=0, runningStock=qty', async () => {
      const supplier = await createTestSupplier(prisma, tenantId, userId);
      const product = await createTestProduct(prisma, tenantId, userId);

      await createAndPostPurchase(app, token, {
        supplierId: supplier.id,
        lines: [{ variantId: product.variants[0].id, quantity: 10, unitCost: 1000 }],
      });

      const res = await request(app.getHttpServer())
        .get(`/api/v1/products/${product.id}/movements`)
        .set(authHeader(token))
        .expect(200);

      expect(res.body.data).toHaveLength(1);
      expect(res.body.meta.total).toBe(1);

      const row = res.body.data[0];
      expect(row.type).toBe('PURCHASE');
      expect(row.quantityIn).toBe(10);
      expect(row.quantityOut).toBe(0);
      expect(row.runningStock).toBe(10);
    });

    it('3. after purchase then sale: two rows, running stock decrements correctly', async () => {
      const supplier = await createTestSupplier(prisma, tenantId, userId);
      const customer = await createTestCustomer(prisma, tenantId, userId);
      const product = await createTestProduct(prisma, tenantId, userId);

      await createAndPostPurchase(app, token, {
        supplierId: supplier.id,
        lines: [{ variantId: product.variants[0].id, quantity: 20, unitCost: 500 }],
      });

      await createAndPostSale(app, token, {
        customerId: customer.id,
        lines: [{ variantId: product.variants[0].id, quantity: 8, unitPrice: 800 }],
      });

      const res = await request(app.getHttpServer())
        .get(`/api/v1/products/${product.id}/movements`)
        .set(authHeader(token))
        .expect(200);

      expect(res.body.data).toHaveLength(2);
      expect(res.body.meta.total).toBe(2);

      const [purchaseRow, saleRow] = res.body.data;
      // Purchase: IN
      expect(purchaseRow.quantityIn).toBe(20);
      expect(purchaseRow.quantityOut).toBe(0);
      expect(purchaseRow.runningStock).toBe(20);
      // Sale: OUT
      expect(saleRow.quantityIn).toBe(0);
      expect(saleRow.quantityOut).toBe(8);
      expect(saleRow.runningStock).toBe(12);
    });

    it('4. pagination: 5 movements, page 1 limit 2 → meta.total=5, data has 2 rows', async () => {
      const supplier = await createTestSupplier(prisma, tenantId, userId);
      const product = await createTestProduct(prisma, tenantId, userId);

      // Create 5 purchases for 5 movement rows
      for (let i = 0; i < 5; i++) {
        await createAndPostPurchase(app, token, {
          supplierId: supplier.id,
          lines: [{ variantId: product.variants[0].id, quantity: 1, unitCost: 100 }],
          idempotencyKey: uuid(),
        });
      }

      const res = await request(app.getHttpServer())
        .get(`/api/v1/products/${product.id}/movements?page=1&limit=2`)
        .set(authHeader(token))
        .expect(200);

      expect(res.body.meta.total).toBe(5);
      expect(res.body.meta.totalPages).toBe(3);
      expect(res.body.data).toHaveLength(2);
    });

    it('5. page 2 running stock is computed correctly from offset', async () => {
      const supplier = await createTestSupplier(prisma, tenantId, userId);
      const product = await createTestProduct(prisma, tenantId, userId);

      // 3 purchases of 10 each
      for (let i = 0; i < 3; i++) {
        await createAndPostPurchase(app, token, {
          supplierId: supplier.id,
          lines: [{ variantId: product.variants[0].id, quantity: 10, unitCost: 100 }],
          idempotencyKey: uuid(),
        });
      }

      const res = await request(app.getHttpServer())
        .get(`/api/v1/products/${product.id}/movements?page=2&limit=2`)
        .set(authHeader(token))
        .expect(200);

      // page 1 covers movements 1 and 2: stock after page 1 = 20
      // page 2 starts at movement 3: runningStock should be 30 after that row
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].runningStock).toBe(30);
    });

    it('6. unknown product → 404', async () => {
      await request(app.getHttpServer())
        .get(`/api/v1/products/${uuid()}/movements`)
        .set(authHeader(token))
        .expect(404);
    });

    it("7. another tenant's product → 404", async () => {
      const { tenant: t2, user: u2 } = await createTenantWithUser(prisma);
      const otherProduct = await createTestProduct(prisma, t2.id, u2.id);

      await request(app.getHttpServer())
        .get(`/api/v1/products/${otherProduct.id}/movements`)
        .set(authHeader(token))
        .expect(404);
    });

    it('8. 401 without auth', async () => {
      const product = await createTestProduct(prisma, tenantId, userId);

      await request(app.getHttpServer())
        .get(`/api/v1/products/${product.id}/movements`)
        .expect(401);
    });
  });

  // ─── GET /api/v1/transactions/:id/returnable-lines ──────────────────────────

  describe('GET /api/v1/transactions/:id/returnable-lines', () => {
    it('1. POSTED PURCHASE, no returns yet → alreadyReturned=0, returnableQty=originalQty', async () => {
      const supplier = await createTestSupplier(prisma, tenantId, userId);
      const product = await createTestProduct(prisma, tenantId, userId);

      const purchase = await createAndPostPurchase(app, token, {
        supplierId: supplier.id,
        lines: [{ variantId: product.variants[0].id, quantity: 15, unitCost: 1000 }],
      });

      const res = await request(app.getHttpServer())
        .get(`/api/v1/transactions/${purchase.id}/returnable-lines`)
        .set(authHeader(token))
        .expect(200);

      expect(res.body.transactionId).toBe(purchase.id);
      expect(res.body.lines).toHaveLength(1);

      const line = res.body.lines[0];
      expect(line.originalQty).toBe(15);
      expect(line.alreadyReturned).toBe(0);
      expect(line.returnableQty).toBe(15);
    });

    it('2. after partial return posted → alreadyReturned=X, returnableQty=originalQty-X', async () => {
      const supplier = await createTestSupplier(prisma, tenantId, userId);
      const product = await createTestProduct(prisma, tenantId, userId);

      const purchase = await createAndPostPurchase(app, token, {
        supplierId: supplier.id,
        lines: [{ variantId: product.variants[0].id, quantity: 10, unitCost: 1000 }],
      });

      const sourceLine = purchase.transactionLines[0];

      // Return 4 units
      await createAndPostSupplierReturn(app, token, {
        supplierId: supplier.id,
        lines: [{ sourceTransactionLineId: sourceLine.id, quantity: 4 }],
      });

      const res = await request(app.getHttpServer())
        .get(`/api/v1/transactions/${purchase.id}/returnable-lines`)
        .set(authHeader(token))
        .expect(200);

      const line = res.body.lines[0];
      expect(line.originalQty).toBe(10);
      expect(line.alreadyReturned).toBe(4);
      expect(line.returnableQty).toBe(6);
    });

    it('3. called on DRAFT transaction → 400', async () => {
      const supplier = await createTestSupplier(prisma, tenantId, userId);
      const product = await createTestProduct(prisma, tenantId, userId);

      const draftRes = await request(app.getHttpServer())
        .post('/api/v1/transactions/purchases/draft')
        .set(authHeader(token))
        .send({
          supplierId: supplier.id,
          transactionDate: '2026-02-10',
          lines: [{ variantId: product.variants[0].id, quantity: 5, unitCost: 1000 }],
        })
        .expect(201);

      await request(app.getHttpServer())
        .get(`/api/v1/transactions/${draftRes.body.id}/returnable-lines`)
        .set(authHeader(token))
        .expect(400);
    });

    it('4. called on non-PURCHASE/SALE type (SUPPLIER_PAYMENT) → 400', async () => {
      const supplier = await createTestSupplier(prisma, tenantId, userId);
      const account = await createTestPaymentAccount(prisma, tenantId, userId);

      const draftRes = await request(app.getHttpServer())
        .post('/api/v1/transactions/supplier-payments/draft')
        .set(authHeader(token))
        .send({
          supplierId: supplier.id,
          amount: 5000,
          paymentAccountId: account.id,
          transactionDate: '2026-02-10',
        })
        .expect(201);

      const postedRes = await request(app.getHttpServer())
        .post(`/api/v1/transactions/${draftRes.body.id}/post`)
        .set(authHeader(token))
        .send({ idempotencyKey: uuid() })
        .expect(200);

      await request(app.getHttpServer())
        .get(`/api/v1/transactions/${postedRes.body.id}/returnable-lines`)
        .set(authHeader(token))
        .expect(400);
    });

    it('5. unknown transaction → 404', async () => {
      await request(app.getHttpServer())
        .get(`/api/v1/transactions/${uuid()}/returnable-lines`)
        .set(authHeader(token))
        .expect(404);
    });

    it('6. 401 without auth', async () => {
      const supplier = await createTestSupplier(prisma, tenantId, userId);
      const product = await createTestProduct(prisma, tenantId, userId);

      const purchase = await createAndPostPurchase(app, token, {
        supplierId: supplier.id,
        lines: [{ variantId: product.variants[0].id, quantity: 5, unitCost: 500 }],
      });

      await request(app.getHttpServer())
        .get(`/api/v1/transactions/${purchase.id}/returnable-lines`)
        .expect(401);
    });
  });

  // ─── GET /api/v1/users ───────────────────────────────────────────────────────

  describe('GET /api/v1/users', () => {
    it('1. returns list with expected fields, no passwordHash', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/users')
        .set(authHeader(token))
        .expect(200);

      expect(res.body.data).toBeInstanceOf(Array);
      expect(res.body.data.length).toBeGreaterThanOrEqual(1);

      const user = res.body.data[0];
      expect(user).toHaveProperty('id');
      expect(user).toHaveProperty('fullName');
      expect(user).toHaveProperty('email');
      expect(user).toHaveProperty('role');
      expect(user).toHaveProperty('status');
      expect(user).not.toHaveProperty('passwordHash');
    });

    it('2. GET /users?status=ALL → includes inactive users', async () => {
      // Create a second user and deactivate them
      const secondUser = await prisma.user.create({
        data: {
          id: uuid(),
          tenantId,
          fullName: 'Inactive User',
          email: `inactive-${uuid().substring(0, 8)}@test.com`,
          passwordHash: 'hash',
          role: 'ADMIN',
          status: 'INACTIVE',
        },
      });

      const resActive = await request(app.getHttpServer())
        .get('/api/v1/users')
        .set(authHeader(token))
        .expect(200);

      const resAll = await request(app.getHttpServer())
        .get('/api/v1/users?status=ALL')
        .set(authHeader(token))
        .expect(200);

      expect(resAll.body.meta.total).toBeGreaterThan(resActive.body.meta.total);
      const ids = resAll.body.data.map((u: any) => u.id);
      expect(ids).toContain(secondUser.id);
    });

    it('3. ADMIN token → 200', async () => {
      const adminUser = await prisma.user.create({
        data: {
          id: uuid(),
          tenantId,
          fullName: 'Admin User',
          email: `admin-${uuid().substring(0, 8)}@test.com`,
          passwordHash: 'hash',
          role: 'ADMIN',
          status: 'ACTIVE',
        },
      });
      const adminToken = generateTestJWT({
        userId: adminUser.id,
        tenantId,
        email: adminUser.email,
        role: adminUser.role,
      });

      await request(app.getHttpServer())
        .get('/api/v1/users')
        .set(authHeader(adminToken))
        .expect(200);
    });

    it('4. STAFF token → 403', async () => {
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
        role: staffUser.role,
      });

      await request(app.getHttpServer())
        .get('/api/v1/users')
        .set(authHeader(staffToken))
        .expect(403);
    });
  });

  // ─── PATCH /api/v1/users/:id/role ───────────────────────────────────────────

  describe('PATCH /api/v1/users/:id/role', () => {
    it('5. OWNER changes another user to ADMIN → 200', async () => {
      const targetUser = await prisma.user.create({
        data: {
          id: uuid(),
          tenantId,
          fullName: 'Target User',
          email: `target-${uuid().substring(0, 8)}@test.com`,
          passwordHash: 'hash',
          role: 'STAFF',
          status: 'ACTIVE',
        },
      });

      const res = await request(app.getHttpServer())
        .patch(`/api/v1/users/${targetUser.id}/role`)
        .set(authHeader(token))
        .send({ role: 'ADMIN' })
        .expect(200);

      expect(res.body.role).toBe('ADMIN');
      expect(res.body).not.toHaveProperty('passwordHash');
    });

    it('6. OWNER tries to change own role → 403', async () => {
      await request(app.getHttpServer())
        .patch(`/api/v1/users/${userId}/role`)
        .set(authHeader(token))
        .send({ role: 'ADMIN' })
        .expect(403);
    });

    it('7. ADMIN token trying to change role → 403', async () => {
      const adminUser = await prisma.user.create({
        data: {
          id: uuid(),
          tenantId,
          fullName: 'Admin Actor',
          email: `adminactor-${uuid().substring(0, 8)}@test.com`,
          passwordHash: 'hash',
          role: 'ADMIN',
          status: 'ACTIVE',
        },
      });
      const targetUser = await prisma.user.create({
        data: {
          id: uuid(),
          tenantId,
          fullName: 'Role Target',
          email: `roletarget-${uuid().substring(0, 8)}@test.com`,
          passwordHash: 'hash',
          role: 'STAFF',
          status: 'ACTIVE',
        },
      });
      const adminToken = generateTestJWT({
        userId: adminUser.id,
        tenantId,
        email: adminUser.email,
        role: adminUser.role,
      });

      await request(app.getHttpServer())
        .patch(`/api/v1/users/${targetUser.id}/role`)
        .set(authHeader(adminToken))
        .send({ role: 'ADMIN' })
        .expect(403);
    });
  });

  // ─── PATCH /api/v1/users/:id/status ─────────────────────────────────────────

  describe('PATCH /api/v1/users/:id/status', () => {
    it('8. OWNER deactivates another user (ADMIN) → 200', async () => {
      const adminUser = await prisma.user.create({
        data: {
          id: uuid(),
          tenantId,
          fullName: 'Admin To Deactivate',
          email: `deactivate-${uuid().substring(0, 8)}@test.com`,
          passwordHash: 'hash',
          role: 'ADMIN',
          status: 'ACTIVE',
        },
      });

      const res = await request(app.getHttpServer())
        .patch(`/api/v1/users/${adminUser.id}/status`)
        .set(authHeader(token))
        .send({ status: 'INACTIVE' })
        .expect(200);

      expect(res.body.status).toBe('INACTIVE');
    });

    it('9. OWNER tries to deactivate themselves → 403', async () => {
      await request(app.getHttpServer())
        .patch(`/api/v1/users/${userId}/status`)
        .set(authHeader(token))
        .send({ status: 'INACTIVE' })
        .expect(403);
    });

    it('10. OWNER tries to deactivate the last active OWNER → 400', async () => {
      // The user created in beforeEach is the only OWNER; trying to deactivate
      // them as a different OWNER means we first need another OWNER actor.
      // Instead, create a second OWNER and use it to try to deactivate the first.
      const secondOwner = await prisma.user.create({
        data: {
          id: uuid(),
          tenantId,
          fullName: 'Second Owner',
          email: `owner2-${uuid().substring(0, 8)}@test.com`,
          passwordHash: 'hash',
          role: 'OWNER',
          status: 'ACTIVE',
        },
      });
      const secondOwnerToken = generateTestJWT({
        userId: secondOwner.id,
        tenantId,
        email: secondOwner.email,
        role: secondOwner.role,
      });

      // Deactivate the first owner via second owner (now only one active OWNER left after this)
      await request(app.getHttpServer())
        .patch(`/api/v1/users/${userId}/status`)
        .set(authHeader(secondOwnerToken))
        .send({ status: 'INACTIVE' })
        .expect(200);

      // Now secondOwner is the last active OWNER; try to deactivate userId (already inactive)
      // More importantly: try to deactivate secondOwner via userId (but userId is inactive, so JWT
      // would still be valid). Use secondOwner token to try deactivating itself — that should 403.
      // To test the 400 (last active OWNER), we need a valid OWNER token targeting the last owner:
      // userId is now INACTIVE. Create a third actor that is OWNER and use them to target secondOwner.
      const thirdOwner = await prisma.user.create({
        data: {
          id: uuid(),
          tenantId,
          fullName: 'Third Owner',
          email: `owner3-${uuid().substring(0, 8)}@test.com`,
          passwordHash: 'hash',
          role: 'OWNER',
          status: 'ACTIVE',
        },
      });

      // Now deactivate thirdOwner via secondOwner, leaving secondOwner as last active OWNER
      await request(app.getHttpServer())
        .patch(`/api/v1/users/${thirdOwner.id}/status`)
        .set(authHeader(secondOwnerToken))
        .send({ status: 'INACTIVE' })
        .expect(200);

      // Now secondOwner is the last active OWNER; trying to deactivate them should fail
      const thirdOwnerToken = generateTestJWT({
        userId: thirdOwner.id,
        tenantId,
        email: thirdOwner.email,
        role: thirdOwner.role,
      });

      // thirdOwner is INACTIVE in DB but JWT still claims OWNER role — the guard checks JWT role.
      // The service will still find secondOwner as last active OWNER.
      await request(app.getHttpServer())
        .patch(`/api/v1/users/${secondOwner.id}/status`)
        .set(authHeader(thirdOwnerToken))
        .send({ status: 'INACTIVE' })
        .expect(400);
    });
  });

  // ─── PATCH /api/v1/auth/tenant ───────────────────────────────────────────────

  describe('PATCH /api/v1/auth/tenant', () => {
    it('1. OWNER updates name → 200, name in response', async () => {
      const res = await request(app.getHttpServer())
        .patch('/api/v1/auth/tenant')
        .set(authHeader(token))
        .send({ name: 'Updated Tenant Name' })
        .expect(200);

      expect(res.body.name).toBe('Updated Tenant Name');
      expect(res.body).toHaveProperty('id');
      expect(res.body).toHaveProperty('baseCurrency');
      expect(res.body).toHaveProperty('timezone');
    });

    it('2. OWNER updates timezone → 200, timezone in response', async () => {
      const res = await request(app.getHttpServer())
        .patch('/api/v1/auth/tenant')
        .set(authHeader(token))
        .send({ timezone: 'Asia/Dubai' })
        .expect(200);

      expect(res.body.timezone).toBe('Asia/Dubai');
    });

    it('3. ADMIN token → 403', async () => {
      const adminUser = await prisma.user.create({
        data: {
          id: uuid(),
          tenantId,
          fullName: 'Admin Actor',
          email: `tenantadmin-${uuid().substring(0, 8)}@test.com`,
          passwordHash: 'hash',
          role: 'ADMIN',
          status: 'ACTIVE',
        },
      });
      const adminToken = generateTestJWT({
        userId: adminUser.id,
        tenantId,
        email: adminUser.email,
        role: adminUser.role,
      });

      await request(app.getHttpServer())
        .patch('/api/v1/auth/tenant')
        .set(authHeader(adminToken))
        .send({ name: 'Should Fail' })
        .expect(403);
    });

    it('4. empty body → 400', async () => {
      await request(app.getHttpServer())
        .patch('/api/v1/auth/tenant')
        .set(authHeader(token))
        .send({})
        .expect(400);
    });
  });
});
