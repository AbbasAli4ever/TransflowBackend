import { PrismaClient } from '@prisma/client';
import { hash } from 'bcrypt';
import { v4 as uuid } from 'uuid';
import * as request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { authHeader } from './test-utils';

const PASSWORD_SALT_ROUNDS = 10; // Lower for tests (faster)

export interface CreateTenantOptions {
  name?: string;
  baseCurrency?: string;
  timezone?: string;
  status?: string;
}

export interface CreateUserOptions {
  tenantId: string;
  fullName?: string;
  email?: string;
  password?: string;
  role?: string;
  status?: string;
}

/**
 * Create a test tenant
 */
export async function createTestTenant(
  prisma: PrismaClient,
  options: CreateTenantOptions = {},
) {
  const id = uuid();
  return prisma.tenant.create({
    data: {
      id,
      name: options.name || `Test Tenant ${id.substring(0, 8)}`,
      baseCurrency: options.baseCurrency || 'PKR',
      timezone: options.timezone || 'Asia/Karachi',
      status: options.status || 'ACTIVE',
    },
  });
}

/**
 * Create a test user
 */
export async function createTestUser(
  prisma: PrismaClient,
  options: CreateUserOptions,
) {
  const id = uuid();
  const email = options.email || `user-${id.substring(0, 8)}@test.com`;
  const password = options.password || 'Test123!';
  const passwordHash = await hash(password, PASSWORD_SALT_ROUNDS);

  const user = await prisma.user.create({
    data: {
      id,
      tenantId: options.tenantId,
      fullName: options.fullName || `Test User ${id.substring(0, 8)}`,
      email: email.toLowerCase(),
      passwordHash,
      role: options.role || 'OWNER',
      status: options.status || 'ACTIVE',
    },
    include: {
      tenant: true,
    },
  });

  return {
    ...user,
    plainPassword: password, // Return plain password for testing
  };
}

/**
 * Create a complete test tenant with owner user
 */
export async function createTenantWithUser(
  prisma: PrismaClient,
  options: {
    tenantName?: string;
    userName?: string;
    userEmail?: string;
    userPassword?: string;
  } = {},
) {
  return prisma.$transaction(async (tx) => {
    const tenant = await createTestTenant(tx as unknown as PrismaClient, {
      name: options.tenantName,
    });

    const user = await createTestUser(tx as unknown as PrismaClient, {
      tenantId: tenant.id,
      fullName: options.userName,
      email: options.userEmail,
      password: options.userPassword,
    });

    return { tenant, user };
  });
}

/**
 * Create a test supplier
 */
export async function createTestSupplier(
  prisma: PrismaClient,
  tenantId: string,
  createdBy?: string,
  options: { name?: string; phone?: string; address?: string } = {},
) {
  const id = uuid();
  return prisma.supplier.create({
    data: {
      id,
      tenantId,
      name: options.name || `Supplier ${id.substring(0, 8)}`,
      phone: options.phone || '+92300 1234567',
      address: options.address,
      createdBy,
    },
  });
}

/**
 * Create a test customer
 */
export async function createTestCustomer(
  prisma: PrismaClient,
  tenantId: string,
  createdBy?: string,
  options: { name?: string; phone?: string; address?: string } = {},
) {
  const id = uuid();
  return prisma.customer.create({
    data: {
      id,
      tenantId,
      name: options.name || `Customer ${id.substring(0, 8)}`,
      phone: options.phone || '+92301 7654321',
      address: options.address,
      createdBy,
    },
  });
}

/**
 * Create a test product
 */
export async function createTestProduct(
  prisma: PrismaClient,
  tenantId: string,
  createdBy?: string,
  options: {
    name?: string;
    sku?: string;
    category?: string;
    unit?: string;
    avgCost?: number;
  } = {},
) {
  const id = uuid();
  return prisma.product.create({
    data: {
      id,
      tenantId,
      name: options.name || `Product ${id.substring(0, 8)}`,
      sku: options.sku,
      category: options.category,
      unit: options.unit || 'piece',
      avgCost: options.avgCost || 0,
      createdBy,
    },
  });
}

/**
 * Create a test payment account
 */
export async function createTestPaymentAccount(
  prisma: PrismaClient,
  tenantId: string,
  createdBy?: string,
  options: {
    name?: string;
    type?: 'CASH' | 'BANK' | 'WALLET' | 'CARD';
    openingBalance?: number;
  } = {},
) {
  const id = uuid();
  return prisma.paymentAccount.create({
    data: {
      id,
      tenantId,
      name: options.name || `Account ${id.substring(0, 8)}`,
      type: options.type || 'CASH',
      openingBalance: options.openingBalance || 0,
      createdBy,
    },
  });
}

