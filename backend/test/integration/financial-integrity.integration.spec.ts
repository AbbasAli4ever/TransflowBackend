/**
 * Financial Integrity Tests
 *
 * These tests verify accounting invariants that MUST always hold, regardless of
 * which transactions have been created. They exist to prevent the class of bug
 * found in production where paidNow on a purchase created ledger entries but
 * no corresponding allocation record, causing open-documents to disagree with
 * the supplier statement.
 *
 * Each describe block tests one invariant category. All tests create their own
 * isolated data (no dependency on seed data).
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
  createAndPostSupplierPayment,
  createAndPostCustomerPayment,
  createAndPostSupplierReturn,
  createAndPostCustomerReturn,
} from '../helpers/test-factories';
import { PrismaClient } from '@prisma/client';

// ─── Test helpers ─────────────────────────────────────────────────────────────

/** Today's date as YYYY-MM-DD (UTC) */
const TODAY = new Date().toISOString().split('T')[0];

describe('Financial Integrity Invariants', () => {
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

  // ═══════════════════════════════════════════════════════════════════════════
  // 1. ALLOCATION COMPLETENESS
  //    Every purchase/sale posted with paidNow/receivedNow > 0 MUST have a
  //    self-allocation record. Without it, open-documents shows wrong outstanding.
  // ═══════════════════════════════════════════════════════════════════════════

  describe('1. Allocation completeness — paidNow/receivedNow creates allocation', () => {
    it('PURCHASE posted with paidNow creates a self-allocation record', async () => {
      const supplier = await createTestSupplier(prisma, tenantId, userId);
      const product = await createTestProduct(prisma, tenantId, userId);
      const account = await createTestPaymentAccount(prisma, tenantId, userId);
      const variantId = product.variants[0].id;

      await createAndPostPurchase(app, token, {
        supplierId: supplier.id,
        lines: [{ variantId, quantity: 10, unitCost: 1000 }],
        transactionDate: TODAY,
        paidNow: 3000,
        paymentAccountId: account.id,
      });

      // Verify: a self-allocation exists for this purchase
      const purchases = await prisma.transaction.findMany({
        where: { tenantId, type: 'PURCHASE', status: 'POSTED' },
      });
      expect(purchases).toHaveLength(1);
      const pur = purchases[0];

      const allocs = await prisma.allocation.findMany({
        where: {
          tenantId,
          paymentTransactionId: pur.id,
          appliesToTransactionId: pur.id,
        },
      });
      expect(allocs).toHaveLength(1);
      expect(allocs[0].amountApplied).toBe(3000);
    });

    it('PURCHASE posted with paidNow = 0 creates NO allocation', async () => {
      const supplier = await createTestSupplier(prisma, tenantId, userId);
      const product = await createTestProduct(prisma, tenantId, userId);

      await createAndPostPurchase(app, token, {
        supplierId: supplier.id,
        lines: [{ variantId: product.variants[0].id, quantity: 5, unitCost: 1000 }],
        transactionDate: TODAY,
      });

      const purchases = await prisma.transaction.findMany({
        where: { tenantId, type: 'PURCHASE', status: 'POSTED' },
      });
      const allocs = await prisma.allocation.findMany({
        where: { tenantId, appliesToTransactionId: purchases[0].id },
      });
      expect(allocs).toHaveLength(0);
    });

    it('SALE posted with receivedNow creates a self-allocation record', async () => {
      const supplier = await createTestSupplier(prisma, tenantId, userId);
      const customer = await createTestCustomer(prisma, tenantId, userId);
      const product = await createTestProduct(prisma, tenantId, userId);
      const account = await createTestPaymentAccount(prisma, tenantId, userId);
      const variantId = product.variants[0].id;

      // Need stock first
      await createAndPostPurchase(app, token, {
        supplierId: supplier.id,
        lines: [{ variantId, quantity: 20, unitCost: 500 }],
        transactionDate: TODAY,
      });

      await createAndPostSale(app, token, {
        customerId: customer.id,
        lines: [{ variantId, quantity: 5, unitPrice: 800 }],
        transactionDate: TODAY,
        receivedNow: 2000,
        paymentAccountId: account.id,
      });

      const sales = await prisma.transaction.findMany({
        where: { tenantId, type: 'SALE', status: 'POSTED' },
      });
      expect(sales).toHaveLength(1);

      const allocs = await prisma.allocation.findMany({
        where: {
          tenantId,
          paymentTransactionId: sales[0].id,
          appliesToTransactionId: sales[0].id,
        },
      });
      expect(allocs).toHaveLength(1);
      expect(allocs[0].amountApplied).toBe(2000);
    });

    it('SUPPLIER_PAYMENT creates allocation pointing to the correct invoice', async () => {
      const supplier = await createTestSupplier(prisma, tenantId, userId);
      const product = await createTestProduct(prisma, tenantId, userId);
      const account = await createTestPaymentAccount(prisma, tenantId, userId);
      const variantId = product.variants[0].id;

      const purRes = await createAndPostPurchase(app, token, {
        supplierId: supplier.id,
        lines: [{ variantId, quantity: 10, unitCost: 1000 }],
        transactionDate: TODAY,
      });

      await createAndPostSupplierPayment(app, token, {
        supplierId: supplier.id,
        amount: 4000,
        paymentAccountId: account.id,
        transactionDate: TODAY,
      });

      // Allocation must point to the purchase invoice, not the payment itself
      const allocs = await prisma.allocation.findMany({
        where: { tenantId, appliesToTransactionId: purRes.id },
      });
      expect(allocs).toHaveLength(1);
      expect(allocs[0].amountApplied).toBe(4000);

      const payment = await prisma.transaction.findFirst({
        where: { tenantId, type: 'SUPPLIER_PAYMENT' },
      });
      expect(allocs[0].paymentTransactionId).toBe(payment!.id);
      expect(allocs[0].appliesToTransactionId).toBe(purRes.id);
    });

    it('allocation amountApplied equals the actual paidNow amount (not inflated/deflated)', async () => {
      const supplier = await createTestSupplier(prisma, tenantId, userId);
      const product = await createTestProduct(prisma, tenantId, userId);
      const account = await createTestPaymentAccount(prisma, tenantId, userId);
      const variantId = product.variants[0].id;

      const PAID_NOW = 7500;
      await createAndPostPurchase(app, token, {
        supplierId: supplier.id,
        lines: [{ variantId, quantity: 10, unitCost: 1500 }],
        transactionDate: TODAY,
        paidNow: PAID_NOW,
        paymentAccountId: account.id,
      });

      const allocs = await prisma.allocation.findMany({ where: { tenantId } });
      expect(allocs).toHaveLength(1);
      expect(allocs[0].amountApplied).toBe(PAID_NOW);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 2. STATEMENT vs OPEN-DOCUMENTS CONSISTENCY
  //    The supplier/customer statement closing balance MUST equal the sum of
  //    open document outstanding amounts plus unapplied credits.
  //    This is the exact invariant that was violated in the bug found.
  // ═══════════════════════════════════════════════════════════════════════════

  describe('2. Statement ↔ Open-Documents balance consistency', () => {
    it('supplier: statement closing balance = sum of open invoices outstanding', async () => {
      const supplier = await createTestSupplier(prisma, tenantId, userId);
      const product = await createTestProduct(prisma, tenantId, userId);
      const account = await createTestPaymentAccount(prisma, tenantId, userId);
      const variantId = product.variants[0].id;

      // Purchase 1 — partial immediate payment (this is the exact bug scenario)
      await createAndPostPurchase(app, token, {
        supplierId: supplier.id,
        lines: [{ variantId, quantity: 10, unitCost: 1000 }],
        transactionDate: TODAY,
        paidNow: 3000,
        paymentAccountId: account.id,
      });

      // Purchase 2 — fully on credit
      await createAndPostPurchase(app, token, {
        supplierId: supplier.id,
        lines: [{ variantId, quantity: 5, unitCost: 800 }],
        transactionDate: TODAY,
      });

      // Separate payment against purchase 1
      await createAndPostSupplierPayment(app, token, {
        supplierId: supplier.id,
        amount: 2000,
        paymentAccountId: account.id,
        transactionDate: TODAY,
      });

      const [stmtRes, openRes] = await Promise.all([
        request(app.getHttpServer())
          .get(`/api/v1/reports/suppliers/${supplier.id}/statement?dateFrom=2020-01-01&dateTo=2030-12-31`)
          .set(authHeader(token)),
        request(app.getHttpServer())
          .get(`/api/v1/suppliers/${supplier.id}/open-documents`)
          .set(authHeader(token)),
      ]);

      expect(stmtRes.status).toBe(200);
      expect(openRes.status).toBe(200);

      const statementClosing: number = stmtRes.body.closingBalance;
      const openOutstanding: number = openRes.body.totalOutstanding;
      const unappliedCredits: number = openRes.body.unappliedCredits;
      const netOutstanding: number = openRes.body.netOutstanding;

      // Core invariant: statement balance = open docs net outstanding
      expect(netOutstanding).toBe(statementClosing);

      // Also verify each open document outstanding sums correctly
      const docSum = openRes.body.documents.reduce(
        (sum: number, d: any) => sum + d.outstanding,
        0,
      );
      expect(docSum).toBe(openOutstanding);
    });

    it('supplier: fully paid invoice disappears from open-documents', async () => {
      const supplier = await createTestSupplier(prisma, tenantId, userId);
      const product = await createTestProduct(prisma, tenantId, userId);
      const account = await createTestPaymentAccount(prisma, tenantId, userId);
      const variantId = product.variants[0].id;

      const INVOICE_AMOUNT = 5000;
      await createAndPostPurchase(app, token, {
        supplierId: supplier.id,
        lines: [{ variantId, quantity: 5, unitCost: 1000 }],
        transactionDate: TODAY,
      });

      // Pay the exact invoice amount
      await createAndPostSupplierPayment(app, token, {
        supplierId: supplier.id,
        amount: INVOICE_AMOUNT,
        paymentAccountId: account.id,
        transactionDate: TODAY,
      });

      const openRes = await request(app.getHttpServer())
        .get(`/api/v1/suppliers/${supplier.id}/open-documents`)
        .set(authHeader(token));

      expect(openRes.status).toBe(200);
      expect(openRes.body.documents).toHaveLength(0);
      expect(openRes.body.totalOutstanding).toBe(0);
      expect(openRes.body.netOutstanding).toBe(0);

      // Statement closing balance should also be 0
      const stmtRes = await request(app.getHttpServer())
        .get(`/api/v1/reports/suppliers/${supplier.id}/statement?dateFrom=2020-01-01&dateTo=2030-12-31`)
        .set(authHeader(token));
      expect(stmtRes.body.closingBalance).toBe(0);
    });

    it('supplier: paidNow on purchase reduces open-document outstanding correctly', async () => {
      // This is the EXACT scenario that was failing in production.
      // paidNow=3000 on a 10000 invoice must show outstanding=7000, not 10000.
      const supplier = await createTestSupplier(prisma, tenantId, userId);
      const product = await createTestProduct(prisma, tenantId, userId);
      const account = await createTestPaymentAccount(prisma, tenantId, userId);
      const variantId = product.variants[0].id;

      const TOTAL = 10000;
      const PAID_NOW = 3000;

      await createAndPostPurchase(app, token, {
        supplierId: supplier.id,
        lines: [{ variantId, quantity: 10, unitCost: 1000 }],
        transactionDate: TODAY,
        paidNow: PAID_NOW,
        paymentAccountId: account.id,
      });

      const openRes = await request(app.getHttpServer())
        .get(`/api/v1/suppliers/${supplier.id}/open-documents`)
        .set(authHeader(token));

      expect(openRes.status).toBe(200);
      expect(openRes.body.documents).toHaveLength(1);
      expect(openRes.body.documents[0].totalAmount).toBe(TOTAL);
      expect(openRes.body.documents[0].paidAmount).toBe(PAID_NOW);         // must be 3000, not 0
      expect(openRes.body.documents[0].outstanding).toBe(TOTAL - PAID_NOW); // must be 7000, not 10000
      expect(openRes.body.totalOutstanding).toBe(TOTAL - PAID_NOW);

      // And the statement must agree
      const stmtRes = await request(app.getHttpServer())
        .get(`/api/v1/reports/suppliers/${supplier.id}/statement?dateFrom=2020-01-01&dateTo=2030-12-31`)
        .set(authHeader(token));
      expect(stmtRes.body.closingBalance).toBe(TOTAL - PAID_NOW);
    });

    it('customer: statement closing balance = sum of open invoices outstanding', async () => {
      const supplier = await createTestSupplier(prisma, tenantId, userId);
      const customer = await createTestCustomer(prisma, tenantId, userId);
      const product = await createTestProduct(prisma, tenantId, userId);
      const account = await createTestPaymentAccount(prisma, tenantId, userId);
      const variantId = product.variants[0].id;

      // Stock up
      await createAndPostPurchase(app, token, {
        supplierId: supplier.id,
        lines: [{ variantId, quantity: 50, unitCost: 500 }],
        transactionDate: TODAY,
      });

      // Sale 1 — with partial receivedNow (the bug scenario for sales)
      await createAndPostSale(app, token, {
        customerId: customer.id,
        lines: [{ variantId, quantity: 10, unitPrice: 1000 }],
        transactionDate: TODAY,
        receivedNow: 3000,
        paymentAccountId: account.id,
      });

      // Sale 2 — fully on credit
      await createAndPostSale(app, token, {
        customerId: customer.id,
        lines: [{ variantId, quantity: 5, unitPrice: 1000 }],
        transactionDate: TODAY,
      });

      const [stmtRes, openRes] = await Promise.all([
        request(app.getHttpServer())
          .get(`/api/v1/reports/customers/${customer.id}/statement?dateFrom=2020-01-01&dateTo=2030-12-31`)
          .set(authHeader(token)),
        request(app.getHttpServer())
          .get(`/api/v1/customers/${customer.id}/open-documents`)
          .set(authHeader(token)),
      ]);

      expect(stmtRes.status).toBe(200);
      expect(openRes.status).toBe(200);

      expect(openRes.body.netOutstanding).toBe(stmtRes.body.closingBalance);
    });

    it('customer: receivedNow on sale reduces open-document outstanding correctly', async () => {
      const supplier = await createTestSupplier(prisma, tenantId, userId);
      const customer = await createTestCustomer(prisma, tenantId, userId);
      const product = await createTestProduct(prisma, tenantId, userId);
      const account = await createTestPaymentAccount(prisma, tenantId, userId);
      const variantId = product.variants[0].id;

      await createAndPostPurchase(app, token, {
        supplierId: supplier.id,
        lines: [{ variantId, quantity: 20, unitCost: 500 }],
        transactionDate: TODAY,
      });

      const TOTAL = 8000;
      const RECEIVED = 2500;

      await createAndPostSale(app, token, {
        customerId: customer.id,
        lines: [{ variantId, quantity: 8, unitPrice: 1000 }],
        transactionDate: TODAY,
        receivedNow: RECEIVED,
        paymentAccountId: account.id,
      });

      const openRes = await request(app.getHttpServer())
        .get(`/api/v1/customers/${customer.id}/open-documents`)
        .set(authHeader(token));

      expect(openRes.body.documents[0].paidAmount).toBe(RECEIVED);
      expect(openRes.body.documents[0].outstanding).toBe(TOTAL - RECEIVED);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 3. NO OVER-ALLOCATION
  //    The sum of allocations for any invoice must never exceed that invoice's
  //    total_amount. Over-allocating would show negative outstanding.
  // ═══════════════════════════════════════════════════════════════════════════

  describe('3. No over-allocation on any invoice', () => {
    it('SUPPLIER_PAYMENT cannot be manually over-allocated beyond outstanding', async () => {
      const supplier = await createTestSupplier(prisma, tenantId, userId);
      const product = await createTestProduct(prisma, tenantId, userId);
      const account = await createTestPaymentAccount(prisma, tenantId, userId);
      const variantId = product.variants[0].id;

      const purRes = await createAndPostPurchase(app, token, {
        supplierId: supplier.id,
        lines: [{ variantId, quantity: 5, unitCost: 1000 }],
        transactionDate: TODAY,
      });

      // Create payment draft
      const draftRes = await request(app.getHttpServer())
        .post('/api/v1/transactions/supplier-payments/draft')
        .set(authHeader(token))
        .send({
          supplierId: supplier.id,
          amount: 6000,
          paymentAccountId: account.id,
          transactionDate: TODAY,
          idempotencyKey: uuid(),
        });
      expect(draftRes.status).toBe(201);

      // Try to manually allocate MORE than the invoice total (5000)
      const postRes = await request(app.getHttpServer())
        .post(`/api/v1/transactions/${draftRes.body.id}/post`)
        .set(authHeader(token))
        .send({
          idempotencyKey: uuid(),
          allocations: [{ transactionId: purRes.id, amount: 6000 }], // invoice is only 5000
        });

      // Must be rejected
      expect([400, 422]).toContain(postRes.status);
    });

    it('after paidNow + separate payment, total allocated never exceeds invoice total', async () => {
      const supplier = await createTestSupplier(prisma, tenantId, userId);
      const product = await createTestProduct(prisma, tenantId, userId);
      const account = await createTestPaymentAccount(prisma, tenantId, userId);
      const variantId = product.variants[0].id;

      const INVOICE_TOTAL = 10000;
      const PAID_NOW = 4000;
      const REMAINING = INVOICE_TOTAL - PAID_NOW; // 6000

      const purRes = await createAndPostPurchase(app, token, {
        supplierId: supplier.id,
        lines: [{ variantId, quantity: 10, unitCost: 1000 }],
        transactionDate: TODAY,
        paidNow: PAID_NOW,
        paymentAccountId: account.id,
      });

      // Pay remaining exactly
      await createAndPostSupplierPayment(app, token, {
        supplierId: supplier.id,
        amount: REMAINING,
        paymentAccountId: account.id,
        transactionDate: TODAY,
      });

      // Total allocations for this invoice = paidNow + payment = 10000
      const allocs = await prisma.allocation.findMany({
        where: { tenantId, appliesToTransactionId: purRes.id },
      });
      const totalAllocated = allocs.reduce((s, a) => s + a.amountApplied, 0);
      expect(totalAllocated).toBeLessThanOrEqual(INVOICE_TOTAL);
      expect(totalAllocated).toBe(INVOICE_TOTAL);

      // Invoice should no longer appear in open-documents
      const openRes = await request(app.getHttpServer())
        .get(`/api/v1/suppliers/${supplier.id}/open-documents`)
        .set(authHeader(token));
      expect(openRes.body.documents).toHaveLength(0);
    });

    it('DB invariant: no invoice has total_allocated > total_amount', async () => {
      const supplier = await createTestSupplier(prisma, tenantId, userId);
      const product = await createTestProduct(prisma, tenantId, userId);
      const account = await createTestPaymentAccount(prisma, tenantId, userId);
      const variantId = product.variants[0].id;

      // Create multiple purchases with partial payments
      for (let i = 0; i < 3; i++) {
        await createAndPostPurchase(app, token, {
          supplierId: supplier.id,
          lines: [{ variantId, quantity: 5, unitCost: 1000 }],
          transactionDate: TODAY,
          paidNow: 2000,
          paymentAccountId: account.id,
        });
      }

      // Raw DB check: no invoice over-allocated
      const overAllocated = await prisma.$queryRaw<Array<{ id: string; over: number }>>`
        SELECT t.id,
               t.total_amount - COALESCE(SUM(a.amount_applied), 0) AS over
        FROM transactions t
        LEFT JOIN allocations a ON a.applies_to_transaction_id = t.id AND a.tenant_id = ${tenantId}::uuid
        WHERE t.tenant_id = ${tenantId}::uuid
          AND t.status = 'POSTED'
        GROUP BY t.id, t.total_amount
        HAVING t.total_amount - COALESCE(SUM(a.amount_applied), 0) < 0
      `;
      expect(overAllocated).toHaveLength(0);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 4. DOUBLE-ENTRY BALANCE INTEGRITY
  //    AP_INCREASE - AP_DECREASE must equal the supplier balance from the
  //    balance endpoint. Same for AR. This proves ledger entries are consistent.
  // ═══════════════════════════════════════════════════════════════════════════

  describe('4. Double-entry AP/AR balance integrity', () => {
    it('supplier: ledger AP sum matches balance endpoint response', async () => {
      const supplier = await createTestSupplier(prisma, tenantId, userId);
      const product = await createTestProduct(prisma, tenantId, userId);
      const account = await createTestPaymentAccount(prisma, tenantId, userId);
      const variantId = product.variants[0].id;

      await createAndPostPurchase(app, token, {
        supplierId: supplier.id,
        lines: [{ variantId, quantity: 10, unitCost: 1000 }],
        transactionDate: TODAY,
        paidNow: 3000,
        paymentAccountId: account.id,
      });

      await createAndPostSupplierPayment(app, token, {
        supplierId: supplier.id,
        amount: 2000,
        paymentAccountId: account.id,
        transactionDate: TODAY,
      });

      // Direct DB calculation
      const ledgerResult = await prisma.$queryRaw<[{ net_ap: bigint }]>`
        SELECT
          COALESCE(SUM(CASE WHEN le.entry_type = 'AP_INCREASE' THEN le.amount ELSE -le.amount END), 0)::bigint AS net_ap
        FROM ledger_entries le
        JOIN transactions t ON t.id = le.transaction_id
        WHERE le.tenant_id = ${tenantId}::uuid
          AND le.supplier_id = ${supplier.id}::uuid
          AND t.status = 'POSTED'
      `;
      const dbBalance = Number(ledgerResult[0].net_ap);

      // Balance endpoint
      const balRes = await request(app.getHttpServer())
        .get(`/api/v1/reports/suppliers/${supplier.id}/balance`)
        .set(authHeader(token));
      expect(balRes.status).toBe(200);

      expect(balRes.body.breakdown.netPayable).toBe(dbBalance);
    });

    it('customer: ledger AR sum matches balance endpoint response', async () => {
      const supplier = await createTestSupplier(prisma, tenantId, userId);
      const customer = await createTestCustomer(prisma, tenantId, userId);
      const product = await createTestProduct(prisma, tenantId, userId);
      const account = await createTestPaymentAccount(prisma, tenantId, userId);
      const variantId = product.variants[0].id;

      await createAndPostPurchase(app, token, {
        supplierId: supplier.id,
        lines: [{ variantId, quantity: 20, unitCost: 500 }],
        transactionDate: TODAY,
      });

      await createAndPostSale(app, token, {
        customerId: customer.id,
        lines: [{ variantId, quantity: 10, unitPrice: 900 }],
        transactionDate: TODAY,
        receivedNow: 2000,
        paymentAccountId: account.id,
      });

      const ledgerResult = await prisma.$queryRaw<[{ net_ar: bigint }]>`
        SELECT
          COALESCE(SUM(CASE WHEN le.entry_type = 'AR_INCREASE' THEN le.amount ELSE -le.amount END), 0)::bigint AS net_ar
        FROM ledger_entries le
        JOIN transactions t ON t.id = le.transaction_id
        WHERE le.tenant_id = ${tenantId}::uuid
          AND le.customer_id = ${customer.id}::uuid
          AND t.status = 'POSTED'
      `;
      const dbBalance = Number(ledgerResult[0].net_ar);

      const balRes = await request(app.getHttpServer())
        .get(`/api/v1/reports/customers/${customer.id}/balance`)
        .set(authHeader(token));
      expect(balRes.status).toBe(200);

      expect(balRes.body.breakdown.netReceivable).toBe(dbBalance);
    });

    it('every POSTED transaction creates the correct AP/AR ledger entries', async () => {
      const supplier = await createTestSupplier(prisma, tenantId, userId);
      const product = await createTestProduct(prisma, tenantId, userId);
      const account = await createTestPaymentAccount(prisma, tenantId, userId);
      const variantId = product.variants[0].id;

      await createAndPostPurchase(app, token, {
        supplierId: supplier.id,
        lines: [{ variantId, quantity: 5, unitCost: 2000 }],
        transactionDate: TODAY,
        paidNow: 3000,
        paymentAccountId: account.id,
      });

      const txn = await prisma.transaction.findFirst({
        where: { tenantId, type: 'PURCHASE', status: 'POSTED' },
      });

      const entries = await prisma.ledgerEntry.findMany({
        where: { transactionId: txn!.id },
      });

      const apIncrease = entries.filter((e) => e.entryType === 'AP_INCREASE');
      const apDecrease = entries.filter((e) => e.entryType === 'AP_DECREASE');

      // Must have exactly one AP_INCREASE for full invoice amount
      expect(apIncrease).toHaveLength(1);
      expect(apIncrease[0].amount).toBe(10000); // 5 × 2000

      // Must have exactly one AP_DECREASE for paidNow
      expect(apDecrease).toHaveLength(1);
      expect(apDecrease[0].amount).toBe(3000);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 5. INVENTORY MOVEMENT INTEGRITY
  //    Correct movement types, correct quantities, transactionLineId populated.
  // ═══════════════════════════════════════════════════════════════════════════

  describe('5. Inventory movement integrity', () => {
    it('PURCHASE creates PURCHASE_IN movements with correct quantity and cost', async () => {
      const supplier = await createTestSupplier(prisma, tenantId, userId);
      const product = await createTestProduct(prisma, tenantId, userId);
      const variantId = product.variants[0].id;

      await createAndPostPurchase(app, token, {
        supplierId: supplier.id,
        lines: [{ variantId, quantity: 15, unitCost: 800 }],
        transactionDate: TODAY,
      });

      const movements = await prisma.inventoryMovement.findMany({
        where: { tenantId, variantId },
      });
      expect(movements).toHaveLength(1);
      expect(movements[0].movementType).toBe('PURCHASE_IN');
      expect(movements[0].quantity).toBe(15);
      expect(movements[0].unitCostAtTime).toBe(800);
    });

    it('SALE creates SALE_OUT movement with unitCostAtTime = variant avgCost (not selling price)', async () => {
      const supplier = await createTestSupplier(prisma, tenantId, userId);
      const customer = await createTestCustomer(prisma, tenantId, userId);
      const product = await createTestProduct(prisma, tenantId, userId);
      const variantId = product.variants[0].id;

      const BUY_COST = 600;
      const SELL_PRICE = 1200;

      await createAndPostPurchase(app, token, {
        supplierId: supplier.id,
        lines: [{ variantId, quantity: 20, unitCost: BUY_COST }],
        transactionDate: TODAY,
      });

      await createAndPostSale(app, token, {
        customerId: customer.id,
        lines: [{ variantId, quantity: 5, unitPrice: SELL_PRICE }],
        transactionDate: TODAY,
      });

      const saleMovement = await prisma.inventoryMovement.findFirst({
        where: { tenantId, variantId, movementType: 'SALE_OUT' },
      });

      // CRITICAL: unitCostAtTime must be the COST (avgCost), NOT the selling price
      expect(saleMovement!.unitCostAtTime).toBe(BUY_COST);
      expect(saleMovement!.unitCostAtTime).not.toBe(SELL_PRICE);
    });

    it('SALE_OUT unitCostAtTime equals the variant avgCost at time of posting', async () => {
      const supplier = await createTestSupplier(prisma, tenantId, userId);
      const customer = await createTestCustomer(prisma, tenantId, userId);
      const product = await createTestProduct(prisma, tenantId, userId);
      const variantId = product.variants[0].id;

      // Purchase 1: 10 units @ 1000 → avgCost=1000
      await createAndPostPurchase(app, token, {
        supplierId: supplier.id,
        lines: [{ variantId, quantity: 10, unitCost: 1000 }],
        transactionDate: TODAY,
      });
      // Purchase 2: 10 units @ 2000 → avgCost=(10*1000+10*2000)/20=1500
      await createAndPostPurchase(app, token, {
        supplierId: supplier.id,
        lines: [{ variantId, quantity: 10, unitCost: 2000 }],
        transactionDate: TODAY,
      });

      // Now sell 5 — COGS should be 5 × 1500 = 7500
      await createAndPostSale(app, token, {
        customerId: customer.id,
        lines: [{ variantId, quantity: 5, unitPrice: 3000 }],
        transactionDate: TODAY,
      });

      const saleMovement = await prisma.inventoryMovement.findFirst({
        where: { tenantId, variantId, movementType: 'SALE_OUT' },
      });

      // avgCost after two purchases = round((10*1000 + 10*2000)/20) = 1500
      expect(saleMovement!.unitCostAtTime).toBe(1500);
    });

    it('PURCHASE_IN movement transactionLineId links to the correct transaction line', async () => {
      const supplier = await createTestSupplier(prisma, tenantId, userId);
      const product = await createTestProduct(prisma, tenantId, userId);
      const variantId = product.variants[0].id;

      await createAndPostPurchase(app, token, {
        supplierId: supplier.id,
        lines: [{ variantId, quantity: 10, unitCost: 500 }],
        transactionDate: TODAY,
      });

      const txn = await prisma.transaction.findFirst({
        where: { tenantId, type: 'PURCHASE', status: 'POSTED' },
      });
      const lines = await prisma.transactionLine.findMany({
        where: { transactionId: txn!.id },
      });
      const movements = await prisma.inventoryMovement.findMany({
        where: { tenantId, variantId },
      });

      expect(movements[0].transactionLineId).toBe(lines[0].id);
    });

    it('SUPPLIER_RETURN creates SUPPLIER_RETURN_OUT not PURCHASE_IN', async () => {
      const supplier = await createTestSupplier(prisma, tenantId, userId);
      const product = await createTestProduct(prisma, tenantId, userId);
      const variantId = product.variants[0].id;

      const purRes = await createAndPostPurchase(app, token, {
        supplierId: supplier.id,
        lines: [{ variantId, quantity: 10, unitCost: 1000 }],
        transactionDate: TODAY,
      });

      const purLines = await prisma.transactionLine.findMany({
        where: { transactionId: purRes.id },
      });

      await createAndPostSupplierReturn(app, token, {
        supplierId: supplier.id,
        lines: [{ sourceTransactionLineId: purLines[0].id, quantity: 3 }],
        transactionDate: TODAY,
      });

      const returnMovement = await prisma.inventoryMovement.findFirst({
        where: { tenantId, movementType: 'SUPPLIER_RETURN_OUT' },
      });
      expect(returnMovement).not.toBeNull();
      expect(returnMovement!.quantity).toBe(3);
    });

    it('stock calculation: net stock = PURCHASE_IN - SALE_OUT - SUPPLIER_RETURN_OUT', async () => {
      const supplier = await createTestSupplier(prisma, tenantId, userId);
      const customer = await createTestCustomer(prisma, tenantId, userId);
      const product = await createTestProduct(prisma, tenantId, userId);
      const variantId = product.variants[0].id;

      const purRes = await createAndPostPurchase(app, token, {
        supplierId: supplier.id,
        lines: [{ variantId, quantity: 20, unitCost: 500 }],
        transactionDate: TODAY,
      });

      await createAndPostSale(app, token, {
        customerId: customer.id,
        lines: [{ variantId, quantity: 5, unitPrice: 800 }],
        transactionDate: TODAY,
      });

      const purLines = await prisma.transactionLine.findMany({
        where: { transactionId: purRes.id },
      });
      await createAndPostSupplierReturn(app, token, {
        supplierId: supplier.id,
        lines: [{ sourceTransactionLineId: purLines[0].id, quantity: 3 }],
        transactionDate: TODAY,
      });

      // Expected: 20 - 5 - 3 = 12
      const stockRes = await request(app.getHttpServer())
        .get(`/api/v1/products/${product.id}/stock`)
        .set(authHeader(token));
      expect(stockRes.status).toBe(200);
      expect(stockRes.body.totalStock).toBe(12);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 6. WEIGHTED AVERAGE COST INTEGRITY
  //    avgCost on product_variants must match the weighted average formula.
  //    Customer/supplier returns must NOT change avgCost.
  // ═══════════════════════════════════════════════════════════════════════════

  describe('6. avgCost weighted average integrity', () => {
    it('first purchase sets avgCost = unitCost exactly', async () => {
      const supplier = await createTestSupplier(prisma, tenantId, userId);
      const product = await createTestProduct(prisma, tenantId, userId);
      const variantId = product.variants[0].id;

      await createAndPostPurchase(app, token, {
        supplierId: supplier.id,
        lines: [{ variantId, quantity: 10, unitCost: 1500 }],
        transactionDate: TODAY,
      });

      const variant = await prisma.productVariant.findUnique({ where: { id: variantId } });
      expect(variant!.avgCost).toBe(1500);
    });

    it('second purchase blends avgCost: (10×1000 + 10×2000)/20 = 1500', async () => {
      const supplier = await createTestSupplier(prisma, tenantId, userId);
      const product = await createTestProduct(prisma, tenantId, userId);
      const variantId = product.variants[0].id;

      await createAndPostPurchase(app, token, {
        supplierId: supplier.id,
        lines: [{ variantId, quantity: 10, unitCost: 1000 }],
        transactionDate: TODAY,
      });
      await createAndPostPurchase(app, token, {
        supplierId: supplier.id,
        lines: [{ variantId, quantity: 10, unitCost: 2000 }],
        transactionDate: TODAY,
      });

      const variant = await prisma.productVariant.findUnique({ where: { id: variantId } });
      expect(variant!.avgCost).toBe(1500);
    });

    it('sale does NOT change avgCost', async () => {
      const supplier = await createTestSupplier(prisma, tenantId, userId);
      const customer = await createTestCustomer(prisma, tenantId, userId);
      const product = await createTestProduct(prisma, tenantId, userId);
      const variantId = product.variants[0].id;

      await createAndPostPurchase(app, token, {
        supplierId: supplier.id,
        lines: [{ variantId, quantity: 10, unitCost: 1200 }],
        transactionDate: TODAY,
      });

      const beforeSale = await prisma.productVariant.findUnique({ where: { id: variantId } });

      await createAndPostSale(app, token, {
        customerId: customer.id,
        lines: [{ variantId, quantity: 3, unitPrice: 2000 }],
        transactionDate: TODAY,
      });

      const afterSale = await prisma.productVariant.findUnique({ where: { id: variantId } });
      expect(afterSale!.avgCost).toBe(beforeSale!.avgCost);
    });

    it('customer return does NOT change avgCost', async () => {
      const supplier = await createTestSupplier(prisma, tenantId, userId);
      const customer = await createTestCustomer(prisma, tenantId, userId);
      const product = await createTestProduct(prisma, tenantId, userId);
      const variantId = product.variants[0].id;

      await createAndPostPurchase(app, token, {
        supplierId: supplier.id,
        lines: [{ variantId, quantity: 20, unitCost: 1000 }],
        transactionDate: TODAY,
      });

      const salRes = await createAndPostSale(app, token, {
        customerId: customer.id,
        lines: [{ variantId, quantity: 10, unitPrice: 1800 }],
        transactionDate: TODAY,
      });

      const beforeReturn = await prisma.productVariant.findUnique({ where: { id: variantId } });

      const salLines = await prisma.transactionLine.findMany({
        where: { transactionId: salRes.id },
      });
      await createAndPostCustomerReturn(app, token, {
        customerId: customer.id,
        lines: [{ sourceTransactionLineId: salLines[0].id, quantity: 3 }],
        transactionDate: TODAY,
      });

      const afterReturn = await prisma.productVariant.findUnique({ where: { id: variantId } });
      expect(afterReturn!.avgCost).toBe(beforeReturn!.avgCost);
    });

    it('supplier return does NOT change avgCost', async () => {
      const supplier = await createTestSupplier(prisma, tenantId, userId);
      const product = await createTestProduct(prisma, tenantId, userId);
      const variantId = product.variants[0].id;

      const purRes = await createAndPostPurchase(app, token, {
        supplierId: supplier.id,
        lines: [{ variantId, quantity: 10, unitCost: 1500 }],
        transactionDate: TODAY,
      });

      const beforeReturn = await prisma.productVariant.findUnique({ where: { id: variantId } });

      const purLines = await prisma.transactionLine.findMany({
        where: { transactionId: purRes.id },
      });
      await createAndPostSupplierReturn(app, token, {
        supplierId: supplier.id,
        lines: [{ sourceTransactionLineId: purLines[0].id, quantity: 4 }],
        transactionDate: TODAY,
      });

      const afterReturn = await prisma.productVariant.findUnique({ where: { id: variantId } });
      expect(afterReturn!.avgCost).toBe(beforeReturn!.avgCost);
    });

    it('P&L COGS = SALE_OUT quantity × avgCost at time of sale', async () => {
      const supplier = await createTestSupplier(prisma, tenantId, userId);
      const customer = await createTestCustomer(prisma, tenantId, userId);
      const product = await createTestProduct(prisma, tenantId, userId);
      const variantId = product.variants[0].id;

      // Buy 10 @ 1000, then 10 @ 2000 → avgCost = 1500
      await createAndPostPurchase(app, token, {
        supplierId: supplier.id,
        lines: [{ variantId, quantity: 10, unitCost: 1000 }],
        transactionDate: TODAY,
      });
      await createAndPostPurchase(app, token, {
        supplierId: supplier.id,
        lines: [{ variantId, quantity: 10, unitCost: 2000 }],
        transactionDate: TODAY,
      });

      // Sell 5 → COGS = 5 × 1500 = 7500
      await createAndPostSale(app, token, {
        customerId: customer.id,
        lines: [{ variantId, quantity: 5, unitPrice: 3000 }],
        transactionDate: TODAY,
      });

      const plRes = await request(app.getHttpServer())
        .get(`/api/v1/reports/profit-loss?dateFrom=2020-01-01&dateTo=2030-12-31`)
        .set(authHeader(token));

      expect(plRes.status).toBe(200);
      expect(plRes.body.costOfGoodsSold).toBe(7500); // 5 × 1500
      expect(plRes.body.sales).toBe(15000);          // 5 × 3000
      expect(plRes.body.grossProfit).toBe(7500);      // 15000 - 7500
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 7. PAYMENT ACCOUNT BALANCE INTEGRITY
  //    opening_balance + total_IN - total_OUT = current balance.
  //    Internal transfers create exactly 2 payment entries with same group ID.
  // ═══════════════════════════════════════════════════════════════════════════

  describe('7. Payment account balance integrity', () => {
    it('payment account balance = openingBalance + totalIn - totalOut', async () => {
      const supplier = await createTestSupplier(prisma, tenantId, userId);
      const product = await createTestProduct(prisma, tenantId, userId);
      const account = await createTestPaymentAccount(prisma, tenantId, userId, {
        openingBalance: 50000,
      });
      const variantId = product.variants[0].id;

      // Purchase: money out
      await createAndPostPurchase(app, token, {
        supplierId: supplier.id,
        lines: [{ variantId, quantity: 10, unitCost: 1000 }],
        transactionDate: TODAY,
        paidNow: 5000,
        paymentAccountId: account.id,
      });

      const balRes = await request(app.getHttpServer())
        .get(`/api/v1/payment-accounts/${account.id}/balance`)
        .set(authHeader(token));

      expect(balRes.status).toBe(200);
      expect(balRes.body.openingBalance).toBe(50000);
      expect(balRes.body.totalOut).toBe(5000);
      expect(balRes.body.totalIn).toBe(0);
      expect(balRes.body.currentBalance).toBe(45000); // 50000 - 5000
    });

    it('internal transfer creates exactly 2 payment entries (OUT + IN) with same transferGroupId', async () => {
      const accountA = await createTestPaymentAccount(prisma, tenantId, userId, { openingBalance: 100000 });
      const accountB = await createTestPaymentAccount(prisma, tenantId, userId, { openingBalance: 0 });

      const draftRes = await request(app.getHttpServer())
        .post('/api/v1/transactions/internal-transfers/draft')
        .set(authHeader(token))
        .send({
          fromPaymentAccountId: accountA.id,
          toPaymentAccountId: accountB.id,
          amount: 20000,
          transactionDate: TODAY,
          idempotencyKey: uuid(),
        });
      expect(draftRes.status).toBe(201);

      await request(app.getHttpServer())
        .post(`/api/v1/transactions/${draftRes.body.id}/post`)
        .set(authHeader(token))
        .send({ idempotencyKey: uuid() });

      const entries = await prisma.paymentEntry.findMany({
        where: { transactionId: draftRes.body.id },
      });

      expect(entries).toHaveLength(2);
      const out = entries.find((e) => e.direction === 'OUT');
      const inn = entries.find((e) => e.direction === 'IN');
      expect(out).toBeDefined();
      expect(inn).toBeDefined();
      expect(out!.amount).toBe(20000);
      expect(inn!.amount).toBe(20000);
      expect(out!.transferGroupId).toBe(inn!.transferGroupId);
      expect(out!.transferGroupId).not.toBeNull();
    });

    it('internal transfer deducts from source and adds to destination', async () => {
      const accountA = await createTestPaymentAccount(prisma, tenantId, userId, { openingBalance: 80000 });
      const accountB = await createTestPaymentAccount(prisma, tenantId, userId, { openingBalance: 10000 });

      const draftRes = await request(app.getHttpServer())
        .post('/api/v1/transactions/internal-transfers/draft')
        .set(authHeader(token))
        .send({
          fromPaymentAccountId: accountA.id,
          toPaymentAccountId: accountB.id,
          amount: 30000,
          transactionDate: TODAY,
          idempotencyKey: uuid(),
        });
      await request(app.getHttpServer())
        .post(`/api/v1/transactions/${draftRes.body.id}/post`)
        .set(authHeader(token))
        .send({ idempotencyKey: uuid() });

      const [balA, balB] = await Promise.all([
        request(app.getHttpServer()).get(`/api/v1/payment-accounts/${accountA.id}/balance`).set(authHeader(token)),
        request(app.getHttpServer()).get(`/api/v1/payment-accounts/${accountB.id}/balance`).set(authHeader(token)),
      ]);

      expect(balA.body.currentBalance).toBe(50000);  // 80000 - 30000
      expect(balB.body.currentBalance).toBe(40000);  // 10000 + 30000
    });

    it('payment account list _computed.currentBalance matches per-account balance endpoint', async () => {
      const account = await createTestPaymentAccount(prisma, tenantId, userId, { openingBalance: 20000 });
      const supplier = await createTestSupplier(prisma, tenantId, userId);
      const product = await createTestProduct(prisma, tenantId, userId);
      const variantId = product.variants[0].id;

      await createAndPostPurchase(app, token, {
        supplierId: supplier.id,
        lines: [{ variantId, quantity: 5, unitCost: 1000 }],
        transactionDate: TODAY,
        paidNow: 4000,
        paymentAccountId: account.id,
      });

      const [listRes, balRes] = await Promise.all([
        request(app.getHttpServer()).get('/api/v1/payment-accounts').set(authHeader(token)),
        request(app.getHttpServer()).get(`/api/v1/payment-accounts/${account.id}/balance`).set(authHeader(token)),
      ]);

      const listAccount = listRes.body.data.find((a: any) => a.id === account.id);
      expect(listAccount._computed.currentBalance).toBe(balRes.body.currentBalance);
      expect(listAccount._computed.currentBalance).toBe(16000); // 20000 - 4000
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 8. DOCUMENT NUMBER INTEGRITY
  //    Document numbers must be unique per tenant. No gaps between posted
  //    transactions of the same type.
  // ═══════════════════════════════════════════════════════════════════════════

  describe('8. Document number integrity', () => {
    it('sequential purchases get sequential document numbers', async () => {
      const supplier = await createTestSupplier(prisma, tenantId, userId);
      const product = await createTestProduct(prisma, tenantId, userId);
      const variantId = product.variants[0].id;

      const [p1, p2, p3] = await Promise.all([
        createAndPostPurchase(app, token, { supplierId: supplier.id, lines: [{ variantId, quantity: 1, unitCost: 100 }], transactionDate: TODAY }),
        createAndPostPurchase(app, token, { supplierId: supplier.id, lines: [{ variantId, quantity: 1, unitCost: 100 }], transactionDate: TODAY }),
        createAndPostPurchase(app, token, { supplierId: supplier.id, lines: [{ variantId, quantity: 1, unitCost: 100 }], transactionDate: TODAY }),
      ]);

      // Extract sequence numbers
      const seqs = [p1, p2, p3]
        .map((p) => parseInt(p.documentNumber.split('-').pop()!, 10))
        .sort((a, b) => a - b);

      expect(seqs[0] + 1).toBe(seqs[1]);
      expect(seqs[1] + 1).toBe(seqs[2]);
    });

    it('document numbers are unique across all POSTED transactions per tenant', async () => {
      const supplier = await createTestSupplier(prisma, tenantId, userId);
      const product = await createTestProduct(prisma, tenantId, userId);
      const variantId = product.variants[0].id;

      await createAndPostPurchase(app, token, { supplierId: supplier.id, lines: [{ variantId, quantity: 1, unitCost: 100 }], transactionDate: TODAY });
      await createAndPostPurchase(app, token, { supplierId: supplier.id, lines: [{ variantId, quantity: 1, unitCost: 100 }], transactionDate: TODAY });
      await createAndPostPurchase(app, token, { supplierId: supplier.id, lines: [{ variantId, quantity: 1, unitCost: 100 }], transactionDate: TODAY });

      const txns = await prisma.transaction.findMany({
        where: { tenantId, status: 'POSTED', type: 'PURCHASE' },
        select: { documentNumber: true },
      });

      const docNums = txns.map((t) => t.documentNumber).filter(Boolean) as string[];
      const unique = new Set(docNums);
      expect(unique.size).toBe(docNums.length);
    });

    it('DRAFT transactions have null documentNumber', async () => {
      const supplier = await createTestSupplier(prisma, tenantId, userId);
      const product = await createTestProduct(prisma, tenantId, userId);
      const variantId = product.variants[0].id;

      const draftRes = await request(app.getHttpServer())
        .post('/api/v1/transactions/purchases/draft')
        .set(authHeader(token))
        .send({
          supplierId: supplier.id,
          lines: [{ variantId, quantity: 5, unitCost: 1000 }],
          transactionDate: TODAY,
          idempotencyKey: uuid(),
        });

      expect(draftRes.status).toBe(201);
      expect(draftRes.body.documentNumber).toBeNull();
    });

    it('POSTED transactions always have a non-null documentNumber', async () => {
      const supplier = await createTestSupplier(prisma, tenantId, userId);
      const product = await createTestProduct(prisma, tenantId, userId);
      const variantId = product.variants[0].id;

      const posted = await createAndPostPurchase(app, token, {
        supplierId: supplier.id,
        lines: [{ variantId, quantity: 5, unitCost: 1000 }],
        transactionDate: TODAY,
      });

      expect(posted.documentNumber).not.toBeNull();
      expect(posted.documentNumber).toMatch(/^PUR-\d{4}-\d{4}$/);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 9. RETURNABLE LINES CONSISTENCY
  //    alreadyReturned + returnableQty must always equal originalQty.
  //    Cannot return more than originalQty across multiple return drafts.
  // ═══════════════════════════════════════════════════════════════════════════

  describe('9. Returnable lines consistency', () => {
    it('before any returns: alreadyReturned=0, returnableQty=originalQty', async () => {
      const supplier = await createTestSupplier(prisma, tenantId, userId);
      const product = await createTestProduct(prisma, tenantId, userId);
      const variantId = product.variants[0].id;

      const purRes = await createAndPostPurchase(app, token, {
        supplierId: supplier.id,
        lines: [{ variantId, quantity: 10, unitCost: 1000 }],
        transactionDate: TODAY,
      });

      const retRes = await request(app.getHttpServer())
        .get(`/api/v1/transactions/${purRes.id}/returnable-lines`)
        .set(authHeader(token));

      expect(retRes.status).toBe(200);
      expect(retRes.body.lines).toHaveLength(1);
      const line = retRes.body.lines[0];
      expect(line.originalQty).toBe(10);
      expect(line.alreadyReturned).toBe(0);
      expect(line.returnableQty).toBe(10);
      expect(line.alreadyReturned + line.returnableQty).toBe(line.originalQty);
    });

    it('after partial return: alreadyReturned + returnableQty = originalQty', async () => {
      const supplier = await createTestSupplier(prisma, tenantId, userId);
      const product = await createTestProduct(prisma, tenantId, userId);
      const variantId = product.variants[0].id;

      const purRes = await createAndPostPurchase(app, token, {
        supplierId: supplier.id,
        lines: [{ variantId, quantity: 10, unitCost: 1000 }],
        transactionDate: TODAY,
      });

      const purLines = await prisma.transactionLine.findMany({
        where: { transactionId: purRes.id },
      });

      await createAndPostSupplierReturn(app, token, {
        supplierId: supplier.id,
        lines: [{ sourceTransactionLineId: purLines[0].id, quantity: 4 }],
        transactionDate: TODAY,
      });

      const retRes = await request(app.getHttpServer())
        .get(`/api/v1/transactions/${purRes.id}/returnable-lines`)
        .set(authHeader(token));

      const line = retRes.body.lines[0];
      expect(line.alreadyReturned).toBe(4);
      expect(line.returnableQty).toBe(6);
      expect(line.alreadyReturned + line.returnableQty).toBe(line.originalQty);
    });

    it('cannot return more than the returnable quantity in a draft', async () => {
      const supplier = await createTestSupplier(prisma, tenantId, userId);
      const product = await createTestProduct(prisma, tenantId, userId);
      const variantId = product.variants[0].id;

      const purRes = await createAndPostPurchase(app, token, {
        supplierId: supplier.id,
        lines: [{ variantId, quantity: 5, unitCost: 1000 }],
        transactionDate: TODAY,
      });

      const purLines = await prisma.transactionLine.findMany({
        where: { transactionId: purRes.id },
      });

      // Attempt to return 6 from a purchase of 5 — must fail
      const draftRes = await request(app.getHttpServer())
        .post('/api/v1/transactions/supplier-returns/draft')
        .set(authHeader(token))
        .send({
          supplierId: supplier.id,
          transactionDate: TODAY,
          lines: [{ sourceTransactionLineId: purLines[0].id, quantity: 6 }],
          idempotencyKey: uuid(),
        });

      expect([400, 422]).toContain(draftRes.status);
    });

    it('second return after partial return correctly limits remaining returnableQty', async () => {
      const supplier = await createTestSupplier(prisma, tenantId, userId);
      const product = await createTestProduct(prisma, tenantId, userId);
      const variantId = product.variants[0].id;

      const purRes = await createAndPostPurchase(app, token, {
        supplierId: supplier.id,
        lines: [{ variantId, quantity: 10, unitCost: 1000 }],
        transactionDate: TODAY,
      });

      const purLines = await prisma.transactionLine.findMany({
        where: { transactionId: purRes.id },
      });

      // Return 4 first
      await createAndPostSupplierReturn(app, token, {
        supplierId: supplier.id,
        lines: [{ sourceTransactionLineId: purLines[0].id, quantity: 4 }],
        transactionDate: TODAY,
      });

      // Return 6 more (exactly remaining) — must succeed
      const secondReturn = await createAndPostSupplierReturn(app, token, {
        supplierId: supplier.id,
        lines: [{ sourceTransactionLineId: purLines[0].id, quantity: 6 }],
        transactionDate: TODAY,
      });
      expect(secondReturn.status ?? 200).toBe(200);

      // Try to return 1 more — must fail (0 left)
      const overReturn = await request(app.getHttpServer())
        .post('/api/v1/transactions/supplier-returns/draft')
        .set(authHeader(token))
        .send({
          supplierId: supplier.id,
          transactionDate: TODAY,
          lines: [{ sourceTransactionLineId: purLines[0].id, quantity: 1 }],
          idempotencyKey: uuid(),
        });
      expect([400, 422]).toContain(overReturn.status);
    });
  });
});
