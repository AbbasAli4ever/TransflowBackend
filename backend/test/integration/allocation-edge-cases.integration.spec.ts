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

describe('Allocation Edge Cases (Integration)', () => {
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

  // ─── TEST 1: Manual allocation within outstanding → balance decreases correctly ─

  it('manual allocation within outstanding amount succeeds and balance decreases correctly', async () => {
    const supplier = await createTestSupplier(prisma, tenantId, userId);
    const product = await createTestProduct(prisma, tenantId, userId);
    const account = await createTestPaymentAccount(prisma, tenantId, userId);

    const purchase = await createAndPostPurchase(app, token, {
      supplierId: supplier.id,
      lines: [{ variantId: product.variants[0].id, quantity: 10, unitCost: 1000 }],
    });

    // Purchase total = 10000. Pay 6000 manually allocated to the purchase.
    await createAndPostSupplierPayment(app, token, {
      supplierId: supplier.id,
      amount: 6000,
      paymentAccountId: account.id,
      allocations: [{ transactionId: purchase.id, amount: 6000 }],
    });

    const balanceRes = await request(app.getHttpServer())
      .get(`/api/v1/reports/suppliers/${supplier.id}/balance`)
      .set(authHeader(token))
      .expect(200);

    expect(balanceRes.body.currentBalance).toBe(4000);

    const openDocsRes = await request(app.getHttpServer())
      .get(`/api/v1/suppliers/${supplier.id}/open-documents`)
      .set(authHeader(token))
      .expect(200);

    expect(openDocsRes.body.documents).toHaveLength(1);
    expect(openDocsRes.body.documents[0].outstanding).toBe(4000);
    expect(openDocsRes.body.documents[0].paidAmount).toBe(6000);
  });

  // ─── TEST 2: Manual allocation exceeding outstanding → 400 or 422 ─────────────

  it('manual allocation exceeding invoice outstanding is rejected with 400 or 422', async () => {
    const supplier = await createTestSupplier(prisma, tenantId, userId);
    const product = await createTestProduct(prisma, tenantId, userId);
    const account = await createTestPaymentAccount(prisma, tenantId, userId);

    const purchase = await createAndPostPurchase(app, token, {
      supplierId: supplier.id,
      lines: [{ variantId: product.variants[0].id, quantity: 5, unitCost: 1000 }],
    });
    // Purchase total = 5000. Attempt to allocate 6000.

    const draftRes = await request(app.getHttpServer())
      .post('/api/v1/transactions/supplier-payments/draft')
      .set(authHeader(token))
      .send({
        supplierId: supplier.id,
        amount: 6000,
        paymentAccountId: account.id,
        transactionDate: new Date().toISOString().split('T')[0],
      })
      .expect(201);

    const res = await request(app.getHttpServer())
      .post(`/api/v1/transactions/${draftRes.body.id}/post`)
      .set(authHeader(token))
      .send({
        idempotencyKey: uuid(),
        allocations: [{ transactionId: purchase.id, amount: 6000 }],
      });

    expect([400, 422]).toContain(res.status);
  });

  // ─── TEST 3: Manual allocation to fully settled invoice → 400 or 422 ─────────

  it('manual allocation to fully settled invoice is rejected with 400 or 422', async () => {
    const supplier = await createTestSupplier(prisma, tenantId, userId);
    const product = await createTestProduct(prisma, tenantId, userId);
    const account = await createTestPaymentAccount(prisma, tenantId, userId);

    const purchase = await createAndPostPurchase(app, token, {
      supplierId: supplier.id,
      lines: [{ variantId: product.variants[0].id, quantity: 3, unitCost: 1000 }],
    });
    // Purchase total = 3000. Fully pay it.
    await createAndPostSupplierPayment(app, token, {
      supplierId: supplier.id,
      amount: 3000,
      paymentAccountId: account.id,
      allocations: [{ transactionId: purchase.id, amount: 3000 }],
    });

    // Now try to allocate again to the same fully-settled purchase.
    const draftRes = await request(app.getHttpServer())
      .post('/api/v1/transactions/supplier-payments/draft')
      .set(authHeader(token))
      .send({
        supplierId: supplier.id,
        amount: 1000,
        paymentAccountId: account.id,
        transactionDate: new Date().toISOString().split('T')[0],
      })
      .expect(201);

    const res = await request(app.getHttpServer())
      .post(`/api/v1/transactions/${draftRes.body.id}/post`)
      .set(authHeader(token))
      .send({
        idempotencyKey: uuid(),
        allocations: [{ transactionId: purchase.id, amount: 1000 }],
      });

    expect([400, 422]).toContain(res.status);
  });

  // ─── TEST 4: Zero amount in allocations array → 400 ──────────────────────────

  it('zero amount in allocations array is rejected with 400', async () => {
    const supplier = await createTestSupplier(prisma, tenantId, userId);
    const product = await createTestProduct(prisma, tenantId, userId);
    const account = await createTestPaymentAccount(prisma, tenantId, userId);

    const purchase = await createAndPostPurchase(app, token, {
      supplierId: supplier.id,
      lines: [{ variantId: product.variants[0].id, quantity: 5, unitCost: 1000 }],
    });

    const draftRes = await request(app.getHttpServer())
      .post('/api/v1/transactions/supplier-payments/draft')
      .set(authHeader(token))
      .send({
        supplierId: supplier.id,
        amount: 5000,
        paymentAccountId: account.id,
        transactionDate: new Date().toISOString().split('T')[0],
      })
      .expect(201);

    const res = await request(app.getHttpServer())
      .post(`/api/v1/transactions/${draftRes.body.id}/post`)
      .set(authHeader(token))
      .send({
        idempotencyKey: uuid(),
        allocations: [{ transactionId: purchase.id, amount: 0 }],
      });

    expect(res.status).toBe(400);
  });

  // ─── TEST 5: Auto-allocate FIFO — older invoice settled first ─────────────────

  it('auto-allocate FIFO: payment of 6000 settles older 5000 invoice fully, newer 3000 partially', async () => {
    const supplier = await createTestSupplier(prisma, tenantId, userId);
    const product = await createTestProduct(prisma, tenantId, userId);
    const account = await createTestPaymentAccount(prisma, tenantId, userId);

    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const olderDate = yesterday.toISOString().split('T')[0];
    const todayDate = new Date().toISOString().split('T')[0];

    const olderPurchase = await createAndPostPurchase(app, token, {
      supplierId: supplier.id,
      transactionDate: olderDate,
      lines: [{ variantId: product.variants[0].id, quantity: 5, unitCost: 1000 }],
    });

    const newerPurchase = await createAndPostPurchase(app, token, {
      supplierId: supplier.id,
      transactionDate: todayDate,
      lines: [{ variantId: product.variants[0].id, quantity: 3, unitCost: 1000 }],
    });

    // Pay 6000 with no manual allocations — FIFO should apply.
    await createAndPostSupplierPayment(app, token, {
      supplierId: supplier.id,
      amount: 6000,
      paymentAccountId: account.id,
      // No allocations array → auto-allocate FIFO
    });

    const openDocsRes = await request(app.getHttpServer())
      .get(`/api/v1/suppliers/${supplier.id}/open-documents`)
      .set(authHeader(token))
      .expect(200);

    // Older (5000) should be fully settled → no longer in open docs.
    const olderDoc = openDocsRes.body.documents.find((d: any) => d.id === olderPurchase.id);
    expect(olderDoc).toBeUndefined();

    // Newer (3000) should have 1000 remaining (3000 - 1000 overflow from 6000-5000).
    const newerDoc = openDocsRes.body.documents.find((d: any) => d.id === newerPurchase.id);
    expect(newerDoc).toBeDefined();
    expect(newerDoc.outstanding).toBe(2000); // 3000 - 1000
  });

  // ─── TEST 6: Partial then full payment — invoice exits open documents ─────────

  it('invoice disappears from open documents after second payment fully settles it', async () => {
    const supplier = await createTestSupplier(prisma, tenantId, userId);
    const product = await createTestProduct(prisma, tenantId, userId);
    const account = await createTestPaymentAccount(prisma, tenantId, userId);

    const purchase = await createAndPostPurchase(app, token, {
      supplierId: supplier.id,
      lines: [{ variantId: product.variants[0].id, quantity: 4, unitCost: 1000 }],
    });
    // Total = 4000. First pay 2000.
    await createAndPostSupplierPayment(app, token, {
      supplierId: supplier.id,
      amount: 2000,
      paymentAccountId: account.id,
      allocations: [{ transactionId: purchase.id, amount: 2000 }],
    });

    const midRes = await request(app.getHttpServer())
      .get(`/api/v1/suppliers/${supplier.id}/open-documents`)
      .set(authHeader(token))
      .expect(200);

    expect(midRes.body.documents).toHaveLength(1);
    expect(midRes.body.documents[0].outstanding).toBe(2000);

    // Now pay remaining 2000.
    await createAndPostSupplierPayment(app, token, {
      supplierId: supplier.id,
      amount: 2000,
      paymentAccountId: account.id,
      allocations: [{ transactionId: purchase.id, amount: 2000 }],
    });

    const finalRes = await request(app.getHttpServer())
      .get(`/api/v1/suppliers/${supplier.id}/open-documents`)
      .set(authHeader(token))
      .expect(200);

    expect(finalRes.body.documents).toHaveLength(0);
    expect(finalRes.body.totalOutstanding).toBe(0);
  });

  // ─── TEST 7: Multiple invoices allocated correctly in one payment ─────────────

  it('one payment with allocations to multiple invoices allocates each correctly', async () => {
    const supplier = await createTestSupplier(prisma, tenantId, userId);
    const product = await createTestProduct(prisma, tenantId, userId);
    const account = await createTestPaymentAccount(prisma, tenantId, userId);

    const purchase1 = await createAndPostPurchase(app, token, {
      supplierId: supplier.id,
      lines: [{ variantId: product.variants[0].id, quantity: 2, unitCost: 1000 }],
    });

    const purchase2 = await createAndPostPurchase(app, token, {
      supplierId: supplier.id,
      lines: [{ variantId: product.variants[0].id, quantity: 3, unitCost: 1000 }],
    });

    // Pay 4000 split: 2000 to invoice1 (fully), 2000 to invoice2 (partially).
    await createAndPostSupplierPayment(app, token, {
      supplierId: supplier.id,
      amount: 4000,
      paymentAccountId: account.id,
      allocations: [
        { transactionId: purchase1.id, amount: 2000 },
        { transactionId: purchase2.id, amount: 2000 },
      ],
    });

    const openDocsRes = await request(app.getHttpServer())
      .get(`/api/v1/suppliers/${supplier.id}/open-documents`)
      .set(authHeader(token))
      .expect(200);

    // Invoice1 fully settled — not in open docs.
    const doc1 = openDocsRes.body.documents.find((d: any) => d.id === purchase1.id);
    expect(doc1).toBeUndefined();

    // Invoice2 partially settled — 1000 remaining.
    const doc2 = openDocsRes.body.documents.find((d: any) => d.id === purchase2.id);
    expect(doc2).toBeDefined();
    expect(doc2.outstanding).toBe(1000);
  });

  // ─── TEST 8: Allocations summing exactly to payment total succeeds ────────────

  it('allocations array summing exactly to payment total is accepted with 200', async () => {
    const supplier = await createTestSupplier(prisma, tenantId, userId);
    const product = await createTestProduct(prisma, tenantId, userId);
    const account = await createTestPaymentAccount(prisma, tenantId, userId);

    const purchase1 = await createAndPostPurchase(app, token, {
      supplierId: supplier.id,
      lines: [{ variantId: product.variants[0].id, quantity: 3, unitCost: 1000 }],
    });

    const purchase2 = await createAndPostPurchase(app, token, {
      supplierId: supplier.id,
      lines: [{ variantId: product.variants[0].id, quantity: 2, unitCost: 1000 }],
    });

    const draftRes = await request(app.getHttpServer())
      .post('/api/v1/transactions/supplier-payments/draft')
      .set(authHeader(token))
      .send({
        supplierId: supplier.id,
        amount: 5000,
        paymentAccountId: account.id,
        transactionDate: new Date().toISOString().split('T')[0],
      })
      .expect(201);

    const postRes = await request(app.getHttpServer())
      .post(`/api/v1/transactions/${draftRes.body.id}/post`)
      .set(authHeader(token))
      .send({
        idempotencyKey: uuid(),
        allocations: [
          { transactionId: purchase1.id, amount: 3000 },
          { transactionId: purchase2.id, amount: 2000 },
        ],
      });

    expect(postRes.status).toBe(200);
    expect(postRes.body.status).toBe('POSTED');
  });

  // ─── TEST 9: Tenant isolation — cannot allocate to other tenant's invoice ─────

  it('cannot allocate payment to an invoice belonging to another tenant', async () => {
    // Set up tenant B
    const { tenant: tB, user: uB } = await createTenantWithUser(prisma);
    const tokenB = generateTestJWT({ userId: uB.id, tenantId: tB.id, email: uB.email, role: uB.role });

    const supplierB = await createTestSupplier(prisma, tB.id, uB.id);
    const productB = await createTestProduct(prisma, tB.id, uB.id);

    const purchaseB = await createAndPostPurchase(app, tokenB, {
      supplierId: supplierB.id,
      lines: [{ variantId: productB.variants[0].id, quantity: 5, unitCost: 1000 }],
    });

    // Set up tenant A fixtures
    const supplierA = await createTestSupplier(prisma, tenantId, userId);
    const accountA = await createTestPaymentAccount(prisma, tenantId, userId);

    const draftRes = await request(app.getHttpServer())
      .post('/api/v1/transactions/supplier-payments/draft')
      .set(authHeader(token))
      .send({
        supplierId: supplierA.id,
        amount: 5000,
        paymentAccountId: accountA.id,
        transactionDate: new Date().toISOString().split('T')[0],
      })
      .expect(201);

    // Tenant A tries to allocate to Tenant B's purchase.
    const res = await request(app.getHttpServer())
      .post(`/api/v1/transactions/${draftRes.body.id}/post`)
      .set(authHeader(token))
      .send({
        idempotencyKey: uuid(),
        allocations: [{ transactionId: purchaseB.id, amount: 5000 }],
      });

    expect([400, 404, 422]).toContain(res.status);
  });

  // ─── TEST 10: Customer payment allocation works the same way ─────────────────

  it('customer payment allocation reduces receivable balance correctly', async () => {
    const supplier = await createTestSupplier(prisma, tenantId, userId);
    const customer = await createTestCustomer(prisma, tenantId, userId);
    const product = await createTestProduct(prisma, tenantId, userId);
    const account = await createTestPaymentAccount(prisma, tenantId, userId);

    // Stock up
    await createAndPostPurchase(app, token, {
      supplierId: supplier.id,
      lines: [{ variantId: product.variants[0].id, quantity: 20, unitCost: 500 }],
    });

    const sale = await createAndPostSale(app, token, {
      customerId: customer.id,
      lines: [{ variantId: product.variants[0].id, quantity: 5, unitPrice: 2000 }],
    });
    // Sale total = 10000.

    await createAndPostCustomerPayment(app, token, {
      customerId: customer.id,
      amount: 7000,
      paymentAccountId: account.id,
      allocations: [{ transactionId: sale.id, amount: 7000 }],
    });

    const openDocsRes = await request(app.getHttpServer())
      .get(`/api/v1/customers/${customer.id}/open-documents`)
      .set(authHeader(token))
      .expect(200);

    expect(openDocsRes.body.documents).toHaveLength(1);
    expect(openDocsRes.body.documents[0].outstanding).toBe(3000);
    expect(openDocsRes.body.documents[0].paidAmount).toBe(7000);
  });
});
