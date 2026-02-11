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
  createAndPostPurchase,
} from '../helpers/test-factories';
import { PrismaClient } from '@prisma/client';

describe('Posting — Concurrency (Integration)', () => {
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

  /**
   * Concurrent sale test: two sales compete for the same limited stock.
   * Exactly one must succeed (200) and the other must fail (422 or 409).
   * This validates that Serializable isolation prevents overselling.
   */
  it('two concurrent sales of the same exact stock: exactly one succeeds', async () => {
    const supplier = await createTestSupplier(prisma, tenantId, userId);
    const customer = await createTestCustomer(prisma, tenantId, userId);
    const product = await createTestProduct(prisma, tenantId, userId);

    // Stock exactly 5 units
    await createAndPostPurchase(app, token, {
      supplierId: supplier.id,
      lines: [{ productId: product.id, quantity: 5, unitCost: 100 }],
    });

    // Create two sale drafts, each wanting all 5 units
    const saleDraft1 = await request(app.getHttpServer())
      .post('/api/v1/transactions/sales/draft')
      .set(authHeader(token))
      .send({
        customerId: customer.id,
        transactionDate: new Date().toISOString().split('T')[0],
        lines: [{ productId: product.id, quantity: 5, unitPrice: 200 }],
      })
      .expect(201);

    const saleDraft2 = await request(app.getHttpServer())
      .post('/api/v1/transactions/sales/draft')
      .set(authHeader(token))
      .send({
        customerId: customer.id,
        transactionDate: new Date().toISOString().split('T')[0],
        lines: [{ productId: product.id, quantity: 5, unitPrice: 200 }],
      })
      .expect(201);

    // Fire both post requests concurrently
    const [res1, res2] = await Promise.all([
      request(app.getHttpServer())
        .post(`/api/v1/transactions/${saleDraft1.body.id}/post`)
        .set(authHeader(token))
        .send({ idempotencyKey: uuid() }),
      request(app.getHttpServer())
        .post(`/api/v1/transactions/${saleDraft2.body.id}/post`)
        .set(authHeader(token))
        .send({ idempotencyKey: uuid() }),
    ]);

    const statuses = [res1.status, res2.status].sort();
    // One should succeed (200), one should fail (422 insufficient stock or 409 serialization conflict)
    expect(statuses[0]).toBe(200);
    expect([409, 422]).toContain(statuses[1]);

    // Net stock should be 0 (all 5 units consumed by the one successful sale)
    const movements = await prisma.inventoryMovement.findMany({
      where: { tenantId, movementType: 'SALE_OUT' },
    });
    expect(movements).toHaveLength(1);
    expect(movements[0].quantity).toBe(5);
  });

  /**
   * Two concurrent purchases generate distinct document numbers.
   */
  it('two concurrent purchases get distinct document numbers', async () => {
    const supplier = await createTestSupplier(prisma, tenantId, userId);
    const product = await createTestProduct(prisma, tenantId, userId);
    const today = new Date().toISOString().split('T')[0];

    const [draft1, draft2] = await Promise.all([
      request(app.getHttpServer())
        .post('/api/v1/transactions/purchases/draft')
        .set(authHeader(token))
        .send({ supplierId: supplier.id, transactionDate: today, lines: [{ productId: product.id, quantity: 1, unitCost: 100 }] })
        .expect(201),
      request(app.getHttpServer())
        .post('/api/v1/transactions/purchases/draft')
        .set(authHeader(token))
        .send({ supplierId: supplier.id, transactionDate: today, lines: [{ productId: product.id, quantity: 1, unitCost: 100 }] })
        .expect(201),
    ]);

    const [post1, post2] = await Promise.all([
      request(app.getHttpServer())
        .post(`/api/v1/transactions/${draft1.body.id}/post`)
        .set(authHeader(token))
        .send({ idempotencyKey: uuid() }),
      request(app.getHttpServer())
        .post(`/api/v1/transactions/${draft2.body.id}/post`)
        .set(authHeader(token))
        .send({ idempotencyKey: uuid() }),
    ]);

    // Both may succeed, but document numbers must be different
    const successResponses = [post1, post2].filter((r) => r.status === 200);
    const docNumbers = successResponses.map((r) => r.body.documentNumber);

    // All successful postings must have unique document numbers
    const uniqueDocNumbers = new Set(docNumbers);
    expect(uniqueDocNumbers.size).toBe(docNumbers.length);

    // All should either succeed or fail with 409 (serialization conflict)
    for (const res of [post1, post2]) {
      expect([200, 409]).toContain(res.status);
    }
  });
});
