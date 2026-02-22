import { ConflictException, BadRequestException, NotFoundException } from '@nestjs/common';
import { PostingService } from '../../src/transactions/posting.service';
import * as requestContext from '../../src/common/request-context';

// Mock getContext so OWNER role is available where needed
jest.spyOn(requestContext, 'getContext').mockReturnValue({
  requestId: 'test-req',
  tenantId: 'tenant-1',
  userId: 'user-1',
  userEmail: 'test@test.com',
  userRole: 'OWNER',
} as any);

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeTxn(overrides: Record<string, any> = {}) {
  return {
    id: 'txn-1',
    tenantId: 'tenant-1',
    type: 'PURCHASE',
    status: 'DRAFT',
    totalAmount: 5000,
    subtotal: 5000,
    discountTotal: 0,
    deliveryFee: 0,
    supplierId: 'supplier-1',
    customerId: null,
    fromPaymentAccountId: null,
    toPaymentAccountId: null,
    transactionDate: new Date('2026-02-01'),
    idempotencyKey: null,
    transactionLines: [
      {
        id: 'line-1',
        variantId: 'variant-1',
        quantity: 5,
        unitCost: 1000,
        unitPrice: 0,
        lineTotal: 5000,
        costTotal: 5000,
        sourceTransactionLineId: null,
        variant: { id: 'variant-1', avgCost: 0, size: 'M', product: { name: 'Test Product' } },
      },
    ],
    ...overrides,
  };
}

