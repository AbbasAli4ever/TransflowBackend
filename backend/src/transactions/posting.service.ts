import {
  Injectable,
  BadRequestException,
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma, TransactionType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PostTransactionDto } from './dto/post-transaction.dto';

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
              transactionLines: { include: { product: true } },
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
          } else {
            throw new BadRequestException(
              'Only PURCHASE and SALE transactions can be posted',
            );
          }
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          timeout: 10000,
        },
      );
    } catch (err: any) {
      if (err.code === 'P2034') {
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

    // 1. Calculate pre-movement stock for each product (before any writes)
    const preStocks = new Map<string, number>();
    for (const line of txn.transactionLines) {
      const stock = await this.calculateProductStock(
        tx,
        txn.tenantId,
        line.productId,
      );
      preStocks.set(line.productId, stock);
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
        productId: line.productId,
        movementType: 'PURCHASE_IN',
        quantity: line.quantity,
        unitCostAtTime: line.unitCost,
        transactionDate,
        createdBy: userId,
      })),
    });

    // 5. Update avgCost for each product using pre-movement stock
    for (const line of txn.transactionLines) {
      const preStock = preStocks.get(line.productId) ?? 0;
      const oldAvg = line.product.avgCost;
      const qty = line.quantity;
      const unitCost = line.unitCost;

      const newAvg =
        preStock + qty === 0
          ? unitCost
          : Math.round(
              (preStock * oldAvg + qty * unitCost) / (preStock + qty),
            );

      await tx.product.update({
        where: { id: line.productId },
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
      productId: string;
      productName: string;
      available: number;
      required: number;
    }> = [];

    for (const line of txn.transactionLines) {
      const stock = await this.calculateProductStock(
        tx,
        txn.tenantId,
        line.productId,
      );
      if (stock < line.quantity) {
        stockErrors.push({
          productId: line.productId,
          productName: line.product.name,
          available: stock,
          required: line.quantity,
        });
      }
    }

    if (stockErrors.length > 0) {
      throw new UnprocessableEntityException({
        message: 'Insufficient stock for one or more products',
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

    // 4. createMany InventoryMovements (SALE_OUT), unitCostAtTime = product.avgCost
    await tx.inventoryMovement.createMany({
      data: txn.transactionLines.map((line: any) => ({
        tenantId: txn.tenantId,
        transactionId: txn.id,
        transactionLineId: line.id,
        productId: line.productId,
        movementType: 'SALE_OUT',
        quantity: line.quantity,
        unitCostAtTime: line.product.avgCost,
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

  async calculateProductStock(
    tx: any,
    tenantId: string,
    productId: string,
  ): Promise<number> {
    const result = await tx.$queryRaw<Array<{ stock: bigint }>>`
      SELECT COALESCE(SUM(CASE
        WHEN movement_type IN ('PURCHASE_IN', 'CUSTOMER_RETURN_IN', 'ADJUSTMENT_IN') THEN quantity
        ELSE -quantity
      END), 0) AS stock
      FROM inventory_movements
      WHERE tenant_id = ${tenantId}::uuid AND product_id = ${productId}::uuid
    `;
    return Number(result[0]?.stock ?? 0);
  }

  private async generateDocumentNumber(
    tx: any,
    tenantId: string,
    type: TransactionType,
    year: number,
  ): Promise<{ documentNumber: string; series: string }> {
    const series = String(year);
    const count = await tx.transaction.count({
      where: { tenantId, type, series },
    });
    const seq = count + 1;
    const prefix = type === 'PURCHASE' ? 'PUR' : 'SAL';
    const documentNumber = `${prefix}-${year}-${String(seq).padStart(4, '0')}`;
    return { documentNumber, series };
  }

  private async fetchFullTransaction(
    tx: any,
    transactionId: string,
    tenantId: string,
  ) {
    return tx.transaction.findFirst({
      where: { id: transactionId, tenantId },
      include: {
        transactionLines: { include: { product: true } },
        inventoryMovements: true,
        ledgerEntries: true,
        paymentEntries: true,
        supplier: true,
        customer: true,
      },
    });
  }
}
