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
  createAndPostSupplierPayment,
} from '../helpers/test-factories';
import { PrismaClient } from '@prisma/client';

describe('Open Documents (Integration)', () => {
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

  // ─── SUPPLIER OPEN DOCUMENTS ─────────────────────────────────────────────────

  describe('GET /api/v1/suppliers/:id/open-documents', () => {
    it('returns empty list when supplier has no purchases', async () => {
      const supplier = await createTestSupplier(prisma, tenantId, userId);

      const res = await request(app.getHttpServer())
        .get(`/api/v1/suppliers/${supplier.id}/open-documents`)
        .set(authHeader(token))
        .expect(200);

      expect(res.body.supplierId).toBe(supplier.id);
      expect(res.body.supplierName).toBe(supplier.name);
      expect(res.body.totalOutstanding).toBe(0);
      expect(res.body.documents).toHaveLength(0);
    });

    it('returns purchase as open document after posting', async () => {
      const supplier = await createTestSupplier(prisma, tenantId, userId);
      const product = await createTestProduct(prisma, tenantId, userId);

      const purchase = await createAndPostPurchase(app, token, {
        supplierId: supplier.id,
        lines: [{ productId: product.id, quantity: 5, unitCost: 2000 }],
      });

      const res = await request(app.getHttpServer())
        .get(`/api/v1/suppliers/${supplier.id}/open-documents`)
        .set(authHeader(token))
        .expect(200);

      expect(res.body.totalOutstanding).toBe(10000);
      expect(res.body.documents).toHaveLength(1);
      expect(res.body.documents[0].id).toBe(purchase.id);
      expect(res.body.documents[0].totalAmount).toBe(10000);
      expect(res.body.documents[0].paidAmount).toBe(0);
      expect(res.body.documents[0].outstanding).toBe(10000);
    });

    it('shows correct outstanding after partial payment', async () => {
      const supplier = await createTestSupplier(prisma, tenantId, userId);
      const product = await createTestProduct(prisma, tenantId, userId);
      const account = await createTestPaymentAccount(prisma, tenantId, userId);

      const purchase = await createAndPostPurchase(app, token, {
        supplierId: supplier.id,
        lines: [{ productId: product.id, quantity: 5, unitCost: 2000 }],
      });

      // Pay 6000 of 10000
      await createAndPostSupplierPayment(app, token, {
        supplierId: supplier.id,
        amount: 6000,
        paymentAccountId: account.id,
        allocations: [{ transactionId: purchase.id, amount: 6000 }],
      });

      const res = await request(app.getHttpServer())
        .get(`/api/v1/suppliers/${supplier.id}/open-documents`)
        .set(authHeader(token))
        .expect(200);

      expect(res.body.totalOutstanding).toBe(4000);
      expect(res.body.documents).toHaveLength(1);
      expect(res.body.documents[0].paidAmount).toBe(6000);
      expect(res.body.documents[0].outstanding).toBe(4000);
    });

    it('excludes fully-paid document from open list', async () => {
      const supplier = await createTestSupplier(prisma, tenantId, userId);
      const product = await createTestProduct(prisma, tenantId, userId);
      const account = await createTestPaymentAccount(prisma, tenantId, userId);

      const purchase = await createAndPostPurchase(app, token, {
        supplierId: supplier.id,
        lines: [{ productId: product.id, quantity: 5, unitCost: 2000 }],
      });

      // Fully paid
      await createAndPostSupplierPayment(app, token, {
        supplierId: supplier.id,
        amount: 10000,
        paymentAccountId: account.id,
        allocations: [{ transactionId: purchase.id, amount: 10000 }],
      });

      const res = await request(app.getHttpServer())
        .get(`/api/v1/suppliers/${supplier.id}/open-documents`)
        .set(authHeader(token))
        .expect(200);

      expect(res.body.totalOutstanding).toBe(0);
      expect(res.body.documents).toHaveLength(0);
    });

    it('returns 404 for unknown supplier', async () => {
      await request(app.getHttpServer())
        .get(`/api/v1/suppliers/${uuid()}/open-documents`)
        .set(authHeader(token))
        .expect(404);
    });

    it('returns 401 without auth', async () => {
      const supplier = await createTestSupplier(prisma, tenantId, userId);

      await request(app.getHttpServer())
        .get(`/api/v1/suppliers/${supplier.id}/open-documents`)
        .expect(401);
    });

    it('tenant isolation: cannot see another tenant supplier documents', async () => {
      const { tenant: t2, user: u2 } = await createTenantWithUser(prisma);
      const t2Token = generateTestJWT({ userId: u2.id, tenantId: t2.id, email: u2.email, role: u2.role });

      const supplier2 = await createTestSupplier(prisma, t2.id, u2.id);

      // t2 has a purchase
      const product2 = await createTestProduct(prisma, t2.id, u2.id);
      await createAndPostPurchase(app, t2Token, {
        supplierId: supplier2.id,
        lines: [{ productId: product2.id, quantity: 1, unitCost: 1000 }],
      });

      // Tenant 1 tries to access tenant 2 supplier — gets 404
      await request(app.getHttpServer())
        .get(`/api/v1/suppliers/${supplier2.id}/open-documents`)
        .set(authHeader(token))
        .expect(404);
    });
  });

  // ─── CUSTOMER OPEN DOCUMENTS ─────────────────────────────────────────────────

  describe('GET /api/v1/customers/:id/open-documents', () => {
    it('returns empty list when customer has no sales', async () => {
      const customer = await createTestCustomer(prisma, tenantId, userId);

      const res = await request(app.getHttpServer())
        .get(`/api/v1/customers/${customer.id}/open-documents`)
        .set(authHeader(token))
        .expect(200);

      expect(res.body.customerId).toBe(customer.id);
      expect(res.body.customerName).toBe(customer.name);
      expect(res.body.totalOutstanding).toBe(0);
      expect(res.body.documents).toHaveLength(0);
    });

    it('returns sale as open document after posting', async () => {
      const supplier = await createTestSupplier(prisma, tenantId, userId);
      const customer = await createTestCustomer(prisma, tenantId, userId);
      const product = await createTestProduct(prisma, tenantId, userId);

      // Pre-stock
      await createAndPostPurchase(app, token, {
        supplierId: supplier.id,
        lines: [{ productId: product.id, quantity: 20, unitCost: 500 }],
      });

      const saleDraft = await request(app.getHttpServer())
        .post('/api/v1/transactions/sales/draft')
        .set(authHeader(token))
        .send({
          customerId: customer.id,
          transactionDate: new Date().toISOString().split('T')[0],
          lines: [{ productId: product.id, quantity: 5, unitPrice: 2000 }],
        })
        .expect(201);

      const sale = await request(app.getHttpServer())
        .post(`/api/v1/transactions/${saleDraft.body.id}/post`)
        .set(authHeader(token))
        .send({ idempotencyKey: uuid() })
        .expect(200);

      const res = await request(app.getHttpServer())
        .get(`/api/v1/customers/${customer.id}/open-documents`)
        .set(authHeader(token))
        .expect(200);

      expect(res.body.totalOutstanding).toBe(10000);
      expect(res.body.documents).toHaveLength(1);
      expect(res.body.documents[0].id).toBe(sale.body.id);
      expect(res.body.documents[0].outstanding).toBe(10000);
    });

    it('returns 404 for unknown customer', async () => {
      await request(app.getHttpServer())
        .get(`/api/v1/customers/${uuid()}/open-documents`)
        .set(authHeader(token))
        .expect(404);
    });
  });
});
