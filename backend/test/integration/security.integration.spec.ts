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
  createTestSupplier,
  createTestCustomer,
  createTestProduct,
  createTestPaymentAccount,
} from '../helpers/test-factories';
import { PrismaClient } from '@prisma/client';

/**
 * Cross-tenant security tests.
 * These verify that tenant A can never read, modify, or status-change
 * resources belonging to tenant B — even when knowing the exact UUID.
 */
describe('Tenant Isolation Security (Integration)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;

  let tenantAId: string;
  let userAId: string;
  let tokenA: string;

  let tenantBId: string;
  let userBId: string;
  let tokenB: string;

  beforeAll(async () => {
    await setupTestDatabase();
    app = await createTestApp({ imports: [AppModule] });
    prisma = getTestPrismaClient();
  });

  beforeEach(async () => {
    await cleanDatabase();

    const { tenant: tA, user: uA } = await createTenantWithUser(prisma);
    tenantAId = tA.id;
    userAId = uA.id;
    tokenA = generateTestJWT({ userId: uA.id, tenantId: tA.id, email: uA.email, role: uA.role });

    const { tenant: tB, user: uB } = await createTenantWithUser(prisma);
    tenantBId = tB.id;
    userBId = uB.id;
    tokenB = generateTestJWT({ userId: uB.id, tenantId: tB.id, email: uB.email, role: uB.role });
  });

  afterAll(async () => {
    await teardownTestDatabase();
    await app.close();
  });

  // ─── Suppliers ───────────────────────────────────────────────────────────────

  describe('Suppliers', () => {
    it('GET /:id — cannot read another tenant supplier', async () => {
      const supplierA = await createTestSupplier(prisma, tenantAId, userAId, { name: 'Tenant A Supplier' });

      await request(app.getHttpServer())
        .get(`/api/v1/suppliers/${supplierA.id}`)
        .set(authHeader(tokenB))
        .expect(404);
    });

    it('PATCH /:id — cannot update another tenant supplier', async () => {
      const supplierA = await createTestSupplier(prisma, tenantAId, userAId, { name: 'Original' });

      await request(app.getHttpServer())
        .patch(`/api/v1/suppliers/${supplierA.id}`)
        .set(authHeader(tokenB))
        .send({ name: 'Hijacked' })
        .expect(404);

      const unchanged = await prisma.supplier.findUnique({ where: { id: supplierA.id } });
      expect(unchanged!.name).toBe('Original');
    });

    it('PATCH /:id/status — cannot change another tenant supplier status', async () => {
      const supplierA = await createTestSupplier(prisma, tenantAId, userAId, { name: 'Test' });

      await request(app.getHttpServer())
        .patch(`/api/v1/suppliers/${supplierA.id}/status`)
        .set(authHeader(tokenB))
        .send({ status: 'INACTIVE' })
        .expect(404);

      const unchanged = await prisma.supplier.findUnique({ where: { id: supplierA.id } });
      expect(unchanged!.status).toBe('ACTIVE');
    });
  });

  // ─── Customers ───────────────────────────────────────────────────────────────

  describe('Customers', () => {
    it('GET /:id — cannot read another tenant customer', async () => {
      const customerA = await createTestCustomer(prisma, tenantAId, userAId, { name: 'Tenant A Customer' });

      await request(app.getHttpServer())
        .get(`/api/v1/customers/${customerA.id}`)
        .set(authHeader(tokenB))
        .expect(404);
    });

    it('PATCH /:id — cannot update another tenant customer', async () => {
      const customerA = await createTestCustomer(prisma, tenantAId, userAId, { name: 'Original' });

      await request(app.getHttpServer())
        .patch(`/api/v1/customers/${customerA.id}`)
        .set(authHeader(tokenB))
        .send({ name: 'Hijacked' })
        .expect(404);

      const unchanged = await prisma.customer.findUnique({ where: { id: customerA.id } });
      expect(unchanged!.name).toBe('Original');
    });

    it('PATCH /:id/status — cannot change another tenant customer status', async () => {
      const customerA = await createTestCustomer(prisma, tenantAId, userAId, { name: 'Test' });

      await request(app.getHttpServer())
        .patch(`/api/v1/customers/${customerA.id}/status`)
        .set(authHeader(tokenB))
        .send({ status: 'INACTIVE' })
        .expect(404);

      const unchanged = await prisma.customer.findUnique({ where: { id: customerA.id } });
      expect(unchanged!.status).toBe('ACTIVE');
    });
  });

  // ─── Products ─────────────────────────────────────────────────────────────────

  describe('Products', () => {
    it('GET /:id — cannot read another tenant product', async () => {
      const productA = await createTestProduct(prisma, tenantAId, userAId, { name: 'Tenant A Product' });

      await request(app.getHttpServer())
        .get(`/api/v1/products/${productA.id}`)
        .set(authHeader(tokenB))
        .expect(404);
    });

    it('PATCH /:id — cannot update another tenant product', async () => {
      const productA = await createTestProduct(prisma, tenantAId, userAId, { name: 'Original' });

      await request(app.getHttpServer())
        .patch(`/api/v1/products/${productA.id}`)
        .set(authHeader(tokenB))
        .send({ name: 'Hijacked' })
        .expect(404);

      const unchanged = await prisma.product.findUnique({ where: { id: productA.id } });
      expect(unchanged!.name).toBe('Original');
    });

    it('PATCH /:id/status — cannot change another tenant product status', async () => {
      const productA = await createTestProduct(prisma, tenantAId, userAId, { name: 'Test' });

      await request(app.getHttpServer())
        .patch(`/api/v1/products/${productA.id}/status`)
        .set(authHeader(tokenB))
        .send({ status: 'INACTIVE' })
        .expect(404);

      const unchanged = await prisma.product.findUnique({ where: { id: productA.id } });
      expect(unchanged!.status).toBe('ACTIVE');
    });
  });

  // ─── Payment Accounts ─────────────────────────────────────────────────────────

  describe('Payment Accounts', () => {
    it('GET /:id — cannot read another tenant account', async () => {
      const accountA = await createTestPaymentAccount(prisma, tenantAId, userAId, { name: 'Tenant A Cash' });

      await request(app.getHttpServer())
        .get(`/api/v1/payment-accounts/${accountA.id}`)
        .set(authHeader(tokenB))
        .expect(404);
    });

    it('PATCH /:id — cannot update another tenant account', async () => {
      const accountA = await createTestPaymentAccount(prisma, tenantAId, userAId, { name: 'Original' });

      await request(app.getHttpServer())
        .patch(`/api/v1/payment-accounts/${accountA.id}`)
        .set(authHeader(tokenB))
        .send({ name: 'Hijacked' })
        .expect(404);

      const unchanged = await prisma.paymentAccount.findUnique({ where: { id: accountA.id } });
      expect(unchanged!.name).toBe('Original');
    });

    it('PATCH /:id/status — cannot change another tenant account status', async () => {
      const accountA = await createTestPaymentAccount(prisma, tenantAId, userAId, { name: 'Test' });

      await request(app.getHttpServer())
        .patch(`/api/v1/payment-accounts/${accountA.id}/status`)
        .set(authHeader(tokenB))
        .send({ status: 'INACTIVE' })
        .expect(404);

      const unchanged = await prisma.paymentAccount.findUnique({ where: { id: accountA.id } });
      expect(unchanged!.status).toBe('ACTIVE');
    });
  });
});
