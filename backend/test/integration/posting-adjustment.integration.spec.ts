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
  createTestProduct,
} from '../helpers/test-factories';
import { PrismaClient } from '@prisma/client';

describe('Posting — ADJUSTMENT (Integration)', () => {
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

  async function createAndPostAdjustment(
    lines: Array<{ productId: string; quantity: number; direction: 'IN' | 'OUT'; reason: string }>,
    idempotencyKey?: string,
  ) {
    const transactionDate = new Date().toISOString().split('T')[0];

    const draftRes = await request(app.getHttpServer())
      .post('/api/v1/transactions/adjustments/draft')
      .set(authHeader(token))
      .send({ transactionDate, lines })
      .expect(201);

    const postRes = await request(app.getHttpServer())
      .post(`/api/v1/transactions/${draftRes.body.id}/post`)
      .set(authHeader(token))
      .send({ idempotencyKey: idempotencyKey || uuid() })
      .expect(200);

    return postRes.body;
  }

  // ─── DRAFT CREATION ──────────────────────────────────────────────────────────

  describe('Draft creation', () => {
    it('creates an ADJUSTMENT draft (201)', async () => {
      const product = await createTestProduct(prisma, tenantId, userId);

      const res = await request(app.getHttpServer())
        .post('/api/v1/transactions/adjustments/draft')
        .set(authHeader(token))
        .send({
          transactionDate: new Date().toISOString().split('T')[0],
          lines: [{ productId: product.id, quantity: 5, direction: 'IN', reason: 'Stock found' }],
        })
        .expect(201);

      expect(res.body.type).toBe('ADJUSTMENT');
      expect(res.body.status).toBe('DRAFT');
      expect(res.body.totalAmount).toBe(0);
      expect(res.body.transactionLines).toHaveLength(1);
    });

    it('returns 403 for non-OWNER/non-ADMIN role', async () => {
      const { tenant, user } = await createTenantWithUser(prisma);
      // Override role to STAFF
      const staffToken = generateTestJWT({
        userId: user.id,
        tenantId: tenant.id,
        email: user.email,
        role: 'STAFF',
      });
      const product = await createTestProduct(prisma, tenant.id, user.id);

      await request(app.getHttpServer())
        .post('/api/v1/transactions/adjustments/draft')
        .set(authHeader(staffToken))
        .send({
          transactionDate: new Date().toISOString().split('T')[0],
          lines: [{ productId: product.id, quantity: 1, direction: 'IN', reason: 'test' }],
        })
        .expect(403);
    });

    it('returns 404 for unknown product', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/transactions/adjustments/draft')
        .set(authHeader(token))
        .send({
          transactionDate: new Date().toISOString().split('T')[0],
          lines: [{ productId: uuid(), quantity: 1, direction: 'IN', reason: 'test' }],
        })
        .expect(404);
    });

    it('rejects future transactionDate (400)', async () => {
      const product = await createTestProduct(prisma, tenantId, userId);
      const future = new Date();
      future.setDate(future.getDate() + 1);

      await request(app.getHttpServer())
        .post('/api/v1/transactions/adjustments/draft')
        .set(authHeader(token))
        .send({
          transactionDate: future.toISOString().split('T')[0],
          lines: [{ productId: product.id, quantity: 1, direction: 'IN', reason: 'test' }],
        })
        .expect(400);
    });

    it('returns 401 without auth', async () => {
      const product = await createTestProduct(prisma, tenantId, userId);

      await request(app.getHttpServer())
        .post('/api/v1/transactions/adjustments/draft')
        .send({
          transactionDate: new Date().toISOString().split('T')[0],
          lines: [{ productId: product.id, quantity: 1, direction: 'IN', reason: 'test' }],
        })
        .expect(401);
    });

    it('validates direction enum (400 for invalid value)', async () => {
      const product = await createTestProduct(prisma, tenantId, userId);

      await request(app.getHttpServer())
        .post('/api/v1/transactions/adjustments/draft')
        .set(authHeader(token))
        .send({
          transactionDate: new Date().toISOString().split('T')[0],
          lines: [{ productId: product.id, quantity: 1, direction: 'SIDEWAYS', reason: 'test' }],
        })
        .expect(400);
    });
  });

  // ─── POSTING ─────────────────────────────────────────────────────────────────

  describe('Posting', () => {
    it('posts adjustment IN: ADJ doc, ADJUSTMENT_IN movement, no ledger entries', async () => {
      const product = await createTestProduct(prisma, tenantId, userId);

      const adj = await createAndPostAdjustment([
        { productId: product.id, quantity: 10, direction: 'IN', reason: 'Found extra stock' },
      ]);

      expect(adj.status).toBe('POSTED');
      expect(adj.documentNumber).toMatch(/^ADJ-\d{4}-\d{4}$/);

      const movements = await prisma.inventoryMovement.findMany({ where: { transactionId: adj.id } });
      expect(movements).toHaveLength(1);
      expect(movements[0].movementType).toBe('ADJUSTMENT_IN');
      expect(movements[0].quantity).toBe(10);

      const ledger = await prisma.ledgerEntry.findMany({ where: { transactionId: adj.id } });
      expect(ledger).toHaveLength(0);
    });

    it('posts adjustment OUT: ADJUSTMENT_OUT movement, no ledger entries', async () => {
      const product = await createTestProduct(prisma, tenantId, userId);

      const adj = await createAndPostAdjustment([
        { productId: product.id, quantity: 5, direction: 'OUT', reason: 'Damaged goods written off' },
      ]);

      const movements = await prisma.inventoryMovement.findMany({ where: { transactionId: adj.id } });
      expect(movements).toHaveLength(1);
      expect(movements[0].movementType).toBe('ADJUSTMENT_OUT');
      expect(movements[0].quantity).toBe(5);

      const ledger = await prisma.ledgerEntry.findMany({ where: { transactionId: adj.id } });
      expect(ledger).toHaveLength(0);
    });

    it('posts multi-line adjustment: multiple movements', async () => {
      const product1 = await createTestProduct(prisma, tenantId, userId);
      const product2 = await createTestProduct(prisma, tenantId, userId);

      const adj = await createAndPostAdjustment([
        { productId: product1.id, quantity: 3, direction: 'IN', reason: 'Found' },
        { productId: product2.id, quantity: 2, direction: 'OUT', reason: 'Damaged' },
      ]);

      const movements = await prisma.inventoryMovement.findMany({
        where: { transactionId: adj.id },
        orderBy: { movementType: 'asc' },
      });
      expect(movements).toHaveLength(2);

      const inMovement = movements.find((m: any) => m.movementType === 'ADJUSTMENT_IN');
      const outMovement = movements.find((m: any) => m.movementType === 'ADJUSTMENT_OUT');

      expect(inMovement).toBeDefined();
      expect(inMovement!.quantity).toBe(3);
      expect(outMovement).toBeDefined();
      expect(outMovement!.quantity).toBe(2);
    });

    it('generates ADJ-YYYY-0001 for first adjustment', async () => {
      const product = await createTestProduct(prisma, tenantId, userId);

      const adj = await createAndPostAdjustment([
        { productId: product.id, quantity: 1, direction: 'IN', reason: 'test' },
      ]);

      const year = new Date().getFullYear();
      expect(adj.documentNumber).toBe(`ADJ-${year}-0001`);
    });

    it('ADMIN role can also create adjustments (201)', async () => {
      const { tenant, user } = await createTenantWithUser(prisma);
      await prisma.user.update({ where: { id: user.id }, data: { role: 'ADMIN' } });
      const adminToken = generateTestJWT({
        userId: user.id,
        tenantId: tenant.id,
        email: user.email,
        role: 'ADMIN',
      });
      const product = await createTestProduct(prisma, tenant.id, user.id);

      const res = await request(app.getHttpServer())
        .post('/api/v1/transactions/adjustments/draft')
        .set(authHeader(adminToken))
        .send({
          transactionDate: new Date().toISOString().split('T')[0],
          lines: [{ productId: product.id, quantity: 1, direction: 'IN', reason: 'Admin adjustment' }],
        })
        .expect(201);

      expect(res.body.type).toBe('ADJUSTMENT');
    });

    it('idempotency: same key returns same result (200)', async () => {
      const product = await createTestProduct(prisma, tenantId, userId);
      const transactionDate = new Date().toISOString().split('T')[0];

      const draftRes = await request(app.getHttpServer())
        .post('/api/v1/transactions/adjustments/draft')
        .set(authHeader(token))
        .send({
          transactionDate,
          lines: [{ productId: product.id, quantity: 1, direction: 'IN', reason: 'test' }],
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
  });
});
