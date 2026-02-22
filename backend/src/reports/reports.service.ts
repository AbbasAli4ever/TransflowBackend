import { Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { getContext } from '../common/request-context';
import { safeMoney } from '../common/utils/money';
import { BalanceQueryDto } from './dto/balance-query.dto';
import { StatementQueryDto } from './dto/statement-query.dto';
import { PendingReceivablesQueryDto } from './dto/pending-receivables-query.dto';
import { PendingPayablesQueryDto } from './dto/pending-payables-query.dto';

@Injectable()
export class ReportsService {
  constructor(private prisma: PrismaService) {}

  // ─── EP-1: Supplier Balance ──────────────────────────────────────────────────

  async getSupplierBalance(id: string, query: BalanceQueryDto) {
    const tenantId = this.requireTenantId();
    const asOfDate = query.asOfDate ?? await this.getBusinessDate(tenantId);

    const supplier = await this.prisma.supplier.findFirst({ where: { id, tenantId } });
    if (!supplier) throw new NotFoundException('Supplier not found');

    const rows = await this.prisma.$queryRaw<
      Array<{
        purchaseCount: number;
        totalPurchases: bigint;
        paymentCount: number;
        totalPayments: bigint;
        returnCount: number;
        totalReturns: bigint;
      }>
    >`
      SELECT
        COUNT(CASE WHEN le.entry_type = 'AP_INCREASE' THEN 1 END)::int                                              AS "purchaseCount",
        COALESCE(SUM(CASE WHEN le.entry_type = 'AP_INCREASE' THEN le.amount ELSE 0 END), 0)::bigint                AS "totalPurchases",
        COUNT(CASE WHEN le.entry_type = 'AP_DECREASE' AND t.type != 'SUPPLIER_RETURN' THEN 1 END)::int             AS "paymentCount",
        COALESCE(SUM(CASE WHEN le.entry_type = 'AP_DECREASE' AND t.type != 'SUPPLIER_RETURN' THEN le.amount ELSE 0 END), 0)::bigint AS "totalPayments",
        COUNT(CASE WHEN le.entry_type = 'AP_DECREASE' AND t.type = 'SUPPLIER_RETURN' THEN 1 END)::int              AS "returnCount",
        COALESCE(SUM(CASE WHEN le.entry_type = 'AP_DECREASE' AND t.type = 'SUPPLIER_RETURN' THEN le.amount ELSE 0 END), 0)::bigint  AS "totalReturns"
      FROM ledger_entries le
      JOIN transactions t ON t.id = le.transaction_id
      WHERE le.tenant_id = ${tenantId}::uuid
        AND le.supplier_id = ${id}::uuid
        AND le.transaction_date <= ${asOfDate}::date
        AND t.status = 'POSTED'
    `;

    const r = rows[0];
    const totalPurchases = safeMoney(r.totalPurchases);
    const totalPayments = safeMoney(r.totalPayments);
    const totalReturns = safeMoney(r.totalReturns);
    const balance = totalPurchases - totalPayments - totalReturns;

    return {
      supplierId: id,
      supplierName: supplier.name,
      asOfDate,
      balance,
      balanceType: balance > 0 ? 'PAYABLE' : balance < 0 ? 'CREDIT' : 'SETTLED',
      breakdown: {
        purchases: { count: r.purchaseCount, totalAmount: totalPurchases },
        payments: { count: r.paymentCount, totalAmount: totalPayments },
        returns: { count: r.returnCount, totalAmount: totalReturns },
        netPayable: balance,
      },
    };
  }

  // ─── EP-2: Customer Balance ──────────────────────────────────────────────────

  async getCustomerBalance(id: string, query: BalanceQueryDto) {
    const tenantId = this.requireTenantId();
    const asOfDate = query.asOfDate ?? await this.getBusinessDate(tenantId);

    const customer = await this.prisma.customer.findFirst({ where: { id, tenantId } });
    if (!customer) throw new NotFoundException('Customer not found');

    const rows = await this.prisma.$queryRaw<
      Array<{
        saleCount: number;
        totalSales: bigint;
        paymentCount: number;
        totalPayments: bigint;
        returnCount: number;
        totalReturns: bigint;
      }>
    >`
      SELECT
        COUNT(CASE WHEN le.entry_type = 'AR_INCREASE' THEN 1 END)::int                                              AS "saleCount",
        COALESCE(SUM(CASE WHEN le.entry_type = 'AR_INCREASE' THEN le.amount ELSE 0 END), 0)::bigint                AS "totalSales",
        COUNT(CASE WHEN le.entry_type = 'AR_DECREASE' AND t.type != 'CUSTOMER_RETURN' THEN 1 END)::int             AS "paymentCount",
        COALESCE(SUM(CASE WHEN le.entry_type = 'AR_DECREASE' AND t.type != 'CUSTOMER_RETURN' THEN le.amount ELSE 0 END), 0)::bigint AS "totalPayments",
        COUNT(CASE WHEN le.entry_type = 'AR_DECREASE' AND t.type = 'CUSTOMER_RETURN' THEN 1 END)::int              AS "returnCount",
        COALESCE(SUM(CASE WHEN le.entry_type = 'AR_DECREASE' AND t.type = 'CUSTOMER_RETURN' THEN le.amount ELSE 0 END), 0)::bigint  AS "totalReturns"
      FROM ledger_entries le
      JOIN transactions t ON t.id = le.transaction_id
      WHERE le.tenant_id = ${tenantId}::uuid
        AND le.customer_id = ${id}::uuid
        AND le.transaction_date <= ${asOfDate}::date
        AND t.status = 'POSTED'
    `;

    const r = rows[0];
    const totalSales = safeMoney(r.totalSales);
    const totalPayments = safeMoney(r.totalPayments);
    const totalReturns = safeMoney(r.totalReturns);
    const balance = totalSales - totalPayments - totalReturns;

    return {
      customerId: id,
      customerName: customer.name,
      asOfDate,
      balance,
      balanceType: balance > 0 ? 'RECEIVABLE' : balance < 0 ? 'CREDIT' : 'SETTLED',
      breakdown: {
        sales: { count: r.saleCount, totalAmount: totalSales },
        payments: { count: r.paymentCount, totalAmount: totalPayments },
        returns: { count: r.returnCount, totalAmount: totalReturns },
        netReceivable: balance,
      },
    };
  }

  // ─── EP-3: Payment Account Balance ──────────────────────────────────────────

  async getPaymentAccountBalance(id: string, query: BalanceQueryDto) {
    const tenantId = this.requireTenantId();
    const asOfDate = query.asOfDate ?? await this.getBusinessDate(tenantId);

    const account = await this.prisma.paymentAccount.findFirst({ where: { id, tenantId } });
    if (!account) throw new NotFoundException('Payment account not found');

    const rows = await this.prisma.$queryRaw<
      Array<{
        moneyInCount: number;
        moneyIn: bigint;
        moneyOutCount: number;
        moneyOut: bigint;
      }>
    >`
      SELECT
        COUNT(CASE WHEN pe.direction = 'IN' THEN 1 END)::int              AS "moneyInCount",
        COALESCE(SUM(CASE WHEN pe.direction = 'IN' THEN pe.amount ELSE 0 END), 0)::bigint  AS "moneyIn",
        COUNT(CASE WHEN pe.direction = 'OUT' THEN 1 END)::int             AS "moneyOutCount",
        COALESCE(SUM(CASE WHEN pe.direction = 'OUT' THEN pe.amount ELSE 0 END), 0)::bigint AS "moneyOut"
      FROM payment_entries pe
      JOIN transactions t ON t.id = pe.transaction_id AND t.status = 'POSTED'
      WHERE pe.tenant_id = ${tenantId}::uuid
        AND pe.payment_account_id = ${id}::uuid
        AND pe.transaction_date <= ${asOfDate}::date
    `;

    const r = rows[0];
    const moneyIn = safeMoney(r.moneyIn);
    const moneyOut = safeMoney(r.moneyOut);
    const balance = account.openingBalance + moneyIn - moneyOut;

    return {
      accountId: id,
      accountName: account.name,
      accountType: account.type,
      asOfDate,
      balance,
      breakdown: {
        openingBalance: account.openingBalance,
        moneyIn: { count: r.moneyInCount, totalAmount: moneyIn },
        moneyOut: { count: r.moneyOutCount, totalAmount: moneyOut },
        currentBalance: balance,
      },
    };
  }

  // ─── EP-4: Product Stock Report ──────────────────────────────────────────────

  async getProductStock(id: string, query: BalanceQueryDto) {
    const tenantId = this.requireTenantId();
    const asOfDate = query.asOfDate ?? await this.getBusinessDate(tenantId);

    const product = await this.prisma.product.findFirst({ where: { id, tenantId } });
    if (!product) throw new NotFoundException('Product not found');

    const rows = await this.prisma.$queryRaw<
      Array<{
        purchasesIn: bigint;
        salesOut: bigint;
        customerReturnsIn: bigint;
        supplierReturnsOut: bigint;
        adjustmentsIn: bigint;
        adjustmentsOut: bigint;
        totalPurchaseCost: bigint;
        totalPurchaseQty: bigint;
        totalReturnCost: bigint;
        totalReturnQty: bigint;
      }>
    >`
      SELECT
        COALESCE(SUM(CASE WHEN movement_type = 'PURCHASE_IN'        THEN quantity ELSE 0 END), 0)::bigint AS "purchasesIn",
        COALESCE(SUM(CASE WHEN movement_type = 'SALE_OUT'           THEN quantity ELSE 0 END), 0)::bigint AS "salesOut",
        COALESCE(SUM(CASE WHEN movement_type = 'CUSTOMER_RETURN_IN' THEN quantity ELSE 0 END), 0)::bigint AS "customerReturnsIn",
        COALESCE(SUM(CASE WHEN movement_type = 'SUPPLIER_RETURN_OUT'THEN quantity ELSE 0 END), 0)::bigint AS "supplierReturnsOut",
        COALESCE(SUM(CASE WHEN movement_type = 'ADJUSTMENT_IN'      THEN quantity ELSE 0 END), 0)::bigint AS "adjustmentsIn",
        COALESCE(SUM(CASE WHEN movement_type = 'ADJUSTMENT_OUT'     THEN quantity ELSE 0 END), 0)::bigint AS "adjustmentsOut",
        COALESCE(SUM(CASE WHEN movement_type = 'PURCHASE_IN'        THEN unit_cost_at_time * quantity ELSE 0 END), 0)::bigint AS "totalPurchaseCost",
        COALESCE(SUM(CASE WHEN movement_type = 'PURCHASE_IN'        THEN quantity ELSE 0 END), 0)::bigint AS "totalPurchaseQty",
        COALESCE(SUM(CASE WHEN movement_type = 'SUPPLIER_RETURN_OUT' THEN unit_cost_at_time * quantity ELSE 0 END), 0)::bigint AS "totalReturnCost",
        COALESCE(SUM(CASE WHEN movement_type = 'SUPPLIER_RETURN_OUT' THEN quantity ELSE 0 END), 0)::bigint AS "totalReturnQty"
      FROM inventory_movements
      WHERE tenant_id = ${tenantId}::uuid
        AND variant_id IN (SELECT id FROM product_variants WHERE product_id = ${id}::uuid)
        AND transaction_date <= ${asOfDate}::date
    `;

    const r = rows[0];
    const purchasesIn = safeMoney(r.purchasesIn);
    const salesOut = safeMoney(r.salesOut);
    const customerReturnsIn = safeMoney(r.customerReturnsIn);
    const supplierReturnsOut = safeMoney(r.supplierReturnsOut);
    const adjustmentsIn = safeMoney(r.adjustmentsIn);
    const adjustmentsOut = safeMoney(r.adjustmentsOut);
    const totalPurchaseCost = safeMoney(r.totalPurchaseCost);
    const totalPurchaseQty = safeMoney(r.totalPurchaseQty);
    const totalReturnCost = safeMoney(r.totalReturnCost);
    const totalReturnQty = safeMoney(r.totalReturnQty);

    const netStock = purchasesIn + customerReturnsIn + adjustmentsIn - salesOut - supplierReturnsOut - adjustmentsOut;
    const netCostPool = totalPurchaseCost - totalReturnCost;
    const netQtyPool = totalPurchaseQty - totalReturnQty;
    const avgCost = netQtyPool > 0 ? Math.round(netCostPool / netQtyPool) : 0;

    return {
      productId: id,
      productName: product.name,
      sku: product.sku ?? null,
      asOfDate,
      currentStock: netStock,
      avgCost,
      stockValue: netStock * avgCost,
      breakdown: {
        purchasesIn,
        salesOut,
        customerReturnsIn,
        supplierReturnsOut,
        adjustmentsIn,
        adjustmentsOut,
        netStock,
      },
    };
  }

  // ─── EP-5: Pending Receivables ───────────────────────────────────────────────

  async getPendingReceivables(query: PendingReceivablesQueryDto) {
    const tenantId = this.requireTenantId();
    const asOfDate = query.asOfDate ?? await this.getBusinessDate(tenantId);
    const minAmount = query.minAmount ?? 0;

    // Query 1: customers with positive AR balance
    const customerFilter = query.customerId
      ? Prisma.sql`AND le.customer_id = ${query.customerId}::uuid`
      : Prisma.empty;

    // Task 8.1: both queries run in a single RepeatableRead snapshot
    const { balanceRows, docRows } = await this.prisma.$transaction(async (tx) => {
      const bRows = await tx.$queryRaw<
        Array<{ customerId: string; customerName: string; balance: bigint }>
      >`
        SELECT
          le.customer_id                           AS "customerId",
          c.name                                   AS "customerName",
          COALESCE(SUM(CASE WHEN le.entry_type = 'AR_INCREASE' THEN le.amount ELSE 0 END), 0)
            - COALESCE(SUM(CASE WHEN le.entry_type = 'AR_DECREASE' THEN le.amount ELSE 0 END), 0) AS balance
        FROM ledger_entries le
        JOIN customers c ON c.id = le.customer_id
        WHERE le.tenant_id = ${tenantId}::uuid
          AND le.transaction_date <= ${asOfDate}::date
          ${customerFilter}
        GROUP BY le.customer_id, c.name
        HAVING
          COALESCE(SUM(CASE WHEN le.entry_type = 'AR_INCREASE' THEN le.amount ELSE 0 END), 0)
            - COALESCE(SUM(CASE WHEN le.entry_type = 'AR_DECREASE' THEN le.amount ELSE 0 END), 0) > ${minAmount}
        ORDER BY balance DESC
      `;

      if (bRows.length === 0) return { balanceRows: bRows, docRows: [] };

      const idsFragment = Prisma.join(bRows.map((r) => Prisma.sql`${r.customerId}::uuid`));

      const dRows = await tx.$queryRaw<
      Array<{
        customerId: string;
        id: string;
        documentNumber: string | null;
        transactionDate: Date;
        totalAmount: bigint;
        paidAmount: bigint;
        outstanding: bigint;
      }>
    >`
      SELECT
        t.customer_id                                              AS "customerId",
        t.id,
        t.document_number                                         AS "documentNumber",
        t.transaction_date                                        AS "transactionDate",
        t.total_amount                                            AS "totalAmount",
        COALESCE(SUM(CASE WHEN payment_t.id IS NOT NULL THEN a.amount_applied ELSE 0 END), 0)::bigint AS "paidAmount",
        (t.total_amount - COALESCE(SUM(CASE WHEN payment_t.id IS NOT NULL THEN a.amount_applied ELSE 0 END), 0))::bigint AS "outstanding"
      FROM transactions t
      LEFT JOIN allocations a
        ON a.applies_to_transaction_id = t.id
       AND a.tenant_id = ${tenantId}::uuid
      LEFT JOIN transactions payment_t
        ON payment_t.id = a.payment_transaction_id
       AND payment_t.transaction_date <= ${asOfDate}::date
       AND payment_t.status = 'POSTED'
      WHERE t.tenant_id = ${tenantId}::uuid
        AND t.customer_id IN (${idsFragment})
        AND t.type = 'SALE'
        AND t.status = 'POSTED'
        AND t.transaction_date <= ${asOfDate}::date
      GROUP BY t.customer_id, t.id, t.document_number, t.transaction_date, t.total_amount
      HAVING t.total_amount - COALESCE(SUM(CASE WHEN payment_t.id IS NOT NULL THEN a.amount_applied ELSE 0 END), 0) > 0
      ORDER BY t.transaction_date ASC
    `;

      return { balanceRows: bRows, docRows: dRows };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });

    // Group documents by customerId
    const docsByCustomer = new Map<string, typeof docRows>();
    for (const doc of docRows) {
      const list = docsByCustomer.get(doc.customerId) ?? [];
      list.push(doc);
      docsByCustomer.set(doc.customerId, list);
    }

    const asOfMs = Date.parse(asOfDate);

    const customers = balanceRows.map((row) => {
      const docs = docsByCustomer.get(row.customerId) ?? [];
      const oldestDoc = docs[0];
      const oldestInvoiceDate = oldestDoc ? oldestDoc.transactionDate.toISOString().split('T')[0] : null;
      const daysPastDue = oldestDoc
        ? Math.floor((asOfMs - oldestDoc.transactionDate.getTime()) / 86400000)
        : 0;

      return {
        customerId: row.customerId,
        customerName: row.customerName,
        balance: safeMoney(row.balance),
        oldestInvoiceDate,
        daysPastDue,
        openDocuments: docs.map((d) => ({
          documentNumber: d.documentNumber,
          transactionDate: d.transactionDate.toISOString().split('T')[0],
          totalAmount: safeMoney(d.totalAmount),
          paidAmount: safeMoney(d.paidAmount),
          outstanding: safeMoney(d.outstanding),
          daysPastDue: Math.floor((asOfMs - d.transactionDate.getTime()) / 86400000),
        })),
      };
    });

    const totalReceivables = customers.reduce((sum, c) => sum + c.balance, 0);

    return { asOfDate, totalReceivables, customerCount: customers.length, customers };
  }

  // ─── EP-6: Pending Payables ──────────────────────────────────────────────────

  async getPendingPayables(query: PendingPayablesQueryDto) {
    const tenantId = this.requireTenantId();
    const asOfDate = query.asOfDate ?? await this.getBusinessDate(tenantId);
    const minAmount = query.minAmount ?? 0;

    const supplierFilter = query.supplierId
      ? Prisma.sql`AND le.supplier_id = ${query.supplierId}::uuid`
      : Prisma.empty;

    // Task 8.1: both queries run in a single RepeatableRead snapshot
    const { balanceRows, docRows } = await this.prisma.$transaction(async (tx) => {
      const bRows = await tx.$queryRaw<
        Array<{ supplierId: string; supplierName: string; balance: bigint }>
      >`
        SELECT
          le.supplier_id                           AS "supplierId",
          s.name                                   AS "supplierName",
          COALESCE(SUM(CASE WHEN le.entry_type = 'AP_INCREASE' THEN le.amount ELSE 0 END), 0)
            - COALESCE(SUM(CASE WHEN le.entry_type = 'AP_DECREASE' THEN le.amount ELSE 0 END), 0) AS balance
        FROM ledger_entries le
        JOIN suppliers s ON s.id = le.supplier_id
        WHERE le.tenant_id = ${tenantId}::uuid
          AND le.transaction_date <= ${asOfDate}::date
          ${supplierFilter}
        GROUP BY le.supplier_id, s.name
        HAVING
          COALESCE(SUM(CASE WHEN le.entry_type = 'AP_INCREASE' THEN le.amount ELSE 0 END), 0)
            - COALESCE(SUM(CASE WHEN le.entry_type = 'AP_DECREASE' THEN le.amount ELSE 0 END), 0) > ${minAmount}
        ORDER BY balance DESC
      `;

      if (bRows.length === 0) return { balanceRows: bRows, docRows: [] };

      const idsFragment = Prisma.join(bRows.map((r) => Prisma.sql`${r.supplierId}::uuid`));

      const dRows = await tx.$queryRaw<
      Array<{
        supplierId: string;
        id: string;
        documentNumber: string | null;
        transactionDate: Date;
        totalAmount: bigint;
        paidAmount: bigint;
        outstanding: bigint;
      }>
    >`
      SELECT
        t.supplier_id                                              AS "supplierId",
        t.id,
        t.document_number                                         AS "documentNumber",
        t.transaction_date                                        AS "transactionDate",
        t.total_amount                                            AS "totalAmount",
        COALESCE(SUM(CASE WHEN payment_t.id IS NOT NULL THEN a.amount_applied ELSE 0 END), 0)::bigint AS "paidAmount",
        (t.total_amount - COALESCE(SUM(CASE WHEN payment_t.id IS NOT NULL THEN a.amount_applied ELSE 0 END), 0))::bigint AS "outstanding"
      FROM transactions t
      LEFT JOIN allocations a
        ON a.applies_to_transaction_id = t.id
       AND a.tenant_id = ${tenantId}::uuid
      LEFT JOIN transactions payment_t
        ON payment_t.id = a.payment_transaction_id
       AND payment_t.transaction_date <= ${asOfDate}::date
       AND payment_t.status = 'POSTED'
      WHERE t.tenant_id = ${tenantId}::uuid
        AND t.supplier_id IN (${idsFragment})
        AND t.type = 'PURCHASE'
        AND t.status = 'POSTED'
        AND t.transaction_date <= ${asOfDate}::date
      GROUP BY t.supplier_id, t.id, t.document_number, t.transaction_date, t.total_amount
      HAVING t.total_amount - COALESCE(SUM(CASE WHEN payment_t.id IS NOT NULL THEN a.amount_applied ELSE 0 END), 0) > 0
      ORDER BY t.transaction_date ASC
    `;

      return { balanceRows: bRows, docRows: dRows };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });

    const docsBySupplier = new Map<string, typeof docRows>();
    for (const doc of docRows) {
      const list = docsBySupplier.get(doc.supplierId) ?? [];
      list.push(doc);
      docsBySupplier.set(doc.supplierId, list);
    }

    const asOfMs = Date.parse(asOfDate);

    const suppliers = balanceRows.map((row) => {
      const docs = docsBySupplier.get(row.supplierId) ?? [];
      const oldestDoc = docs[0];
      const oldestInvoiceDate = oldestDoc ? oldestDoc.transactionDate.toISOString().split('T')[0] : null;
      const daysPastDue = oldestDoc
        ? Math.floor((asOfMs - oldestDoc.transactionDate.getTime()) / 86400000)
        : 0;

      return {
        supplierId: row.supplierId,
        supplierName: row.supplierName,
        balance: safeMoney(row.balance),
        oldestInvoiceDate,
        daysPastDue,
        openDocuments: docs.map((d) => ({
          documentNumber: d.documentNumber,
          transactionDate: d.transactionDate.toISOString().split('T')[0],
          totalAmount: safeMoney(d.totalAmount),
          paidAmount: safeMoney(d.paidAmount),
          outstanding: safeMoney(d.outstanding),
          daysPastDue: Math.floor((asOfMs - d.transactionDate.getTime()) / 86400000),
        })),
      };
    });

    const totalPayables = suppliers.reduce((sum, s) => sum + s.balance, 0);

    return { asOfDate, totalPayables, supplierCount: suppliers.length, suppliers };
  }

  // ─── EP-7: Supplier Statement ────────────────────────────────────────────────

  async getSupplierStatement(id: string, query: StatementQueryDto) {
    const tenantId = this.requireTenantId();
    const { dateFrom, dateTo } = query;

    const supplier = await this.prisma.supplier.findFirst({ where: { id, tenantId } });
    if (!supplier) throw new NotFoundException('Supplier not found');

    // Task 8.1: both queries share a single RepeatableRead snapshot
    const [openingRows, entryRows] = await this.prisma.$transaction(
      async (tx) => Promise.all([
        tx.$queryRaw<Array<{ openingBalance: bigint }>>`
          SELECT COALESCE(
            SUM(CASE WHEN le.entry_type = 'AP_INCREASE' THEN le.amount ELSE -le.amount END), 0
          )::bigint AS "openingBalance"
          FROM ledger_entries le
          JOIN transactions t ON t.id = le.transaction_id
          WHERE le.tenant_id = ${tenantId}::uuid
            AND le.supplier_id = ${id}::uuid
            AND le.transaction_date < ${dateFrom}::date
            AND t.status = 'POSTED'
        `,
        tx.$queryRaw<
          Array<{ date: Date; documentNumber: string | null; type: string; description: string | null; debit: bigint; credit: bigint }>
        >`
          SELECT
            t.transaction_date                                                        AS date,
            t.document_number                                                         AS "documentNumber",
            t.type,
            t.notes                                                                   AS description,
            CASE WHEN le.entry_type = 'AP_INCREASE' THEN le.amount ELSE 0 END::bigint AS debit,
            CASE WHEN le.entry_type = 'AP_DECREASE' THEN le.amount ELSE 0 END::bigint AS credit
          FROM ledger_entries le
          JOIN transactions t ON t.id = le.transaction_id
          WHERE le.tenant_id = ${tenantId}::uuid
            AND le.supplier_id = ${id}::uuid
            AND le.transaction_date >= ${dateFrom}::date
            AND le.transaction_date <= ${dateTo}::date
            AND t.status = 'POSTED'
          ORDER BY t.transaction_date ASC, t.created_at ASC
        `,
      ]),
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );

    const openingBalance = safeMoney(openingRows[0].openingBalance);
    const entries = this.buildRunningBalance(openingBalance, entryRows, 'debit', 'credit');
    const closingBalance = entries.length > 0 ? entries[entries.length - 1].runningBalance : openingBalance;

    return {
      supplierId: id,
      supplierName: supplier.name,
      dateFrom,
      dateTo,
      openingBalance,
      closingBalance,
      entries,
    };
  }

  // ─── EP-8: Customer Statement ────────────────────────────────────────────────

  async getCustomerStatement(id: string, query: StatementQueryDto) {
    const tenantId = this.requireTenantId();
    const { dateFrom, dateTo } = query;

    const customer = await this.prisma.customer.findFirst({ where: { id, tenantId } });
    if (!customer) throw new NotFoundException('Customer not found');

    // Task 8.1: both queries share a single RepeatableRead snapshot
    const [openingRows, entryRows] = await this.prisma.$transaction(
      async (tx) => Promise.all([
        tx.$queryRaw<Array<{ openingBalance: bigint }>>`
          SELECT COALESCE(
            SUM(CASE WHEN le.entry_type = 'AR_INCREASE' THEN le.amount ELSE -le.amount END), 0
          )::bigint AS "openingBalance"
          FROM ledger_entries le
          JOIN transactions t ON t.id = le.transaction_id
          WHERE le.tenant_id = ${tenantId}::uuid
            AND le.customer_id = ${id}::uuid
            AND le.transaction_date < ${dateFrom}::date
            AND t.status = 'POSTED'
        `,
        tx.$queryRaw<
          Array<{ date: Date; documentNumber: string | null; type: string; description: string | null; debit: bigint; credit: bigint }>
        >`
          SELECT
            t.transaction_date                                                        AS date,
            t.document_number                                                         AS "documentNumber",
            t.type,
            t.notes                                                                   AS description,
            CASE WHEN le.entry_type = 'AR_INCREASE' THEN le.amount ELSE 0 END::bigint AS debit,
            CASE WHEN le.entry_type = 'AR_DECREASE' THEN le.amount ELSE 0 END::bigint AS credit
          FROM ledger_entries le
          JOIN transactions t ON t.id = le.transaction_id
          WHERE le.tenant_id = ${tenantId}::uuid
            AND le.customer_id = ${id}::uuid
            AND le.transaction_date >= ${dateFrom}::date
            AND le.transaction_date <= ${dateTo}::date
            AND t.status = 'POSTED'
          ORDER BY t.transaction_date ASC, t.created_at ASC
        `,
      ]),
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );

    const openingBalance = safeMoney(openingRows[0].openingBalance);
    const entries = this.buildRunningBalance(openingBalance, entryRows, 'debit', 'credit');
    const closingBalance = entries.length > 0 ? entries[entries.length - 1].runningBalance : openingBalance;

    return {
      customerId: id,
      customerName: customer.name,
      dateFrom,
      dateTo,
      openingBalance,
      closingBalance,
      entries,
    };
  }

  // ─── EP-9: Payment Account Statement ────────────────────────────────────────

  async getPaymentAccountStatement(id: string, query: StatementQueryDto) {
    const tenantId = this.requireTenantId();
    const { dateFrom, dateTo } = query;

    const account = await this.prisma.paymentAccount.findFirst({ where: { id, tenantId } });
    if (!account) throw new NotFoundException('Payment account not found');

    // Task 8.1: both queries share a single RepeatableRead snapshot
    const [historicalRows, entryRows] = await this.prisma.$transaction(
      async (tx) => Promise.all([
        tx.$queryRaw<Array<{ historicalBalance: bigint }>>`
          SELECT COALESCE(
            SUM(CASE WHEN pe.direction = 'IN' THEN pe.amount ELSE -pe.amount END), 0
          )::bigint AS "historicalBalance"
          FROM payment_entries pe
          JOIN transactions t ON t.id = pe.transaction_id AND t.status = 'POSTED'
          WHERE pe.tenant_id = ${tenantId}::uuid
            AND pe.payment_account_id = ${id}::uuid
            AND pe.transaction_date < ${dateFrom}::date
        `,
        tx.$queryRaw<
          Array<{ date: Date; documentNumber: string | null; type: string; moneyIn: bigint; moneyOut: bigint; partyName: string | null }>
        >`
          SELECT
            pe.transaction_date                                               AS date,
            t.document_number                                                 AS "documentNumber",
            t.type,
            CASE WHEN pe.direction = 'IN'  THEN pe.amount ELSE 0 END::bigint AS "moneyIn",
            CASE WHEN pe.direction = 'OUT' THEN pe.amount ELSE 0 END::bigint AS "moneyOut",
            COALESCE(s.name, c.name)                                          AS "partyName"
          FROM payment_entries pe
          JOIN transactions t ON t.id = pe.transaction_id AND t.status = 'POSTED'
          LEFT JOIN suppliers s ON s.id = pe.supplier_id
          LEFT JOIN customers c ON c.id = pe.customer_id
          WHERE pe.tenant_id = ${tenantId}::uuid
            AND pe.payment_account_id = ${id}::uuid
            AND pe.transaction_date >= ${dateFrom}::date
            AND pe.transaction_date <= ${dateTo}::date
          ORDER BY pe.transaction_date ASC, pe.created_at ASC
        `,
      ]),
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );

    const openingBalance = account.openingBalance + safeMoney(historicalRows[0].historicalBalance);
    let running = openingBalance;
    const entries = entryRows.map((row) => {
      const moneyIn = safeMoney(row.moneyIn);
      const moneyOut = safeMoney(row.moneyOut);
      running = running + moneyIn - moneyOut;
      return {
        date: row.date instanceof Date ? row.date.toISOString().split('T')[0] : row.date,
        documentNumber: row.documentNumber ?? null,
        type: row.type,
        partyName: row.partyName ?? null,
        moneyIn,
        moneyOut,
        runningBalance: running,
      };
    });
    const closingBalance = entries.length > 0 ? entries[entries.length - 1].runningBalance : openingBalance;

    return {
      accountId: id,
      accountName: account.name,
      dateFrom,
      dateTo,
      openingBalance,
      closingBalance,
      entries,
    };
  }

  // ─── EP-10: Profit & Loss Report ────────────────────────────────────────────

  async getProfitLoss(query: StatementQueryDto) {
    const tenantId = this.requireTenantId();
    const { dateFrom, dateTo } = query;

    const [revenueRows, cogsRows] = await Promise.all([
      this.prisma.$queryRaw<Array<{ sales: bigint; salesReturns: bigint }>>`
        SELECT
          COALESCE(SUM(CASE WHEN t.type = 'SALE'            THEN t.total_amount ELSE 0 END), 0)::bigint AS sales,
          COALESCE(SUM(CASE WHEN t.type = 'CUSTOMER_RETURN' THEN t.total_amount ELSE 0 END), 0)::bigint AS "salesReturns"
        FROM transactions t
        WHERE t.tenant_id = ${tenantId}::uuid
          AND t.status = 'POSTED'
          AND t.type IN ('SALE', 'CUSTOMER_RETURN')
          AND t.transaction_date BETWEEN ${dateFrom}::date AND ${dateTo}::date
      `,
      this.prisma.$queryRaw<Array<{ cogs: bigint }>>`
        SELECT
          COALESCE(
            SUM(CASE WHEN im.movement_type = 'SALE_OUT'           THEN im.unit_cost_at_time * im.quantity ELSE 0 END)
            - SUM(CASE WHEN im.movement_type = 'CUSTOMER_RETURN_IN' THEN im.unit_cost_at_time * im.quantity ELSE 0 END),
            0
          )::bigint AS cogs
        FROM inventory_movements im
        WHERE im.tenant_id = ${tenantId}::uuid
          AND im.movement_type IN ('SALE_OUT', 'CUSTOMER_RETURN_IN')
          AND im.transaction_date BETWEEN ${dateFrom}::date AND ${dateTo}::date
      `,
    ]);

    const sales = safeMoney(revenueRows[0].sales);
    const salesReturns = safeMoney(revenueRows[0].salesReturns);
    const cogs = safeMoney(cogsRows[0].cogs);
    const netRevenue = sales - salesReturns;
    const grossProfit = netRevenue - cogs;
    const grossProfitMargin = netRevenue > 0 ? Math.round((grossProfit / netRevenue) * 10000) / 100 : 0;

    return { dateFrom, dateTo, sales, salesReturns, netRevenue, costOfGoodsSold: cogs, grossProfit, grossProfitMargin };
  }

  // ─── EP-11: Inventory Valuation Report ──────────────────────────────────────

  async getInventoryValuation(query: BalanceQueryDto) {
    const tenantId = this.requireTenantId();
    const asOfDate = query.asOfDate ?? await this.getBusinessDate(tenantId);

    const rows = await this.prisma.$queryRaw<Array<{
      productId: string;
      productName: string;
      sku: string | null;
      category: string | null;
      variantId: string;
      size: string;
      variantSku: string | null;
      qtyOnHand: bigint;
      totalPurchaseCost: bigint;
      totalPurchaseQty: bigint;
      totalReturnCost: bigint;
      totalReturnQty: bigint;
    }>>`
      SELECT
        p.id::text                                                                                                    AS "productId",
        p.name                                                                                                        AS "productName",
        p.sku,
        p.category,
        pv.id::text                                                                                                   AS "variantId",
        pv.size,
        pv.sku                                                                                                        AS "variantSku",
        COALESCE(
          SUM(CASE WHEN im.movement_type IN ('PURCHASE_IN','CUSTOMER_RETURN_IN','ADJUSTMENT_IN')     THEN im.quantity ELSE 0 END)
          - SUM(CASE WHEN im.movement_type IN ('SALE_OUT','SUPPLIER_RETURN_OUT','ADJUSTMENT_OUT')    THEN im.quantity ELSE 0 END),
          0
        )::bigint                                                                                                     AS "qtyOnHand",
        COALESCE(SUM(CASE WHEN im.movement_type = 'PURCHASE_IN'         THEN im.unit_cost_at_time * im.quantity ELSE 0 END), 0)::bigint AS "totalPurchaseCost",
        COALESCE(SUM(CASE WHEN im.movement_type = 'PURCHASE_IN'         THEN im.quantity ELSE 0 END), 0)::bigint                       AS "totalPurchaseQty",
        COALESCE(SUM(CASE WHEN im.movement_type = 'SUPPLIER_RETURN_OUT' THEN im.unit_cost_at_time * im.quantity ELSE 0 END), 0)::bigint AS "totalReturnCost",
        COALESCE(SUM(CASE WHEN im.movement_type = 'SUPPLIER_RETURN_OUT' THEN im.quantity ELSE 0 END), 0)::bigint                       AS "totalReturnQty"
      FROM products p
      JOIN product_variants pv ON pv.product_id = p.id AND pv.tenant_id = ${tenantId}::uuid AND pv.status = 'ACTIVE'
      LEFT JOIN inventory_movements im ON im.variant_id = pv.id
        AND im.tenant_id = ${tenantId}::uuid
        AND im.transaction_date <= ${asOfDate}::date
      WHERE p.tenant_id = ${tenantId}::uuid AND p.status = 'ACTIVE'
      GROUP BY p.id, p.name, p.sku, p.category, pv.id, pv.size, pv.sku
      ORDER BY p.name, pv.size
    `;

    // Group rows by product, compute avgCost in TypeScript (consistent with getProductStock)
    const productMap = new Map<string, {
      productId: string; productName: string; sku: string | null; category: string | null;
      variants: { variantId: string; size: string; sku: string | null; qtyOnHand: number; avgCost: number; totalValue: number }[];
      productTotalQty: number; productTotalValue: number;
    }>();

    for (const row of rows) {
      const qtyOnHand = safeMoney(row.qtyOnHand);
      const netCostPool = safeMoney(row.totalPurchaseCost) - safeMoney(row.totalReturnCost);
      const netQtyPool = safeMoney(row.totalPurchaseQty) - safeMoney(row.totalReturnQty);
      const avgCost = netQtyPool > 0 ? Math.round(netCostPool / netQtyPool) : 0;
      const totalValue = qtyOnHand * avgCost;

      let product = productMap.get(row.productId);
      if (!product) {
        product = {
          productId: row.productId,
          productName: row.productName,
          sku: row.sku ?? null,
          category: row.category ?? null,
          variants: [],
          productTotalQty: 0,
          productTotalValue: 0,
        };
        productMap.set(row.productId, product);
      }
      product.variants.push({ variantId: row.variantId, size: row.size, sku: row.variantSku ?? null, qtyOnHand, avgCost, totalValue });
      product.productTotalQty += qtyOnHand;
      product.productTotalValue += totalValue;
    }

    const products = Array.from(productMap.values());
    const grandTotalValue = products.reduce((sum, p) => sum + p.productTotalValue, 0);

    return { asOfDate, grandTotalValue, products };
  }

  // ─── EP-12: Trial Balance Report ─────────────────────────────────────────────

  async getTrialBalance(query: BalanceQueryDto) {
    const tenantId = this.requireTenantId();
    const asOfDate = query.asOfDate ?? await this.getBusinessDate(tenantId);

    const [arApRows, paymentAccountRows, inventoryRows] = await Promise.all([
      // AR and AP net balances from ledger entries
      this.prisma.$queryRaw<Array<{ net_ar: bigint; net_ap: bigint }>>`
        SELECT
          COALESCE(SUM(CASE WHEN le.entry_type = 'AR_INCREASE' THEN le.amount ELSE 0 END), 0)
          - COALESCE(SUM(CASE WHEN le.entry_type = 'AR_DECREASE' THEN le.amount ELSE 0 END), 0) AS net_ar,
          COALESCE(SUM(CASE WHEN le.entry_type = 'AP_INCREASE' THEN le.amount ELSE 0 END), 0)
          - COALESCE(SUM(CASE WHEN le.entry_type = 'AP_DECREASE' THEN le.amount ELSE 0 END), 0) AS net_ap
        FROM ledger_entries le
        JOIN transactions t ON t.id = le.transaction_id
        WHERE le.tenant_id = ${tenantId}::uuid
          AND t.status = 'POSTED'
          AND le.transaction_date <= ${asOfDate}::date
      `,
      // Payment account balances (one row per active account)
      this.prisma.$queryRaw<Array<{ name: string; opening_balance: bigint; total_in: bigint; total_out: bigint }>>`
        SELECT
          pa.name,
          pa.opening_balance::bigint,
          COALESCE(SUM(CASE WHEN pe.direction = 'IN'  THEN pe.amount ELSE 0 END), 0)::bigint AS total_in,
          COALESCE(SUM(CASE WHEN pe.direction = 'OUT' THEN pe.amount ELSE 0 END), 0)::bigint AS total_out
        FROM payment_accounts pa
        LEFT JOIN payment_entries pe
          ON pe.payment_account_id = pa.id
          AND pe.transaction_date <= ${asOfDate}::date
          AND EXISTS (
            SELECT 1 FROM transactions t
            WHERE t.id = pe.transaction_id AND t.status = 'POSTED'
          )
        WHERE pa.tenant_id = ${tenantId}::uuid
          AND pa.status = 'ACTIVE'
        GROUP BY pa.id, pa.name, pa.opening_balance
        ORDER BY pa.name
      `,
      // Net inventory value from inventory movements
      this.prisma.$queryRaw<Array<{ net_inventory_value: bigint }>>`
        SELECT
          COALESCE(SUM(
            CASE WHEN im.movement_type IN ('PURCHASE_IN', 'ADJUSTMENT_IN', 'CUSTOMER_RETURN_IN')
                 THEN im.quantity * im.unit_cost_at_time
                 ELSE -(im.quantity * im.unit_cost_at_time)
            END
          ), 0)::bigint AS net_inventory_value
        FROM inventory_movements im
        WHERE im.tenant_id = ${tenantId}::uuid
          AND im.movement_date <= ${asOfDate}::date
      `,
    ]);

    const netAr = safeMoney(arApRows[0].net_ar);
    const netAp = safeMoney(arApRows[0].net_ap);
    const netInventory = safeMoney(inventoryRows[0].net_inventory_value);

    const accounts: Array<{ name: string; debit: number; credit: number }> = [];

    // AR — debit when positive (customers owe us)
    if (netAr !== 0) {
      accounts.push({ name: 'Accounts Receivable', debit: netAr > 0 ? netAr : 0, credit: netAr < 0 ? -netAr : 0 });
    }

    // AP — credit when positive (we owe suppliers)
    if (netAp !== 0) {
      accounts.push({ name: 'Accounts Payable', debit: netAp < 0 ? -netAp : 0, credit: netAp > 0 ? netAp : 0 });
    }

    // Payment accounts
    for (const row of paymentAccountRows) {
      const balance = safeMoney(row.opening_balance) + safeMoney(row.total_in) - safeMoney(row.total_out);
      if (balance !== 0) {
        accounts.push({ name: row.name, debit: balance > 0 ? balance : 0, credit: balance < 0 ? -balance : 0 });
      }
    }

    // Inventory — debit when positive
    if (netInventory !== 0) {
      accounts.push({ name: 'Inventory', debit: netInventory > 0 ? netInventory : 0, credit: netInventory < 0 ? -netInventory : 0 });
    }

    const totalDebit = accounts.reduce((sum, a) => sum + a.debit, 0);
    const totalCredit = accounts.reduce((sum, a) => sum + a.credit, 0);

    return { asOfDate, accounts, totalDebit, totalCredit };
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  private requireTenantId(): string {
    const tenantId = getContext()?.tenantId;
    if (!tenantId) throw new UnauthorizedException();
    return tenantId;
  }

  private async getBusinessDate(tenantId: string): Promise<string> {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { timezone: true } });
    const tz = tenant?.timezone ?? 'Asia/Karachi';
    return new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date());
  }

  private buildRunningBalance<T extends Record<string, any>>(
    openingBalance: number,
    rows: T[],
    inKey: keyof T,
    outKey: keyof T,
  ) {
    let running = openingBalance;
    return rows.map((row) => {
      const inAmount = safeMoney(row[inKey]);
      const outAmount = safeMoney(row[outKey]);
      running = running + inAmount - outAmount;
      return {
        date: row.date instanceof Date ? row.date.toISOString().split('T')[0] : row.date,
        documentNumber: row.documentNumber ?? null,
        type: row.type,
        description: row.description ?? null,
        [inKey as string]: inAmount,
        [outKey as string]: outAmount,
        runningBalance: running,
      };
    });
  }
}
