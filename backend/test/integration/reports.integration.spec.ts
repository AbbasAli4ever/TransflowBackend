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
  createAndPostSupplierPayment,
  createAndPostCustomerPayment,
  createAndPostSupplierReturn,
  createAndPostCustomerReturn,
} from '../helpers/test-factories';
import { PrismaClient } from '@prisma/client';

describe('Reports (Integration)', () => {
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

  // ─── EP-1: Supplier Balance ──────────────────────────────────────────────────

  describe('GET /api/v1/reports/suppliers/:id/balance', () => {
    it('returns zero balance for supplier with no transactions', async () => {
      const supplier = await createTestSupplier(prisma, tenantId, userId);

      const res = await request(app.getHttpServer())
        .get(`/api/v1/reports/suppliers/${supplier.id}/balance`)
        .set(authHeader(token))
        .expect(200);

      expect(res.body.supplierId).toBe(supplier.id);
      expect(res.body.balance).toBe(0);
      expect(res.body.balanceType).toBe('SETTLED');
      expect(res.body.breakdown.purchases.count).toBe(0);
    });

    it('asOfDate excludes transactions after that date', async () => {
      const supplier = await createTestSupplier(prisma, tenantId, userId);
      const product = await createTestProduct(prisma, tenantId, userId);
      const account = await createTestPaymentAccount(prisma, tenantId, userId);

      // Purchase on 2026-01-10
      await createAndPostPurchase(app, token, {
        supplierId: supplier.id,
        lines: [{ variantId: product.variants[0].id, quantity: 10, unitCost: 1000 }],
        transactionDate: '2026-01-10',
        paidNow: 3000,
        paymentAccountId: account.id,
      });

      // Another purchase on 2026-02-15 (should be excluded when asOfDate=2026-01-31)
      await createAndPostPurchase(app, token, {
        supplierId: supplier.id,
        lines: [{ variantId: product.variants[0].id, quantity: 5, unitCost: 500 }],
        transactionDate: '2026-02-15',
      });

      const res = await request(app.getHttpServer())
        .get(`/api/v1/reports/suppliers/${supplier.id}/balance?asOfDate=2026-01-31`)
        .set(authHeader(token))
        .expect(200);

      // Only the 10,000 purchase and 3,000 payment should be included
      expect(res.body.breakdown.purchases.totalAmount).toBe(10000);
      expect(res.body.breakdown.payments.totalAmount).toBe(3000);
      expect(res.body.balance).toBe(7000);
      expect(res.body.balanceType).toBe('PAYABLE');
    });

    it('breakdown separates purchases, payments, and returns', async () => {
      const supplier = await createTestSupplier(prisma, tenantId, userId);
      const product = await createTestProduct(prisma, tenantId, userId);
      const account = await createTestPaymentAccount(prisma, tenantId, userId);

      // 1 purchase
      const purchase = await createAndPostPurchase(app, token, {
        supplierId: supplier.id,
        lines: [{ variantId: product.variants[0].id, quantity: 20, unitCost: 500 }],
        transactionDate: '2026-01-05',
      });

      // 1 payment
      await createAndPostSupplierPayment(app, token, {
        supplierId: supplier.id,
        amount: 3000,
        paymentAccountId: account.id,
        transactionDate: '2026-01-10',
      });

      // 1 return
      const purchaseLineId = purchase.transactionLines[0].id;
      await createAndPostSupplierReturn(app, token, {
        supplierId: supplier.id,
        lines: [{ sourceTransactionLineId: purchaseLineId, quantity: 2 }],
        transactionDate: '2026-01-15',
      });

      const res = await request(app.getHttpServer())
        .get(`/api/v1/reports/suppliers/${supplier.id}/balance`)
        .set(authHeader(token))
        .expect(200);

      expect(res.body.breakdown.purchases.count).toBe(1);
      expect(res.body.breakdown.purchases.totalAmount).toBe(10000); // 20 * 500
      expect(res.body.breakdown.payments.count).toBe(1);
      expect(res.body.breakdown.payments.totalAmount).toBe(3000);
      expect(res.body.breakdown.returns.count).toBe(1);
      expect(res.body.breakdown.returns.totalAmount).toBe(1000); // 2 * 500
      expect(res.body.balance).toBe(6000); // 10000 - 3000 - 1000
    });

    it('returns 404 for unknown supplier', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/reports/suppliers/00000000-0000-0000-0000-000000000099/balance')
        .set(authHeader(token))
        .expect(404);
    });

    it('tenant isolation: returns 404 for another tenant supplier', async () => {
      const { tenant: t2, user: u2 } = await createTenantWithUser(prisma);
      const supplier2 = await createTestSupplier(prisma, t2.id, u2.id);

      await request(app.getHttpServer())
        .get(`/api/v1/reports/suppliers/${supplier2.id}/balance`)
        .set(authHeader(token))
        .expect(404);
    });
  });

  // ─── EP-2: Customer Balance ──────────────────────────────────────────────────

  describe('GET /api/v1/reports/customers/:id/balance', () => {
    it('asOfDate filters correctly and defaults to today', async () => {
      const supplier = await createTestSupplier(prisma, tenantId, userId);
      const customer = await createTestCustomer(prisma, tenantId, userId);
      const product = await createTestProduct(prisma, tenantId, userId);

      await createAndPostPurchase(app, token, {
        supplierId: supplier.id,
        lines: [{ variantId: product.variants[0].id, quantity: 50, unitCost: 100 }],
      });

      // Sale on 2026-01-05
      await createAndPostSale(app, token, {
        customerId: customer.id,
        lines: [{ variantId: product.variants[0].id, quantity: 10, unitPrice: 300 }],
        transactionDate: '2026-01-05',
      });

      // Sale on 2026-02-10 (excluded when asOfDate=2026-01-31)
      await createAndPostSale(app, token, {
        customerId: customer.id,
        lines: [{ variantId: product.variants[0].id, quantity: 5, unitPrice: 300 }],
        transactionDate: '2026-02-10',
      });

      const res = await request(app.getHttpServer())
        .get(`/api/v1/reports/customers/${customer.id}/balance?asOfDate=2026-01-31`)
        .set(authHeader(token))
        .expect(200);

      expect(res.body.breakdown.sales.totalAmount).toBe(3000); // only first sale
      expect(res.body.balance).toBe(3000);
      expect(res.body.balanceType).toBe('RECEIVABLE');
    });

    it('breakdown separates sales, payments, and returns', async () => {
      const supplier = await createTestSupplier(prisma, tenantId, userId);
      const customer = await createTestCustomer(prisma, tenantId, userId);
      const product = await createTestProduct(prisma, tenantId, userId);
      const account = await createTestPaymentAccount(prisma, tenantId, userId);

      await createAndPostPurchase(app, token, {
        supplierId: supplier.id,
        lines: [{ variantId: product.variants[0].id, quantity: 30, unitCost: 100 }],
      });

      // Sale
      const sale = await createAndPostSale(app, token, {
        customerId: customer.id,
        lines: [{ variantId: product.variants[0].id, quantity: 10, unitPrice: 500 }],
      });

      // Payment
      await createAndPostCustomerPayment(app, token, {
        customerId: customer.id,
        amount: 2000,
        paymentAccountId: account.id,
      });

      // Return
      const saleLineId = sale.transactionLines[0].id;
      await createAndPostCustomerReturn(app, token, {
        customerId: customer.id,
        lines: [{ sourceTransactionLineId: saleLineId, quantity: 2 }],
      });

      const res = await request(app.getHttpServer())
        .get(`/api/v1/reports/customers/${customer.id}/balance`)
        .set(authHeader(token))
        .expect(200);

      expect(res.body.breakdown.sales.count).toBe(1);
      expect(res.body.breakdown.sales.totalAmount).toBe(5000);
      expect(res.body.breakdown.payments.count).toBe(1);
      expect(res.body.breakdown.payments.totalAmount).toBe(2000);
      expect(res.body.breakdown.returns.count).toBe(1);
      expect(res.body.breakdown.returns.totalAmount).toBe(1000); // 2 * 500
      expect(res.body.balance).toBe(2000); // 5000 - 2000 - 1000
    });

    it('returns 404 for unknown customer', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/reports/customers/00000000-0000-0000-0000-000000000099/balance')
        .set(authHeader(token))
        .expect(404);
    });

    it('tenant isolation: returns 404 for another tenant customer', async () => {
      const { tenant: t2, user: u2 } = await createTenantWithUser(prisma);
      const customer2 = await createTestCustomer(prisma, t2.id, u2.id);

      await request(app.getHttpServer())
        .get(`/api/v1/reports/customers/${customer2.id}/balance`)
        .set(authHeader(token))
        .expect(404);
    });
  });

  // ─── EP-3: Payment Account Balance ──────────────────────────────────────────

  describe('GET /api/v1/reports/payment-accounts/:id/balance', () => {
    it('includes openingBalance from account record', async () => {
      const account = await createTestPaymentAccount(prisma, tenantId, userId, {
        openingBalance: 5000,
      });

      const res = await request(app.getHttpServer())
        .get(`/api/v1/reports/payment-accounts/${account.id}/balance`)
        .set(authHeader(token))
        .expect(200);

      expect(res.body.accountId).toBe(account.id);
      expect(res.body.breakdown.openingBalance).toBe(5000);
      expect(res.body.balance).toBe(5000);
    });

    it('asOfDate filters payment entries correctly', async () => {
      const supplier = await createTestSupplier(prisma, tenantId, userId);
      const product = await createTestProduct(prisma, tenantId, userId);
      const account = await createTestPaymentAccount(prisma, tenantId, userId, {
        openingBalance: 10000,
      });

      // Payment out on 2026-01-10 (5 * 400 = 2000 total, paid in full)
      await createAndPostPurchase(app, token, {
        supplierId: supplier.id,
        lines: [{ variantId: product.variants[0].id, quantity: 5, unitCost: 400 }],
        transactionDate: '2026-01-10',
        paidNow: 2000,
        paymentAccountId: account.id,
      });

      // Payment out on 2026-02-10 (excluded when asOfDate=2026-01-31)
      await createAndPostPurchase(app, token, {
        supplierId: supplier.id,
        lines: [{ variantId: product.variants[0].id, quantity: 5, unitCost: 200 }],
        transactionDate: '2026-02-10',
        paidNow: 1000,
        paymentAccountId: account.id,
      });

      const res = await request(app.getHttpServer())
        .get(`/api/v1/reports/payment-accounts/${account.id}/balance?asOfDate=2026-01-31`)
        .set(authHeader(token))
        .expect(200);

      expect(res.body.balance).toBe(8000); // 10000 - 2000
      expect(res.body.breakdown.moneyOut.totalAmount).toBe(2000);
    });

    it('returns 404 for unknown payment account', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/reports/payment-accounts/00000000-0000-0000-0000-000000000099/balance')
        .set(authHeader(token))
        .expect(404);
    });
  });

  // ─── EP-4: Product Stock ─────────────────────────────────────────────────────

  describe('GET /api/v1/reports/products/:id/stock', () => {
    it('asOfDate filters inventory movements correctly', async () => {
      const supplier = await createTestSupplier(prisma, tenantId, userId);
      const product = await createTestProduct(prisma, tenantId, userId);

      // Purchase on 2026-01-05: 20 units in
      await createAndPostPurchase(app, token, {
        supplierId: supplier.id,
        lines: [{ variantId: product.variants[0].id, quantity: 20, unitCost: 500 }],
        transactionDate: '2026-01-05',
      });

      // Purchase on 2026-02-05: 10 more units (should be excluded when asOfDate=2026-01-31)
      await createAndPostPurchase(app, token, {
        supplierId: supplier.id,
        lines: [{ variantId: product.variants[0].id, quantity: 10, unitCost: 600 }],
        transactionDate: '2026-02-05',
      });

      const res = await request(app.getHttpServer())
        .get(`/api/v1/reports/products/${product.id}/stock?asOfDate=2026-01-31`)
        .set(authHeader(token))
        .expect(200);

      expect(res.body.currentStock).toBe(20);
      expect(res.body.avgCost).toBe(500);
      expect(res.body.stockValue).toBe(10000);
    });

    it('breakdown counts each movement type separately', async () => {
      const supplier = await createTestSupplier(prisma, tenantId, userId);
      const customer = await createTestCustomer(prisma, tenantId, userId);
      const product = await createTestProduct(prisma, tenantId, userId);

      // 30 in via purchase
      const purchase = await createAndPostPurchase(app, token, {
        supplierId: supplier.id,
        lines: [{ variantId: product.variants[0].id, quantity: 30, unitCost: 200 }],
      });

      // 8 out via sale, 2 return from customer
      const sale = await createAndPostSale(app, token, {
        customerId: customer.id,
        lines: [{ variantId: product.variants[0].id, quantity: 8, unitPrice: 500 }],
      });

      const saleLineId = sale.transactionLines[0].id;
      await createAndPostCustomerReturn(app, token, {
        customerId: customer.id,
        lines: [{ sourceTransactionLineId: saleLineId, quantity: 2 }],
      });

      // 5 out via supplier return
      const purchaseLineId = purchase.transactionLines[0].id;
      await createAndPostSupplierReturn(app, token, {
        supplierId: supplier.id,
        lines: [{ sourceTransactionLineId: purchaseLineId, quantity: 5 }],
      });

      const res = await request(app.getHttpServer())
        .get(`/api/v1/reports/products/${product.id}/stock`)
        .set(authHeader(token))
        .expect(200);

      expect(res.body.breakdown.purchasesIn).toBe(30);
      expect(res.body.breakdown.salesOut).toBe(8);
      expect(res.body.breakdown.customerReturnsIn).toBe(2);
      expect(res.body.breakdown.supplierReturnsOut).toBe(5);
      expect(res.body.breakdown.netStock).toBe(19); // 30 - 8 + 2 - 5
      expect(res.body.currentStock).toBe(19);
    });

    it('stockValue equals currentStock times avgCost', async () => {
      const supplier = await createTestSupplier(prisma, tenantId, userId);
      const product = await createTestProduct(prisma, tenantId, userId);

      await createAndPostPurchase(app, token, {
        supplierId: supplier.id,
        lines: [{ variantId: product.variants[0].id, quantity: 10, unitCost: 300 }],
      });

      const res = await request(app.getHttpServer())
        .get(`/api/v1/reports/products/${product.id}/stock`)
        .set(authHeader(token))
        .expect(200);

      expect(res.body.stockValue).toBe(res.body.currentStock * res.body.avgCost);
    });

    it('returns 404 for unknown product', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/reports/products/00000000-0000-0000-0000-000000000099/stock')
        .set(authHeader(token))
        .expect(404);
    });
  });

  // ─── EP-5: Pending Receivables ───────────────────────────────────────────────

  describe('GET /api/v1/reports/pending-receivables', () => {
    it('includes only customers with positive AR balance', async () => {
      const supplier = await createTestSupplier(prisma, tenantId, userId);
      const customerA = await createTestCustomer(prisma, tenantId, userId, { name: 'Customer A' });
      const customerB = await createTestCustomer(prisma, tenantId, userId, { name: 'Customer B' });
      const product = await createTestProduct(prisma, tenantId, userId);
      const account = await createTestPaymentAccount(prisma, tenantId, userId);

      await createAndPostPurchase(app, token, {
        supplierId: supplier.id,
        lines: [{ variantId: product.variants[0].id, quantity: 50, unitCost: 100 }],
      });

      // customerA: 5000 outstanding
      await createAndPostSale(app, token, {
        customerId: customerA.id,
        lines: [{ variantId: product.variants[0].id, quantity: 10, unitPrice: 500 }],
      });

      // customerB: fully paid — balance = 0, should NOT appear
      const saleB = await createAndPostSale(app, token, {
        customerId: customerB.id,
        lines: [{ variantId: product.variants[0].id, quantity: 4, unitPrice: 500 }],
      });
      await createAndPostCustomerPayment(app, token, {
        customerId: customerB.id,
        amount: 2000,
        paymentAccountId: account.id,
      });

      const res = await request(app.getHttpServer())
        .get('/api/v1/reports/pending-receivables')
        .set(authHeader(token))
        .expect(200);

      expect(res.body.customerCount).toBe(1);
      expect(res.body.customers[0].customerId).toBe(customerA.id);
      expect(res.body.totalReceivables).toBe(5000);
    });

    it('minAmount filter excludes customers below threshold', async () => {
      const supplier = await createTestSupplier(prisma, tenantId, userId);
      const customerA = await createTestCustomer(prisma, tenantId, userId, { name: 'High Balance' });
      const customerB = await createTestCustomer(prisma, tenantId, userId, { name: 'Low Balance' });
      const product = await createTestProduct(prisma, tenantId, userId);

      await createAndPostPurchase(app, token, {
        supplierId: supplier.id,
        lines: [{ variantId: product.variants[0].id, quantity: 100, unitCost: 50 }],
      });

      await createAndPostSale(app, token, {
        customerId: customerA.id,
        lines: [{ variantId: product.variants[0].id, quantity: 20, unitPrice: 500 }], // 10000
      });
      await createAndPostSale(app, token, {
        customerId: customerB.id,
        lines: [{ variantId: product.variants[0].id, quantity: 2, unitPrice: 200 }], // 400
      });

      const res = await request(app.getHttpServer())
        .get('/api/v1/reports/pending-receivables?minAmount=1000')
        .set(authHeader(token))
        .expect(200);

      expect(res.body.customerCount).toBe(1);
      expect(res.body.customers[0].customerId).toBe(customerA.id);
    });

    it('customerId filter returns only that customer', async () => {
      const supplier = await createTestSupplier(prisma, tenantId, userId);
      const customerA = await createTestCustomer(prisma, tenantId, userId);
      const customerB = await createTestCustomer(prisma, tenantId, userId);
      const product = await createTestProduct(prisma, tenantId, userId);

      await createAndPostPurchase(app, token, {
        supplierId: supplier.id,
        lines: [{ variantId: product.variants[0].id, quantity: 50, unitCost: 100 }],
      });

      await createAndPostSale(app, token, {
        customerId: customerA.id,
        lines: [{ variantId: product.variants[0].id, quantity: 5, unitPrice: 300 }],
      });
      await createAndPostSale(app, token, {
        customerId: customerB.id,
        lines: [{ variantId: product.variants[0].id, quantity: 3, unitPrice: 300 }],
      });

      const res = await request(app.getHttpServer())
        .get(`/api/v1/reports/pending-receivables?customerId=${customerA.id}`)
        .set(authHeader(token))
        .expect(200);

      expect(res.body.customerCount).toBe(1);
      expect(res.body.customers[0].customerId).toBe(customerA.id);
    });

    it('open documents include outstanding amount and daysPastDue', async () => {
      const supplier = await createTestSupplier(prisma, tenantId, userId);
      const customer = await createTestCustomer(prisma, tenantId, userId);
      const product = await createTestProduct(prisma, tenantId, userId);
      const account = await createTestPaymentAccount(prisma, tenantId, userId);

      await createAndPostPurchase(app, token, {
        supplierId: supplier.id,
        lines: [{ variantId: product.variants[0].id, quantity: 20, unitCost: 100 }],
      });

      // Sale of 10 units at 500 each = 5000 total
      await createAndPostSale(app, token, {
        customerId: customer.id,
        lines: [{ variantId: product.variants[0].id, quantity: 10, unitPrice: 500 }],
        transactionDate: '2026-01-01',
      });

      // Partial payment of 1000, dated before asOfDate so it is included
      await createAndPostCustomerPayment(app, token, {
        customerId: customer.id,
        amount: 1000,
        paymentAccountId: account.id,
        transactionDate: '2026-01-15',
      });

      const res = await request(app.getHttpServer())
        .get(`/api/v1/reports/pending-receivables?asOfDate=2026-02-01`)
        .set(authHeader(token))
        .expect(200);

      expect(res.body.customers).toHaveLength(1);
      const docs = res.body.customers[0].openDocuments;
      expect(docs).toHaveLength(1);
      expect(docs[0].outstanding).toBe(4000); // 5000 - 1000 allocated
      expect(docs[0].daysPastDue).toBe(31); // Jan 1 to Feb 1
    });
  });

  // ─── EP-6: Pending Payables ──────────────────────────────────────────────────

  describe('GET /api/v1/reports/pending-payables', () => {
    it('includes only suppliers with positive AP balance', async () => {
      const supplierA = await createTestSupplier(prisma, tenantId, userId, { name: 'Supplier A' });
      const supplierB = await createTestSupplier(prisma, tenantId, userId, { name: 'Supplier B' });
      const product = await createTestProduct(prisma, tenantId, userId);
      const account = await createTestPaymentAccount(prisma, tenantId, userId);

      // supplierA: outstanding 5000
      await createAndPostPurchase(app, token, {
        supplierId: supplierA.id,
        lines: [{ variantId: product.variants[0].id, quantity: 10, unitCost: 500 }],
      });

      // supplierB: fully paid — should NOT appear
      await createAndPostPurchase(app, token, {
        supplierId: supplierB.id,
        lines: [{ variantId: product.variants[0].id, quantity: 4, unitCost: 500 }],
        paidNow: 2000,
        paymentAccountId: account.id,
      });

      const res = await request(app.getHttpServer())
        .get('/api/v1/reports/pending-payables')
        .set(authHeader(token))
        .expect(200);

      expect(res.body.supplierCount).toBe(1);
      expect(res.body.suppliers[0].supplierId).toBe(supplierA.id);
      expect(res.body.totalPayables).toBe(5000);
    });

    it('supplierId filter returns only that supplier', async () => {
      const supplierA = await createTestSupplier(prisma, tenantId, userId);
      const supplierB = await createTestSupplier(prisma, tenantId, userId);
      const product = await createTestProduct(prisma, tenantId, userId);

      await createAndPostPurchase(app, token, {
        supplierId: supplierA.id,
        lines: [{ variantId: product.variants[0].id, quantity: 5, unitCost: 500 }],
      });
      await createAndPostPurchase(app, token, {
        supplierId: supplierB.id,
        lines: [{ variantId: product.variants[0].id, quantity: 3, unitCost: 500 }],
      });

      const res = await request(app.getHttpServer())
        .get(`/api/v1/reports/pending-payables?supplierId=${supplierA.id}`)
        .set(authHeader(token))
        .expect(200);

      expect(res.body.supplierCount).toBe(1);
      expect(res.body.suppliers[0].supplierId).toBe(supplierA.id);
    });
  });

  // ─── EP-7: Supplier Statement ────────────────────────────────────────────────

  describe('GET /api/v1/reports/suppliers/:id/statement', () => {
    it('openingBalance is sum of AP entries before dateFrom', async () => {
      const supplier = await createTestSupplier(prisma, tenantId, userId);
      const product = await createTestProduct(prisma, tenantId, userId);

      // Pre-range purchase: 5000 AP_INCREASE
      await createAndPostPurchase(app, token, {
        supplierId: supplier.id,
        lines: [{ variantId: product.variants[0].id, quantity: 10, unitCost: 500 }],
        transactionDate: '2025-12-15',
      });

      const res = await request(app.getHttpServer())
        .get(`/api/v1/reports/suppliers/${supplier.id}/statement?dateFrom=2026-01-01&dateTo=2026-01-31`)
        .set(authHeader(token))
        .expect(200);

      expect(res.body.openingBalance).toBe(5000);
      expect(res.body.entries).toHaveLength(0);
      expect(res.body.closingBalance).toBe(5000);
    });

    it('runningBalance accumulates correctly across entries', async () => {
      const supplier = await createTestSupplier(prisma, tenantId, userId);
      const product = await createTestProduct(prisma, tenantId, userId);
      const account = await createTestPaymentAccount(prisma, tenantId, userId);

      // Purchase on 2026-01-05: 10000
      await createAndPostPurchase(app, token, {
        supplierId: supplier.id,
        lines: [{ variantId: product.variants[0].id, quantity: 20, unitCost: 500 }],
        transactionDate: '2026-01-05',
      });

      // Payment on 2026-01-15: 4000
      await createAndPostSupplierPayment(app, token, {
        supplierId: supplier.id,
        amount: 4000,
        paymentAccountId: account.id,
        transactionDate: '2026-01-15',
      });

      const res = await request(app.getHttpServer())
        .get(`/api/v1/reports/suppliers/${supplier.id}/statement?dateFrom=2026-01-01&dateTo=2026-01-31`)
        .set(authHeader(token))
        .expect(200);

      expect(res.body.openingBalance).toBe(0);
      expect(res.body.entries).toHaveLength(2);
      expect(res.body.entries[0].runningBalance).toBe(10000); // after purchase
      expect(res.body.entries[1].runningBalance).toBe(6000);  // after payment
      expect(res.body.closingBalance).toBe(6000);
    });

    it('empty date range returns openingBalance as closingBalance', async () => {
      const supplier = await createTestSupplier(prisma, tenantId, userId);
      const product = await createTestProduct(prisma, tenantId, userId);

      await createAndPostPurchase(app, token, {
        supplierId: supplier.id,
        lines: [{ variantId: product.variants[0].id, quantity: 10, unitCost: 1000 }],
        transactionDate: '2025-12-01',
      });

      const res = await request(app.getHttpServer())
        .get(`/api/v1/reports/suppliers/${supplier.id}/statement?dateFrom=2026-02-01&dateTo=2026-02-28`)
        .set(authHeader(token))
        .expect(200);

      expect(res.body.openingBalance).toBe(10000);
      expect(res.body.entries).toHaveLength(0);
      expect(res.body.closingBalance).toBe(10000);
    });

    it('returns 404 for unknown supplier', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/reports/suppliers/00000000-0000-0000-0000-000000000099/statement?dateFrom=2026-01-01&dateTo=2026-01-31')
        .set(authHeader(token))
        .expect(404);
    });
  });

  // ─── EP-8: Customer Statement ────────────────────────────────────────────────

  describe('GET /api/v1/reports/customers/:id/statement', () => {
    it('mirrors supplier statement logic with AR entries', async () => {
      const supplier = await createTestSupplier(prisma, tenantId, userId);
      const customer = await createTestCustomer(prisma, tenantId, userId);
      const product = await createTestProduct(prisma, tenantId, userId);
      const account = await createTestPaymentAccount(prisma, tenantId, userId);

      await createAndPostPurchase(app, token, {
        supplierId: supplier.id,
        lines: [{ variantId: product.variants[0].id, quantity: 30, unitCost: 100 }],
      });

      // Pre-range sale
      await createAndPostSale(app, token, {
        customerId: customer.id,
        lines: [{ variantId: product.variants[0].id, quantity: 5, unitPrice: 400 }],
        transactionDate: '2025-12-20',
      });

      // In-range sale
      await createAndPostSale(app, token, {
        customerId: customer.id,
        lines: [{ variantId: product.variants[0].id, quantity: 8, unitPrice: 400 }],
        transactionDate: '2026-01-10',
      });

      // In-range payment
      await createAndPostCustomerPayment(app, token, {
        customerId: customer.id,
        amount: 1000,
        paymentAccountId: account.id,
        transactionDate: '2026-01-20',
      });

      const res = await request(app.getHttpServer())
        .get(`/api/v1/reports/customers/${customer.id}/statement?dateFrom=2026-01-01&dateTo=2026-01-31`)
        .set(authHeader(token))
        .expect(200);

      expect(res.body.openingBalance).toBe(2000); // 5 * 400 pre-range
      expect(res.body.entries).toHaveLength(2);
      expect(res.body.entries[0].runningBalance).toBe(5200); // 2000 + 3200
      expect(res.body.entries[1].runningBalance).toBe(4200); // 5200 - 1000
      expect(res.body.closingBalance).toBe(4200);
    });

    it('returns 404 for unknown customer', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/reports/customers/00000000-0000-0000-0000-000000000099/statement?dateFrom=2026-01-01&dateTo=2026-01-31')
        .set(authHeader(token))
        .expect(404);
    });
  });

  // ─── EP-9: Payment Account Statement ────────────────────────────────────────

  describe('GET /api/v1/reports/payment-accounts/:id/statement', () => {
    it('openingBalance includes account.openingBalance plus pre-range entries', async () => {
      const supplier = await createTestSupplier(prisma, tenantId, userId);
      const product = await createTestProduct(prisma, tenantId, userId);
      const account = await createTestPaymentAccount(prisma, tenantId, userId, {
        openingBalance: 5000,
      });

      // Pre-range payment out: 2000
      await createAndPostPurchase(app, token, {
        supplierId: supplier.id,
        lines: [{ variantId: product.variants[0].id, quantity: 10, unitCost: 500 }],
        transactionDate: '2025-12-10',
        paidNow: 2000,
        paymentAccountId: account.id,
      });

      const res = await request(app.getHttpServer())
        .get(`/api/v1/reports/payment-accounts/${account.id}/statement?dateFrom=2026-01-01&dateTo=2026-01-31`)
        .set(authHeader(token))
        .expect(200);

      expect(res.body.openingBalance).toBe(3000); // 5000 (account) - 2000 (pre-range out)
      expect(res.body.entries).toHaveLength(0);
      expect(res.body.closingBalance).toBe(3000);
    });

    it('runningBalance correct for in-range entries', async () => {
      const supplier = await createTestSupplier(prisma, tenantId, userId);
      const customer = await createTestCustomer(prisma, tenantId, userId);
      const product = await createTestProduct(prisma, tenantId, userId);
      const account = await createTestPaymentAccount(prisma, tenantId, userId, {
        openingBalance: 10000,
      });

      await createAndPostPurchase(app, token, {
        supplierId: supplier.id,
        lines: [{ variantId: product.variants[0].id, quantity: 20, unitCost: 200 }],
      });

      // Pay supplier 3000 out via explicit payment
      await createAndPostSupplierPayment(app, token, {
        supplierId: supplier.id,
        amount: 3000,
        paymentAccountId: account.id,
        transactionDate: '2026-01-05',
      });

      // Receive from customer 1500 in
      await createAndPostSale(app, token, {
        customerId: customer.id,
        lines: [{ variantId: product.variants[0].id, quantity: 5, unitPrice: 500 }],
        transactionDate: '2026-01-15',
        receivedNow: 1500,
        paymentAccountId: account.id,
      });

      const res = await request(app.getHttpServer())
        .get(`/api/v1/reports/payment-accounts/${account.id}/statement?dateFrom=2026-01-01&dateTo=2026-01-31`)
        .set(authHeader(token))
        .expect(200);

      expect(res.body.openingBalance).toBe(10000);
      expect(res.body.entries).toHaveLength(2);
      expect(res.body.entries[0].runningBalance).toBe(7000); // 10000 - 3000
      expect(res.body.entries[1].runningBalance).toBe(8500); // 7000 + 1500
      expect(res.body.closingBalance).toBe(8500);
    });

    it('returns 404 for unknown payment account', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/reports/payment-accounts/00000000-0000-0000-0000-000000000099/statement?dateFrom=2026-01-01&dateTo=2026-01-31')
        .set(authHeader(token))
        .expect(404);
    });
  });

  // ─── WAVE 2: Date Validation (Tasks 1.3 + 1.4) ────────────────────────────

  describe('Wave 2 — asOfDate format validation (Task 1.3)', () => {
    it('rejects asOfDate datetime string on balance endpoint (400)', async () => {
      const supplier = await createTestSupplier(prisma, tenantId, userId);
      await request(app.getHttpServer())
        .get(`/api/v1/reports/suppliers/${supplier.id}/balance?asOfDate=2026-02-15T00:00:00Z`)
        .set(authHeader(token))
        .expect(400);
    });

    it('accepts asOfDate YYYY-MM-DD on balance endpoint (200)', async () => {
      const supplier = await createTestSupplier(prisma, tenantId, userId);
      await request(app.getHttpServer())
        .get(`/api/v1/reports/suppliers/${supplier.id}/balance?asOfDate=2026-02-15`)
        .set(authHeader(token))
        .expect(200);
    });

    it('rejects asOfDate datetime string on pending-receivables (400)', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/reports/pending-receivables?asOfDate=2026-02-15T00:00:00Z')
        .set(authHeader(token))
        .expect(400);
    });

    it('rejects asOfDate datetime string on pending-payables (400)', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/reports/pending-payables?asOfDate=2026-02-15T00:00:00Z')
        .set(authHeader(token))
        .expect(400);
    });
  });

  describe('Wave 2 — Statement date range validation (Task 1.4)', () => {
    it('rejects inverted date range on supplier statement (400)', async () => {
      const supplier = await createTestSupplier(prisma, tenantId, userId);
      await request(app.getHttpServer())
        .get(`/api/v1/reports/suppliers/${supplier.id}/statement?dateFrom=2026-02-15&dateTo=2026-02-01`)
        .set(authHeader(token))
        .expect(400);
    });

    it('accepts same-day date range on supplier statement (200)', async () => {
      const supplier = await createTestSupplier(prisma, tenantId, userId);
      await request(app.getHttpServer())
        .get(`/api/v1/reports/suppliers/${supplier.id}/statement?dateFrom=2026-02-15&dateTo=2026-02-15`)
        .set(authHeader(token))
        .expect(200);
    });

    it('rejects inverted date range on customer statement (400)', async () => {
      const customer = await createTestCustomer(prisma, tenantId, userId);
      await request(app.getHttpServer())
        .get(`/api/v1/reports/customers/${customer.id}/statement?dateFrom=2026-03-01&dateTo=2026-02-01`)
        .set(authHeader(token))
        .expect(400);
    });

    it('rejects inverted date range on payment account statement (400)', async () => {
      const account = await createTestPaymentAccount(prisma, tenantId, userId);
      await request(app.getHttpServer())
        .get(`/api/v1/reports/payment-accounts/${account.id}/statement?dateFrom=2026-03-01&dateTo=2026-01-01`)
        .set(authHeader(token))
        .expect(400);
    });

    it('rejects datetime string for dateFrom on supplier statement (400)', async () => {
      const supplier = await createTestSupplier(prisma, tenantId, userId);
      await request(app.getHttpServer())
        .get(`/api/v1/reports/suppliers/${supplier.id}/statement?dateFrom=2026-02-15T00:00:00Z&dateTo=2026-02-28`)
        .set(authHeader(token))
        .expect(400);
    });
  });

  // ─── WAVE 2: Pending Reports Temporal Integrity (Task 1.2) ────────────────

  describe('Wave 2 — Pending receivables temporal integrity (Task 1.2)', () => {
    it('future-dated payment does not close open document for asOfDate=today', async () => {
      const today = new Date().toISOString().split('T')[0];
      const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0];

      const supplier = await createTestSupplier(prisma, tenantId, userId);
      const customer = await createTestCustomer(prisma, tenantId, userId);
      const product = await createTestProduct(prisma, tenantId, userId);

      await createAndPostPurchase(app, token, {
        supplierId: supplier.id,
        lines: [{ variantId: product.variants[0].id, quantity: 10, unitCost: 500 }],
      });

      const sale = await createAndPostSale(app, token, {
        customerId: customer.id,
        lines: [{ variantId: product.variants[0].id, quantity: 5, unitPrice: 2000 }],
      });

      // Verify sale shows as open with asOfDate=today
      const before = await request(app.getHttpServer())
        .get(`/api/v1/reports/pending-receivables?asOfDate=${today}`)
        .set(authHeader(token))
        .expect(200);

      const custBefore = before.body.customers.find((c: any) => c.customerId === customer.id);
      expect(custBefore).toBeDefined();
      expect(custBefore.openDocuments).toHaveLength(1);
      expect(custBefore.openDocuments[0].outstanding).toBe(10000); // 5 * 2000

      // Insert a future-dated payment + allocation directly in DB
      const payTxn = await prisma.transaction.create({
        data: {
          tenantId,
          type: 'CUSTOMER_PAYMENT',
          status: 'POSTED',
          transactionDate: new Date(tomorrow),
          customerId: customer.id,
          subtotal: 10000,
          totalAmount: 10000,
          discountTotal: 0,
          documentNumber: 'CPY-TEMP-0001',
          series: String(new Date().getFullYear()),
          postedAt: new Date(),
          createdBy: userId,
        },
      });

      await prisma.allocation.create({
        data: {
          tenantId,
          paymentTransactionId: payTxn.id,
          appliesToTransactionId: sale.id,
          amountApplied: 10000,
          createdBy: userId,
        },
      });

      // Re-query with asOfDate=today: future payment must NOT close the document
      const after = await request(app.getHttpServer())
        .get(`/api/v1/reports/pending-receivables?asOfDate=${today}`)
        .set(authHeader(token))
        .expect(200);

      const custAfter = after.body.customers.find((c: any) => c.customerId === customer.id);
      expect(custAfter).toBeDefined();
      expect(custAfter.openDocuments[0].outstanding).toBe(10000); // still fully open
      expect(custAfter.openDocuments[0].paidAmount).toBe(0);      // payment not counted

      // Query with asOfDate=tomorrow: payment now in scope, document is closed
      const afterTomorrow = await request(app.getHttpServer())
        .get(`/api/v1/reports/pending-receivables?asOfDate=${tomorrow}`)
        .set(authHeader(token))
        .expect(200);

      const custTomorrow = afterTomorrow.body.customers.find((c: any) => c.customerId === customer.id);
      // Customer should not appear (balance settled) or paidAmount = totalAmount
      if (custTomorrow) {
        expect(custTomorrow.openDocuments).toHaveLength(0);
      }
    });
  });

  describe('Wave 2 — Pending payables temporal integrity (Task 1.2)', () => {
    it('future-dated payment does not close open document for asOfDate=today', async () => {
      const today = new Date().toISOString().split('T')[0];
      const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0];

      const supplier = await createTestSupplier(prisma, tenantId, userId);
      const product = await createTestProduct(prisma, tenantId, userId);

      const purchase = await createAndPostPurchase(app, token, {
        supplierId: supplier.id,
        lines: [{ variantId: product.variants[0].id, quantity: 10, unitCost: 1000 }],
      });

      // Verify purchase shows as open with asOfDate=today
      const before = await request(app.getHttpServer())
        .get(`/api/v1/reports/pending-payables?asOfDate=${today}`)
        .set(authHeader(token))
        .expect(200);

      const suppBefore = before.body.suppliers.find((s: any) => s.supplierId === supplier.id);
      expect(suppBefore).toBeDefined();
      expect(suppBefore.openDocuments[0].outstanding).toBe(10000);

      // Insert a future-dated payment + allocation directly in DB
      const payTxn = await prisma.transaction.create({
        data: {
          tenantId,
          type: 'SUPPLIER_PAYMENT',
          status: 'POSTED',
          transactionDate: new Date(tomorrow),
          supplierId: supplier.id,
          subtotal: 10000,
          totalAmount: 10000,
          discountTotal: 0,
          documentNumber: 'SPY-TEMP-0001',
          series: String(new Date().getFullYear()),
          postedAt: new Date(),
          createdBy: userId,
        },
      });

      await prisma.allocation.create({
        data: {
          tenantId,
          paymentTransactionId: payTxn.id,
          appliesToTransactionId: purchase.id,
          amountApplied: 10000,
          createdBy: userId,
        },
      });

      // Re-query with asOfDate=today: future payment must NOT close the document
      const after = await request(app.getHttpServer())
        .get(`/api/v1/reports/pending-payables?asOfDate=${today}`)
        .set(authHeader(token))
        .expect(200);

      const suppAfter = after.body.suppliers.find((s: any) => s.supplierId === supplier.id);
      expect(suppAfter).toBeDefined();
      expect(suppAfter.openDocuments[0].outstanding).toBe(10000);
      expect(suppAfter.openDocuments[0].paidAmount).toBe(0);

      // Query with asOfDate=tomorrow: payment in scope, document is closed
      const afterTomorrow = await request(app.getHttpServer())
        .get(`/api/v1/reports/pending-payables?asOfDate=${tomorrow}`)
        .set(authHeader(token))
        .expect(200);

      const suppTomorrow = afterTomorrow.body.suppliers.find((s: any) => s.supplierId === supplier.id);
      if (suppTomorrow) {
        expect(suppTomorrow.openDocuments).toHaveLength(0);
      }
    });
  });

  // ─── EP-10: Profit & Loss Report ────────────────────────────────────────────

  describe('GET /api/v1/reports/profit-loss', () => {
    it('returns all zeroes when no transactions exist', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/reports/profit-loss?dateFrom=2026-01-01&dateTo=2026-01-31')
        .set(authHeader(token))
        .expect(200);

      expect(res.body.sales).toBe(0);
      expect(res.body.salesReturns).toBe(0);
      expect(res.body.netRevenue).toBe(0);
      expect(res.body.costOfGoodsSold).toBe(0);
      expect(res.body.grossProfit).toBe(0);
      expect(res.body.grossProfitMargin).toBe(0);
      expect(res.body.dateFrom).toBe('2026-01-01');
      expect(res.body.dateTo).toBe('2026-01-31');
    });

    it('correctly sums sales and excludes DRAFT transactions', async () => {
      const supplier = await createTestSupplier(prisma, tenantId, userId);
      const customer = await createTestCustomer(prisma, tenantId, userId);
      const product = await createTestProduct(prisma, tenantId, userId);
      const account = await createTestPaymentAccount(prisma, tenantId, userId);

      // Post a purchase first so we have stock and cost
      await createAndPostPurchase(app, token, {
        supplierId: supplier.id,
        lines: [{ variantId: product.variants[0].id, quantity: 10, unitCost: 1000 }],
        transactionDate: '2026-01-05',
      });

      // Post a sale of 5 units at 2000 each → revenue 10000, COGS = 5 * 1000 = 5000
      await createAndPostSale(app, token, {
        customerId: customer.id,
        lines: [{ variantId: product.variants[0].id, quantity: 5, unitPrice: 2000 }],
        transactionDate: '2026-01-10',
        paymentAccountId: account.id,
        receivedNow: 0,
      });

      // Create a draft sale (must be excluded)
      await request(app.getHttpServer())
        .post('/api/v1/transactions')
        .set(authHeader(token))
        .send({
          type: 'SALE',
          customerId: customer.id,
          transactionDate: '2026-01-15',
          lines: [{ variantId: product.variants[0].id, quantity: 2, unitPrice: 2000 }],
        });

      const res = await request(app.getHttpServer())
        .get('/api/v1/reports/profit-loss?dateFrom=2026-01-01&dateTo=2026-01-31')
        .set(authHeader(token))
        .expect(200);

      expect(res.body.sales).toBe(10000);
      expect(res.body.salesReturns).toBe(0);
      expect(res.body.netRevenue).toBe(10000);
      expect(res.body.costOfGoodsSold).toBe(5000);
      expect(res.body.grossProfit).toBe(5000);
      expect(res.body.grossProfitMargin).toBe(50);
    });

    it('salesReturns reduces netRevenue and COGS reduced by customer return cost', async () => {
      const supplier = await createTestSupplier(prisma, tenantId, userId);
      const customer = await createTestCustomer(prisma, tenantId, userId);
      const product = await createTestProduct(prisma, tenantId, userId);
      const account = await createTestPaymentAccount(prisma, tenantId, userId);

      await createAndPostPurchase(app, token, {
        supplierId: supplier.id,
        lines: [{ variantId: product.variants[0].id, quantity: 10, unitCost: 1000 }],
        transactionDate: '2026-01-05',
      });

      const sale = await createAndPostSale(app, token, {
        customerId: customer.id,
        lines: [{ variantId: product.variants[0].id, quantity: 6, unitPrice: 2000 }],
        transactionDate: '2026-01-10',
        paymentAccountId: account.id,
        receivedNow: 0,
      });

      // Return 2 units (revenue returned = 4000)
      await createAndPostCustomerReturn(app, token, {
        customerId: customer.id,
        lines: [{ sourceTransactionLineId: sale.transactionLines[0].id, quantity: 2 }],
        transactionDate: '2026-01-20',
      });

      const res = await request(app.getHttpServer())
        .get('/api/v1/reports/profit-loss?dateFrom=2026-01-01&dateTo=2026-01-31')
        .set(authHeader(token))
        .expect(200);

      // sales = 6 * 2000 = 12000; salesReturns = 2 * 2000 = 4000; netRevenue = 8000
      expect(res.body.sales).toBe(12000);
      expect(res.body.salesReturns).toBe(4000);
      expect(res.body.netRevenue).toBe(8000);
      // COGS = SALE_OUT (6*1000=6000) - CUSTOMER_RETURN_IN (2*1000=2000) = 4000
      expect(res.body.costOfGoodsSold).toBe(4000);
      expect(res.body.grossProfit).toBe(4000);
      expect(res.body.grossProfitMargin).toBe(50);
    });

    it('grossProfitMargin is 0 when netRevenue is 0 (no divide-by-zero)', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/reports/profit-loss?dateFrom=2025-01-01&dateTo=2025-01-31')
        .set(authHeader(token))
        .expect(200);

      expect(res.body.netRevenue).toBe(0);
      expect(res.body.grossProfitMargin).toBe(0);
    });

    it('dateFrom/dateTo filter excludes out-of-range transactions', async () => {
      const supplier = await createTestSupplier(prisma, tenantId, userId);
      const customer = await createTestCustomer(prisma, tenantId, userId);
      const product = await createTestProduct(prisma, tenantId, userId);
      const account = await createTestPaymentAccount(prisma, tenantId, userId);

      await createAndPostPurchase(app, token, {
        supplierId: supplier.id,
        lines: [{ variantId: product.variants[0].id, quantity: 10, unitCost: 1000 }],
        transactionDate: '2026-01-05',
      });

      // Sale in January (in range)
      await createAndPostSale(app, token, {
        customerId: customer.id,
        lines: [{ variantId: product.variants[0].id, quantity: 2, unitPrice: 2000 }],
        transactionDate: '2026-01-15',
        paymentAccountId: account.id,
        receivedNow: 0,
      });

      // Sale in February (out of range)
      await createAndPostSale(app, token, {
        customerId: customer.id,
        lines: [{ variantId: product.variants[0].id, quantity: 3, unitPrice: 2000 }],
        transactionDate: '2026-02-05',
        paymentAccountId: account.id,
        receivedNow: 0,
      });

      const res = await request(app.getHttpServer())
        .get('/api/v1/reports/profit-loss?dateFrom=2026-01-01&dateTo=2026-01-31')
        .set(authHeader(token))
        .expect(200);

      // Only Jan sale: 2 * 2000 = 4000
      expect(res.body.sales).toBe(4000);
      expect(res.body.costOfGoodsSold).toBe(2000);
    });

    it('returns 400 if dateFrom or dateTo is missing', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/reports/profit-loss?dateFrom=2026-01-01')
        .set(authHeader(token))
        .expect(400);

      await request(app.getHttpServer())
        .get('/api/v1/reports/profit-loss?dateTo=2026-01-31')
        .set(authHeader(token))
        .expect(400);
    });
  });

  // ─── EP-11: Inventory Valuation Report ──────────────────────────────────────

  describe('GET /api/v1/reports/inventory-valuation', () => {
    it('returns empty products array when no active products exist', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/reports/inventory-valuation?asOfDate=2026-02-20')
        .set(authHeader(token))
        .expect(200);

      expect(res.body.grandTotalValue).toBe(0);
      expect(res.body.products).toHaveLength(0);
      expect(res.body.asOfDate).toBe('2026-02-20');
    });

    it('correctly computes qtyOnHand, avgCost, and totalValue per variant', async () => {
      const supplier = await createTestSupplier(prisma, tenantId, userId);
      const product = await createTestProduct(prisma, tenantId, userId);

      // Purchase 10 units at 1000 each
      await createAndPostPurchase(app, token, {
        supplierId: supplier.id,
        lines: [{ variantId: product.variants[0].id, quantity: 10, unitCost: 1000 }],
        transactionDate: '2026-01-05',
      });

      // Purchase 5 more units at 2000 each (avgCost = (10000+10000)/15 = 1333)
      await createAndPostPurchase(app, token, {
        supplierId: supplier.id,
        lines: [{ variantId: product.variants[0].id, quantity: 5, unitCost: 2000 }],
        transactionDate: '2026-01-10',
      });

      const res = await request(app.getHttpServer())
        .get('/api/v1/reports/inventory-valuation?asOfDate=2026-02-20')
        .set(authHeader(token))
        .expect(200);

      expect(res.body.products).toHaveLength(1);
      const p = res.body.products[0];
      expect(p.productId).toBe(product.id);
      expect(p.productName).toBe(product.name);
      expect(p.productTotalQty).toBe(15);

      const v = p.variants[0];
      expect(v.variantId).toBe(product.variants[0].id);
      expect(v.qtyOnHand).toBe(15);
      // avgCost = round((10000 + 10000) / 15) = round(1333.33) = 1333
      expect(v.avgCost).toBe(1333);
      expect(v.totalValue).toBe(15 * 1333);
      expect(p.productTotalValue).toBe(15 * 1333);
      expect(res.body.grandTotalValue).toBe(15 * 1333);
    });

    it('asOfDate excludes movements after that date', async () => {
      const supplier = await createTestSupplier(prisma, tenantId, userId);
      const product = await createTestProduct(prisma, tenantId, userId);

      // Purchase on Jan 5
      await createAndPostPurchase(app, token, {
        supplierId: supplier.id,
        lines: [{ variantId: product.variants[0].id, quantity: 10, unitCost: 1000 }],
        transactionDate: '2026-01-05',
      });

      // Purchase on Feb 5 (should be excluded when asOfDate=2026-01-31)
      await createAndPostPurchase(app, token, {
        supplierId: supplier.id,
        lines: [{ variantId: product.variants[0].id, quantity: 20, unitCost: 500 }],
        transactionDate: '2026-02-05',
      });

      const res = await request(app.getHttpServer())
        .get('/api/v1/reports/inventory-valuation?asOfDate=2026-01-31')
        .set(authHeader(token))
        .expect(200);

      expect(res.body.products).toHaveLength(1);
      const v = res.body.products[0].variants[0];
      expect(v.qtyOnHand).toBe(10);
      expect(v.avgCost).toBe(1000);
    });

    it('grandTotalValue equals sum of all product total values', async () => {
      const supplier = await createTestSupplier(prisma, tenantId, userId);
      const product1 = await createTestProduct(prisma, tenantId, userId);
      const product2 = await createTestProduct(prisma, tenantId, userId);

      await createAndPostPurchase(app, token, {
        supplierId: supplier.id,
        lines: [
          { variantId: product1.variants[0].id, quantity: 5, unitCost: 1000 },
          { variantId: product2.variants[0].id, quantity: 4, unitCost: 2000 },
        ],
        transactionDate: '2026-01-05',
      });

      const res = await request(app.getHttpServer())
        .get('/api/v1/reports/inventory-valuation?asOfDate=2026-02-20')
        .set(authHeader(token))
        .expect(200);

      expect(res.body.products).toHaveLength(2);
      const totalFromProducts = res.body.products.reduce((sum: number, p: any) => sum + p.productTotalValue, 0);
      expect(res.body.grandTotalValue).toBe(totalFromProducts);
      // product1: 5 * 1000 = 5000; product2: 4 * 2000 = 8000; grand = 13000
      expect(res.body.grandTotalValue).toBe(13000);
    });
  });
});
