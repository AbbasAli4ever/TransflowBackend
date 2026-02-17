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
  createTestPaymentAccount,
  createAndPostPurchase,
} from '../helpers/test-factories';
import { PrismaClient } from '@prisma/client';

describe('Posting — PURCHASE (Integration)', () => {
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

  async function createDraft(supplierId: string, variantId: string, qty: number, unitCost: number) {
    const res = await request(app.getHttpServer())
      .post('/api/v1/transactions/purchases/draft')
      .set(authHeader(token))
      .send({
        supplierId,
        transactionDate: new Date().toISOString().split('T')[0],
        lines: [{ variantId, quantity: qty, unitCost }],
      })
      .expect(201);
    return res.body;
  }

  // ─── FULL FLOW ─────────────────────────────────────────────────────────────

  describe('Full posting flow', () => {
    it('posts a purchase with no payment', async () => {
      const supplier = await createTestSupplier(prisma, tenantId, userId);
      const product = await createTestProduct(prisma, tenantId, userId);
      const draft = await createDraft(supplier.id, product.variants[0].id, 10, 500);

      const res = await request(app.getHttpServer())
        .post(`/api/v1/transactions/${draft.id}/post`)
        .set(authHeader(token))
        .send({ idempotencyKey: uuid() })
        .expect(200);

      expect(res.body.status).toBe('POSTED');
      expect(res.body.documentNumber).toBe('PUR-2026-0001');
      expect(res.body.series).toBe('2026');
      expect(res.body.paidNow).toBe(0);
      expect(res.body.postedAt).toBeDefined();
    });

    it('posts a purchase with full payment', async () => {
      const supplier = await createTestSupplier(prisma, tenantId, userId);
      const product = await createTestProduct(prisma, tenantId, userId);
      const account = await createTestPaymentAccount(prisma, tenantId, userId);
      const draft = await createDraft(supplier.id, product.variants[0].id, 5, 1000);

      const res = await request(app.getHttpServer())
        .post(`/api/v1/transactions/${draft.id}/post`)
        .set(authHeader(token))
        .send({ idempotencyKey: uuid(), paidNow: 5000, paymentAccountId: account.id })
        .expect(200);

      expect(res.body.status).toBe('POSTED');
      expect(res.body.paidNow).toBe(5000);
      expect(res.body.ledgerEntries).toHaveLength(2);
      expect(res.body.paymentEntries).toHaveLength(1);
      expect(res.body.paymentEntries[0].direction).toBe('OUT');
      expect(res.body.paymentEntries[0].amount).toBe(5000);
    });

    it('posts a purchase with partial payment', async () => {
      const supplier = await createTestSupplier(prisma, tenantId, userId);
      const product = await createTestProduct(prisma, tenantId, userId);
      const account = await createTestPaymentAccount(prisma, tenantId, userId);
      const draft = await createDraft(supplier.id, product.variants[0].id, 4, 1000);

      const res = await request(app.getHttpServer())
        .post(`/api/v1/transactions/${draft.id}/post`)
        .set(authHeader(token))
        .send({ idempotencyKey: uuid(), paidNow: 1500, paymentAccountId: account.id })
        .expect(200);

      expect(res.body.paidNow).toBe(1500);
      expect(res.body.ledgerEntries).toHaveLength(2);

      const apIncrease = res.body.ledgerEntries.find((e: any) => e.entryType === 'AP_INCREASE');
      const apDecrease = res.body.ledgerEntries.find((e: any) => e.entryType === 'AP_DECREASE');
      expect(apIncrease.amount).toBe(4000);
      expect(apDecrease.amount).toBe(1500);
    });

    it('creates PURCHASE_IN inventory movements', async () => {
      const supplier = await createTestSupplier(prisma, tenantId, userId);
      const product = await createTestProduct(prisma, tenantId, userId);
      const draft = await createDraft(supplier.id, product.variants[0].id, 7, 300);

      const res = await request(app.getHttpServer())
        .post(`/api/v1/transactions/${draft.id}/post`)
        .set(authHeader(token))
        .send({ idempotencyKey: uuid() })
        .expect(200);

      expect(res.body.inventoryMovements).toHaveLength(1);
      expect(res.body.inventoryMovements[0].movementType).toBe('PURCHASE_IN');
      expect(res.body.inventoryMovements[0].quantity).toBe(7);
      expect(res.body.inventoryMovements[0].unitCostAtTime).toBe(300);
    });

    it('creates allocation when paidNow > 0', async () => {
      const supplier = await createTestSupplier(prisma, tenantId, userId);
      const product = await createTestProduct(prisma, tenantId, userId);
      const account = await createTestPaymentAccount(prisma, tenantId, userId);
      const draft = await createDraft(supplier.id, product.variants[0].id, 2, 1000);

      await request(app.getHttpServer())
        .post(`/api/v1/transactions/${draft.id}/post`)
        .set(authHeader(token))
        .send({ idempotencyKey: uuid(), paidNow: 2000, paymentAccountId: account.id })
        .expect(200);

      const allocations = await prisma.allocation.findMany({ where: { tenantId } });
      expect(allocations).toHaveLength(1);
      expect(allocations[0].paymentTransactionId).toBe(draft.id);
      expect(allocations[0].appliesToTransactionId).toBe(draft.id);
      expect(allocations[0].amountApplied).toBe(2000);
    });
  });

  // ─── AVG COST ──────────────────────────────────────────────────────────────

  describe('Average cost update', () => {
    it('sets avgCost on first purchase', async () => {
      const supplier = await createTestSupplier(prisma, tenantId, userId);
      const product = await createTestProduct(prisma, tenantId, userId);
      const draft = await createDraft(supplier.id, product.variants[0].id, 10, 800);

      await request(app.getHttpServer())
        .post(`/api/v1/transactions/${draft.id}/post`)
        .set(authHeader(token))
        .send({ idempotencyKey: uuid() })
        .expect(200);

      const updated = await prisma.productVariant.findFirst({ where: { productId: product.id } });
      expect(updated!.avgCost).toBe(800);
    });

    it('updates avgCost correctly on second purchase', async () => {
      const supplier = await createTestSupplier(prisma, tenantId, userId);
      const product = await createTestProduct(prisma, tenantId, userId);

      // First purchase: 10 units @ 1000
      await createAndPostPurchase(app, token, {
        supplierId: supplier.id,
        lines: [{ variantId: product.variants[0].id, quantity: 10, unitCost: 1000 }],
      });

      // Second purchase: 10 units @ 2000 → new avg = (10*1000 + 10*2000) / 20 = 1500
      const draft2 = await createDraft(supplier.id, product.variants[0].id, 10, 2000);
      await request(app.getHttpServer())
        .post(`/api/v1/transactions/${draft2.id}/post`)
        .set(authHeader(token))
        .send({ idempotencyKey: uuid() })
        .expect(200);

      const updated = await prisma.productVariant.findFirst({ where: { productId: product.id } });
      expect(updated!.avgCost).toBe(1500);
    });
  });

  // ─── DOCUMENT NUMBERS ──────────────────────────────────────────────────────

  describe('Sequential document numbers', () => {
    it('generates PUR-YYYY-0001 for first purchase', async () => {
      const supplier = await createTestSupplier(prisma, tenantId, userId);
      const product = await createTestProduct(prisma, tenantId, userId);
      const draft = await createDraft(supplier.id, product.variants[0].id, 1, 100);

      const res = await request(app.getHttpServer())
        .post(`/api/v1/transactions/${draft.id}/post`)
        .set(authHeader(token))
        .send({ idempotencyKey: uuid() })
        .expect(200);

      const year = new Date().getFullYear();
      expect(res.body.documentNumber).toBe(`PUR-${year}-0001`);
    });

    it('increments document number for subsequent purchases', async () => {
      const supplier = await createTestSupplier(prisma, tenantId, userId);
      const product = await createTestProduct(prisma, tenantId, userId);
      const year = new Date().getFullYear();

      const posted1 = await createAndPostPurchase(app, token, {
        supplierId: supplier.id,
        lines: [{ variantId: product.variants[0].id, quantity: 1, unitCost: 100 }],
      });
      expect(posted1.documentNumber).toBe(`PUR-${year}-0001`);

      const posted2 = await createAndPostPurchase(app, token, {
        supplierId: supplier.id,
        lines: [{ variantId: product.variants[0].id, quantity: 2, unitCost: 100 }],
      });
      expect(posted2.documentNumber).toBe(`PUR-${year}-0002`);
    });
  });

  // ─── IDEMPOTENCY ───────────────────────────────────────────────────────────

  describe('Idempotency', () => {
    it('returns same result when posted twice with the same idempotency key (200)', async () => {
      const supplier = await createTestSupplier(prisma, tenantId, userId);
      const product = await createTestProduct(prisma, tenantId, userId);
      const draft = await createDraft(supplier.id, product.variants[0].id, 3, 500);
      const key = uuid();

      const res1 = await request(app.getHttpServer())
        .post(`/api/v1/transactions/${draft.id}/post`)
        .set(authHeader(token))
        .send({ idempotencyKey: key })
        .expect(200);

      const res2 = await request(app.getHttpServer())
        .post(`/api/v1/transactions/${draft.id}/post`)
        .set(authHeader(token))
        .send({ idempotencyKey: key })
        .expect(200);

      expect(res2.body.id).toBe(res1.body.id);
      expect(res2.body.documentNumber).toBe(res1.body.documentNumber);

      // Only one inventory movement should exist
      const movements = await prisma.inventoryMovement.findMany({ where: { tenantId } });
      expect(movements).toHaveLength(1);
    });

    it('returns 409 when posted with a different idempotency key', async () => {
      const supplier = await createTestSupplier(prisma, tenantId, userId);
      const product = await createTestProduct(prisma, tenantId, userId);
      const draft = await createDraft(supplier.id, product.variants[0].id, 2, 500);

      await request(app.getHttpServer())
        .post(`/api/v1/transactions/${draft.id}/post`)
        .set(authHeader(token))
        .send({ idempotencyKey: 'key-one' })
        .expect(200);

      await request(app.getHttpServer())
        .post(`/api/v1/transactions/${draft.id}/post`)
        .set(authHeader(token))
        .send({ idempotencyKey: 'key-two' })
        .expect(409);
    });

    it('returns 409 when idempotency key is already used on a different transaction', async () => {
      const supplier = await createTestSupplier(prisma, tenantId, userId);
      const product = await createTestProduct(prisma, tenantId, userId);
      const sharedKey = uuid();

      const draft1 = await createDraft(supplier.id, product.variants[0].id, 1, 100);
      await request(app.getHttpServer())
        .post(`/api/v1/transactions/${draft1.id}/post`)
        .set(authHeader(token))
        .send({ idempotencyKey: sharedKey })
        .expect(200);

      const draft2 = await createDraft(supplier.id, product.variants[0].id, 1, 100);
      await request(app.getHttpServer())
        .post(`/api/v1/transactions/${draft2.id}/post`)
        .set(authHeader(token))
        .send({ idempotencyKey: sharedKey })
        .expect(409);
    });
  });

  // ─── VALIDATION ERRORS ─────────────────────────────────────────────────────

  describe('Posting validation', () => {
    it('returns 404 for unknown transaction', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/transactions/00000000-0000-0000-0000-000000000099/post')
        .set(authHeader(token))
        .send({ idempotencyKey: uuid() })
        .expect(404);
    });

    it('returns 400 when payment amount exceeds total', async () => {
      const supplier = await createTestSupplier(prisma, tenantId, userId);
      const product = await createTestProduct(prisma, tenantId, userId);
      const account = await createTestPaymentAccount(prisma, tenantId, userId);
      const draft = await createDraft(supplier.id, product.variants[0].id, 1, 1000);

      await request(app.getHttpServer())
        .post(`/api/v1/transactions/${draft.id}/post`)
        .set(authHeader(token))
        .send({ idempotencyKey: uuid(), paidNow: 5000, paymentAccountId: account.id })
        .expect(400);
    });

    it('returns 400 when paymentAccountId is missing but paidNow > 0', async () => {
      const supplier = await createTestSupplier(prisma, tenantId, userId);
      const product = await createTestProduct(prisma, tenantId, userId);
      const draft = await createDraft(supplier.id, product.variants[0].id, 1, 1000);

      await request(app.getHttpServer())
        .post(`/api/v1/transactions/${draft.id}/post`)
        .set(authHeader(token))
        .send({ idempotencyKey: uuid(), paidNow: 500 })
        .expect(400);
    });

    it('returns 422 when payment account is inactive', async () => {
      const supplier = await createTestSupplier(prisma, tenantId, userId);
      const product = await createTestProduct(prisma, tenantId, userId);
      const account = await createTestPaymentAccount(prisma, tenantId, userId);
      await prisma.paymentAccount.update({ where: { id: account.id }, data: { status: 'INACTIVE' } });

      const draft = await createDraft(supplier.id, product.variants[0].id, 1, 1000);

      await request(app.getHttpServer())
        .post(`/api/v1/transactions/${draft.id}/post`)
        .set(authHeader(token))
        .send({ idempotencyKey: uuid(), paidNow: 500, paymentAccountId: account.id })
        .expect(422);
    });

    it('returns 400 when idempotencyKey is missing', async () => {
      const supplier = await createTestSupplier(prisma, tenantId, userId);
      const product = await createTestProduct(prisma, tenantId, userId);
      const draft = await createDraft(supplier.id, product.variants[0].id, 1, 100);

      await request(app.getHttpServer())
        .post(`/api/v1/transactions/${draft.id}/post`)
        .set(authHeader(token))
        .send({})
        .expect(400);
    });
  });
});
