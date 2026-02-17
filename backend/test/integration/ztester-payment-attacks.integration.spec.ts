
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
  createTestCustomer,
  createTestProduct,
  createTestPaymentAccount,
  createAndPostPurchase,
  createAndPostSale,
} from '../helpers/test-factories';
import { PrismaClient } from '@prisma/client';

describe('zTester — Payment Attack Scenarios (Integration)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;

  // Common variables for Tenant A
  let tokenA: string;
  let tenantAId: string;
  let userIdA: string;

  // Common variables for Tenant B
  let tokenB: string;
  let tenantBId: string;
  let userIdB: string;

  beforeAll(async () => {
    await setupTestDatabase();
    app = await createTestApp({ imports: [AppModule] });
    prisma = getTestPrismaClient();
  });

  beforeEach(async () => {
    await cleanDatabase();
    // Setup Tenant A
    const { tenant: tA, user: uA } = await createTenantWithUser(prisma, { userEmail: 'tenant-a@test.com' });
    tenantAId = tA.id;
    userIdA = uA.id;
    tokenA = generateTestJWT({ userId: userIdA, tenantId: tenantAId, email: uA.email, role: uA.role });

    // Setup Tenant B
    const { tenant: tB, user: uB } = await createTenantWithUser(prisma, { userEmail: 'tenant-b@test.com' });
    tenantBId = tB.id;
    userIdB = uB.id;
    tokenB = generateTestJWT({ userId: userIdB, tenantId: tenantBId, email: uB.email, role: uB.role });
  });

  afterAll(async () => {
    await teardownTestDatabase();
    await app.close();
  });

  // ─── zTester - Concurrency ──────────────────────────────────────────────────

  describe('zTester - Concurrency', () => {
    it('should handle concurrent payment allocations to the same invoice idempotently', async () => {
      // 1. Setup: Create a purchase in Tenant A that needs to be paid.
      const supplier = await createTestSupplier(prisma, tenantAId, userIdA);
      const product = await createTestProduct(prisma, tenantAId, userIdA);
      const account = await createTestPaymentAccount(prisma, tenantAId, userIdA);
      const purchase = await createAndPostPurchase(app, tokenA, {
        supplierId: supplier.id,
        lines: [{ variantId: product.variants[0].id, quantity: 50, unitCost: 100 }], // Total 5000
      });

      // 2. Create a payment draft for the exact amount.
      const paymentDraft = await request(app.getHttpServer())
        .post('/api/v1/transactions/supplier-payments/draft')
        .set(authHeader(tokenA))
        .send({
          supplierId: supplier.id,
          amount: 5000,
          paymentAccountId: account.id,
          transactionDate: new Date().toISOString().split('T')[0],
        })
        .expect(201);

      // 3. Fire two identical requests concurrently to post and allocate the payment.
      const idempotencyKey = uuid();
      const postBody = {
        idempotencyKey,
        allocations: [{ transactionId: purchase.id, amount: 5000 }],
      };

      const [res1, res2] = await Promise.all([
        request(app.getHttpServer())
          .post(`/api/v1/transactions/${paymentDraft.body.id}/post`)
          .set(authHeader(tokenA))
          .send(postBody),
        request(app.getHttpServer())
          .post(`/api/v1/transactions/${paymentDraft.body.id}/post`)
          .set(authHeader(tokenA))
          .send(postBody),
      ]);

      // 4. Assertions
      const statuses = [res1.status, res2.status].sort();
      // One must be 200 (OK), the other can be 200 (idempotent return) or 409 (conflict from DB lock).
      // Crucially, no 422, which would imply a race condition where one transaction partially saw the other's work.
      expect(statuses[0]).toBe(200);
      expect([200, 409]).toContain(statuses[1]);

      // There must be EXACTLY ONE allocation record created.
      const allocations = await prisma.allocation.findMany({
        where: { appliesToTransactionId: purchase.id },
      });
      expect(allocations).toHaveLength(1);
      expect(allocations[0].amountApplied).toBe(5000);
    });
  });

  // ─── zTester - Tenant Isolation ───────────────────────────────────────────

  describe('zTester - Tenant Isolation', () => {
    it('should prevent allocating a payment from Tenant B to a purchase in Tenant A', async () => {
      // 1. Setup: Create a purchase in Tenant A.
      const supplierA = await createTestSupplier(prisma, tenantAId, userIdA);
      const productA = await createTestProduct(prisma, tenantAId, userIdA);
      const purchaseA = await createAndPostPurchase(app, tokenA, {
        supplierId: supplierA.id,
        lines: [{ variantId: productA.variants[0].id, quantity: 1, unitCost: 100 }],
      });

      // 2. Setup: Create a payment draft in Tenant B.
      const supplierB = await createTestSupplier(prisma, tenantBId, userIdB);
      const accountB = await createTestPaymentAccount(prisma, tenantBId, userIdB);
      const paymentDraftB = await request(app.getHttpServer())
        .post('/api/v1/transactions/supplier-payments/draft')
        .set(authHeader(tokenB))
        .send({
          supplierId: supplierB.id,
          amount: 100,
          paymentAccountId: accountB.id,
          transactionDate: new Date().toISOString().split('T')[0],
        })
        .expect(201);

      // 3. Attempt to post Tenant B's payment, allocating it to Tenant A's purchase.
      const postBody = {
        idempotencyKey: uuid(),
        allocations: [{ transactionId: purchaseA.id, amount: 100 }], // Cross-tenant ID
      };

      const res = await request(app.getHttpServer())
        .post(`/api/v1/transactions/${paymentDraftB.body.id}/post`)
        .set(authHeader(tokenB))
        .send(postBody);

      // 4. Assertion: The request must be rejected.
      // 422 is the most appropriate code, as the referenced entity is invalid *for this transaction*.
      expect(res.status).toBe(422);
      expect(res.body.message).toContain('not found or not eligible');
    });
  });

    // ─── zTester - Data Integrity ───────────────────────────────────────────────

  describe('zTester - Data Integrity', () => {
    it('should reject allocating to the same invoice twice in one request', async () => {
        const supplier = await createTestSupplier(prisma, tenantAId, userIdA);
        const product = await createTestProduct(prisma, tenantAId, userIdA);
        const account = await createTestPaymentAccount(prisma, tenantAId, userIdA);
        const purchase = await createAndPostPurchase(app, tokenA, {
            supplierId: supplier.id,
            lines: [{ variantId: product.variants[0].id, quantity: 1, unitCost: 5000 }],
        });

        const paymentDraft = await request(app.getHttpServer())
            .post('/api/v1/transactions/supplier-payments/draft')
            .set(authHeader(tokenA))
            .send({
                supplierId: supplier.id,
                amount: 2000,
                paymentAccountId: account.id,
                transactionDate: new Date().toISOString().split('T')[0],
            })
            .expect(201);
        
        const postBody = {
            idempotencyKey: uuid(),
            allocations: [
                { transactionId: purchase.id, amount: 1000 },
                { transactionId: purchase.id, amount: 1000 },
            ],
        };

        await request(app.getHttpServer())
            .post(`/api/v1/transactions/${paymentDraft.body.id}/post`)
            .set(authHeader(tokenA))
            .send(postBody)
            .expect(422);
    });

    it('should reject allocating a supplier payment to a customer sale', async () => {
        const supplier = await createTestSupplier(prisma, tenantAId, userIdA);
        const customer = await createTestCustomer(prisma, tenantAId, userIdA);
        const product = await createTestProduct(prisma, tenantAId, userIdA);
        const account = await createTestPaymentAccount(prisma, tenantAId, userIdA);
        
        // zTester FIX: Add stock for the product before trying to sell it.
        await createAndPostPurchase(app, tokenA, {
            supplierId: supplier.id,
            lines: [{ variantId: product.variants[0].id, quantity: 10, unitCost: 1000 }],
        });

        const sale = await createAndPostSale(app, tokenA, {
            customerId: customer.id,
            lines: [{ variantId: product.variants[0].id, quantity: 1, unitPrice: 5000 }],
        });

        const paymentDraft = await request(app.getHttpServer())
            .post('/api/v1/transactions/supplier-payments/draft')
            .set(authHeader(tokenA))
            .send({
                supplierId: supplier.id,
                amount: 5000,
                paymentAccountId: account.id,
                transactionDate: new Date().toISOString().split('T')[0],
            })
            .expect(201);

        const postBody = {
            idempotencyKey: uuid(),
            allocations: [{ transactionId: sale.id, amount: 5000 }],
        };

        await request(app.getHttpServer())
            .post(`/api/v1/transactions/${paymentDraft.body.id}/post`)
            .set(authHeader(tokenA))
            .send(postBody)
            .expect(422);
    });
  });
});
