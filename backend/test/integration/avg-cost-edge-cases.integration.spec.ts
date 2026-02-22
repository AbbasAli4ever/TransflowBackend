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
  createAndPostSupplierReturn,
  createAndPostCustomerReturn,
} from '../helpers/test-factories';
import { PrismaClient } from '@prisma/client';

describe('Weighted Average Cost Edge Cases (Integration)', () => {
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

  // ─── TEST 1: First purchase (preStock=0): avgCost equals unitCost exactly ─────

  it('first purchase sets avgCost to unitCost exactly when preStock is zero', async () => {
    const supplier = await createTestSupplier(prisma, tenantId, userId);
    const product = await createTestProduct(prisma, tenantId, userId);

    await createAndPostPurchase(app, token, {
      supplierId: supplier.id,
      lines: [{ variantId: product.variants[0].id, quantity: 10, unitCost: 1500 }],
    });

    const stockRes = await request(app.getHttpServer())
      .get(`/api/v1/products/${product.id}/stock`)
      .set(authHeader(token))
      .expect(200);

    expect(stockRes.body.variants[0].avgCost).toBe(1500);
  });

  // ─── TEST 2: Second purchase blending → (10×1000 + 10×2000) / 20 = 1500 ──────

  it('second purchase blends correctly: (10×1000 + 10×2000) / 20 = 1500', async () => {
    const supplier = await createTestSupplier(prisma, tenantId, userId);
    const product = await createTestProduct(prisma, tenantId, userId);
    const variantId = product.variants[0].id;

    await createAndPostPurchase(app, token, {
      supplierId: supplier.id,
      lines: [{ variantId, quantity: 10, unitCost: 1000 }],
    });

    await createAndPostPurchase(app, token, {
      supplierId: supplier.id,
      lines: [{ variantId, quantity: 10, unitCost: 2000 }],
    });

    const stockRes = await request(app.getHttpServer())
      .get(`/api/v1/products/${product.id}/stock`)
      .set(authHeader(token))
      .expect(200);

    expect(stockRes.body.variants[0].avgCost).toBe(1500);
  });

  // ─── TEST 3: Sell all stock then repurchase — avgCost resets to new unitCost ──

  it('selling all stock then repurchasing resets avgCost to new unitCost (preStock=0)', async () => {
    const supplier = await createTestSupplier(prisma, tenantId, userId);
    const customer = await createTestCustomer(prisma, tenantId, userId);
    const product = await createTestProduct(prisma, tenantId, userId);
    const variantId = product.variants[0].id;

    // Buy 5 @ 1000
    await createAndPostPurchase(app, token, {
      supplierId: supplier.id,
      lines: [{ variantId, quantity: 5, unitCost: 1000 }],
    });

    // Sell all 5 — stock drops to 0
    await createAndPostSale(app, token, {
      customerId: customer.id,
      lines: [{ variantId, quantity: 5, unitPrice: 1500 }],
    });

    // Repurchase 5 @ 2500
    await createAndPostPurchase(app, token, {
      supplierId: supplier.id,
      lines: [{ variantId, quantity: 5, unitCost: 2500 }],
    });

    const stockRes = await request(app.getHttpServer())
      .get(`/api/v1/products/${product.id}/stock`)
      .set(authHeader(token))
      .expect(200);

    // preStock was 0 at time of repurchase → avgCost = new unitCost = 2500
    expect(stockRes.body.variants[0].avgCost).toBe(2500);
  });

  // ─── TEST 4: Rounding — (2×1000 + 1×1001) / 3 = 1000.33 → rounds to 1000 ───

  it('avgCost rounds correctly: (2×1000 + 1×1001) / 3 = 1000.33 → 1000', async () => {
    const supplier = await createTestSupplier(prisma, tenantId, userId);
    const product = await createTestProduct(prisma, tenantId, userId);
    const variantId = product.variants[0].id;

    await createAndPostPurchase(app, token, {
      supplierId: supplier.id,
      lines: [{ variantId, quantity: 2, unitCost: 1000 }],
    });

    await createAndPostPurchase(app, token, {
      supplierId: supplier.id,
      lines: [{ variantId, quantity: 1, unitCost: 1001 }],
    });

    const stockRes = await request(app.getHttpServer())
      .get(`/api/v1/products/${product.id}/stock`)
      .set(authHeader(token))
      .expect(200);

    // (2*1000 + 1*1001) / 3 = 3001/3 = 1000.33 → rounds to 1000
    expect(stockRes.body.variants[0].avgCost).toBe(1000);
  });

  // ─── TEST 5: Customer return does not change avgCost ─────────────────────────

  it('customer return does not change the variant avgCost', async () => {
    const supplier = await createTestSupplier(prisma, tenantId, userId);
    const customer = await createTestCustomer(prisma, tenantId, userId);
    const product = await createTestProduct(prisma, tenantId, userId);
    const variantId = product.variants[0].id;

    // Buy 10 @ 1000 → avgCost = 1000
    await createAndPostPurchase(app, token, {
      supplierId: supplier.id,
      lines: [{ variantId, quantity: 10, unitCost: 1000 }],
    });

    const sale = await createAndPostSale(app, token, {
      customerId: customer.id,
      lines: [{ variantId, quantity: 3, unitPrice: 2000 }],
    });

    // Return 1 unit from the sale
    const returnableRes = await request(app.getHttpServer())
      .get(`/api/v1/transactions/${sale.id}/returnable-lines`)
      .set(authHeader(token))
      .expect(200);

    await createAndPostCustomerReturn(app, token, {
      customerId: customer.id,
      lines: [{ sourceTransactionLineId: returnableRes.body[0].id, quantity: 1 }],
    });

    const stockRes = await request(app.getHttpServer())
      .get(`/api/v1/products/${product.id}/stock`)
      .set(authHeader(token))
      .expect(200);

    // avgCost must remain 1000 — customer returns do not change cost basis
    expect(stockRes.body.variants[0].avgCost).toBe(1000);
  });

  // ─── TEST 6: Supplier return does not change avgCost ─────────────────────────

  it('supplier return does not change the variant avgCost', async () => {
    const supplier = await createTestSupplier(prisma, tenantId, userId);
    const product = await createTestProduct(prisma, tenantId, userId);
    const variantId = product.variants[0].id;

    // Buy 10 @ 1000 → avgCost = 1000
    const purchase = await createAndPostPurchase(app, token, {
      supplierId: supplier.id,
      lines: [{ variantId, quantity: 10, unitCost: 1000 }],
    });

    // Return 2 units back to supplier
    const returnableRes = await request(app.getHttpServer())
      .get(`/api/v1/transactions/${purchase.id}/returnable-lines`)
      .set(authHeader(token))
      .expect(200);

    await createAndPostSupplierReturn(app, token, {
      supplierId: supplier.id,
      lines: [{ sourceTransactionLineId: returnableRes.body[0].id, quantity: 2 }],
    });

    const stockRes = await request(app.getHttpServer())
      .get(`/api/v1/products/${product.id}/stock`)
      .set(authHeader(token))
      .expect(200);

    // avgCost must remain 1000 — supplier returns do not change cost basis
    expect(stockRes.body.variants[0].avgCost).toBe(1000);
  });

  // ─── TEST 7: Multiple variants are independent ────────────────────────────────

  it('multiple variants on same product maintain independent avgCosts', async () => {
    const supplier = await createTestSupplier(prisma, tenantId, userId);

    // Create a product with two variants: M and L
    const productId = uuid();
    const product = await prisma.product.create({
      data: {
        id: productId,
        tenantId,
        name: `Multi-variant Product ${productId.substring(0, 8)}`,
        unit: 'piece',
        createdBy: userId,
        variants: {
          create: [
            { tenantId, size: 'M', avgCost: 0, createdBy: userId },
            { tenantId, size: 'L', avgCost: 0, createdBy: userId },
          ],
        },
      },
      include: { variants: true },
    });

    const variantM = product.variants.find((v) => v.size === 'M')!;
    const variantL = product.variants.find((v) => v.size === 'L')!;

    // Buy M @ 800
    await createAndPostPurchase(app, token, {
      supplierId: supplier.id,
      lines: [{ variantId: variantM.id, quantity: 5, unitCost: 800 }],
    });

    // Buy L @ 1200
    await createAndPostPurchase(app, token, {
      supplierId: supplier.id,
      lines: [{ variantId: variantL.id, quantity: 5, unitCost: 1200 }],
    });

    const stockRes = await request(app.getHttpServer())
      .get(`/api/v1/products/${product.id}/stock`)
      .set(authHeader(token))
      .expect(200);

    const stockM = stockRes.body.variants.find((v: any) => v.size === 'M');
    const stockL = stockRes.body.variants.find((v: any) => v.size === 'L');

    expect(stockM.avgCost).toBe(800);
    expect(stockL.avgCost).toBe(1200);
  });

  // ─── TEST 8: P&L COGS matches avgCost at time of sale ────────────────────────

  it('P&L COGS = units sold × avgCost at time of sale: buy 10@1000 then 10@2000 (avg=1500), sell 5 → COGS=7500', async () => {
    const supplier = await createTestSupplier(prisma, tenantId, userId);
    const customer = await createTestCustomer(prisma, tenantId, userId);
    const product = await createTestProduct(prisma, tenantId, userId);
    const variantId = product.variants[0].id;

    const today = new Date().toISOString().split('T')[0];

    // First purchase: 10 @ 1000
    await createAndPostPurchase(app, token, {
      supplierId: supplier.id,
      transactionDate: today,
      lines: [{ variantId, quantity: 10, unitCost: 1000 }],
    });

    // Second purchase: 10 @ 2000 → avgCost = (10*1000 + 10*2000)/20 = 1500
    await createAndPostPurchase(app, token, {
      supplierId: supplier.id,
      transactionDate: today,
      lines: [{ variantId, quantity: 10, unitCost: 2000 }],
    });

    // Sell 5 units → COGS should be 5 * 1500 = 7500
    await createAndPostSale(app, token, {
      customerId: customer.id,
      transactionDate: today,
      lines: [{ variantId, quantity: 5, unitPrice: 3000 }],
    });

    const plRes = await request(app.getHttpServer())
      .get(`/api/v1/reports/profit-loss?dateFrom=${today}&dateTo=${today}`)
      .set(authHeader(token))
      .expect(200);

    expect(plRes.body.costOfGoodsSold).toBe(7500);
  });
});