/**
 * Create a supplier payment draft and post it via the API.
 * Returns the posted transaction response body.
 */
export async function createAndPostSupplierPayment(
  app: INestApplication,
  token: string,
  options: {
    supplierId: string;
    amount: number;
    paymentAccountId: string;
    transactionDate?: string;
    idempotencyKey?: string;
    allocations?: Array<{ transactionId: string; amount: number }>;
  },
) {
  const transactionDate =
    options.transactionDate || new Date().toISOString().split('T')[0];

  const draftRes = await request(app.getHttpServer())
    .post('/api/v1/transactions/supplier-payments/draft')
    .set(authHeader(token))
    .send({
      supplierId: options.supplierId,
      amount: options.amount,
      paymentAccountId: options.paymentAccountId,
      transactionDate,
    })
    .expect(201);

  const transactionId = draftRes.body.id;

  const postRes = await request(app.getHttpServer())
    .post(`/api/v1/transactions/${transactionId}/post`)
    .set(authHeader(token))
    .send({
      idempotencyKey: options.idempotencyKey || uuid(),
      allocations: options.allocations,
    })
    .expect(200);

  return postRes.body;
}

/**
 * Create a purchase draft and post it via the API.
 * Returns the posted transaction response body.
 */
export async function createAndPostPurchase(
  app: INestApplication,
  token: string,
  options: {
    supplierId: string;
    lines: Array<{ productId: string; quantity: number; unitCost: number; discountAmount?: number }>;
    transactionDate?: string;
    deliveryFee?: number;
    paidNow?: number;
    paymentAccountId?: string;
    idempotencyKey?: string;
  },
) {
  const transactionDate =
    options.transactionDate || new Date().toISOString().split('T')[0];

  const draftRes = await request(app.getHttpServer())
    .post('/api/v1/transactions/purchases/draft')
    .set(authHeader(token))
    .send({
      supplierId: options.supplierId,
      transactionDate,
      lines: options.lines,
      deliveryFee: options.deliveryFee,
    })
    .expect(201);

  const transactionId = draftRes.body.id;

  const postRes = await request(app.getHttpServer())
    .post(`/api/v1/transactions/${transactionId}/post`)
    .set(authHeader(token))
    .send({
      idempotencyKey: options.idempotencyKey || uuid(),
      paidNow: options.paidNow,
      paymentAccountId: options.paymentAccountId,
    })
    .expect(200);

  return postRes.body;
}

/**
 * Create a supplier return draft and post it via the API.
 * Returns the posted transaction response body.
 */
export async function createAndPostSupplierReturn(
  app: INestApplication,
  token: string,
  options: {
    supplierId: string;
    lines: Array<{ sourceTransactionLineId: string; quantity: number }>;
    transactionDate?: string;
    idempotencyKey?: string;
  },
) {
  const transactionDate =
    options.transactionDate || new Date().toISOString().split('T')[0];

  const draftRes = await request(app.getHttpServer())
    .post('/api/v1/transactions/supplier-returns/draft')
    .set(authHeader(token))
    .send({
      supplierId: options.supplierId,
      transactionDate,
      lines: options.lines,
    })
    .expect(201);

  const transactionId = draftRes.body.id;

  const postRes = await request(app.getHttpServer())
    .post(`/api/v1/transactions/${transactionId}/post`)
    .set(authHeader(token))
    .send({ idempotencyKey: options.idempotencyKey || uuid() })
    .expect(200);

  return postRes.body;
}

/**
 * Create a sale draft and post it via the API.
 * Returns the posted transaction response body.
 */
export async function createAndPostSale(
  app: INestApplication,
  token: string,
  options: {
    customerId: string;
    lines: Array<{ productId: string; quantity: number; unitPrice: number; discountAmount?: number }>;
    transactionDate?: string;
    deliveryFee?: number;
    receivedNow?: number;
    paymentAccountId?: string;
    idempotencyKey?: string;
  },
) {
  const transactionDate =
    options.transactionDate || new Date().toISOString().split('T')[0];

  const draftRes = await request(app.getHttpServer())
    .post('/api/v1/transactions/sales/draft')
    .set(authHeader(token))
    .send({
      customerId: options.customerId,
      transactionDate,
      lines: options.lines,
      deliveryFee: options.deliveryFee,
    })
    .expect(201);

  const transactionId = draftRes.body.id;

  const postRes = await request(app.getHttpServer())
    .post(`/api/v1/transactions/${transactionId}/post`)
    .set(authHeader(token))
    .send({
      idempotencyKey: options.idempotencyKey || uuid(),
      receivedNow: options.receivedNow,
      paymentAccountId: options.paymentAccountId,
    })
    .expect(200);

  return postRes.body;
}
