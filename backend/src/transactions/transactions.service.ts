import {
  Injectable,
  UnauthorizedException,
  NotFoundException,
  BadRequestException,
  UnprocessableEntityException,
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
        createdBy,
      },
    });
  }

  async createCustomerPaymentDraft(dto: CreateCustomerPaymentDraftDto) {
    const tenantId = getContext()?.tenantId;
    if (!tenantId) throw new UnauthorizedException();
    const createdBy = getContext()?.userId;

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
        createdBy,
      },
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
