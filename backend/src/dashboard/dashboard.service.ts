import { Injectable, UnauthorizedException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { getContext } from '../common/request-context';
import { DashboardQueryDto } from './dto/dashboard-query.dto';
import { safeMoney } from '../common/utils/money';

type TxClient = Prisma.TransactionClient;

@Injectable()
export class DashboardService {
  constructor(private prisma: PrismaService) {}

  async getSummary(query: DashboardQueryDto) {
    const tenantId = this.requireTenantId();
    const asOfDate = query.asOfDate ?? await this.getBusinessDate(tenantId);
    const overdueThreshold = this.subtractDays(asOfDate, 30);

    // Task 8.1: all 5 sub-queries run inside a single RepeatableRead snapshot
    const [cashRows, invRows, recRows, payRows, actRows] = await this.prisma.$transaction(
      async (tx) =>
        Promise.all([
          this.queryCash(tx, tenantId, asOfDate),
          this.queryInventory(tx, tenantId, asOfDate),
          this.queryReceivables(tx, tenantId, asOfDate, overdueThreshold),
          this.queryPayables(tx, tenantId, asOfDate, overdueThreshold),
          this.queryRecentActivity(tx, tenantId, asOfDate),
        ]),
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );

    // Cash section
    const accounts = cashRows.map((r) => ({ name: r.name, balance: safeMoney(r.balance) }));
    const totalBalance = accounts.reduce((sum, a) => sum + a.balance, 0);

    // Inventory section
    const inv = invRows[0];
    const inventory = {
      totalValue: safeMoney(inv.totalValue),
      totalProducts: Number(inv.totalProducts),
      lowStockCount: Number(inv.lowStockCount),
    };

    // Receivables section
    const rec = recRows[0];
    const receivables = {
      totalAmount: safeMoney(rec.totalAmount),
      customerCount: Number(rec.customerCount),
      overdueAmount: safeMoney(rec.overdueAmount),
      overdueCount: Number(rec.overdueCount),
    };

    // Payables section
    const pay = payRows[0];
    const payables = {
      totalAmount: safeMoney(pay.totalAmount),
      supplierCount: Number(pay.supplierCount),
      overdueAmount: safeMoney(pay.overdueAmount),
      overdueCount: Number(pay.overdueCount),
    };

    // Recent activity section
    const act = actRows[0];
    const recentActivity = {
      todaySales: safeMoney(act.todaySales),
      todayPurchases: safeMoney(act.todayPurchases),
      todayPayments: safeMoney(act.todayPayments),
      todayReceipts: safeMoney(act.todayReceipts),
    };

    return {
      asOfDate,
      cash: { totalBalance, accounts },
      inventory,
      receivables,
      payables,
      recentActivity,
    };
  }

  // ─── Sub-queries ─────────────────────────────────────────────────────────────

  private queryCash(tx: TxClient, tenantId: string, asOfDate: string) {
    return tx.$queryRaw<Array<{ id: string; name: string; balance: bigint }>>`
      SELECT
        pa.id,
        pa.name,
        (pa.opening_balance
          + COALESCE(SUM(CASE WHEN pe.direction = 'IN'  THEN pe.amount ELSE 0 END), 0)
          - COALESCE(SUM(CASE WHEN pe.direction = 'OUT' THEN pe.amount ELSE 0 END), 0)
        )::bigint AS balance
      FROM payment_accounts pa
      LEFT JOIN payment_entries pe
        ON pe.payment_account_id = pa.id
       AND pe.tenant_id = ${tenantId}::uuid
       AND pe.transaction_date <= ${asOfDate}::date
      WHERE pa.tenant_id = ${tenantId}::uuid
      GROUP BY pa.id, pa.name, pa.opening_balance
      ORDER BY pa.name
    `;
  }

  private queryInventory(tx: TxClient, tenantId: string, asOfDate: string) {
    return tx.$queryRaw<
      Array<{ totalProducts: number; totalValue: bigint; lowStockCount: number }>
    >`
      WITH active_products AS (
        SELECT id FROM products
        WHERE tenant_id = ${tenantId}::uuid AND status = 'ACTIVE'
      ),
      variant_stock AS (
        SELECT
          pv.product_id,
          COALESCE(SUM(CASE
            WHEN im.movement_type = 'PURCHASE_IN'         THEN  im.quantity
            WHEN im.movement_type = 'CUSTOMER_RETURN_IN'  THEN  im.quantity
            WHEN im.movement_type = 'ADJUSTMENT_IN'       THEN  im.quantity
            WHEN im.movement_type = 'SALE_OUT'            THEN -im.quantity
            WHEN im.movement_type = 'SUPPLIER_RETURN_OUT' THEN -im.quantity
            WHEN im.movement_type = 'ADJUSTMENT_OUT'      THEN -im.quantity
            ELSE 0 END), 0) AS net_stock,
          CASE
            WHEN COALESCE(SUM(CASE WHEN im.movement_type = 'PURCHASE_IN' THEN im.quantity ELSE 0 END), 0) > 0
            THEN COALESCE(SUM(CASE WHEN im.movement_type = 'PURCHASE_IN' THEN im.unit_cost_at_time * im.quantity ELSE 0 END), 0) /
                 COALESCE(SUM(CASE WHEN im.movement_type = 'PURCHASE_IN' THEN im.quantity ELSE 0 END), 0)
            ELSE 0
          END AS avg_cost
        FROM inventory_movements im
        JOIN product_variants pv ON pv.id = im.variant_id
        WHERE im.tenant_id = ${tenantId}::uuid
          AND im.transaction_date <= ${asOfDate}::date
        GROUP BY pv.product_id
      ),
      ap_with_stock AS (
        SELECT
          ap.id,
          COALESCE(vs.net_stock, 0) AS net_stock,
          COALESCE(vs.avg_cost, 0)  AS avg_cost
        FROM active_products ap
        LEFT JOIN variant_stock vs ON vs.product_id = ap.id
      )
      SELECT
        COUNT(*)::int                                    AS "totalProducts",
        COALESCE(SUM(net_stock * avg_cost), 0)::bigint  AS "totalValue",
        COUNT(CASE WHEN net_stock <= 5 THEN 1 END)::int AS "lowStockCount"
      FROM ap_with_stock
    `;
  }

  private queryReceivables(tx: TxClient, tenantId: string, asOfDate: string, overdueThreshold: string) {
    return tx.$queryRaw<
      Array<{ customerCount: number; totalAmount: bigint; overdueCount: number; overdueAmount: bigint }>
    >`
      WITH ar_balances AS (
        SELECT
          le.customer_id,
          SUM(CASE WHEN le.entry_type = 'AR_INCREASE' THEN le.amount ELSE -le.amount END) AS balance
        FROM ledger_entries le
        JOIN transactions t ON t.id = le.transaction_id
        WHERE le.tenant_id = ${tenantId}::uuid
          AND le.transaction_date <= ${asOfDate}::date
          AND t.status = 'POSTED'
        GROUP BY le.customer_id
        HAVING SUM(CASE WHEN le.entry_type = 'AR_INCREASE' THEN le.amount ELSE -le.amount END) > 0
      ),
      alloc_sums AS (
        SELECT a.applies_to_transaction_id AS txn_id, SUM(a.amount_applied) AS paid
        FROM allocations a
        JOIN transactions pt ON pt.id = a.payment_transaction_id
        WHERE a.tenant_id = ${tenantId}::uuid
          AND pt.transaction_date <= ${asOfDate}::date
          AND pt.status = 'POSTED'
        GROUP BY a.applies_to_transaction_id
      ),
      overdue_amounts AS (
        SELECT t.customer_id, SUM(t.total_amount - COALESCE(a.paid, 0)) AS overdue_amount
        FROM transactions t
        LEFT JOIN alloc_sums a ON a.txn_id = t.id
        WHERE t.tenant_id = ${tenantId}::uuid
          AND t.type = 'SALE'
          AND t.status = 'POSTED'
          AND t.transaction_date <= ${asOfDate}::date
          AND t.transaction_date < ${overdueThreshold}::date
          AND t.total_amount - COALESCE(a.paid, 0) > 0
        GROUP BY t.customer_id
      )
      SELECT
        COUNT(ab.customer_id)::int                               AS "customerCount",
        COALESCE(SUM(ab.balance), 0)::bigint                    AS "totalAmount",
        COUNT(oa.customer_id)::int                              AS "overdueCount",
        COALESCE(SUM(oa.overdue_amount), 0)::bigint             AS "overdueAmount"
      FROM ar_balances ab
      LEFT JOIN overdue_amounts oa ON oa.customer_id = ab.customer_id
    `;
  }

  private queryPayables(tx: TxClient, tenantId: string, asOfDate: string, overdueThreshold: string) {
    return tx.$queryRaw<
      Array<{ supplierCount: number; totalAmount: bigint; overdueCount: number; overdueAmount: bigint }>
    >`
      WITH ap_balances AS (
        SELECT
          le.supplier_id,
          SUM(CASE WHEN le.entry_type = 'AP_INCREASE' THEN le.amount ELSE -le.amount END) AS balance
        FROM ledger_entries le
        JOIN transactions t ON t.id = le.transaction_id
        WHERE le.tenant_id = ${tenantId}::uuid
          AND le.transaction_date <= ${asOfDate}::date
          AND t.status = 'POSTED'
        GROUP BY le.supplier_id
        HAVING SUM(CASE WHEN le.entry_type = 'AP_INCREASE' THEN le.amount ELSE -le.amount END) > 0
      ),
      alloc_sums AS (
        SELECT a.applies_to_transaction_id AS txn_id, SUM(a.amount_applied) AS paid
        FROM allocations a
        JOIN transactions pt ON pt.id = a.payment_transaction_id
        WHERE a.tenant_id = ${tenantId}::uuid
          AND pt.transaction_date <= ${asOfDate}::date
          AND pt.status = 'POSTED'
        GROUP BY a.applies_to_transaction_id
      ),
      overdue_amounts AS (
        SELECT t.supplier_id, SUM(t.total_amount - COALESCE(a.paid, 0)) AS overdue_amount
        FROM transactions t
        LEFT JOIN alloc_sums a ON a.txn_id = t.id
        WHERE t.tenant_id = ${tenantId}::uuid
          AND t.type = 'PURCHASE'
          AND t.status = 'POSTED'
          AND t.transaction_date <= ${asOfDate}::date
          AND t.transaction_date < ${overdueThreshold}::date
          AND t.total_amount - COALESCE(a.paid, 0) > 0
        GROUP BY t.supplier_id
      )
      SELECT
        COUNT(ab.supplier_id)::int                              AS "supplierCount",
        COALESCE(SUM(ab.balance), 0)::bigint                   AS "totalAmount",
        COUNT(oa.supplier_id)::int                             AS "overdueCount",
        COALESCE(SUM(oa.overdue_amount), 0)::bigint            AS "overdueAmount"
      FROM ap_balances ab
      LEFT JOIN overdue_amounts oa ON oa.supplier_id = ab.supplier_id
    `;
  }

  private queryRecentActivity(tx: TxClient, tenantId: string, asOfDate: string) {
    return tx.$queryRaw<
      Array<{ todaySales: bigint; todayPurchases: bigint; todayPayments: bigint; todayReceipts: bigint }>
    >`
      SELECT
        COALESCE(SUM(CASE WHEN type = 'SALE'             THEN total_amount ELSE 0 END), 0)::bigint AS "todaySales",
        COALESCE(SUM(CASE WHEN type = 'PURCHASE'         THEN total_amount ELSE 0 END), 0)::bigint AS "todayPurchases",
        COALESCE(SUM(CASE WHEN type = 'SUPPLIER_PAYMENT' THEN total_amount ELSE 0 END), 0)::bigint AS "todayPayments",
        COALESCE(SUM(CASE WHEN type = 'CUSTOMER_PAYMENT' THEN total_amount ELSE 0 END), 0)::bigint AS "todayReceipts"
      FROM transactions
      WHERE tenant_id = ${tenantId}::uuid
        AND status = 'POSTED'
        AND transaction_date = ${asOfDate}::date
    `;
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

  private subtractDays(dateStr: string, days: number): string {
    const d = new Date(dateStr + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() - days);
    return d.toISOString().split('T')[0];
  }
}
