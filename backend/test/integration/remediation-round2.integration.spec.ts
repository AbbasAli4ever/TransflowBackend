/**
 * Remediation Round 2 — Integration Tests
 * Covers: A1, A2, A3, A4, A5, A6, B1, B2, B3, B4, B5, C1, C2
 */
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
  createAndPostSupplierReturn,
  createAndPostCustomerReturn,
  createAndPostCustomerPayment,
  createAndPostSupplierPayment,
} from '../helpers/test-factories';
import { PrismaClient } from '@prisma/client';

describe('Remediation Round 2 (Integration)', () => {
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

  // ─── A1: Return Valuation with Discounts ─────────────────────────────────────

  describe('A1: Return Valuation — effective unit cost/price from lineTotal', () => {
    it('supplier return uses effective cost (lineTotal/qty) when purchase had discount', async () => {
      const supplier = await createTestSupplier(prisma, tenantId, userId);
      const product = await createTestProduct(prisma, tenantId, userId);

      // 10 units × 1000 = 10000, discount 1000 → lineTotal 9000
      const purchase = await createAndPostPurchase(app, token, {
        supplierId: supplier.id,
        lines: [{ productId: product.id, quantity: 10, unitCost: 1000, discountAmount: 1000 }],
      });

      const sourceLine = purchase.transactionLines[0];

      const res = await request(app.getHttpServer())
        .post('/api/v1/transactions/supplier-returns/draft')
        .set(authHeader(token))
        .send({
          supplierId: supplier.id,
          transactionDate: new Date().toISOString().split('T')[0],
          lines: [{ sourceTransactionLineId: sourceLine.id, quantity: 5 }],
        })
        .expect(201);

      // effectiveUnitCost = floor(9000 / 10) = 900; return 5 → 4500
      expect(res.body.totalAmount).toBe(4500);
      expect(res.body.transactionLines[0].lineTotal).toBe(4500);
    });

    it('supplier return uses unitCost directly when no discount (lineTotal == qty × unitCost)', async () => {
      const supplier = await createTestSupplier(prisma, tenantId, userId);
      const product = await createTestProduct(prisma, tenantId, userId);

      const purchase = await createAndPostPurchase(app, token, {
        supplierId: supplier.id,
        lines: [{ productId: product.id, quantity: 10, unitCost: 500 }],
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

      // effectiveUnitCost = floor(5000 / 10) = 500; return 3 → 1500
      expect(res.body.totalAmount).toBe(1500);
    });

    it('customer return uses effective price (lineTotal/qty) when sale had discount', async () => {
      const supplier = await createTestSupplier(prisma, tenantId, userId);
      const customer = await createTestCustomer(prisma, tenantId, userId);
      const product = await createTestProduct(prisma, tenantId, userId);

      await createAndPostPurchase(app, token, {
        supplierId: supplier.id,
        lines: [{ productId: product.id, quantity: 20, unitCost: 400 }],
      });

      // 10 units × 1000 = 10000, discount 1000 → lineTotal 9000
      const sale = await createAndPostSale(app, token, {
        customerId: customer.id,
        lines: [{ productId: product.id, quantity: 10, unitPrice: 1000, discountAmount: 1000 }],
      });

      const sourceLine = sale.transactionLines[0];

      const res = await request(app.getHttpServer())
        .post('/api/v1/transactions/customer-returns/draft')
        .set(authHeader(token))
        .send({
          customerId: customer.id,
          transactionDate: new Date().toISOString().split('T')[0],
          lines: [{ sourceTransactionLineId: sourceLine.id, quantity: 5 }],
        })
        .expect(201);

      // effectiveUnitPrice = floor(9000 / 10) = 900; return 5 → 4500
      expect(res.body.totalAmount).toBe(4500);
      expect(res.body.transactionLines[0].lineTotal).toBe(4500);
    });
  });

  // ─── A2: Customer Balance Split ───────────────────────────────────────────────

  describe('A2: Customer Balance — totalPayments + totalReturns split', () => {
    it('splits AR decreases into totalPayments and totalReturns', async () => {
      const supplier = await createTestSupplier(prisma, tenantId, userId);
      const customer = await createTestCustomer(prisma, tenantId, userId);
      const product = await createTestProduct(prisma, tenantId, userId);
      const account = await createTestPaymentAccount(prisma, tenantId, userId);

      await createAndPostPurchase(app, token, {
        supplierId: supplier.id,
        lines: [{ productId: product.id, quantity: 20, unitCost: 200 }],
      });

      const sale = await createAndPostSale(app, token, {
        customerId: customer.id,
        lines: [{ productId: product.id, quantity: 10, unitPrice: 500 }],
      });

      // Payment: 2000
      await createAndPostCustomerPayment(app, token, {
        customerId: customer.id,
        amount: 2000,
        paymentAccountId: account.id,
      });

      // Return: 3 units × 500 = 1500
      const saleLineId = sale.transactionLines[0].id;
      await createAndPostCustomerReturn(app, token, {
        customerId: customer.id,
        lines: [{ sourceTransactionLineId: saleLineId, quantity: 3 }],
        paymentAccountId: account.id,
      });

      const res = await request(app.getHttpServer())
        .get(`/api/v1/customers/${customer.id}/balance`)
        .set(authHeader(token))
        .expect(200);

      expect(res.body.totalSales).toBe(5000);
      expect(res.body.totalPayments).toBe(2000);
      expect(res.body.totalReturns).toBe(1500);
      expect(res.body.currentBalance).toBe(1500); // 5000 - 2000 - 1500
    });

    it('returns no totalReceived field (renamed)', async () => {
      const customer = await createTestCustomer(prisma, tenantId, userId);

      const res = await request(app.getHttpServer())
        .get(`/api/v1/customers/${customer.id}/balance`)
        .set(authHeader(token))
        .expect(200);

      expect(res.body.totalReceived).toBeUndefined();
      expect(res.body.totalPayments).toBeDefined();
      expect(res.body.totalReturns).toBeDefined();
    });
  });

  // ─── A3: Open-Doc Unapplied Credits ──────────────────────────────────────────

  describe('A3: Open Documents — unappliedCredits and netOutstanding', () => {
    it('customer open docs includes unappliedCredits from CUSTOMER_RETURN', async () => {
      const supplier = await createTestSupplier(prisma, tenantId, userId);
      const customer = await createTestCustomer(prisma, tenantId, userId);
      const product = await createTestProduct(prisma, tenantId, userId);
      const account = await createTestPaymentAccount(prisma, tenantId, userId);

      await createAndPostPurchase(app, token, {
        supplierId: supplier.id,
        lines: [{ productId: product.id, quantity: 10, unitCost: 200 }],
      });

      const sale = await createAndPostSale(app, token, {
        customerId: customer.id,
        lines: [{ productId: product.id, quantity: 5, unitPrice: 400 }], // total 2000
      });

      // Partial payment: 500
      await createAndPostCustomerPayment(app, token, {
        customerId: customer.id,
        amount: 500,
        paymentAccountId: account.id,
      });

      // Return 1 unit: 400
      const saleLineId = sale.transactionLines[0].id;
      await createAndPostCustomerReturn(app, token, {
        customerId: customer.id,
        lines: [{ sourceTransactionLineId: saleLineId, quantity: 1 }],
        paymentAccountId: account.id,
      });

      const res = await request(app.getHttpServer())
        .get(`/api/v1/customers/${customer.id}/open-documents`)
        .set(authHeader(token))
        .expect(200);

      expect(res.body.unappliedCredits).toBe(400);
      expect(res.body.totalOutstanding).toBe(1500); // 2000 - 500 allocated
      expect(res.body.netOutstanding).toBe(1100); // 1500 - 400
    });

    it('supplier open docs includes unappliedCredits from SUPPLIER_RETURN', async () => {
      const supplier = await createTestSupplier(prisma, tenantId, userId);
      const product = await createTestProduct(prisma, tenantId, userId);
      const account = await createTestPaymentAccount(prisma, tenantId, userId);

      const purchase = await createAndPostPurchase(app, token, {
        supplierId: supplier.id,
        lines: [{ productId: product.id, quantity: 10, unitCost: 300 }], // total 3000
      });

      // Partial payment: 1000
      await createAndPostSupplierPayment(app, token, {
        supplierId: supplier.id,
        amount: 1000,
        paymentAccountId: account.id,
      });

      // Return 2 units: 600
      const purchaseLineId = purchase.transactionLines[0].id;
      await createAndPostSupplierReturn(app, token, {
        supplierId: supplier.id,
        lines: [{ sourceTransactionLineId: purchaseLineId, quantity: 2 }],
      });

      const res = await request(app.getHttpServer())
        .get(`/api/v1/suppliers/${supplier.id}/open-documents`)
        .set(authHeader(token))
        .expect(200);

      expect(res.body.unappliedCredits).toBe(600);
      expect(res.body.totalOutstanding).toBe(2000); // 3000 - 1000 allocated
      expect(res.body.netOutstanding).toBe(1400); // 2000 - 600
    });
  });

  // ─── A4: Dashboard Document-Level Overdue ─────────────────────────────────────

  describe('A4: Dashboard — document-level overdueAmount', () => {
    it('counts only overdue document outstanding, not full customer balance', async () => {
      const supplier = await createTestSupplier(prisma, tenantId, userId);
      const customer = await createTestCustomer(prisma, tenantId, userId);
      const product = await createTestProduct(prisma, tenantId, userId);

      // Stock up
      await createAndPostPurchase(app, token, {
        supplierId: supplier.id,
        lines: [{ productId: product.id, quantity: 50, unitCost: 100 }],
      });

      // Overdue invoice: 40 days ago → outstanding 500
      const overdueDate = new Date();
      overdueDate.setDate(overdueDate.getDate() - 40);
      const overdueDateStr = overdueDate.toISOString().split('T')[0];

      await createAndPostSale(app, token, {
        customerId: customer.id,
        transactionDate: overdueDateStr,
        lines: [{ productId: product.id, quantity: 1, unitPrice: 500 }],
      });

      // Current invoice: today → outstanding 1000
      await createAndPostSale(app, token, {
        customerId: customer.id,
        lines: [{ productId: product.id, quantity: 2, unitPrice: 500 }],
      });

      const today = new Date().toISOString().split('T')[0];
      const res = await request(app.getHttpServer())
        .get(`/api/v1/dashboard/summary?asOfDate=${today}`)
        .set(authHeader(token))
        .expect(200);

      // totalAmount = 1500, but only the 40-day-old invoice's 500 is overdue
      expect(res.body.receivables.totalAmount).toBe(1500);
      expect(res.body.receivables.overdueAmount).toBe(500);
      expect(res.body.receivables.overdueCount).toBe(1);
    });
  });

  // ─── A5: POSTED Filter in Payment Account Reports ─────────────────────────────

  describe('A5: Reports — POSTED filter in payment account balance/statement', () => {
    it('payment account balance excludes entries from non-POSTED transactions', async () => {
      const account = await createTestPaymentAccount(prisma, tenantId, userId);

      // Inject an orphan payment_entry with no transaction (simulate draft/non-posted)
      const draftTxn = await prisma.transaction.create({
        data: {
          tenantId,
          type: 'CUSTOMER_PAYMENT',
          status: 'DRAFT',
          transactionDate: new Date(),
          totalAmount: 999,
          subtotal: 999,
          createdBy: userId,
        },
      });

      await prisma.paymentEntry.create({
        data: {
          tenantId,
          transactionId: draftTxn.id,
          paymentAccountId: account.id,
          entryType: 'MONEY_IN',
          direction: 'IN',
          amount: 999,
          transactionDate: new Date(),
        },
      });

      const today = new Date().toISOString().split('T')[0];
      const res = await request(app.getHttpServer())
        .get(`/api/v1/reports/payment-accounts/${account.id}/balance?asOfDate=${today}`)
        .set(authHeader(token))
        .expect(200);

      expect(res.body.balance).toBe(0); // opening balance 0, draft entry excluded
      expect(res.body.breakdown.moneyIn.totalAmount).toBe(0);
    });

    it('payment account statement excludes entries from non-POSTED transactions', async () => {
      const account = await createTestPaymentAccount(prisma, tenantId, userId);

      const draftTxn = await prisma.transaction.create({
        data: {
          tenantId,
          type: 'CUSTOMER_PAYMENT',
          status: 'DRAFT',
          transactionDate: new Date(),
          totalAmount: 500,
          subtotal: 500,
          createdBy: userId,
        },
      });

      await prisma.paymentEntry.create({
        data: {
          tenantId,
          transactionId: draftTxn.id,
          paymentAccountId: account.id,
          entryType: 'MONEY_IN',
          direction: 'IN',
          amount: 500,
          transactionDate: new Date(),
        },
      });

      const today = new Date().toISOString().split('T')[0];
      const res = await request(app.getHttpServer())
        .get(`/api/v1/reports/payment-accounts/${account.id}/statement?dateFrom=${today}&dateTo=${today}`)
        .set(authHeader(token))
        .expect(200);

      expect(res.body.entries).toHaveLength(0);
      expect(res.body.closingBalance).toBe(0);
    });
  });

  // ─── A6: Import Opening Balance Safety ───────────────────────────────────────

  describe('A6: Import — opening balance safety', () => {
    it('blocks overwrite when account has existing transaction history', async () => {
      const account = await createTestPaymentAccount(prisma, tenantId, userId);
      const supplier = await createTestSupplier(prisma, tenantId, userId);
      const product = await createTestProduct(prisma, tenantId, userId);

      // Create a payment entry (history) for this account by posting a purchase+payment
      await createAndPostPurchase(app, token, {
        supplierId: supplier.id,
        lines: [{ productId: product.id, quantity: 1, unitCost: 100 }],
      });

      await createAndPostSupplierPayment(app, token, {
        supplierId: supplier.id,
        amount: 100,
        paymentAccountId: account.id,
      });

      // Upload CSV with opening balance for this account
      const csvContent = `accountName,amount\n${account.name},5000`;
      const uploadRes = await request(app.getHttpServer())
        .post('/api/v1/imports')
        .set(authHeader(token))
        .attach('file', Buffer.from(csvContent), { filename: 'ob.csv', contentType: 'text/csv' })
        .field('module', 'OPENING_BALANCES')
        .expect(201);

      const batchId = uploadRes.body.id;

      // Map columns
      await request(app.getHttpServer())
        .post(`/api/v1/imports/${batchId}/map`)
        .set(authHeader(token))
        .send({ columnMappings: { accountName: 'accountName', amount: 'amount' } })
        .expect(200);

      // Commit — should succeed but with FAILED row
      const commitRes = await request(app.getHttpServer())
        .post(`/api/v1/imports/${batchId}/commit`)
        .set(authHeader(token))
        .send({})
        .expect(200);

      expect(commitRes.body.failedRows).toBeGreaterThan(0);
    });

    it('allows overwrite when account has no transaction history', async () => {
      const account = await createTestPaymentAccount(prisma, tenantId, userId);

      const csvContent = `accountName,amount\n${account.name},5000`;
      const uploadRes = await request(app.getHttpServer())
        .post('/api/v1/imports')
        .set(authHeader(token))
        .attach('file', Buffer.from(csvContent), { filename: 'ob.csv', contentType: 'text/csv' })
        .field('module', 'OPENING_BALANCES')
        .expect(201);

      const batchId = uploadRes.body.id;

      await request(app.getHttpServer())
        .post(`/api/v1/imports/${batchId}/map`)
        .set(authHeader(token))
        .send({ columnMappings: { accountName: 'accountName', amount: 'amount' } })
        .expect(200);

      const commitRes = await request(app.getHttpServer())
        .post(`/api/v1/imports/${batchId}/commit`)
        .set(authHeader(token))
        .send({})
        .expect(200);

      expect(commitRes.body.successRows).toBe(1);
      expect(commitRes.body.failedRows).toBe(0);

      const updatedAccount = await prisma.paymentAccount.findUnique({ where: { id: account.id } });
      expect(updatedAccount?.openingBalance).toBe(5000);
    });

    it('matches account name case-insensitively', async () => {
      // Create account with uppercase name
      const account = await prisma.paymentAccount.create({
        data: { tenantId, name: 'CASH ACCOUNT', type: 'CASH', openingBalance: 0, createdBy: userId },
      });

      // Import with lowercase name
      const csvContent = `accountName,amount\ncash account,3000`;
      const uploadRes = await request(app.getHttpServer())
        .post('/api/v1/imports')
        .set(authHeader(token))
        .attach('file', Buffer.from(csvContent), { filename: 'ob.csv', contentType: 'text/csv' })
        .field('module', 'OPENING_BALANCES')
        .expect(201);

      const batchId = uploadRes.body.id;

      await request(app.getHttpServer())
        .post(`/api/v1/imports/${batchId}/map`)
        .set(authHeader(token))
        .send({ columnMappings: { accountName: 'accountName', amount: 'amount' } })
        .expect(200);

      const commitRes = await request(app.getHttpServer())
        .post(`/api/v1/imports/${batchId}/commit`)
        .set(authHeader(token))
        .send({})
        .expect(200);

      expect(commitRes.body.successRows).toBe(1);

      const updated = await prisma.paymentAccount.findUnique({ where: { id: account.id } });
      expect(updated?.openingBalance).toBe(3000);
    });
  });

  // ─── B1: IsCalendarDate Validator ─────────────────────────────────────────────

  describe('B1: IsCalendarDate — rejects impossible dates', () => {
    it('rejects 2026-02-31 (invalid day)', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/dashboard/summary?asOfDate=2026-02-31')
        .set(authHeader(token))
        .expect(400);
    });

    it('rejects 2026-13-01 (invalid month)', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/dashboard/summary?asOfDate=2026-13-01')
        .set(authHeader(token))
        .expect(400);
    });

    it('rejects 2025-02-29 (non-leap year)', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/dashboard/summary?asOfDate=2025-02-29')
        .set(authHeader(token))
        .expect(400);
    });

    it('accepts 2026-02-28 (valid date)', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/dashboard/summary?asOfDate=2026-02-28')
        .set(authHeader(token))
        .expect(200);
    });

    it('rejects 2024-02-31 via balance endpoint', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/reports/suppliers/00000000-0000-0000-0000-000000000001/balance?asOfDate=2024-02-31')
        .set(authHeader(token))
        .expect(400);
    });

    it('rejects 2026-00-15 via statement endpoint', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/reports/suppliers/00000000-0000-0000-0000-000000000001/statement?dateFrom=2026-00-15&dateTo=2026-02-28')
        .set(authHeader(token))
        .expect(400);
    });
  });

  // ─── B2: Date Range Validation in Transactions List ──────────────────────────

  describe('B2: Transaction list — dateTo must not be before dateFrom', () => {
    it('rejects dateFrom=2026-02-15&dateTo=2026-02-01', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/transactions?dateFrom=2026-02-15&dateTo=2026-02-01')
        .set(authHeader(token))
        .expect(400);
    });

    it('accepts valid range', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/transactions?dateFrom=2026-02-01&dateTo=2026-02-15')
        .set(authHeader(token))
        .expect(200);
    });

    it('accepts only dateFrom without dateTo', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/transactions?dateFrom=2026-02-01')
        .set(authHeader(token))
        .expect(200);
    });

    it('accepts same dateFrom and dateTo', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/transactions?dateFrom=2026-02-01&dateTo=2026-02-01')
        .set(authHeader(token))
        .expect(200);
    });
  });

  // ─── B3: Safe @Transform ──────────────────────────────────────────────────────

  describe('B3: Safe @Transform — non-string inputs do not crash (no 500)', () => {
    it('POST /auth/register with numeric tenantName does not return 500', async () => {
      // enableImplicitConversion coerces 42 → "42" — request succeeds or fails validation, never 500
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({ tenantName: 42, fullName: 'Test', email: `t${uuid()}@test.com`, password: 'Pass123A' });
      expect(res.status).not.toBe(500);
    });

    it('POST /customers with numeric name does not return 500', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/customers')
        .set(authHeader(token))
        .send({ name: 12345 });
      expect(res.status).not.toBe(500);
    });

    it('POST /suppliers with numeric name does not return 500', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/suppliers')
        .set(authHeader(token))
        .send({ name: 12345 });
      expect(res.status).not.toBe(500);
    });
  });

  // ─── B4: Pagination Upper Bounds ──────────────────────────────────────────────

  describe('B4: Pagination — limit capped at 100', () => {
    it('GET /transactions/allocations?limit=1000 returns 400', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/transactions/allocations?limit=1000')
        .set(authHeader(token))
        .expect(400);
    });

    it('GET /imports?limit=500 returns 400', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/imports?limit=500')
        .set(authHeader(token))
        .expect(400);
    });

    it('GET /imports/:id?limit=101 returns 400', async () => {
      const batchId = uuid();
      await request(app.getHttpServer())
        .get(`/api/v1/imports/${batchId}?limit=101`)
        .set(authHeader(token))
        .expect(400);
    });

    it('GET /imports/:id?limit=-1 returns 400', async () => {
      const batchId = uuid();
      await request(app.getHttpServer())
        .get(`/api/v1/imports/${batchId}?limit=-1`)
        .set(authHeader(token))
        .expect(400);
    });
  });

  // ─── B5: Reject Empty PATCH Payloads ─────────────────────────────────────────

  describe('B5: Empty PATCH payload returns 400', () => {
    it('PATCH /customers/:id with {} returns 400', async () => {
      const customer = await createTestCustomer(prisma, tenantId, userId);

      await request(app.getHttpServer())
        .patch(`/api/v1/customers/${customer.id}`)
        .set(authHeader(token))
        .send({})
        .expect(400);
    });

    it('PATCH /customers/:id with a field returns 200', async () => {
      const customer = await createTestCustomer(prisma, tenantId, userId);

      await request(app.getHttpServer())
        .patch(`/api/v1/customers/${customer.id}`)
        .set(authHeader(token))
        .send({ name: 'Updated Name' })
        .expect(200);
    });

    it('PATCH /suppliers/:id with {} returns 400', async () => {
      const supplier = await createTestSupplier(prisma, tenantId, userId);

      await request(app.getHttpServer())
        .patch(`/api/v1/suppliers/${supplier.id}`)
        .set(authHeader(token))
        .send({})
        .expect(400);
    });

    it('PATCH /products/:id with {} returns 400', async () => {
      const product = await createTestProduct(prisma, tenantId, userId);

      await request(app.getHttpServer())
        .patch(`/api/v1/products/${product.id}`)
        .set(authHeader(token))
        .send({})
        .expect(400);
    });

    it('PATCH /payment-accounts/:id with {} returns 400', async () => {
      const account = await createTestPaymentAccount(prisma, tenantId, userId);

      await request(app.getHttpServer())
        .patch(`/api/v1/payment-accounts/${account.id}`)
        .set(authHeader(token))
        .send({})
        .expect(400);
    });
  });

  // ─── C1: JwtStrategy DB Validation ───────────────────────────────────────────

  describe('C1: JwtStrategy — rejects tokens for deactivated users/tenants', () => {
    it('returns 401 when user is INACTIVE', async () => {
      const customer = await createTestCustomer(prisma, tenantId, userId);

      // Deactivate user directly
      await prisma.user.update({ where: { id: userId }, data: { status: 'INACTIVE' } });

      await request(app.getHttpServer())
        .get(`/api/v1/customers/${customer.id}`)
        .set(authHeader(token))
        .expect(401);
    });

    it('returns 401 when tenant is INACTIVE', async () => {
      const customer = await createTestCustomer(prisma, tenantId, userId);

      await prisma.tenant.update({ where: { id: tenantId }, data: { status: 'INACTIVE' } });

      await request(app.getHttpServer())
        .get(`/api/v1/customers/${customer.id}`)
        .set(authHeader(token))
        .expect(401);
    });
  });

  // ─── C2: Remove Email Enumeration ────────────────────────────────────────────

  describe('C2: Register — generic conflict message', () => {
    it('returns generic "Registration failed" on duplicate email', async () => {
      const email = `test-${uuid()}@example.com`;

      // First registration succeeds
      await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({ tenantName: 'First Co', fullName: 'Alice', email, password: 'Pass123!' })
        .expect(201);

      // Second with same email
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({ tenantName: 'Second Co', fullName: 'Bob', email, password: 'Pass123!' })
        .expect(409);

      expect(res.body.message).toBe('Registration failed');
      expect(res.body.message).not.toContain('email');
      expect(res.body.message).not.toContain('Email');
    });
  });
});
