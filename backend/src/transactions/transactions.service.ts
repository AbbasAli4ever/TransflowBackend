import {
  Injectable,
  UnauthorizedException,
  NotFoundException,
  BadRequestException,
  UnprocessableEntityException,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { getContext } from '../common/request-context';
import { paginateResponse } from '../common/utils/paginate';
import { PostingService } from './posting.service';
import { CreatePurchaseDraftDto } from './dto/create-purchase-draft.dto';
import { CreateSaleDraftDto } from './dto/create-sale-draft.dto';
import { PostTransactionDto } from './dto/post-transaction.dto';
import { ListTransactionsQueryDto } from './dto/list-transactions-query.dto';
import { CreateSupplierPaymentDraftDto } from './dto/create-supplier-payment-draft.dto';
import { CreateCustomerPaymentDraftDto } from './dto/create-customer-payment-draft.dto';
import { ListAllocationsQueryDto } from './dto/list-allocations-query.dto';
import { CreateSupplierReturnDraftDto } from './dto/create-supplier-return-draft.dto';
import { CreateCustomerReturnDraftDto } from './dto/create-customer-return-draft.dto';
import { CreateInternalTransferDraftDto } from './dto/create-internal-transfer-draft.dto';
import { CreateAdjustmentDraftDto } from './dto/create-adjustment-draft.dto';

@Injectable()
export class TransactionsService {
  constructor(
    private prisma: PrismaService,
    private postingService: PostingService,
  ) {}

  async createPurchaseDraft(dto: CreatePurchaseDraftDto) {
    const tenantId = getContext()?.tenantId;
    if (!tenantId) throw new UnauthorizedException();
    const createdBy = getContext()?.userId;

    const existing = await this.checkDraftIdempotency(tenantId, dto.idempotencyKey);
    if (existing) return existing;

    this.assertDateNotFuture(dto.transactionDate);

    const supplier = await this.prisma.supplier.findFirst({
      where: { id: dto.supplierId, tenantId },
    });
    if (!supplier) throw new NotFoundException('Supplier not found');
    if (supplier.status !== 'ACTIVE') {
      throw new UnprocessableEntityException('Supplier is not active');
    }

    const processedLines = await this.validateAndProcessPurchaseLines(
      dto.lines,
      tenantId,
    );

    const deliveryFee = dto.deliveryFee ?? 0;
    const discountTotal = processedLines.reduce(
      (sum, l) => sum + l.discountAmount,
      0,
    );
    const subtotal = processedLines.reduce((sum, l) => sum + l.lineTotal, 0);
    const totalAmount = subtotal + deliveryFee;

    return this.prisma.$transaction(async (tx) => {
      const txn = await tx.transaction.create({
        data: {
          tenantId,
          type: 'PURCHASE',
          status: 'DRAFT',
          transactionDate: new Date(dto.transactionDate),
          supplierId: dto.supplierId,
          subtotal,
          discountTotal,
          deliveryFee,
          totalAmount,
          notes: dto.notes,
          idempotencyKey: dto.idempotencyKey,
          createdBy,
        },
      });

      await tx.transactionLine.createMany({
        data: processedLines.map((line) => ({
          tenantId,
          transactionId: txn.id,
          productId: line.productId,
          quantity: line.quantity,
          unitCost: line.unitCost,
          discountAmount: line.discountAmount,
          lineTotal: line.lineTotal,
          costTotal: line.lineTotal,
          createdBy,
        })),
      });

      return tx.transaction.findFirst({
        where: { id: txn.id },
        include: { transactionLines: true },
      });
    });
  }

  async createSaleDraft(dto: CreateSaleDraftDto) {
    const tenantId = getContext()?.tenantId;
    if (!tenantId) throw new UnauthorizedException();
    const createdBy = getContext()?.userId;

    const existing = await this.checkDraftIdempotency(tenantId, dto.idempotencyKey);
    if (existing) return existing;

    this.assertDateNotFuture(dto.transactionDate);

    const customer = await this.prisma.customer.findFirst({
      where: { id: dto.customerId, tenantId },
    });
    if (!customer) throw new NotFoundException('Customer not found');
    if (customer.status !== 'ACTIVE') {
      throw new UnprocessableEntityException('Customer is not active');
    }

    const processedLines = await this.validateAndProcessSaleLines(
      dto.lines,
      tenantId,
    );

    const deliveryFee = dto.deliveryFee ?? 0;
    const discountTotal = processedLines.reduce(
      (sum, l) => sum + l.discountAmount,
      0,
    );
    const subtotal = processedLines.reduce((sum, l) => sum + l.lineTotal, 0);
    const totalAmount = subtotal + deliveryFee;

    return this.prisma.$transaction(async (tx) => {
      const txn = await tx.transaction.create({
        data: {
          tenantId,
          type: 'SALE',
          status: 'DRAFT',
          transactionDate: new Date(dto.transactionDate),
          customerId: dto.customerId,
          subtotal,
          discountTotal,
          deliveryFee,
          totalAmount,
          deliveryType: dto.deliveryType,
          deliveryAddress: dto.deliveryAddress,
          notes: dto.notes,
          idempotencyKey: dto.idempotencyKey,
          createdBy,
        },
      });

      await tx.transactionLine.createMany({
        data: processedLines.map((line) => ({
          tenantId,
          transactionId: txn.id,
          productId: line.productId,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          discountAmount: line.discountAmount,
          lineTotal: line.lineTotal,
          costTotal: line.lineTotal,
          createdBy,
        })),
      });

      return tx.transaction.findFirst({
        where: { id: txn.id },
        include: { transactionLines: true },
      });
    });
  }

  async post(id: string, dto: PostTransactionDto) {
    const tenantId = getContext()?.tenantId;
    if (!tenantId) throw new UnauthorizedException();
    const userId = getContext()?.userId ?? '';

    const txn = await this.prisma.transaction.findFirst({
      where: { id, tenantId },
    });
    if (!txn) throw new NotFoundException('Transaction not found');

    return this.postingService.post(id, dto, tenantId, userId);
  }

  async findAll(query: ListTransactionsQueryDto) {
    const tenantId = getContext()?.tenantId;
    if (!tenantId) throw new UnauthorizedException();

    const {
      page,
      limit,
      type,
      status,
      dateFrom,
      dateTo,
      supplierId,
      customerId,
      sortBy = 'transactionDate',
      sortOrder = 'desc',
    } = query;
    const skip = (page - 1) * limit;

    const where: any = { tenantId };
    if (type) where.type = type;
    if (status) where.status = status;
    if (supplierId) where.supplierId = supplierId;
    if (customerId) where.customerId = customerId;
    if (dateFrom || dateTo) {
      where.transactionDate = {};
      if (dateFrom) where.transactionDate.gte = new Date(dateFrom);
      if (dateTo) where.transactionDate.lte = new Date(dateTo);
    }

    const [transactions, total] = await Promise.all([
      this.prisma.transaction.findMany({
        where,
        skip,
        take: limit,
        orderBy: { [sortBy]: sortOrder },
        include: { transactionLines: true },
      }),
      this.prisma.transaction.count({ where }),
    ]);

    return paginateResponse(transactions, total, page, limit);
  }

  async findOne(id: string) {
    const tenantId = getContext()?.tenantId;
    if (!tenantId) throw new UnauthorizedException();

    const transaction = await this.prisma.transaction.findFirst({
      where: { id, tenantId },
      include: {
        transactionLines: { include: { product: true } },
        inventoryMovements: true,
        ledgerEntries: true,
        paymentEntries: true,
        supplier: true,
        customer: true,
      },
    });
    if (!transaction) throw new NotFoundException('Transaction not found');
    return transaction;
  }

  async createSupplierPaymentDraft(dto: CreateSupplierPaymentDraftDto) {
    const tenantId = getContext()?.tenantId;
    if (!tenantId) throw new UnauthorizedException();
    const createdBy = getContext()?.userId;

    const existing = await this.checkDraftIdempotency(tenantId, dto.idempotencyKey);
    if (existing) return existing;

    this.assertDateNotFuture(dto.transactionDate);

    const supplier = await this.prisma.supplier.findFirst({
      where: { id: dto.supplierId, tenantId },
    });
    if (!supplier) throw new NotFoundException('Supplier not found');
    if (supplier.status !== 'ACTIVE') {
      throw new UnprocessableEntityException('Supplier is not active');
    }

    const account = await this.prisma.paymentAccount.findFirst({
      where: { id: dto.paymentAccountId, tenantId },
    });
    if (!account) throw new NotFoundException('Payment account not found');
    if (account.status !== 'ACTIVE') {
      throw new UnprocessableEntityException('Payment account is not active');
    }

    return this.prisma.transaction.create({
      data: {
        tenantId,
        type: 'SUPPLIER_PAYMENT',
        status: 'DRAFT',
        transactionDate: new Date(dto.transactionDate),
        supplierId: dto.supplierId,
        fromPaymentAccountId: dto.paymentAccountId,
        totalAmount: dto.amount,
        subtotal: dto.amount,
        notes: dto.notes,
        idempotencyKey: dto.idempotencyKey,
        createdBy,
      },
    });
  }

  async createCustomerPaymentDraft(dto: CreateCustomerPaymentDraftDto) {
    const tenantId = getContext()?.tenantId;
    if (!tenantId) throw new UnauthorizedException();
    const createdBy = getContext()?.userId;

    const existing = await this.checkDraftIdempotency(tenantId, dto.idempotencyKey);
    if (existing) return existing;

    this.assertDateNotFuture(dto.transactionDate);

    const customer = await this.prisma.customer.findFirst({
      where: { id: dto.customerId, tenantId },
    });
    if (!customer) throw new NotFoundException('Customer not found');
    if (customer.status !== 'ACTIVE') {
      throw new UnprocessableEntityException('Customer is not active');
    }

    const account = await this.prisma.paymentAccount.findFirst({
      where: { id: dto.paymentAccountId, tenantId },
    });
    if (!account) throw new NotFoundException('Payment account not found');
    if (account.status !== 'ACTIVE') {
      throw new UnprocessableEntityException('Payment account is not active');
    }

    return this.prisma.transaction.create({
      data: {
        tenantId,
        type: 'CUSTOMER_PAYMENT',
        status: 'DRAFT',
        transactionDate: new Date(dto.transactionDate),
        customerId: dto.customerId,
        fromPaymentAccountId: dto.paymentAccountId,
        totalAmount: dto.amount,
        subtotal: dto.amount,
        notes: dto.notes,
        idempotencyKey: dto.idempotencyKey,
        createdBy,
      },
    });
  }

  async createSupplierReturnDraft(dto: CreateSupplierReturnDraftDto) {
    const tenantId = getContext()?.tenantId;
    if (!tenantId) throw new UnauthorizedException();
    const createdBy = getContext()?.userId;

    const existing = await this.checkDraftIdempotency(tenantId, dto.idempotencyKey);
    if (existing) return existing;

    this.assertDateNotFuture(dto.transactionDate);

    // Task 2.4 — Reject duplicate sourceTransactionLineId in a single request
    const sourceLineIds = dto.lines.map((l) => l.sourceTransactionLineId);
    if (new Set(sourceLineIds).size !== sourceLineIds.length) {
      throw new UnprocessableEntityException(
        'Duplicate sourceTransactionLineId in request: each source line may only appear once',
      );
    }

    const supplier = await this.prisma.supplier.findFirst({
      where: { id: dto.supplierId, tenantId },
    });
    if (!supplier) throw new NotFoundException('Supplier not found');
    if (supplier.status !== 'ACTIVE') {
      throw new UnprocessableEntityException('Supplier is not active');
    }

    const processedLines: Array<{
      sourceTransactionLineId: string;
      productId: string;
      quantity: number;
      unitCost: number;
      lineTotal: number;
    }> = [];

    for (const line of dto.lines) {
      const sourceLine = await this.prisma.transactionLine.findFirst({
        where: { id: line.sourceTransactionLineId, tenantId },
        include: { transaction: true },
      });
      if (!sourceLine) {
        throw new UnprocessableEntityException(
          `Source line ${line.sourceTransactionLineId} not found`,
        );
      }
      if (
        sourceLine.transaction.type !== 'PURCHASE' ||
        sourceLine.transaction.status !== 'POSTED' ||
        sourceLine.transaction.supplierId !== dto.supplierId
      ) {
        throw new UnprocessableEntityException(
          `Source line ${line.sourceTransactionLineId} is not from a posted PURCHASE for this supplier`,
        );
      }

      const returnedResult = await this.prisma.$queryRaw<[{ returned: bigint }]>`
        SELECT COALESCE(SUM(tl.quantity), 0) AS returned
        FROM transaction_lines tl
        JOIN transactions t ON t.id = tl.transaction_id
        WHERE tl.source_transaction_line_id = ${line.sourceTransactionLineId}::uuid
          AND tl.tenant_id = ${tenantId}::uuid
          AND t.status = 'POSTED'
          AND t.type IN ('SUPPLIER_RETURN', 'CUSTOMER_RETURN')
      `;
      const alreadyReturned = Number(returnedResult[0]?.returned ?? 0);
      const returnableQty = sourceLine.quantity - alreadyReturned;

      if (line.quantity > returnableQty) {
        throw new UnprocessableEntityException(
          `Cannot return ${line.quantity} units for line ${line.sourceTransactionLineId}: only ${returnableQty} returnable`,
        );
      }

      const effectiveUnitCost = sourceLine.quantity > 0
        ? Math.floor((sourceLine.lineTotal ?? 0) / sourceLine.quantity)
        : (sourceLine.unitCost ?? 0);
      processedLines.push({
        sourceTransactionLineId: line.sourceTransactionLineId,
        productId: sourceLine.productId,
        quantity: line.quantity,
        unitCost: effectiveUnitCost,
        lineTotal: line.quantity * effectiveUnitCost,
      });
    }

    const subtotal = processedLines.reduce((sum, l) => sum + l.lineTotal, 0);

    return this.prisma.$transaction(async (tx) => {
      const txn = await tx.transaction.create({
        data: {
          tenantId,
          type: 'SUPPLIER_RETURN',
          status: 'DRAFT',
          transactionDate: new Date(dto.transactionDate),
          supplierId: dto.supplierId,
          subtotal,
          totalAmount: subtotal,
          notes: dto.notes,
          idempotencyKey: dto.idempotencyKey,
          createdBy,
        },
      });

      await tx.transactionLine.createMany({
        data: processedLines.map((line) => ({
          tenantId,
          transactionId: txn.id,
          productId: line.productId,
          quantity: line.quantity,
          unitCost: line.unitCost,
          lineTotal: line.lineTotal,
          costTotal: line.lineTotal,
          sourceTransactionLineId: line.sourceTransactionLineId,
          createdBy,
        })),
      });

      return tx.transaction.findFirst({
        where: { id: txn.id },
        include: { transactionLines: true },
      });
    });
  }

  async createCustomerReturnDraft(dto: CreateCustomerReturnDraftDto) {
    const tenantId = getContext()?.tenantId;
    if (!tenantId) throw new UnauthorizedException();
    const createdBy = getContext()?.userId;

    const existing = await this.checkDraftIdempotency(tenantId, dto.idempotencyKey);
    if (existing) return existing;

    this.assertDateNotFuture(dto.transactionDate);

    // Task 2.4 — Reject duplicate sourceTransactionLineId in a single request
    const sourceLineIds = dto.lines.map((l) => l.sourceTransactionLineId);
    if (new Set(sourceLineIds).size !== sourceLineIds.length) {
      throw new UnprocessableEntityException(
        'Duplicate sourceTransactionLineId in request: each source line may only appear once',
      );
    }

    const customer = await this.prisma.customer.findFirst({
      where: { id: dto.customerId, tenantId },
    });
    if (!customer) throw new NotFoundException('Customer not found');
    if (customer.status !== 'ACTIVE') {
      throw new UnprocessableEntityException('Customer is not active');
    }

    const processedLines: Array<{
      sourceTransactionLineId: string;
      productId: string;
      quantity: number;
      unitPrice: number;
      lineTotal: number;
    }> = [];

    for (const line of dto.lines) {
      const sourceLine = await this.prisma.transactionLine.findFirst({
        where: { id: line.sourceTransactionLineId, tenantId },
        include: { transaction: true },
      });
      if (!sourceLine) {
        throw new UnprocessableEntityException(
          `Source line ${line.sourceTransactionLineId} not found`,
        );
      }
      if (
        sourceLine.transaction.type !== 'SALE' ||
        sourceLine.transaction.status !== 'POSTED' ||
        sourceLine.transaction.customerId !== dto.customerId
      ) {
        throw new UnprocessableEntityException(
          `Source line ${line.sourceTransactionLineId} is not from a posted SALE for this customer`,
        );
      }

      const returnedResult = await this.prisma.$queryRaw<[{ returned: bigint }]>`
        SELECT COALESCE(SUM(tl.quantity), 0) AS returned
        FROM transaction_lines tl
        JOIN transactions t ON t.id = tl.transaction_id
        WHERE tl.source_transaction_line_id = ${line.sourceTransactionLineId}::uuid
          AND tl.tenant_id = ${tenantId}::uuid
          AND t.status = 'POSTED'
          AND t.type IN ('SUPPLIER_RETURN', 'CUSTOMER_RETURN')
      `;
      const alreadyReturned = Number(returnedResult[0]?.returned ?? 0);
      const returnableQty = sourceLine.quantity - alreadyReturned;

      if (line.quantity > returnableQty) {
        throw new UnprocessableEntityException(
          `Cannot return ${line.quantity} units for line ${line.sourceTransactionLineId}: only ${returnableQty} returnable`,
        );
      }

      const effectiveUnitPrice = sourceLine.quantity > 0
        ? Math.floor((sourceLine.lineTotal ?? 0) / sourceLine.quantity)
        : (sourceLine.unitPrice ?? 0);
      processedLines.push({
        sourceTransactionLineId: line.sourceTransactionLineId,
        productId: sourceLine.productId,
        quantity: line.quantity,
        unitPrice: effectiveUnitPrice,
        lineTotal: line.quantity * effectiveUnitPrice,
      });
    }

    const subtotal = processedLines.reduce((sum, l) => sum + l.lineTotal, 0);

    return this.prisma.$transaction(async (tx) => {
      const txn = await tx.transaction.create({
        data: {
          tenantId,
          type: 'CUSTOMER_RETURN',
          status: 'DRAFT',
          transactionDate: new Date(dto.transactionDate),
          customerId: dto.customerId,
          subtotal,
          totalAmount: subtotal,
          notes: dto.notes,
          idempotencyKey: dto.idempotencyKey,
          createdBy,
        },
      });

      await tx.transactionLine.createMany({
        data: processedLines.map((line) => ({
          tenantId,
          transactionId: txn.id,
          productId: line.productId,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          lineTotal: line.lineTotal,
          costTotal: line.lineTotal,
          sourceTransactionLineId: line.sourceTransactionLineId,
          createdBy,
        })),
      });

      return tx.transaction.findFirst({
        where: { id: txn.id },
        include: { transactionLines: true },
      });
    });
  }

  async createInternalTransferDraft(dto: CreateInternalTransferDraftDto) {
    const tenantId = getContext()?.tenantId;
    if (!tenantId) throw new UnauthorizedException();
    const createdBy = getContext()?.userId;

    const existing = await this.checkDraftIdempotency(tenantId, dto.idempotencyKey);
    if (existing) return existing;

    this.assertDateNotFuture(dto.transactionDate);

    if (dto.fromPaymentAccountId === dto.toPaymentAccountId) {
      throw new BadRequestException('fromPaymentAccountId and toPaymentAccountId must be different');
    }

    const fromAccount = await this.prisma.paymentAccount.findFirst({
      where: { id: dto.fromPaymentAccountId, tenantId },
    });
    if (!fromAccount) throw new NotFoundException('From payment account not found');
    if (fromAccount.status !== 'ACTIVE') {
      throw new UnprocessableEntityException('From payment account is not active');
    }

    const toAccount = await this.prisma.paymentAccount.findFirst({
      where: { id: dto.toPaymentAccountId, tenantId },
    });
    if (!toAccount) throw new NotFoundException('To payment account not found');
    if (toAccount.status !== 'ACTIVE') {
      throw new UnprocessableEntityException('To payment account is not active');
    }

    return this.prisma.transaction.create({
      data: {
        tenantId,
        type: 'INTERNAL_TRANSFER',
        status: 'DRAFT',
        transactionDate: new Date(dto.transactionDate),
        fromPaymentAccountId: dto.fromPaymentAccountId,
        toPaymentAccountId: dto.toPaymentAccountId,
        totalAmount: dto.amount,
        subtotal: dto.amount,
        notes: dto.notes,
        idempotencyKey: dto.idempotencyKey,
        createdBy,
      },
    });
  }

  async createAdjustmentDraft(dto: CreateAdjustmentDraftDto) {
    const role = getContext()?.userRole;
    if (role !== 'OWNER' && role !== 'ADMIN') {
      throw new ForbiddenException('Only OWNER or ADMIN can create adjustments');
    }
    const tenantId = getContext()?.tenantId;
    if (!tenantId) throw new UnauthorizedException();
    const createdBy = getContext()?.userId;

    const existing = await this.checkDraftIdempotency(tenantId, dto.idempotencyKey);
    if (existing) return existing;

    this.assertDateNotFuture(dto.transactionDate);

    for (const line of dto.lines) {
      const product = await this.prisma.product.findFirst({
        where: { id: line.productId, tenantId },
      });
      if (!product) throw new NotFoundException(`Product ${line.productId} not found`);
      if (product.status !== 'ACTIVE') {
        throw new UnprocessableEntityException(`Product ${product.name} is not active`);
      }
    }

    return this.prisma.$transaction(async (tx) => {
      const txn = await tx.transaction.create({
        data: {
          tenantId,
          type: 'ADJUSTMENT',
          status: 'DRAFT',
          transactionDate: new Date(dto.transactionDate),
          totalAmount: 0,
          subtotal: 0,
          notes: dto.notes,
          idempotencyKey: dto.idempotencyKey,
          createdBy,
        },
      });

      await tx.transactionLine.createMany({
        data: dto.lines.map((line) => ({
          tenantId,
          transactionId: txn.id,
          productId: line.productId,
          quantity: line.quantity,
          lineTotal: 0,
          costTotal: 0,
          // direction and reason stored as JSON in description
          description: JSON.stringify({ direction: line.direction, reason: line.reason ?? null }),
          createdBy,
        })),
      });

      return tx.transaction.findFirst({
        where: { id: txn.id },
        include: { transactionLines: true },
      });
    });
  }

  async listAllocations(query: ListAllocationsQueryDto) {
    const tenantId = getContext()?.tenantId;
    if (!tenantId) throw new UnauthorizedException();

    const { page, limit, supplierId, customerId, purchaseId, saleId, dateFrom, dateTo } = query;
    const skip = (page - 1) * limit;

    const where: any = { tenantId };

    if (supplierId) {
      where.paymentTransaction = { supplierId };
    }
    if (customerId) {
      where.paymentTransaction = { ...where.paymentTransaction, customerId };
    }
    if (purchaseId) {
      where.appliesToTransactionId = purchaseId;
    } else if (saleId) {
      where.appliesToTransactionId = saleId;
    }
    if (dateFrom || dateTo) {
      where.createdAt = {};
      if (dateFrom) where.createdAt.gte = new Date(dateFrom);
      if (dateTo) where.createdAt.lte = new Date(dateTo);
    }

    const [allocations, total] = await Promise.all([
      this.prisma.allocation.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          paymentTransaction: {
            select: { id: true, documentNumber: true, transactionDate: true, totalAmount: true, type: true },
          },
          appliesToTransaction: {
            select: { id: true, documentNumber: true, transactionDate: true, totalAmount: true, type: true },
          },
        },
      }),
      this.prisma.allocation.count({ where }),
    ]);

    return paginateResponse(allocations, total, page, limit);
  }

  // ─── helpers ────────────────────────────────────────────────────────────────

  private async checkDraftIdempotency(tenantId: string, key: string | undefined) {
    if (!key) return null;
    const existing = await this.prisma.transaction.findFirst({
      where: { tenantId, idempotencyKey: key },
      include: { transactionLines: true },
    });
    if (!existing) return null;
    if (existing.status === 'POSTED') {
      throw new ConflictException('This idempotency key has already been used for a posted transaction');
    }
    return existing; // return existing DRAFT
  }

  private assertDateNotFuture(dateStr: string) {
    const txDateStr = dateStr.split('T')[0];
    const todayStr = new Date().toISOString().split('T')[0];
    if (txDateStr > todayStr) {
      throw new BadRequestException('transactionDate cannot be in the future');
    }
  }

  private async validateAndProcessPurchaseLines(
    lines: CreatePurchaseDraftDto['lines'],
    tenantId: string,
  ) {
    const processed = [];
    for (const line of lines) {
      const product = await this.prisma.product.findFirst({
        where: { id: line.productId, tenantId },
      });
      if (!product) {
        throw new NotFoundException(`Product ${line.productId} not found`);
      }
      if (product.status !== 'ACTIVE') {
        throw new UnprocessableEntityException(
          `Product ${product.name} is not active`,
        );
      }
      const discountAmount = line.discountAmount ?? 0;
      const maxDiscount = line.quantity * line.unitCost;
      if (discountAmount > maxDiscount) {
        throw new BadRequestException(
          `Discount amount for product ${product.name} exceeds line total`,
        );
      }
      processed.push({
        productId: line.productId,
        quantity: line.quantity,
        unitCost: line.unitCost,
        discountAmount,
        lineTotal: maxDiscount - discountAmount,
      });
    }
    return processed;
  }

  private async validateAndProcessSaleLines(
    lines: CreateSaleDraftDto['lines'],
    tenantId: string,
  ) {
    const processed = [];
    for (const line of lines) {
      const product = await this.prisma.product.findFirst({
        where: { id: line.productId, tenantId },
      });
      if (!product) {
        throw new NotFoundException(`Product ${line.productId} not found`);
      }
      if (product.status !== 'ACTIVE') {
        throw new UnprocessableEntityException(
          `Product ${product.name} is not active`,
        );
      }
      const discountAmount = line.discountAmount ?? 0;
      const maxDiscount = line.quantity * line.unitPrice;
      if (discountAmount > maxDiscount) {
        throw new BadRequestException(
          `Discount amount for product ${product.name} exceeds line total`,
        );
      }
      processed.push({
        productId: line.productId,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        discountAmount,
        lineTotal: maxDiscount - discountAmount,
      });
    }
    return processed;
  }
}