function makeTx(txn: any) {
  return {
    transaction: {
      findFirst: jest.fn().mockResolvedValue(txn),
      update: jest.fn().mockResolvedValue({ ...txn, status: 'POSTED' }),
    },
    transactionLine: {
      findMany: jest.fn().mockResolvedValue(txn?.transactionLines ?? []),
    },
    productVariant: {
      update: jest.fn().mockResolvedValue({}),
    },
    inventoryMovement: {
      create: jest.fn().mockResolvedValue({}),
      createMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    ledgerEntry: {
      create: jest.fn().mockResolvedValue({}),
      createMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    paymentEntry: {
      create: jest.fn().mockResolvedValue({}),
    },
    paymentAccount: {
      findFirst: jest.fn().mockResolvedValue({ id: 'acct-1', status: 'ACTIVE' }),
    },
    allocation: {
      create: jest.fn().mockResolvedValue({}),
      findMany: jest.fn().mockResolvedValue([]),
    },
    supplier: { findFirst: jest.fn().mockResolvedValue({ id: 'supplier-1', status: 'ACTIVE' }) },
    customer: { findFirst: jest.fn().mockResolvedValue(null) },
    $queryRaw: jest.fn().mockResolvedValue([{ stock: BigInt(0) }]),
    $executeRaw: jest.fn().mockResolvedValue([{ last_value: BigInt(1) }]),
  };
}

function makePrisma(txn: any) {
  const tx = makeTx(txn);
  const prisma: any = {
    $transaction: jest.fn().mockImplementation((callback: any) =>
      callback(tx),
    ),
  };
  return { prisma, tx };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('PostingService (Unit)', () => {
  const dto = { idempotencyKey: 'key-1' };
  const tenantId = 'tenant-1';
  const userId = 'user-1';

  describe('post() — idempotency guards', () => {
    it('throws NotFoundException when transaction does not exist', async () => {
      const { prisma, tx } = makePrisma(null);
      tx.transaction.findFirst.mockResolvedValue(null);
      const service = new PostingService(prisma);

      await expect(service.post('unknown-id', dto, tenantId, userId)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('returns existing transaction when already POSTED with same idempotency key', async () => {
      const postedTxn = makeTxn({ status: 'POSTED', idempotencyKey: 'key-1' });
      const { prisma, tx } = makePrisma(postedTxn);
      // fetchFullTransaction calls findFirst again
      tx.transaction.findFirst
        .mockResolvedValueOnce(postedTxn)  // initial check
        .mockResolvedValueOnce(postedTxn); // fetchFullTransaction
      const service = new PostingService(prisma);

      const result = await service.post('txn-1', dto, tenantId, userId);
      expect(result).toMatchObject({ status: 'POSTED' });
    });

    it('throws ConflictException when already POSTED with different idempotency key', async () => {
      const postedTxn = makeTxn({ status: 'POSTED', idempotencyKey: 'other-key' });
      const { prisma } = makePrisma(postedTxn);
      const service = new PostingService(prisma);

      await expect(service.post('txn-1', dto, tenantId, userId)).rejects.toThrow(
        ConflictException,
      );
    });

    it('throws BadRequestException when transaction is not DRAFT', async () => {
      const voidedTxn = makeTxn({ status: 'VOIDED' });
      const { prisma } = makePrisma(voidedTxn);
      const service = new PostingService(prisma);

      await expect(service.post('txn-1', dto, tenantId, userId)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws ConflictException when idempotency key used on different transaction', async () => {
      const txn = makeTxn();
      const { prisma, tx } = makePrisma(txn);
      tx.transaction.findFirst
        .mockResolvedValueOnce(txn)                                   // main fetch
        .mockResolvedValueOnce({ id: 'other-txn', status: 'POSTED' }); // key conflict check
      const service = new PostingService(prisma);

      await expect(service.post('txn-1', dto, tenantId, userId)).rejects.toThrow(
        ConflictException,
      );
    });

    it('throws BadRequestException when paidNow > 0 but no paymentAccountId', async () => {
      const txn = makeTxn();
      const { prisma, tx } = makePrisma(txn);
      tx.transaction.findFirst
        .mockResolvedValueOnce(txn)   // main fetch
        .mockResolvedValueOnce(null); // no key conflict
      const service = new PostingService(prisma);

      await expect(
        service.post('txn-1', { idempotencyKey: 'key-1', paidNow: 500 }, tenantId, userId),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when paidNow exceeds totalAmount', async () => {
      const txn = makeTxn({ totalAmount: 5000 });
      const { prisma, tx } = makePrisma(txn);
      tx.transaction.findFirst
        .mockResolvedValueOnce(txn)
        .mockResolvedValueOnce(null);
      tx.paymentAccount.findFirst.mockResolvedValue({ id: 'acct-1', status: 'ACTIVE' });
      const service = new PostingService(prisma);

      await expect(
        service.post('txn-1', { idempotencyKey: 'key-1', paidNow: 9999, paymentAccountId: 'acct-1' }, tenantId, userId),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('post() — PURCHASE entry creation', () => {
    async function postPurchase(txnOverrides = {}, dtoOverrides = {}) {
      const txn = makeTxn({ type: 'PURCHASE', ...txnOverrides });
      const { prisma, tx } = makePrisma(txn);
      tx.transaction.findFirst
        .mockResolvedValueOnce(txn)
        .mockResolvedValueOnce(null)  // no key conflict
        .mockResolvedValueOnce(txn);  // fetchFullTransaction
      tx.$queryRaw
        .mockResolvedValueOnce([{ stock: BigInt(0) }])    // preStock for variant
        .mockResolvedValueOnce([{ last_value: BigInt(1) }]); // document sequence
      const service = new PostingService(prisma);
      await service.post('txn-1', { idempotencyKey: 'key-1', ...dtoOverrides }, tenantId, userId);
      return tx;
    }

    it('creates PURCHASE_IN inventory movement', async () => {
      const tx = await postPurchase();
      expect(tx.inventoryMovement.createMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.arrayContaining([
            expect.objectContaining({ movementType: 'PURCHASE_IN', quantity: 5, unitCostAtTime: 1000 }),
          ]),
        }),
      );
    });

    it('updates variant avgCost: preStock=0, qty=5, cost=1000 → avgCost=1000', async () => {
      const tx = await postPurchase();
      expect(tx.productVariant.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { avgCost: 1000 } }),
      );
    });

    it('creates AP_INCREASE ledger entry', async () => {
      const tx = await postPurchase();
      expect(tx.ledgerEntry.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ entryType: 'AP_INCREASE', amount: 5000 }),
        }),
      );
    });

    it('creates no payment entry when paidNow = 0', async () => {
      const tx = await postPurchase();
      expect(tx.paymentEntry.create).not.toHaveBeenCalled();
    });

    it('creates MONEY_OUT payment entry and AP_DECREASE ledger entry when paidNow > 0', async () => {
      const tx = await postPurchase({}, { paidNow: 2000, paymentAccountId: 'acct-1' });
      expect(tx.paymentEntry.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ entryType: 'MONEY_OUT', direction: 'OUT', amount: 2000 }),
        }),
      );
      // AP_DECREASE for the paid portion
      const ledgerCalls = tx.ledgerEntry.create.mock.calls.map((c: any) => c[0].data.entryType);
      expect(ledgerCalls).toContain('AP_INCREASE');
      expect(ledgerCalls).toContain('AP_DECREASE');
    });
  });

  describe('post() — SALE entry creation', () => {
    async function postSale(dtoOverrides = {}) {
      const txn = makeTxn({
        type: 'SALE',
        customerId: 'customer-1',
        supplierId: null,
        transactionLines: [
          {
            id: 'line-1',
            variantId: 'variant-1',
            quantity: 3,
            unitCost: 0,
            unitPrice: 1500,
            lineTotal: 4500,
            costTotal: 4500,
            sourceTransactionLineId: null,
            variant: { id: 'variant-1', avgCost: 1000, size: 'M', product: { name: 'Product' } },
          },
        ],
        totalAmount: 4500,
      });
      const { prisma, tx } = makePrisma(txn);
      tx.transaction.findFirst
        .mockResolvedValueOnce(txn)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(txn);
      tx.$queryRaw
        .mockResolvedValueOnce([{ stock: BigInt(10) }])   // stock check per variant
        .mockResolvedValueOnce([{ last_value: BigInt(1) }]); // document sequence
      const service = new PostingService(prisma);
      await service.post('txn-1', { idempotencyKey: 'key-1', ...dtoOverrides }, tenantId, userId);
      return tx;
    }

    it('creates SALE_OUT inventory movement with unitCostAtTime = variant.avgCost', async () => {
      const tx = await postSale();
      expect(tx.inventoryMovement.createMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.arrayContaining([
            expect.objectContaining({ movementType: 'SALE_OUT', unitCostAtTime: 1000 }),
          ]),
        }),
      );
    });

    it('creates AR_INCREASE ledger entry', async () => {
      const tx = await postSale();
      expect(tx.ledgerEntry.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ entryType: 'AR_INCREASE' }),
        }),
      );
    });
  });

  describe('post() — INTERNAL_TRANSFER entry creation', () => {
    it('creates two payment entries (OUT + IN) with same transferGroupId, no ledger entries', async () => {
      const txn = makeTxn({
        type: 'INTERNAL_TRANSFER',
        supplierId: null,
        customerId: null,
        fromPaymentAccountId: 'acct-from',
        toPaymentAccountId: 'acct-to',
        totalAmount: 3000,
        transactionLines: [],
      });
      const { prisma, tx } = makePrisma(txn);
      tx.transaction.findFirst
        .mockResolvedValueOnce(txn)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(txn);
      tx.$queryRaw.mockResolvedValueOnce([{ last_value: BigInt(1) }]);
      tx.paymentAccount.findFirst
        .mockResolvedValueOnce({ id: 'acct-from', status: 'ACTIVE' })
        .mockResolvedValueOnce({ id: 'acct-to', status: 'ACTIVE' });
      const service = new PostingService(prisma);

      await service.post('txn-1', dto, tenantId, userId);

      const calls = tx.paymentEntry.create.mock.calls.map((c: any) => c[0].data.direction);
      expect(calls).toContain('OUT');
      expect(calls).toContain('IN');
      expect(tx.paymentEntry.create).toHaveBeenCalledTimes(2);
      expect(tx.ledgerEntry.create).not.toHaveBeenCalled();
    });
  });

  describe('post() — ADJUSTMENT entry creation', () => {
    it('creates ADJUSTMENT_IN movement when direction=IN', async () => {
      const txn = makeTxn({
        type: 'ADJUSTMENT',
        supplierId: null,
        totalAmount: 0,
        transactionLines: [
          {
            id: 'line-1',
            variantId: 'variant-1',
            quantity: 5,
            unitCost: 0,
            lineTotal: 0,
            costTotal: 0,
            description: JSON.stringify({ direction: 'IN', reason: 'Stock count' }),
            sourceTransactionLineId: null,
            variant: { id: 'variant-1', avgCost: 1000, size: 'M', product: { name: 'P' } },
          },
        ],
      });
      const { prisma, tx } = makePrisma(txn);
      tx.transaction.findFirst
        .mockResolvedValueOnce(txn)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(txn);
      tx.$queryRaw.mockResolvedValueOnce([{ last_value: BigInt(1) }]);
      const service = new PostingService(prisma);

      await service.post('txn-1', dto, tenantId, userId);

      // postAdjustment creates one movement per line via create() (not createMany)
      expect(tx.inventoryMovement.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ movementType: 'ADJUSTMENT_IN' }),
        }),
      );
      expect(tx.ledgerEntry.create).not.toHaveBeenCalled();
    });
  });
});
