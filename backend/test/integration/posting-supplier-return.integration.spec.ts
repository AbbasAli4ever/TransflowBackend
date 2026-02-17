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
  createAndPostPurchase,
  createAndPostSupplierReturn,
} from '../helpers/test-factories';
import { PrismaClient } from '@prisma/client';

describe('Posting — SUPPLIER_RETURN (Integration)', () => {
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

  // ─── DRAFT CREATION ──────────────────────────────────────────────────────────

  describe('Draft creation', () => {
    it('creates a SUPPLIER_RETURN draft (201)', async () => {
      const supplier = await createTestSupplier(prisma, tenantId, userId);
      const product = await createTestProduct(prisma, tenantId, userId);

      const purchase = await createAndPostPurchase(app, token, {
        supplierId: supplier.id,
        lines: [{ variantId: product.variants[0].id, quantity: 10, unitCost: 1000 }],
      });

      const sourceLine = purchase.transactionLines[0];

      const res = await request(app.getHttpServer())
        .post('/api/v1/transactions/supplier-returns/draft')
        .set(authHeader(token))
        .send({
          supplierId: supplier.id,
          transactionDate: new Date().toISOString().split('T')[0],
          lines: [{ sourceTransactionLineId: sourceLine.id, quantity: 3 }],
        })
        .expect(201);

      expect(res.body.type).toBe('SUPPLIER_RETURN');
      expect(res.body.status).toBe('DRAFT');
      expect(res.body.supplierId).toBe(supplier.id);
      expect(res.body.totalAmount).toBe(3000); // 3 * 1000
      expect(res.body.transactionLines).toHaveLength(1);
      expect(res.body.transactionLines[0].sourceTransactionLineId).toBe(sourceLine.id);
    });

    it('returns 404 for unknown supplier', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/transactions/supplier-returns/draft')
        .set(authHeader(token))
        .send({
          supplierId: uuid(),
          transactionDate: new Date().toISOString().split('T')[0],
          lines: [{ sourceTransactionLineId: uuid(), quantity: 1 }],
        })
        .expect(404);
    });

    it('returns 422 for source line not from this supplier', async () => {
      const supplier1 = await createTestSupplier(prisma, tenantId, userId);
      const supplier2 = await createTestSupplier(prisma, tenantId, userId);
      const product = await createTestProduct(prisma, tenantId, userId);

      const purchase = await createAndPostPurchase(app, token, {
        supplierId: supplier2.id,
        lines: [{ variantId: product.variants[0].id, quantity: 5, unitCost: 1000 }],
      });
      const sourceLine = purchase.transactionLines[0];

      await request(app.getHttpServer())
        .post('/api/v1/transactions/supplier-returns/draft')
        .set(authHeader(token))
        .send({
          supplierId: supplier1.id,
          transactionDate: new Date().toISOString().split('T')[0],
          lines: [{ sourceTransactionLineId: sourceLine.id, quantity: 1 }],
        })
        .expect(422);
    });

    it('returns 422 when return quantity exceeds original quantity', async () => {
      const supplier = await createTestSupplier(prisma, tenantId, userId);
      const product = await createTestProduct(prisma, tenantId, userId);

      const purchase = await createAndPostPurchase(app, token, {
        supplierId: supplier.id,
        lines: [{ variantId: product.variants[0].id, quantity: 3, unitCost: 1000 }],
      });
      const sourceLine = purchase.transactionLines[0];

      await request(app.getHttpServer())
        .post('/api/v1/transactions/supplier-returns/draft')
        .set(authHeader(token))
        .send({
          supplierId: supplier.id,
          transactionDate: new Date().toISOString().split('T')[0],
          lines: [{ sourceTransactionLineId: sourceLine.id, quantity: 5 }],
        })
        .expect(422);
    });

    it('rejects future transactionDate (400)', async () => {
      const supplier = await createTestSupplier(prisma, tenantId, userId);
      const future = new Date();
      future.setDate(future.getDate() + 1);

      await request(app.getHttpServer())
        .post('/api/v1/transactions/supplier-returns/draft')
        .set(authHeader(token))
        .send({
          supplierId: supplier.id,
          transactionDate: future.toISOString().split('T')[0],
          lines: [{ sourceTransactionLineId: uuid(), quantity: 1 }],
        })
        .expect(400);
    });

    it('returns 401 without auth', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/transactions/supplier-returns/draft')
        .send({
          supplierId: uuid(),
          transactionDate: new Date().toISOString().split('T')[0],
          lines: [{ sourceTransactionLineId: uuid(), quantity: 1 }],
        })
        .expect(401);
    });
  });

  // ─── POSTING ─────────────────────────────────────────────────────────────────

  describe('Posting', () => {
    it('posts supplier return: SRN doc number, AP_DECREASE ledger, SUPPLIER_RETURN_OUT movement', async () => {
      const supplier = await createTestSupplier(prisma, tenantId, userId);
      const product = await createTestProduct(prisma, tenantId, userId);

      const purchase = await createAndPostPurchase(app, token, {
        supplierId: supplier.id,
        lines: [{ variantId: product.variants[0].id, quantity: 10, unitCost: 500 }],
      });
      const sourceLine = purchase.transactionLines[0];

      const ret = await createAndPostSupplierReturn(app, token, {
        supplierId: supplier.id,
        lines: [{ sourceTransactionLineId: sourceLine.id, quantity: 3 }],
      });

      expect(ret.status).toBe('POSTED');
      expect(ret.documentNumber).toMatch(/^SRN-\d{4}-\d{4}$/);
      expect(ret.totalAmount).toBe(1500); // 3 * 500

      const ledger = await prisma.ledgerEntry.findMany({ where: { transactionId: ret.id } });
      expect(ledger).toHaveLength(1);
      expect(ledger[0].entryType).toBe('AP_DECREASE');
      expect(ledger[0].amount).toBe(1500);
      expect(ledger[0].supplierId).toBe(supplier.id);

      const movements = await prisma.inventoryMovement.findMany({ where: { transactionId: ret.id } });
      expect(movements).toHaveLength(1);
      expect(movements[0].movementType).toBe('SUPPLIER_RETURN_OUT');
      expect(movements[0].quantity).toBe(3);
      expect(movements[0].unitCostAtTime).toBe(500);
    });

    it('generates SRN-YYYY-0001 for first return', async () => {
      const supplier = await createTestSupplier(prisma, tenantId, userId);
      const product = await createTestProduct(prisma, tenantId, userId);

      const purchase = await createAndPostPurchase(app, token, {
        supplierId: supplier.id,
        lines: [{ variantId: product.variants[0].id, quantity: 10, unitCost: 1000 }],
      });
      const sourceLine = purchase.transactionLines[0];

      const ret = await createAndPostSupplierReturn(app, token, {
        supplierId: supplier.id,
        lines: [{ sourceTransactionLineId: sourceLine.id, quantity: 1 }],
      });

      const year = new Date().getFullYear();
      expect(ret.documentNumber).toBe(`SRN-${year}-0001`);
    });

    it('rejects over-return at posting time (422)', async () => {
      const supplier = await createTestSupplier(prisma, tenantId, userId);
      const product = await createTestProduct(prisma, tenantId, userId);

      const purchase = await createAndPostPurchase(app, token, {
        supplierId: supplier.id,
        lines: [{ variantId: product.variants[0].id, quantity: 2, unitCost: 1000 }],
      });
      const sourceLine = purchase.transactionLines[0];

      // First return: return 1
      await createAndPostSupplierReturn(app, token, {
        supplierId: supplier.id,
        lines: [{ sourceTransactionLineId: sourceLine.id, quantity: 1 }],
      });

      // Now try to create another draft for 2 (only 1 left)
      const draftRes = await request(app.getHttpServer())
        .post('/api/v1/transactions/supplier-returns/draft')
        .set(authHeader(token))
        .send({
          supplierId: supplier.id,
          transactionDate: new Date().toISOString().split('T')[0],
          lines: [{ sourceTransactionLineId: sourceLine.id, quantity: 2 }],
        })
        .expect(422);

      expect(draftRes.body.message).toMatch(/returnable/i);
    });

    it('partial return followed by second return works correctly', async () => {
      const supplier = await createTestSupplier(prisma, tenantId, userId);
      const product = await createTestProduct(prisma, tenantId, userId);

      const purchase = await createAndPostPurchase(app, token, {
        supplierId: supplier.id,
        lines: [{ variantId: product.variants[0].id, quantity: 10, unitCost: 1000 }],
      });
      const sourceLine = purchase.transactionLines[0];

      // Return 4 first
      await createAndPostSupplierReturn(app, token, {
        supplierId: supplier.id,
        lines: [{ sourceTransactionLineId: sourceLine.id, quantity: 4 }],
      });

      // Return 6 more — should succeed
      const secondReturn = await createAndPostSupplierReturn(app, token, {
        supplierId: supplier.id,
        lines: [{ sourceTransactionLineId: sourceLine.id, quantity: 6 }],
      });

      expect(secondReturn.status).toBe('POSTED');
      expect(secondReturn.totalAmount).toBe(6000);
    });

    it('idempotency: same key returns same result (200)', async () => {
      const supplier = await createTestSupplier(prisma, tenantId, userId);
      const product = await createTestProduct(prisma, tenantId, userId);

      const purchase = await createAndPostPurchase(app, token, {
        supplierId: supplier.id,
        lines: [{ variantId: product.variants[0].id, quantity: 10, unitCost: 1000 }],
      });
      const sourceLine = purchase.transactionLines[0];

      const draftRes = await request(app.getHttpServer())
        .post('/api/v1/transactions/supplier-returns/draft')
        .set(authHeader(token))
        .send({
          supplierId: supplier.id,
          transactionDate: new Date().toISOString().split('T')[0],
          lines: [{ sourceTransactionLineId: sourceLine.id, quantity: 2 }],
        })
        .expect(201);

      const key = uuid();

      const first = await request(app.getHttpServer())
        .post(`/api/v1/transactions/${draftRes.body.id}/post`)
        .set(authHeader(token))
        .send({ idempotencyKey: key })
        .expect(200);

      const second = await request(app.getHttpServer())
        .post(`/api/v1/transactions/${draftRes.body.id}/post`)
        .set(authHeader(token))
        .send({ idempotencyKey: key })
        .expect(200);

      expect(second.body.id).toBe(first.body.id);
      expect(second.body.documentNumber).toBe(first.body.documentNumber);
    });

    it('tenant isolation: cannot use source line from another tenant (422)', async () => {
      // Second tenant
      const { tenant: tenant2, user: user2 } = await createTenantWithUser(prisma);
      const token2 = generateTestJWT({ userId: user2.id, tenantId: tenant2.id, email: user2.email, role: user2.role });

      const supplier1 = await createTestSupplier(prisma, tenantId, userId);
      const supplier2 = await createTestSupplier(prisma, tenant2.id, user2.id);
      const product1 = await createTestProduct(prisma, tenantId, userId);
      const product2 = await createTestProduct(prisma, tenant2.id, user2.id);

      const purchase1 = await createAndPostPurchase(app, token, {
        supplierId: supplier1.id,
        lines: [{ variantId: product1.variants[0].id, quantity: 5, unitCost: 1000 }],
      });

      // Tenant2 tries to return a line from tenant1's purchase
      await request(app.getHttpServer())
        .post('/api/v1/transactions/supplier-returns/draft')
        .set(authHeader(token2))
        .send({
          supplierId: supplier2.id,
          transactionDate: new Date().toISOString().split('T')[0],
          lines: [{ sourceTransactionLineId: purchase1.transactionLines[0].id, quantity: 1 }],
        })
        .expect(422);
    });
  });
});
