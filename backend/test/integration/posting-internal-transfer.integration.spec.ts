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
  createTestPaymentAccount,
} from '../helpers/test-factories';
import { PrismaClient } from '@prisma/client';

describe('Posting — INTERNAL_TRANSFER (Integration)', () => {
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

  async function createAndPostTransfer(fromId: string, toId: string, amount: number, idempotencyKey?: string) {
    const transactionDate = new Date().toISOString().split('T')[0];

    const draftRes = await request(app.getHttpServer())
      .post('/api/v1/transactions/internal-transfers/draft')
      .set(authHeader(token))
      .send({ fromPaymentAccountId: fromId, toPaymentAccountId: toId, amount, transactionDate })
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
    it('creates an INTERNAL_TRANSFER draft (201)', async () => {
      const from = await createTestPaymentAccount(prisma, tenantId, userId);
      const to = await createTestPaymentAccount(prisma, tenantId, userId);

      const res = await request(app.getHttpServer())
        .post('/api/v1/transactions/internal-transfers/draft')
        .set(authHeader(token))
        .send({
          fromPaymentAccountId: from.id,
          toPaymentAccountId: to.id,
          amount: 5000,
          transactionDate: new Date().toISOString().split('T')[0],
        })
        .expect(201);

      expect(res.body.type).toBe('INTERNAL_TRANSFER');
      expect(res.body.status).toBe('DRAFT');
      expect(res.body.fromPaymentAccountId).toBe(from.id);
      expect(res.body.toPaymentAccountId).toBe(to.id);
      expect(res.body.totalAmount).toBe(5000);
    });

    it('rejects same-account transfer (400)', async () => {
      const account = await createTestPaymentAccount(prisma, tenantId, userId);

      await request(app.getHttpServer())
        .post('/api/v1/transactions/internal-transfers/draft')
        .set(authHeader(token))
        .send({
          fromPaymentAccountId: account.id,
          toPaymentAccountId: account.id,
          amount: 1000,
          transactionDate: new Date().toISOString().split('T')[0],
        })
        .expect(400);
    });

    it('returns 404 for unknown from account', async () => {
      const to = await createTestPaymentAccount(prisma, tenantId, userId);

      await request(app.getHttpServer())
        .post('/api/v1/transactions/internal-transfers/draft')
        .set(authHeader(token))
        .send({
          fromPaymentAccountId: uuid(),
          toPaymentAccountId: to.id,
          amount: 1000,
          transactionDate: new Date().toISOString().split('T')[0],
        })
        .expect(404);
    });

    it('returns 404 for unknown to account', async () => {
      const from = await createTestPaymentAccount(prisma, tenantId, userId);

      await request(app.getHttpServer())
        .post('/api/v1/transactions/internal-transfers/draft')
        .set(authHeader(token))
        .send({
          fromPaymentAccountId: from.id,
          toPaymentAccountId: uuid(),
          amount: 1000,
          transactionDate: new Date().toISOString().split('T')[0],
        })
        .expect(404);
    });

    it('validates amount must be at least 1 (400)', async () => {
      const from = await createTestPaymentAccount(prisma, tenantId, userId);
      const to = await createTestPaymentAccount(prisma, tenantId, userId);

      await request(app.getHttpServer())
        .post('/api/v1/transactions/internal-transfers/draft')
        .set(authHeader(token))
        .send({
          fromPaymentAccountId: from.id,
          toPaymentAccountId: to.id,
          amount: 0,
          transactionDate: new Date().toISOString().split('T')[0],
        })
        .expect(400);
    });

    it('rejects future transactionDate (400)', async () => {
      const from = await createTestPaymentAccount(prisma, tenantId, userId);
      const to = await createTestPaymentAccount(prisma, tenantId, userId);
      const future = new Date();
      future.setDate(future.getDate() + 1);

      await request(app.getHttpServer())
        .post('/api/v1/transactions/internal-transfers/draft')
        .set(authHeader(token))
        .send({
          fromPaymentAccountId: from.id,
          toPaymentAccountId: to.id,
          amount: 1000,
          transactionDate: future.toISOString().split('T')[0],
        })
        .expect(400);
    });

    it('returns 401 without auth', async () => {
      const from = await createTestPaymentAccount(prisma, tenantId, userId);
      const to = await createTestPaymentAccount(prisma, tenantId, userId);

      await request(app.getHttpServer())
        .post('/api/v1/transactions/internal-transfers/draft')
        .send({
          fromPaymentAccountId: from.id,
          toPaymentAccountId: to.id,
          amount: 1000,
          transactionDate: new Date().toISOString().split('T')[0],
        })
        .expect(401);
    });
  });

  // ─── POSTING ─────────────────────────────────────────────────────────────────

  describe('Posting', () => {
    it('posts internal transfer: TRF doc, two payment entries linked by transferGroupId', async () => {
      const from = await createTestPaymentAccount(prisma, tenantId, userId);
      const to = await createTestPaymentAccount(prisma, tenantId, userId);

      const transfer = await createAndPostTransfer(from.id, to.id, 3000);

      expect(transfer.status).toBe('POSTED');
      expect(transfer.documentNumber).toMatch(/^TRF-\d{4}-\d{4}$/);
      expect(transfer.totalAmount).toBe(3000);

      const payments = await prisma.paymentEntry.findMany({
        where: { transactionId: transfer.id },
        orderBy: { direction: 'asc' },
      });
      expect(payments).toHaveLength(2);

      const outEntry = payments.find((p: any) => p.direction === 'OUT');
      const inEntry = payments.find((p: any) => p.direction === 'IN');

      expect(outEntry).toBeDefined();
      expect(outEntry!.entryType).toBe('MONEY_OUT');
      expect(outEntry!.paymentAccountId).toBe(from.id);
      expect(outEntry!.amount).toBe(3000);

      expect(inEntry).toBeDefined();
      expect(inEntry!.entryType).toBe('MONEY_IN');
      expect(inEntry!.paymentAccountId).toBe(to.id);
      expect(inEntry!.amount).toBe(3000);

      // Both must share the same transferGroupId
      expect(outEntry!.transferGroupId).toBeTruthy();
      expect(outEntry!.transferGroupId).toBe(inEntry!.transferGroupId);
    });

    it('produces no ledger entries (no AP/AR impact)', async () => {
      const from = await createTestPaymentAccount(prisma, tenantId, userId);
      const to = await createTestPaymentAccount(prisma, tenantId, userId);

      const transfer = await createAndPostTransfer(from.id, to.id, 5000);

      const ledger = await prisma.ledgerEntry.findMany({ where: { transactionId: transfer.id } });
      expect(ledger).toHaveLength(0);
    });

    it('produces no inventory movements', async () => {
      const from = await createTestPaymentAccount(prisma, tenantId, userId);
      const to = await createTestPaymentAccount(prisma, tenantId, userId);

      const transfer = await createAndPostTransfer(from.id, to.id, 5000);

      const movements = await prisma.inventoryMovement.findMany({ where: { transactionId: transfer.id } });
      expect(movements).toHaveLength(0);
    });

    it('generates TRF-YYYY-0001 for first transfer', async () => {
      const from = await createTestPaymentAccount(prisma, tenantId, userId);
      const to = await createTestPaymentAccount(prisma, tenantId, userId);

      const transfer = await createAndPostTransfer(from.id, to.id, 1000);

      const year = new Date().getFullYear();
      expect(transfer.documentNumber).toBe(`TRF-${year}-0001`);
    });

    it('increments to TRF-YYYY-0002 for second transfer', async () => {
      const from = await createTestPaymentAccount(prisma, tenantId, userId);
      const to = await createTestPaymentAccount(prisma, tenantId, userId);

      await createAndPostTransfer(from.id, to.id, 1000);
      const second = await createAndPostTransfer(from.id, to.id, 2000);

      const year = new Date().getFullYear();
      expect(second.documentNumber).toBe(`TRF-${year}-0002`);
    });

    it('idempotency: same key returns same result (200)', async () => {
      const from = await createTestPaymentAccount(prisma, tenantId, userId);
      const to = await createTestPaymentAccount(prisma, tenantId, userId);
      const transactionDate = new Date().toISOString().split('T')[0];

      const draftRes = await request(app.getHttpServer())
        .post('/api/v1/transactions/internal-transfers/draft')
        .set(authHeader(token))
        .send({ fromPaymentAccountId: from.id, toPaymentAccountId: to.id, amount: 1000, transactionDate })
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
