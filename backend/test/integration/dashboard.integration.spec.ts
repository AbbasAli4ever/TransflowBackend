import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
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
  createTestSupplier,
  createTestCustomer,
  createTestProduct,
  createAndPostPurchase,
  createAndPostSale,
  createAndPostSupplierPayment,
  createAndPostCustomerPayment,
} from '../helpers/test-factories';

describe('Dashboard (integration)', () => {
  let app: INestApplication;
  let prisma: ReturnType<typeof getTestPrismaClient>;
  let token: string;
  let tenantId: string;
  let userId: string;

  beforeAll(async () => {
    await setupTestDatabase();
    app = await createTestApp({ imports: [AppModule] });
    prisma = getTestPrismaClient();
  });

  afterAll(async () => {
    await teardownTestDatabase();
    await app.close();
  });

  beforeEach(async () => {
    await cleanDatabase();
    const { tenant, user } = await createTenantWithUser(prisma);
    tenantId = tenant.id;
    userId = user.id;
    token = generateTestJWT({ userId, tenantId, email: user.email, role: user.role });
  });

  describe('GET /api/v1/dashboard/summary', () => {
    // ─── Test 1: empty tenant ──────────────────────────────────────────────────

    it('returns all zeros for a tenant with no data', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/dashboard/summary')
        .set(authHeader(token))
        .expect(200);

      const { cash, inventory, receivables, payables, recentActivity } = res.body;

      expect(cash.totalBalance).toBe(0);
      expect(cash.accounts).toEqual([]);
      expect(inventory.totalValue).toBe(0);
      expect(inventory.totalProducts).toBe(0);
      expect(inventory.lowStockCount).toBe(0);
      expect(receivables.totalAmount).toBe(0);
      expect(receivables.customerCount).toBe(0);
      expect(receivables.overdueAmount).toBe(0);
      expect(receivables.overdueCount).toBe(0);
      expect(payables.totalAmount).toBe(0);
      expect(payables.supplierCount).toBe(0);
      expect(payables.overdueAmount).toBe(0);
      expect(payables.overdueCount).toBe(0);
      expect(recentActivity.todaySales).toBe(0);
      expect(recentActivity.todayPurchases).toBe(0);
      expect(recentActivity.todayPayments).toBe(0);
      expect(recentActivity.todayReceipts).toBe(0);
    });

    // ─── Test 2: cash section ─────────────────────────────────────────────────

    it('cash section shows all payment accounts with correct balances', async () => {
      const cashAcc = await createTestPaymentAccount(prisma, tenantId, userId, {
        name: 'Cash',
        type: 'CASH',
        openingBalance: 5000,
      });
      await createTestPaymentAccount(prisma, tenantId, userId, {
        name: 'Bank',
        type: 'BANK',
        openingBalance: 10000,
      });

      const supplier = await createTestSupplier(prisma, tenantId, userId);
      const product = await createTestProduct(prisma, tenantId, userId);

      // Pay 2000 from Cash → Cash: 5000 - 2000 = 3000
      await createAndPostPurchase(app, token, {
        supplierId: supplier.id,
        lines: [{ productId: product.id, quantity: 2, unitCost: 1000 }],
        paidNow: 2000,
        paymentAccountId: cashAcc.id,
        transactionDate: '2026-02-15',
      });

      const res = await request(app.getHttpServer())
        .get('/api/v1/dashboard/summary')
        .set(authHeader(token))
        .expect(200);

      const { cash } = res.body;
      expect(cash.accounts).toHaveLength(2);

      const cashResult = cash.accounts.find((a: any) => a.name === 'Cash');
      const bankResult = cash.accounts.find((a: any) => a.name === 'Bank');
      expect(cashResult.balance).toBe(3000);   // 5000 - 2000 paid out
      expect(bankResult.balance).toBe(10000);  // opening only, untouched
      expect(cash.totalBalance).toBe(13000);
    });

    // ─── Test 3: inventory totalValue and totalProducts ───────────────────────

    it('inventory section shows total value and product count', async () => {
      const supplier = await createTestSupplier(prisma, tenantId, userId);
      const product = await createTestProduct(prisma, tenantId, userId);

      // 10 units @ 500 → stock=10, totalValue=5000
      await createAndPostPurchase(app, token, {
        supplierId: supplier.id,
        lines: [{ productId: product.id, quantity: 10, unitCost: 500 }],
        transactionDate: '2026-02-15',
      });

      const res = await request(app.getHttpServer())
        .get('/api/v1/dashboard/summary')
        .set(authHeader(token))
        .expect(200);

      const { inventory } = res.body;
      expect(inventory.totalProducts).toBe(1);
      expect(inventory.totalValue).toBe(5000);
      expect(inventory.lowStockCount).toBe(0); // stock=10 > 5
    });

    // ─── Test 4: inventory lowStockCount ──────────────────────────────────────

    it('inventory lowStockCount counts products with stock ≤ 5', async () => {
      const supplier = await createTestSupplier(prisma, tenantId, userId);
      const productA = await createTestProduct(prisma, tenantId, userId, { name: 'Product A' });
      const productB = await createTestProduct(prisma, tenantId, userId, { name: 'Product B' });

      // Product A: 3 units @ 100 (stock=3, low stock)
      await createAndPostPurchase(app, token, {
        supplierId: supplier.id,
        lines: [{ productId: productA.id, quantity: 3, unitCost: 100 }],
        transactionDate: '2026-02-15',
      });

      // Product B: 10 units @ 200 (stock=10, not low stock)
      await createAndPostPurchase(app, token, {
        supplierId: supplier.id,
        lines: [{ productId: productB.id, quantity: 10, unitCost: 200 }],
        transactionDate: '2026-02-15',
      });

      const res = await request(app.getHttpServer())
        .get('/api/v1/dashboard/summary')
        .set(authHeader(token))
        .expect(200);

      const { inventory } = res.body;
      expect(inventory.totalProducts).toBe(2);
      expect(inventory.totalValue).toBe(3 * 100 + 10 * 200); // 2300
      expect(inventory.lowStockCount).toBe(1); // only product A (stock=3)
    });

    // ─── Test 5: receivables ──────────────────────────────────────────────────

    it('receivables shows positive AR balances only, with overdue detection', async () => {
      const payAcc = await createTestPaymentAccount(prisma, tenantId, userId);
      const supplier = await createTestSupplier(prisma, tenantId, userId);
      const product = await createTestProduct(prisma, tenantId, userId);

      // Stock the product
      await createAndPostPurchase(app, token, {
        supplierId: supplier.id,
        lines: [{ productId: product.id, quantity: 50, unitCost: 100 }],
        transactionDate: '2026-01-01',
      });

      const customerA = await createTestCustomer(prisma, tenantId, userId);
      const customerB = await createTestCustomer(prisma, tenantId, userId);

      // Customer A: sale 5000 on 2026-01-01 (45 days before 2026-02-15), no payment → overdue
      await createAndPostSale(app, token, {
        customerId: customerA.id,
        lines: [{ productId: product.id, quantity: 5, unitPrice: 1000 }],
        transactionDate: '2026-01-01',
      });

      // Customer B: sale 2000, fully paid → balance=0, excluded
      const saleB = await createAndPostSale(app, token, {
        customerId: customerB.id,
        lines: [{ productId: product.id, quantity: 2, unitPrice: 1000 }],
        transactionDate: '2026-01-01',
      });
      await createAndPostCustomerPayment(app, token, {
        customerId: customerB.id,
        amount: 2000,
        paymentAccountId: payAcc.id,
        allocations: [{ transactionId: saleB.id, amount: 2000 }],
        transactionDate: '2026-01-02',
      });

      const res = await request(app.getHttpServer())
        .get('/api/v1/dashboard/summary?asOfDate=2026-02-15')
        .set(authHeader(token))
        .expect(200);

      const { receivables } = res.body;
      expect(receivables.totalAmount).toBe(5000);
      expect(receivables.customerCount).toBe(1);
      // overdueThreshold = 2026-02-15 - 30 days = 2026-01-16
      // sale date 2026-01-01 < 2026-01-16 → overdue
      expect(receivables.overdueCount).toBe(1);
      expect(receivables.overdueAmount).toBe(5000);
    });

    // ─── Test 6: payables ─────────────────────────────────────────────────────

    it('payables shows positive AP balances only, with overdue detection', async () => {
      const payAcc = await createTestPaymentAccount(prisma, tenantId, userId, {
        openingBalance: 50000,
      });
      const product = await createTestProduct(prisma, tenantId, userId);
      const supplierA = await createTestSupplier(prisma, tenantId, userId);
      const supplierB = await createTestSupplier(prisma, tenantId, userId);

      // Supplier A: purchase 3000, fully paid → balance=0, excluded
      const purA = await createAndPostPurchase(app, token, {
        supplierId: supplierA.id,
        lines: [{ productId: product.id, quantity: 3, unitCost: 1000 }],
        transactionDate: '2026-01-01',
      });
      await createAndPostSupplierPayment(app, token, {
        supplierId: supplierA.id,
        amount: 3000,
        paymentAccountId: payAcc.id,
        allocations: [{ transactionId: purA.id, amount: 3000 }],
        transactionDate: '2026-01-02',
      });

      // Supplier B: purchase 2000, no payment — old date → overdue
      await createAndPostPurchase(app, token, {
        supplierId: supplierB.id,
        lines: [{ productId: product.id, quantity: 2, unitCost: 1000 }],
        transactionDate: '2026-01-01',
      });

      const res = await request(app.getHttpServer())
        .get('/api/v1/dashboard/summary?asOfDate=2026-02-15')
        .set(authHeader(token))
        .expect(200);

      const { payables } = res.body;
      expect(payables.totalAmount).toBe(2000);
      expect(payables.supplierCount).toBe(1);
      expect(payables.overdueCount).toBe(1);
      expect(payables.overdueAmount).toBe(2000);
    });

    // ─── Test 7: recent activity ──────────────────────────────────────────────

    it('recent activity sums posted transactions by type for the given date', async () => {
      const payAcc = await createTestPaymentAccount(prisma, tenantId, userId, {
        openingBalance: 100000,
      });
      const product = await createTestProduct(prisma, tenantId, userId);
      const supplier = await createTestSupplier(prisma, tenantId, userId);
      const customer = await createTestCustomer(prisma, tenantId, userId);

      // Pre-stock on earlier date
      await createAndPostPurchase(app, token, {
        supplierId: supplier.id,
        lines: [{ productId: product.id, quantity: 100, unitCost: 100 }],
        transactionDate: '2026-01-01',
      });

      // Target date transactions
      await createAndPostPurchase(app, token, {
        supplierId: supplier.id,
        lines: [{ productId: product.id, quantity: 5, unitCost: 1000 }],
        transactionDate: '2026-02-15',
      });

      await createAndPostSale(app, token, {
        customerId: customer.id,
        lines: [{ productId: product.id, quantity: 10, unitPrice: 1000 }],
        transactionDate: '2026-02-15',
      });

      await createAndPostSupplierPayment(app, token, {
        supplierId: supplier.id,
        amount: 2000,
        paymentAccountId: payAcc.id,
        transactionDate: '2026-02-15',
      });

      await createAndPostCustomerPayment(app, token, {
        customerId: customer.id,
        amount: 3000,
        paymentAccountId: payAcc.id,
        transactionDate: '2026-02-15',
      });

      const res = await request(app.getHttpServer())
        .get('/api/v1/dashboard/summary?asOfDate=2026-02-15')
        .set(authHeader(token))
        .expect(200);

      const { recentActivity } = res.body;
      expect(recentActivity.todayPurchases).toBe(5000);
      expect(recentActivity.todaySales).toBe(10000);
      expect(recentActivity.todayPayments).toBe(2000);
      expect(recentActivity.todayReceipts).toBe(3000);
    });

    // ─── Test 8: asOfDate filters all sections ────────────────────────────────

    it('asOfDate param filters inventory, payables, and recent activity correctly', async () => {
      const product = await createTestProduct(prisma, tenantId, userId);
      const supplier = await createTestSupplier(prisma, tenantId, userId);

      // Purchase on 2026-01-10: 10 units @ 200 = 2000 value, AP balance 2000
      await createAndPostPurchase(app, token, {
        supplierId: supplier.id,
        lines: [{ productId: product.id, quantity: 10, unitCost: 200 }],
        transactionDate: '2026-01-10',
      });

      // Purchase on 2026-02-15: 5 more units @ 300 (excluded by asOfDate=2026-01-10)
      await createAndPostPurchase(app, token, {
        supplierId: supplier.id,
        lines: [{ productId: product.id, quantity: 5, unitCost: 300 }],
        transactionDate: '2026-02-15',
      });

      const res = await request(app.getHttpServer())
        .get('/api/v1/dashboard/summary?asOfDate=2026-01-10')
        .set(authHeader(token))
        .expect(200);

      const { inventory, payables, recentActivity } = res.body;

      expect(inventory.totalProducts).toBe(1);
      expect(inventory.totalValue).toBe(10 * 200); // 2000
      expect(inventory.lowStockCount).toBe(0);     // stock=10 > 5

      expect(payables.totalAmount).toBe(2000);     // only first purchase
      expect(payables.supplierCount).toBe(1);

      expect(recentActivity.todayPurchases).toBe(2000); // only 2026-01-10 purchase
      expect(recentActivity.todaySales).toBe(0);
    });

    // ─── Test 9: tenant isolation ─────────────────────────────────────────────

    it('enforces tenant isolation — tenant 1 sees nothing from tenant 2', async () => {
      // Set up data in a second tenant
      const { tenant: tenant2, user: user2 } = await createTenantWithUser(prisma);
      const token2 = generateTestJWT({
        userId: user2.id,
        tenantId: tenant2.id,
        email: user2.email,
        role: user2.role,
      });

      const product = await createTestProduct(prisma, tenant2.id, user2.id);
      const supplier = await createTestSupplier(prisma, tenant2.id, user2.id);
      const customer = await createTestCustomer(prisma, tenant2.id, user2.id);
      const payAcc = await createTestPaymentAccount(prisma, tenant2.id, user2.id, {
        openingBalance: 10000,
      });

      await createAndPostPurchase(app, token2, {
        supplierId: supplier.id,
        lines: [{ productId: product.id, quantity: 20, unitCost: 500 }],
        transactionDate: '2026-02-15',
      });
      await createAndPostSale(app, token2, {
        customerId: customer.id,
        lines: [{ productId: product.id, quantity: 5, unitPrice: 800 }],
        transactionDate: '2026-02-15',
      });

      // Tenant 1 (original token) queries — should see zeros
      const res = await request(app.getHttpServer())
        .get('/api/v1/dashboard/summary')
        .set(authHeader(token))
        .expect(200);

      expect(res.body.cash.totalBalance).toBe(0);
      expect(res.body.cash.accounts).toEqual([]);
      expect(res.body.inventory.totalProducts).toBe(0);
      expect(res.body.inventory.totalValue).toBe(0);
      expect(res.body.receivables.totalAmount).toBe(0);
      expect(res.body.payables.totalAmount).toBe(0);
      expect(res.body.recentActivity.todaySales).toBe(0);
      expect(res.body.recentActivity.todayPurchases).toBe(0);
    });
  });
});
