import {
  Injectable,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { v4 as uuid } from 'uuid';
import { Prisma, TransactionType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { getContext } from '../common/request-context';
import { PostTransactionDto } from './dto/post-transaction.dto';
import { PaymentAllocationItemDto } from './dto/payment-allocation-item.dto';

@Injectable()
export class PostingService {
  constructor(private prisma: PrismaService) {}

  async post(
    transactionId: string,
    dto: PostTransactionDto,
    tenantId: string,
    userId: string,
  ) {
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const txn = await tx.transaction.findFirst({
            where: { id: transactionId, tenantId },
            include: {
              transactionLines: { include: { variant: true } },
            },
          });

          if (!txn) throw new NotFoundException('Transaction not found');

          // Idempotency: already POSTED with same key → return existing (200)
          if (txn.status === 'POSTED') {
            if (txn.idempotencyKey === dto.idempotencyKey) {
              return this.fetchFullTransaction(tx, transactionId, tenantId);
            }
            throw new ConflictException(
              'Transaction already posted with a different idempotency key',
            );
          }

          if (txn.status !== 'DRAFT') {
            throw new BadRequestException('Transaction is not in DRAFT status');
          }

          // Check idempotency key not used on a different transaction
          const keyConflict = await tx.transaction.findFirst({
            where: {
              tenantId,
              idempotencyKey: dto.idempotencyKey,
              NOT: { id: transactionId },
            },
          });
          if (keyConflict) {
            throw new ConflictException(
              'Idempotency key already used on a different transaction',
            );
          }

          // Validate payment fields
          const paymentAmount =
            txn.type === 'PURCHASE'
              ? (dto.paidNow ?? 0)
              : (dto.receivedNow ?? 0);

          if (paymentAmount > 0) {
            if (!dto.paymentAccountId) {
              throw new BadRequestException(
                'paymentAccountId is required when paidNow/receivedNow > 0',
              );
            }
            if (paymentAmount > txn.totalAmount) {
              throw new BadRequestException(
                'Payment amount exceeds transaction total',
              );
            }
            const account = await tx.paymentAccount.findFirst({
              where: { id: dto.paymentAccountId, tenantId },
            });
            if (!account || account.status !== 'ACTIVE') {
              throw new UnprocessableEntityException(
                'Payment account not found or inactive',
              );
            }
          }

          if (txn.type === 'PURCHASE') {
            return this.postPurchase(tx, txn, dto, userId, paymentAmount);
          } else if (txn.type === 'SALE') {
            return this.postSale(tx, txn, dto, userId, paymentAmount);
          } else if (txn.type === 'SUPPLIER_PAYMENT') {
            return this.postSupplierPayment(tx, txn, dto, userId);
          } else if (txn.type === 'CUSTOMER_PAYMENT') {
            return this.postCustomerPayment(tx, txn, dto, userId);
          } else if (txn.type === 'SUPPLIER_RETURN') {
            return this.postSupplierReturn(tx, txn, dto, userId);
          } else if (txn.type === 'CUSTOMER_RETURN') {
            return this.postCustomerReturn(tx, txn, dto, userId);
          } else if (txn.type === 'INTERNAL_TRANSFER') {
            return this.postInternalTransfer(tx, txn, dto, userId);
          } else if (txn.type === 'ADJUSTMENT') {
            return this.postAdjustment(tx, txn, dto, userId);
          } else {
            throw new BadRequestException(
              `Transaction type ${txn.type} cannot be posted`,
            );
          }
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          timeout: 10000,
        },
      );
    } catch (err: any) {
      // P2034: serialization failure from Prisma ORM operations
      // 40001 raw: serialization failure from $queryRaw (document_sequences upsert)
      if (err.code === 'P2034' || err.meta?.code === '40001' || String(err.message).includes('40001')) {
        throw new ConflictException('Serialization conflict, please retry');
      }
      throw err;
    }
  }

  private async postPurchase(
    tx: any,
    txn: any,
    dto: PostTransactionDto,
    userId: string,
    paidNow: number,
  ) {
    const transactionDate = new Date(txn.transactionDate);

    // 1. Calculate pre-movement stock for each variant (before any writes)
    const preStocks = new Map<string, number>();
    for (const line of txn.transactionLines) {
      const stock = await this.calculateVariantStock(
        tx,
        txn.tenantId,
        line.variantId,
      );
      preStocks.set(line.variantId, stock);
    }

    // 2. Generate document number (within Serializable tx)
    const { documentNumber, series } = await this.generateDocumentNumber(
      tx,
      txn.tenantId,
      'PURCHASE',
      transactionDate.getFullYear(),
    );

    // 3. UPDATE transaction: status=POSTED
    await tx.transaction.update({
      where: { id: txn.id },
      data: {
        status: 'POSTED',
        documentNumber,
        series,
        paidNow,
        postedAt: new Date(),
        idempotencyKey: dto.idempotencyKey,
      },
    });

    // 4. createMany InventoryMovements (PURCHASE_IN, one per line)
    await tx.inventoryMovement.createMany({
      data: txn.transactionLines.map((line: any) => ({
        tenantId: txn.tenantId,
        transactionId: txn.id,
        transactionLineId: line.id,
        variantId: line.variantId,
        movementType: 'PURCHASE_IN',
        quantity: line.quantity,
        unitCostAtTime: line.unitCost,
        transactionDate,
        createdBy: userId,
      })),
    });

    // 5. Update avgCost for each variant using pre-movement stock
    for (const line of txn.transactionLines) {
      const preStock = preStocks.get(line.variantId) ?? 0;
      const oldAvg = line.variant.avgCost;
      const qty = line.quantity;
      const unitCost = line.unitCost;

      const newAvg =
        preStock + qty === 0
          ? unitCost
          : Math.round(
              (preStock * oldAvg + qty * unitCost) / (preStock + qty),
            );

      await tx.productVariant.update({
        where: { id: line.variantId },
        data: { avgCost: newAvg },
      });
    }

    // 6. CREATE LedgerEntry: AP_INCREASE
    await tx.ledgerEntry.create({
      data: {
        tenantId: txn.tenantId,
        transactionId: txn.id,
        entryType: 'AP_INCREASE',
        supplierId: txn.supplierId,
        amount: txn.totalAmount,
        transactionDate,
        createdBy: userId,
      },
    });

    // 7. If paidNow > 0: payment entry + AP_DECREASE + allocation
    if (paidNow > 0) {
      await tx.paymentEntry.create({
        data: {
          tenantId: txn.tenantId,
          transactionId: txn.id,
          paymentAccountId: dto.paymentAccountId!,
          entryType: 'MONEY_OUT',
          direction: 'OUT',
          amount: paidNow,
          transactionDate,
          supplierId: txn.supplierId,
          createdBy: userId,
        },
      });

      await tx.ledgerEntry.create({
        data: {
          tenantId: txn.tenantId,
          transactionId: txn.id,
          entryType: 'AP_DECREASE',
          supplierId: txn.supplierId,
          amount: paidNow,
          transactionDate,
          createdBy: userId,
        },
      });

      await tx.allocation.create({
        data: {
          tenantId: txn.tenantId,
          paymentTransactionId: txn.id,
          appliesToTransactionId: txn.id,
          amountApplied: paidNow,
          createdBy: userId,
        },
      });
    }

    return this.fetchFullTransaction(tx, txn.id, txn.tenantId);
  }

  private async postSale(
    tx: any,
    txn: any,
    dto: PostTransactionDto,
    userId: string,
    receivedNow: number,
  ) {
    const transactionDate = new Date(txn.transactionDate);

    // 1. Check stock for ALL lines first (collect all errors before throwing)
    const stockErrors: Array<{
      variantId: string;
      available: number;
      required: number;
    }> = [];

    for (const line of txn.transactionLines) {
      const stock = await this.calculateVariantStock(
        tx,
        txn.tenantId,
        line.variantId,
      );
      if (stock < line.quantity) {
        stockErrors.push({
          variantId: line.variantId,
          available: stock,
          required: line.quantity,
        });
      }
    }

    if (stockErrors.length > 0) {
      throw new UnprocessableEntityException({
        message: 'Insufficient stock for one or more variants',
        errors: stockErrors,
      });
    }

    // 2. Generate document number
    const { documentNumber, series } = await this.generateDocumentNumber(
      tx,
      txn.tenantId,
      'SALE',
      transactionDate.getFullYear(),
    );

    // 3. UPDATE transaction: status=POSTED
    await tx.transaction.update({
      where: { id: txn.id },
      data: {
        status: 'POSTED',
        documentNumber,
        series,
        paidNow: receivedNow,
        postedAt: new Date(),
        idempotencyKey: dto.idempotencyKey,
      },
    });

    // 4. createMany InventoryMovements (SALE_OUT), unitCostAtTime = variant.avgCost
    await tx.inventoryMovement.createMany({
      data: txn.transactionLines.map((line: any) => ({
        tenantId: txn.tenantId,
        transactionId: txn.id,
        transactionLineId: line.id,
        variantId: line.variantId,
        movementType: 'SALE_OUT',
        quantity: line.quantity,
        unitCostAtTime: line.variant.avgCost,
        transactionDate,
        createdBy: userId,
      })),
    });

    // 5. CREATE LedgerEntry: AR_INCREASE
    await tx.ledgerEntry.create({
      data: {
        tenantId: txn.tenantId,
        transactionId: txn.id,
        entryType: 'AR_INCREASE',
        customerId: txn.customerId,
        amount: txn.totalAmount,
        transactionDate,
        createdBy: userId,
      },
    });

    // 6. If receivedNow > 0: payment entry + AR_DECREASE + allocation
    if (receivedNow > 0) {
      await tx.paymentEntry.create({
        data: {
          tenantId: txn.tenantId,
          transactionId: txn.id,
          paymentAccountId: dto.paymentAccountId!,
          entryType: 'MONEY_IN',
          direction: 'IN',
          amount: receivedNow,
          transactionDate,
          customerId: txn.customerId,
          createdBy: userId,
        },
      });

      await tx.ledgerEntry.create({
        data: {
          tenantId: txn.tenantId,
          transactionId: txn.id,
          entryType: 'AR_DECREASE',
          customerId: txn.customerId,
          amount: receivedNow,
          transactionDate,
          createdBy: userId,
        },
      });

      await tx.allocation.create({
        data: {
          tenantId: txn.tenantId,
          paymentTransactionId: txn.id,
          appliesToTransactionId: txn.id,
          amountApplied: receivedNow,
          createdBy: userId,
        },
      });
    }

    return this.fetchFullTransaction(tx, txn.id, txn.tenantId);
  }

  async calculateVariantStock(
    tx: any,
    tenantId: string,
    variantId: string,
  ): Promise<number> {
    const result = await tx.$queryRaw<Array<{ stock: bigint }>>`
      SELECT COALESCE(SUM(CASE
        WHEN movement_type IN ('PURCHASE_IN', 'CUSTOMER_RETURN_IN', 'ADJUSTMENT_IN') THEN quantity
        ELSE -quantity
      END), 0) AS stock
      FROM inventory_movements
      WHERE tenant_id = ${tenantId}::uuid AND variant_id = ${variantId}::uuid
    `;
    return Number(result[0]?.stock ?? 0);
  }

  private async generateDocumentNumber(
    tx: any,
    tenantId: string,
    type: TransactionType,
    year: number,
  ): Promise<{ documentNumber: string; series: string }> {
    const prefixMap: Partial<Record<TransactionType, string>> = {
      PURCHASE: 'PUR',
      SALE: 'SAL',
      SUPPLIER_PAYMENT: 'SPY',
      CUSTOMER_PAYMENT: 'CPY',
      SUPPLIER_RETURN: 'SRN',
      CUSTOMER_RETURN: 'CRN',
      INTERNAL_TRANSFER: 'TRF',
      ADJUSTMENT: 'ADJ',
    };
    const series = String(year);
    // Atomic upsert — prevents sequence gaps/duplicates under concurrent posting
    const seqResult = await tx.$queryRaw<[{ last_value: number }]>`
      INSERT INTO document_sequences (id, tenant_id, transaction_type, last_value)
      VALUES (gen_random_uuid(), ${tenantId}::uuid, ${type}, 1)
      ON CONFLICT (tenant_id, transaction_type)
      DO UPDATE SET last_value = document_sequences.last_value + 1
      RETURNING last_value
    `;
    const seq = Number(seqResult[0].last_value);
    const prefix = prefixMap[type] ?? type.substring(0, 3);
    const documentNumber = `${prefix}-${year}-${String(seq).padStart(4, '0')}`;
    return { documentNumber, series };
  }

  private async postSupplierPayment(
    tx: any,
    txn: any,
    dto: PostTransactionDto,
    userId: string,
  ) {
    const transactionDate = new Date(txn.transactionDate);

    if (!txn.fromPaymentAccountId) {
      throw new BadRequestException('Payment account missing on transaction');
    }

    // Task 2.7 — Revalidate supplier and payment account are still ACTIVE at post time
    const supplier = await tx.supplier.findFirst({
      where: { id: txn.supplierId, tenantId: txn.tenantId },
    });
    if (!supplier || supplier.status !== 'ACTIVE') {
      throw new BadRequestException('Supplier is not active');
    }

    const paymentAccount = await tx.paymentAccount.findFirst({
      where: { id: txn.fromPaymentAccountId, tenantId: txn.tenantId },
    });
    if (!paymentAccount || paymentAccount.status !== 'ACTIVE') {
      throw new BadRequestException('Payment account is not active');
    }

    const { documentNumber, series } = await this.generateDocumentNumber(
      tx,
      txn.tenantId,
      'SUPPLIER_PAYMENT',
      transactionDate.getFullYear(),
    );

    await tx.transaction.update({
      where: { id: txn.id },
      data: {
        status: 'POSTED',
        documentNumber,
        series,
        postedAt: new Date(),
        idempotencyKey: dto.idempotencyKey,
      },
    });

    await tx.paymentEntry.create({
      data: {
        tenantId: txn.tenantId,
        transactionId: txn.id,
        paymentAccountId: txn.fromPaymentAccountId,
        entryType: 'MONEY_OUT',
        direction: 'OUT',
        amount: txn.totalAmount,
        transactionDate,
        supplierId: txn.supplierId,
        createdBy: userId,
      },
    });

    await tx.ledgerEntry.create({
      data: {
        tenantId: txn.tenantId,
        transactionId: txn.id,
        entryType: 'AP_DECREASE',
        supplierId: txn.supplierId,
        amount: txn.totalAmount,
        transactionDate,
        createdBy: userId,
      },
    });

    if (dto.allocations && dto.allocations.length > 0) {
      await this.applyManualAllocations(tx, txn, dto.allocations, userId, 'PURCHASE');
    } else {
      await this.autoAllocate(tx, txn, userId, 'PURCHASE');
    }

    return this.fetchFullTransaction(tx, txn.id, txn.tenantId);
  }

  private async postCustomerPayment(
    tx: any,
    txn: any,
    dto: PostTransactionDto,
    userId: string,
  ) {
    const transactionDate = new Date(txn.transactionDate);

    if (!txn.fromPaymentAccountId) {
      throw new BadRequestException('Payment account missing on transaction');
    }

    // Task 2.7 — Revalidate customer and payment account are still ACTIVE at post time
    const customer = await tx.customer.findFirst({
      where: { id: txn.customerId, tenantId: txn.tenantId },
    });
    if (!customer || customer.status !== 'ACTIVE') {
      throw new BadRequestException('Customer is not active');
    }

    const paymentAccount = await tx.paymentAccount.findFirst({
      where: { id: txn.fromPaymentAccountId, tenantId: txn.tenantId },
    });
    if (!paymentAccount || paymentAccount.status !== 'ACTIVE') {
      throw new BadRequestException('Payment account is not active');
    }

    const { documentNumber, series } = await this.generateDocumentNumber(
      tx,
      txn.tenantId,
      'CUSTOMER_PAYMENT',
      transactionDate.getFullYear(),
    );

    await tx.transaction.update({
      where: { id: txn.id },
      data: {
        status: 'POSTED',
        documentNumber,
        series,
        postedAt: new Date(),
        idempotencyKey: dto.idempotencyKey,
      },
    });

    await tx.paymentEntry.create({
      data: {
        tenantId: txn.tenantId,
        transactionId: txn.id,
        paymentAccountId: txn.fromPaymentAccountId,
        entryType: 'MONEY_IN',
        direction: 'IN',
        amount: txn.totalAmount,
        transactionDate,
        customerId: txn.customerId,
        createdBy: userId,
      },
    });

    await tx.ledgerEntry.create({
      data: {
        tenantId: txn.tenantId,
        transactionId: txn.id,
        entryType: 'AR_DECREASE',
        customerId: txn.customerId,
        amount: txn.totalAmount,
        transactionDate,
        createdBy: userId,
      },
    });

    if (dto.allocations && dto.allocations.length > 0) {
      await this.applyManualAllocations(tx, txn, dto.allocations, userId, 'SALE');
    } else {
      await this.autoAllocate(tx, txn, userId, 'SALE');
    }

    return this.fetchFullTransaction(tx, txn.id, txn.tenantId);
  }

  private async postSupplierReturn(
    tx: any,
    txn: any,
    dto: PostTransactionDto,
    userId: string,
  ) {
    const transactionDate = new Date(txn.transactionDate);

    // Reload lines with variant for race-condition guard
    const lines = await tx.transactionLine.findMany({
      where: { transactionId: txn.id },
      include: { variant: true },
    });

    // Task 2.4 — Aggregate quantities by sourceTransactionLineId to prevent over-return via duplicates
    const aggregatedReturnQty = new Map<string, number>();
    for (const line of lines) {
      if (!line.sourceTransactionLineId) continue;
      aggregatedReturnQty.set(
        line.sourceTransactionLineId,
        (aggregatedReturnQty.get(line.sourceTransactionLineId) ?? 0) + line.quantity,
      );
    }

    // Re-validate returnableQty within Serializable tx using aggregated quantities
    for (const [sourceLineId, totalQty] of aggregatedReturnQty) {
      const returnableQty = await this.getReturnableQty(tx, sourceLineId, txn.tenantId);
      if (totalQty > returnableQty) {
        throw new UnprocessableEntityException(
          `Return quantity ${totalQty} exceeds returnable ${returnableQty} for line ${sourceLineId}`,
        );
      }
    }

    // Task 2.1 — Stock check: ensure current stock >= return quantity for each variant
    for (const line of lines) {
      const currentStock = await this.calculateVariantStock(tx, txn.tenantId, line.variantId);
      if (currentStock < line.quantity) {
        throw new UnprocessableEntityException(
          `Insufficient stock for variant ${line.variantId}: available ${currentStock}, required ${line.quantity}`,
        );
      }
    }

    const { documentNumber, series } = await this.generateDocumentNumber(
      tx,
      txn.tenantId,
      'SUPPLIER_RETURN',
      transactionDate.getFullYear(),
    );

    await tx.transaction.update({
      where: { id: txn.id },
      data: {
        status: 'POSTED',
        documentNumber,
        series,
        postedAt: new Date(),
        idempotencyKey: dto.idempotencyKey,
      },
    });

    await tx.inventoryMovement.createMany({
      data: lines.map((line: any) => ({
        tenantId: txn.tenantId,
        transactionId: txn.id,
        transactionLineId: line.id,
        variantId: line.variantId,
        movementType: 'SUPPLIER_RETURN_OUT',
        quantity: line.quantity,
        unitCostAtTime: line.unitCost ?? 0,
        transactionDate,
        createdBy: userId,
      })),
    });

    await tx.ledgerEntry.create({
      data: {
        tenantId: txn.tenantId,
        transactionId: txn.id,
        entryType: 'AP_DECREASE',
        supplierId: txn.supplierId,
        amount: txn.totalAmount,
        transactionDate,
        createdBy: userId,
      },
    });

    return this.fetchFullTransaction(tx, txn.id, txn.tenantId);
  }

  private async postCustomerReturn(
    tx: any,
    txn: any,
    dto: PostTransactionDto,
    userId: string,
  ) {
    const transactionDate = new Date(txn.transactionDate);

    // Reload lines with variant for race-condition guard + avgCost update
    const lines = await tx.transactionLine.findMany({
      where: { transactionId: txn.id },
      include: { variant: true },
    });

    // Task 2.5 — returnHandling is required for CUSTOMER_RETURN posting
    if (!dto.returnHandling) {
      throw new BadRequestException(
        'returnHandling is required for CUSTOMER_RETURN posting: REFUND_NOW or STORE_CREDIT',
      );
    }

    // Task 2.4 — Aggregate quantities by sourceTransactionLineId to prevent over-return via duplicates
    const aggregatedReturnQty = new Map<string, number>();
    for (const line of lines) {
      if (!line.sourceTransactionLineId) continue;
      aggregatedReturnQty.set(
        line.sourceTransactionLineId,
        (aggregatedReturnQty.get(line.sourceTransactionLineId) ?? 0) + line.quantity,
      );
    }

    // Re-validate returnableQty within Serializable tx using aggregated quantities
    for (const [sourceLineId, totalQty] of aggregatedReturnQty) {
      const returnableQty = await this.getReturnableQty(tx, sourceLineId, txn.tenantId);
      if (totalQty > returnableQty) {
        throw new UnprocessableEntityException(
          `Return quantity ${totalQty} exceeds returnable ${returnableQty} for line ${sourceLineId}`,
        );
      }
    }

    const { documentNumber, series } = await this.generateDocumentNumber(
      tx,
      txn.tenantId,
      'CUSTOMER_RETURN',
      transactionDate.getFullYear(),
    );

    await tx.transaction.update({
      where: { id: txn.id },
      data: {
        status: 'POSTED',
        documentNumber,
        series,
        postedAt: new Date(),
        idempotencyKey: dto.idempotencyKey,
      },
    });

    await tx.inventoryMovement.createMany({
      data: lines.map((line: any) => ({
        tenantId: txn.tenantId,
        transactionId: txn.id,
        transactionLineId: line.id,
        variantId: line.variantId,
        movementType: 'CUSTOMER_RETURN_IN',
        quantity: line.quantity,
        unitCostAtTime: line.variant.avgCost,
        transactionDate,
        createdBy: userId,
      })),
    });

    // Update avgCost for returned variants (weighted average)
    for (const line of lines) {
      const preStock = await this.calculateVariantStock(tx, txn.tenantId, line.variantId);
      // preStock already includes the CUSTOMER_RETURN_IN we just created (visible in same tx)
      // so subtract our new qty to get the pre-return stock
      const stockBeforeReturn = preStock - line.quantity;
      const oldAvg = line.variant.avgCost;
      const qty = line.quantity;

      const newAvg =
        stockBeforeReturn + qty === 0
          ? oldAvg
          : Math.round(
              (stockBeforeReturn * oldAvg + qty * oldAvg) / (stockBeforeReturn + qty),
            );

      await tx.productVariant.update({
        where: { id: line.variantId },
        data: { avgCost: newAvg },
      });
    }

    await tx.ledgerEntry.create({
      data: {
        tenantId: txn.tenantId,
        transactionId: txn.id,
        entryType: 'AR_DECREASE',
        customerId: txn.customerId,
        amount: txn.totalAmount,
        transactionDate,
        createdBy: userId,
      },
    });

    if (dto.returnHandling === 'REFUND_NOW') {
      if (!dto.paymentAccountId) {
        throw new BadRequestException(
          'paymentAccountId is required when returnHandling is REFUND_NOW',
        );
      }
      const account = await tx.paymentAccount.findFirst({
        where: { id: dto.paymentAccountId, tenantId: txn.tenantId },
      });
      if (!account || account.status !== 'ACTIVE') {
        throw new UnprocessableEntityException('Payment account not found or inactive');
      }
      await tx.paymentEntry.create({
        data: {
          tenantId: txn.tenantId,
          transactionId: txn.id,
          paymentAccountId: dto.paymentAccountId,
          entryType: 'MONEY_OUT',
          direction: 'OUT',
          amount: txn.totalAmount,
          transactionDate,
          customerId: txn.customerId,
          createdBy: userId,
        },
      });
    }

    return this.fetchFullTransaction(tx, txn.id, txn.tenantId);
  }

  private async postInternalTransfer(
    tx: any,
    txn: any,
    dto: PostTransactionDto,
    userId: string,
  ) {
    const transactionDate = new Date(txn.transactionDate);

    if (!txn.fromPaymentAccountId || !txn.toPaymentAccountId) {
      throw new BadRequestException('Transfer accounts missing on transaction');
    }

    const fromAccount = await tx.paymentAccount.findFirst({
      where: { id: txn.fromPaymentAccountId, tenantId: txn.tenantId },
    });
    if (!fromAccount || fromAccount.status !== 'ACTIVE') {
      throw new UnprocessableEntityException('From payment account not found or inactive');
    }

    const toAccount = await tx.paymentAccount.findFirst({
      where: { id: txn.toPaymentAccountId, tenantId: txn.tenantId },
    });
    if (!toAccount || toAccount.status !== 'ACTIVE') {
      throw new UnprocessableEntityException('To payment account not found or inactive');
    }

    const { documentNumber, series } = await this.generateDocumentNumber(
      tx,
      txn.tenantId,
      'INTERNAL_TRANSFER',
      transactionDate.getFullYear(),
    );

    await tx.transaction.update({
      where: { id: txn.id },
      data: {
        status: 'POSTED',
        documentNumber,
        series,
        postedAt: new Date(),
        idempotencyKey: dto.idempotencyKey,
      },
    });

    const transferGroupId = uuid();

    await tx.paymentEntry.create({
      data: {
        tenantId: txn.tenantId,
        transactionId: txn.id,
        paymentAccountId: txn.fromPaymentAccountId,
        entryType: 'MONEY_OUT',
        direction: 'OUT',
        amount: txn.totalAmount,
        transactionDate,
        transferGroupId,
        createdBy: userId,
      },
    });

    await tx.paymentEntry.create({
      data: {
        tenantId: txn.tenantId,
        transactionId: txn.id,
        paymentAccountId: txn.toPaymentAccountId,
        entryType: 'MONEY_IN',
        direction: 'IN',
        amount: txn.totalAmount,
        transactionDate,
        transferGroupId,
        createdBy: userId,
      },
    });

    return this.fetchFullTransaction(tx, txn.id, txn.tenantId);
  }

  private async postAdjustment(
    tx: any,
    txn: any,
    dto: PostTransactionDto,
    userId: string,
  ) {
    // Task 2.3 — Only OWNER or ADMIN can post adjustments
    const userRole = getContext()?.userRole;
    if (userRole !== 'OWNER' && userRole !== 'ADMIN') {
      throw new ForbiddenException('Only OWNER or ADMIN can post adjustments');
    }

    const transactionDate = new Date(txn.transactionDate);

    const lines = await tx.transactionLine.findMany({
      where: { transactionId: txn.id },
    });

    const { documentNumber, series } = await this.generateDocumentNumber(
      tx,
      txn.tenantId,
      'ADJUSTMENT',
      transactionDate.getFullYear(),
    );

    await tx.transaction.update({
      where: { id: txn.id },
      data: {
        status: 'POSTED',
        documentNumber,
        series,
        postedAt: new Date(),
        idempotencyKey: dto.idempotencyKey,
      },
    });

    for (const line of lines) {
      // Parse direction and reason from JSON in description field
      let direction = 'IN';
      try {
        const parsed = JSON.parse(line.description ?? '{}');
        if (parsed.direction === 'OUT') direction = 'OUT';
      } catch {
        // legacy pipe-delimited fallback
        direction = (line.description ?? 'IN|').split('|')[0] ?? 'IN';
      }
      const movementType = direction === 'OUT' ? 'ADJUSTMENT_OUT' : 'ADJUSTMENT_IN';

      // Task 2.2 — Stock check before ADJUSTMENT_OUT
      if (movementType === 'ADJUSTMENT_OUT') {
        const currentStock = await this.calculateVariantStock(tx, txn.tenantId, line.variantId);
        if (currentStock < line.quantity) {
          throw new UnprocessableEntityException(
            `Insufficient stock for variant ${line.variantId}: available ${currentStock}, required ${line.quantity}`,
          );
        }
      }

      await tx.inventoryMovement.create({
        data: {
          tenantId: txn.tenantId,
          transactionId: txn.id,
          transactionLineId: line.id,
          variantId: line.variantId,
          movementType,
          quantity: line.quantity,
          unitCostAtTime: 0,
          transactionDate,
          createdBy: userId,
        },
      });
    }

    return this.fetchFullTransaction(tx, txn.id, txn.tenantId);
  }

  private async getReturnableQty(
    tx: any,
    sourceTransactionLineId: string,
    tenantId: string,
  ): Promise<number> {
    const sourceLine = await tx.transactionLine.findFirst({
      where: { id: sourceTransactionLineId, tenantId },
    });
    if (!sourceLine) throw new NotFoundException(`Source line ${sourceTransactionLineId} not found`);

    const result = await tx.$queryRaw<[{ returned: bigint }]>`
      SELECT COALESCE(SUM(tl.quantity), 0) AS returned
      FROM transaction_lines tl
      JOIN transactions t ON t.id = tl.transaction_id
      WHERE tl.source_transaction_line_id = ${sourceTransactionLineId}::uuid
        AND tl.tenant_id = ${tenantId}::uuid
        AND t.status = 'POSTED'
        AND t.type IN ('SUPPLIER_RETURN', 'CUSTOMER_RETURN')
    `;
    return sourceLine.quantity - Number(result[0]?.returned ?? 0);
  }

  private async autoAllocate(
    tx: any,
    txn: any,
    userId: string,
    docType: 'PURCHASE' | 'SALE',
  ) {
    const tenantId = txn.tenantId;

    let rows: Array<{ id: string; outstanding: bigint }>;

    if (docType === 'PURCHASE') {
      rows = await tx.$queryRaw<Array<{ id: string; outstanding: bigint }>>`
        SELECT t.id, t.total_amount - COALESCE(SUM(a.amount_applied), 0) AS outstanding
        FROM transactions t
        LEFT JOIN allocations a ON a.applies_to_transaction_id = t.id AND a.tenant_id = ${tenantId}::uuid
        WHERE t.tenant_id = ${tenantId}::uuid
          AND t.supplier_id = ${txn.supplierId}::uuid
          AND t.type = 'PURCHASE'
          AND t.status = 'POSTED'
        GROUP BY t.id, t.total_amount, t.transaction_date
        HAVING t.total_amount - COALESCE(SUM(a.amount_applied), 0) > 0
        ORDER BY t.transaction_date ASC
      `;
    } else {
      rows = await tx.$queryRaw<Array<{ id: string; outstanding: bigint }>>`
        SELECT t.id, t.total_amount - COALESCE(SUM(a.amount_applied), 0) AS outstanding
        FROM transactions t
        LEFT JOIN allocations a ON a.applies_to_transaction_id = t.id AND a.tenant_id = ${tenantId}::uuid
        WHERE t.tenant_id = ${tenantId}::uuid
          AND t.customer_id = ${txn.customerId}::uuid
          AND t.type = 'SALE'
          AND t.status = 'POSTED'
        GROUP BY t.id, t.total_amount, t.transaction_date
        HAVING t.total_amount - COALESCE(SUM(a.amount_applied), 0) > 0
        ORDER BY t.transaction_date ASC
      `;
    }

    let remaining = txn.totalAmount;
    for (const row of rows) {
      if (remaining <= 0) break;
      const outstanding = Number(row.outstanding);
      const apply = Math.min(remaining, outstanding);
      await tx.allocation.create({
        data: {
          tenantId,
          paymentTransactionId: txn.id,
          appliesToTransactionId: row.id,
          amountApplied: apply,
          createdBy: userId,
        },
      });
      remaining -= apply;
    }
    // remaining > 0 = unallocated credit — allowed by spec
  }

  private async applyManualAllocations(
    tx: any,
    txn: any,
    allocations: PaymentAllocationItemDto[],
    userId: string,
    docType: 'PURCHASE' | 'SALE',
  ) {
    const tenantId = txn.tenantId;
    const entityId = docType === 'PURCHASE' ? txn.supplierId : txn.customerId;

    const uniqueIds = new Set(allocations.map((a) => a.transactionId));
    if (uniqueIds.size !== allocations.length) {
      throw new UnprocessableEntityException(
        'Duplicate transactionId in allocations array',
      );
    }

    const totalRequested = allocations.reduce((sum, a) => sum + a.amount, 0);
    if (totalRequested > txn.totalAmount) {
      throw new UnprocessableEntityException(
        'Total allocations exceed payment amount',
      );
    }

    for (const alloc of allocations) {
      const doc = await tx.transaction.findFirst({
        where: { id: alloc.transactionId, tenantId, status: 'POSTED', type: docType },
      });
      if (!doc) {
        throw new UnprocessableEntityException(
          `Document ${alloc.transactionId} not found or not eligible`,
        );
      }
      if (docType === 'PURCHASE' && doc.supplierId !== entityId) {
        throw new UnprocessableEntityException(
          `Document ${alloc.transactionId} does not belong to this supplier`,
        );
      }
      if (docType === 'SALE' && doc.customerId !== entityId) {
        throw new UnprocessableEntityException(
          `Document ${alloc.transactionId} does not belong to this customer`,
        );
      }

      const allocResult = await tx.$queryRaw<Array<{ total_allocated: bigint }>>`
        SELECT COALESCE(SUM(amount_applied), 0) AS total_allocated
        FROM allocations
        WHERE applies_to_transaction_id = ${alloc.transactionId}::uuid
          AND tenant_id = ${tenantId}::uuid
      `;
      const totalAllocated = Number(allocResult[0]?.total_allocated ?? 0);
      const outstanding = doc.totalAmount - totalAllocated;

      if (alloc.amount > outstanding) {
        throw new UnprocessableEntityException(
          `Allocation amount ${alloc.amount} exceeds outstanding ${outstanding} for document ${alloc.transactionId}`,
        );
      }

      await tx.allocation.create({
        data: {
          tenantId,
          paymentTransactionId: txn.id,
          appliesToTransactionId: alloc.transactionId,
          amountApplied: alloc.amount,
          createdBy: userId,
        },
      });
    }
  }

  private async fetchFullTransaction(
    tx: any,
    transactionId: string,
    tenantId: string,
  ) {
    return tx.transaction.findFirst({
      where: { id: transactionId, tenantId },
      include: {
        transactionLines: { include: { variant: { include: { product: true } } } },
        inventoryMovements: true,
        ledgerEntries: true,
        paymentEntries: true,
        supplier: true,
        customer: true,
      },
    });
  }
}
