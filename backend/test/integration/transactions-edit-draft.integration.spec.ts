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
} from '../helpers/test-factories';
import { PrismaClient } from '@prisma/client';

describe('Transactions — Edit Draft & Delete (Integration)', () => {
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

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  async function createPurchaseDraft(supplierId: string, lines: any[], deliveryFee = 0) {
    const res = await request(app.getHttpServer())
      .post('/api/v1/transactions/purchases/draft')
      .set(authHeader(token))
      .send({
        supplierId,
        transactionDate: '2026-02-10',
        lines,
        deliveryFee,
      })
      .expect(201);
    return res.body;
  }

  async function createSaleDraft(customerId: string, lines: any[], deliveryFee = 0) {
    const res = await request(app.getHttpServer())
      .post('/api/v1/transactions/sales/draft')
      .set(authHeader(token))
      .send({
        customerId,
        transactionDate: '2026-02-10',
        lines,
        deliveryFee,
      })
      .expect(201);
    return res.body;
  }

  async function createSupplierPaymentDraft(supplierId: string, amount: number, accountId: string) {
    const res = await request(app.getHttpServer())
      .post('/api/v1/transactions/supplier-payments/draft')
      .set(authHeader(token))
      .send({
        supplierId,
        amount,
        paymentAccountId: accountId,
        transactionDate: '2026-02-10',
      })
      .expect(201);
    return res.body;
  }

  async function createInternalTransferDraft(fromId: string, toId: string, amount: number) {
    const res = await request(app.getHttpServer())
      .post('/api/v1/transactions/internal-transfers/draft')
      .set(authHeader(token))
      .send({
        fromPaymentAccountId: fromId,
        toPaymentAccountId: toId,
        amount,
        transactionDate: '2026-02-10',
      })
      .expect(201);
    return res.body;
  }

  async function createSupplierReturnDraft(supplierId: string, lines: any[]) {
    const res = await request(app.getHttpServer())
      .post('/api/v1/transactions/supplier-returns/draft')
      .set(authHeader(token))
      .send({
        supplierId,
        transactionDate: '2026-02-10',
        lines,
      })
      .expect(201);
    return res.body;
  }

  // ─── PURCHASE Edit ───────────────────────────────────────────────────────────

  describe('PATCH /api/v1/transactions/:id — PURCHASE', () => {
    it('1. updates transactionDate → 200, date changes', async () => {
      const supplier = await createTestSupplier(prisma, tenantId, userId);
      const product = await createTestProduct(prisma, tenantId, userId);
      const draft = await createPurchaseDraft(supplier.id, [
        { variantId: product.variants[0].id, quantity: 5, unitCost: 1000 },
      ]);

      const res = await request(app.getHttpServer())
        .patch(`/api/v1/transactions/${draft.id}`)
        .set(authHeader(token))
        .send({ transactionDate: '2026-01-15' })
        .expect(200);

      expect(res.body.transactionDate).toContain('2026-01-15');
    });

    it('2. updates supplierId to another active supplier → 200', async () => {
      const supplier1 = await createTestSupplier(prisma, tenantId, userId);
      const supplier2 = await createTestSupplier(prisma, tenantId, userId);
      const product = await createTestProduct(prisma, tenantId, userId);
      const draft = await createPurchaseDraft(supplier1.id, [
        { variantId: product.variants[0].id, quantity: 3, unitCost: 500 },
      ]);

      const res = await request(app.getHttpServer())
        .patch(`/api/v1/transactions/${draft.id}`)
        .set(authHeader(token))
        .send({ supplierId: supplier2.id })
        .expect(200);

      expect(res.body.supplierId).toBe(supplier2.id);
    });

    it('3. updates supplierId to inactive supplier → 422', async () => {
      const supplier1 = await createTestSupplier(prisma, tenantId, userId);
      const supplier2 = await createTestSupplier(prisma, tenantId, userId);
      const product = await createTestProduct(prisma, tenantId, userId);

      // Deactivate supplier2
      await prisma.supplier.update({ where: { id: supplier2.id }, data: { status: 'INACTIVE' } });

      const draft = await createPurchaseDraft(supplier1.id, [
        { variantId: product.variants[0].id, quantity: 3, unitCost: 500 },
      ]);

      await request(app.getHttpServer())
        .patch(`/api/v1/transactions/${draft.id}`)
        .set(authHeader(token))
        .send({ supplierId: supplier2.id })
        .expect(422);
    });

    it('4. replaces lines → 200, totalAmount recalculated', async () => {
      const supplier = await createTestSupplier(prisma, tenantId, userId);
      const product = await createTestProduct(prisma, tenantId, userId);
      const draft = await createPurchaseDraft(supplier.id, [
        { variantId: product.variants[0].id, quantity: 5, unitCost: 1000 },
      ]);
      // Original totalAmount = 5 * 1000 = 5000

      const newProduct = await createTestProduct(prisma, tenantId, userId);

      const res = await request(app.getHttpServer())
        .patch(`/api/v1/transactions/${draft.id}`)
        .set(authHeader(token))
        .send({
          lines: [
            { variantId: product.variants[0].id, quantity: 2, unitCost: 1500 },
            { variantId: newProduct.variants[0].id, quantity: 4, unitCost: 800 },
          ],
        })
        .expect(200);

      // 2*1500 + 4*800 = 3000 + 3200 = 6200
      expect(res.body.totalAmount).toBe(6200);
      expect(res.body.transactionLines).toHaveLength(2);
    });

    it('5. replaces lines with inactive variant → 422', async () => {
      const supplier = await createTestSupplier(prisma, tenantId, userId);
      const product = await createTestProduct(prisma, tenantId, userId);
      const inactiveProduct = await createTestProduct(prisma, tenantId, userId);

      // Deactivate the variant
      await prisma.productVariant.update({
        where: { id: inactiveProduct.variants[0].id },
        data: { status: 'INACTIVE' },
      });

      const draft = await createPurchaseDraft(supplier.id, [
        { variantId: product.variants[0].id, quantity: 5, unitCost: 1000 },
      ]);

      await request(app.getHttpServer())
        .patch(`/api/v1/transactions/${draft.id}`)
        .set(authHeader(token))
        .send({
          lines: [{ variantId: inactiveProduct.variants[0].id, quantity: 2, unitCost: 1000 }],
        })
        .expect(422);
    });

    it('6. edit POSTED transaction → 400', async () => {
      const supplier = await createTestSupplier(prisma, tenantId, userId);
      const product = await createTestProduct(prisma, tenantId, userId);

      const posted = await createAndPostPurchase(app, token, {
        supplierId: supplier.id,
        lines: [{ variantId: product.variants[0].id, quantity: 5, unitCost: 1000 }],
      });

      await request(app.getHttpServer())
        .patch(`/api/v1/transactions/${posted.id}`)
        .set(authHeader(token))
        .send({ transactionDate: '2026-01-15' })
        .expect(400);
    });

    it('7. edit non-existent transaction → 404', async () => {
      await request(app.getHttpServer())
        .patch(`/api/v1/transactions/${uuid()}`)
        .set(authHeader(token))
        .send({ transactionDate: '2026-01-15' })
        .expect(404);
    });

    it('8. empty body {} → 400', async () => {
      const supplier = await createTestSupplier(prisma, tenantId, userId);
      const product = await createTestProduct(prisma, tenantId, userId);
      const draft = await createPurchaseDraft(supplier.id, [
        { variantId: product.variants[0].id, quantity: 5, unitCost: 1000 },
      ]);

      await request(app.getHttpServer())
        .patch(`/api/v1/transactions/${draft.id}`)
        .set(authHeader(token))
        .send({})
        .expect(400);
    });
  });

  // ─── SALE Edit ───────────────────────────────────────────────────────────────

  describe('PATCH /api/v1/transactions/:id — SALE', () => {
    it('9. updates deliveryType to HOME_DELIVERY → 200', async () => {
      const customer = await createTestCustomer(prisma, tenantId, userId);
      const product = await createTestProduct(prisma, tenantId, userId);
      const draft = await createSaleDraft(customer.id, [
        { variantId: product.variants[0].id, quantity: 2, unitPrice: 2000 },
      ]);

      const res = await request(app.getHttpServer())
        .patch(`/api/v1/transactions/${draft.id}`)
        .set(authHeader(token))
        .send({ deliveryType: 'HOME_DELIVERY', deliveryAddress: '123 Main Street, Lahore' })
        .expect(200);

      expect(res.body.deliveryType).toBe('HOME_DELIVERY');
      expect(res.body.deliveryAddress).toBe('123 Main Street, Lahore');
    });

    it('10. replaces lines → totalAmount recalculated correctly', async () => {
      const customer = await createTestCustomer(prisma, tenantId, userId);
      const product = await createTestProduct(prisma, tenantId, userId);
      const draft = await createSaleDraft(customer.id, [
        { variantId: product.variants[0].id, quantity: 3, unitPrice: 1500 },
      ]);
      // Original: 3 * 1500 = 4500

      const newProduct = await createTestProduct(prisma, tenantId, userId);

      const res = await request(app.getHttpServer())
        .patch(`/api/v1/transactions/${draft.id}`)
        .set(authHeader(token))
        .send({
          lines: [
            { variantId: product.variants[0].id, quantity: 1, unitPrice: 2000 },
            { variantId: newProduct.variants[0].id, quantity: 3, unitPrice: 1000 },
          ],
        })
        .expect(200);

      // 1*2000 + 3*1000 = 2000 + 3000 = 5000
      expect(res.body.totalAmount).toBe(5000);
      expect(res.body.transactionLines).toHaveLength(2);
    });
  });

  // ─── SUPPLIER_RETURN Edit ─────────────────────────────────────────────────────

  describe('PATCH /api/v1/transactions/:id — SUPPLIER_RETURN', () => {
    it('11. updates quantity within returnable limit → 200', async () => {
      const supplier = await createTestSupplier(prisma, tenantId, userId);
      const product = await createTestProduct(prisma, tenantId, userId);

      const purchase = await createAndPostPurchase(app, token, {
        supplierId: supplier.id,
        lines: [{ variantId: product.variants[0].id, quantity: 10, unitCost: 1000 }],
      });

      const sourceLine = purchase.transactionLines[0];
      const returnDraft = await createSupplierReturnDraft(supplier.id, [
        { sourceTransactionLineId: sourceLine.id, quantity: 3 },
      ]);

      const returnLineId = returnDraft.transactionLines[0].id;

      const res = await request(app.getHttpServer())
        .patch(`/api/v1/transactions/${returnDraft.id}`)
        .set(authHeader(token))
        .send({
          lines: [{ lineId: returnLineId, quantity: 5 }],
        })
        .expect(200);

      const updatedLine = res.body.transactionLines.find((l: any) => l.id === returnLineId);
      expect(updatedLine.quantity).toBe(5);
      // totalAmount = 5 * 1000 = 5000
      expect(res.body.totalAmount).toBe(5000);
    });

    it('12. updates quantity exceeding returnable limit → 422', async () => {
      const supplier = await createTestSupplier(prisma, tenantId, userId);
      const product = await createTestProduct(prisma, tenantId, userId);

      const purchase = await createAndPostPurchase(app, token, {
        supplierId: supplier.id,
        lines: [{ variantId: product.variants[0].id, quantity: 5, unitCost: 1000 }],
      });

      const sourceLine = purchase.transactionLines[0];
      const returnDraft = await createSupplierReturnDraft(supplier.id, [
        { sourceTransactionLineId: sourceLine.id, quantity: 2 },
      ]);

      const returnLineId = returnDraft.transactionLines[0].id;

      await request(app.getHttpServer())
        .patch(`/api/v1/transactions/${returnDraft.id}`)
        .set(authHeader(token))
        .send({
          lines: [{ lineId: returnLineId, quantity: 10 }], // more than the 5 purchased
        })
        .expect(422);
    });
  });

  // ─── SUPPLIER_PAYMENT Edit ───────────────────────────────────────────────────

  describe('PATCH /api/v1/transactions/:id — SUPPLIER_PAYMENT', () => {
    it('13. updates amount → 200, totalAmount updated', async () => {
      const supplier = await createTestSupplier(prisma, tenantId, userId);
      const account = await createTestPaymentAccount(prisma, tenantId, userId);
      const draft = await createSupplierPaymentDraft(supplier.id, 10000, account.id);

      const res = await request(app.getHttpServer())
        .patch(`/api/v1/transactions/${draft.id}`)
        .set(authHeader(token))
        .send({ amount: 25000 })
        .expect(200);

      expect(res.body.totalAmount).toBe(25000);
    });
  });

  // ─── INTERNAL_TRANSFER Edit ───────────────────────────────────────────────────

  describe('PATCH /api/v1/transactions/:id — INTERNAL_TRANSFER', () => {
    it('14. updates amount → 200, totalAmount updated', async () => {
      const fromAccount = await createTestPaymentAccount(prisma, tenantId, userId);
      const toAccount = await createTestPaymentAccount(prisma, tenantId, userId);
      const draft = await createInternalTransferDraft(fromAccount.id, toAccount.id, 5000);

      const res = await request(app.getHttpServer())
        .patch(`/api/v1/transactions/${draft.id}`)
        .set(authHeader(token))
        .send({ amount: 12000 })
        .expect(200);

      expect(res.body.totalAmount).toBe(12000);
    });

    it('15. same from/to account → 400', async () => {
      const accountA = await createTestPaymentAccount(prisma, tenantId, userId);
      const accountB = await createTestPaymentAccount(prisma, tenantId, userId);
      const draft = await createInternalTransferDraft(accountA.id, accountB.id, 5000);

      // Attempt to make from and to the same account
      await request(app.getHttpServer())
        .patch(`/api/v1/transactions/${draft.id}`)
        .set(authHeader(token))
        .send({ toPaymentAccountId: accountA.id })
        .expect(400);
    });
  });

  // ─── DELETE /api/v1/transactions/:id ─────────────────────────────────────────

  describe('DELETE /api/v1/transactions/:id', () => {
    it('16. deletes a DRAFT transaction → 200, transaction gone', async () => {
      const supplier = await createTestSupplier(prisma, tenantId, userId);
      const product = await createTestProduct(prisma, tenantId, userId);
      const draft = await createPurchaseDraft(supplier.id, [
        { variantId: product.variants[0].id, quantity: 2, unitCost: 500 },
      ]);

      const deleteRes = await request(app.getHttpServer())
        .delete(`/api/v1/transactions/${draft.id}`)
        .set(authHeader(token))
        .expect(200);

      expect(deleteRes.body.message).toBe('Transaction deleted');

      // Confirm it's gone
      await request(app.getHttpServer())
        .get(`/api/v1/transactions/${draft.id}`)
        .set(authHeader(token))
        .expect(404);
    });

    it('17. deletes a POSTED transaction → 400', async () => {
      const supplier = await createTestSupplier(prisma, tenantId, userId);
      const product = await createTestProduct(prisma, tenantId, userId);

      const posted = await createAndPostPurchase(app, token, {
        supplierId: supplier.id,
        lines: [{ variantId: product.variants[0].id, quantity: 3, unitCost: 1000 }],
      });

      await request(app.getHttpServer())
        .delete(`/api/v1/transactions/${posted.id}`)
        .set(authHeader(token))
        .expect(400);
    });

    it('18. deletes non-existent transaction → 404', async () => {
      await request(app.getHttpServer())
        .delete(`/api/v1/transactions/${uuid()}`)
        .set(authHeader(token))
        .expect(404);
    });

    it('19. verifies child records are removed after DRAFT deletion', async () => {
      const supplier = await createTestSupplier(prisma, tenantId, userId);
      const product = await createTestProduct(prisma, tenantId, userId);
      const draft = await createPurchaseDraft(supplier.id, [
        { variantId: product.variants[0].id, quantity: 4, unitCost: 750 },
      ]);

      // Confirm lines exist before delete
      const linesBefore = await prisma.transactionLine.count({ where: { transactionId: draft.id } });
      expect(linesBefore).toBe(1);

      await request(app.getHttpServer())
        .delete(`/api/v1/transactions/${draft.id}`)
        .set(authHeader(token))
        .expect(200);

      // Lines should be deleted
      const linesAfter = await prisma.transactionLine.count({ where: { transactionId: draft.id } });
      expect(linesAfter).toBe(0);

      // Parent transaction should be gone
      const txnInDb = await prisma.transaction.findFirst({ where: { id: draft.id } });
      expect(txnInDb).toBeNull();
    });
  });
});
