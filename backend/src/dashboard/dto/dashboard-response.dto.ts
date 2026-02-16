import { ApiProperty } from '@nestjs/swagger';

export class DashboardAccountBalanceDto {
  @ApiProperty({ example: 'Main Cash' })
  name!: string;

  @ApiProperty({ example: 125000, description: 'Account balance in PKR (integer)' })
  balance!: number;
}

export class DashboardCashSummaryDto {
  @ApiProperty({ example: 250000, description: 'Total cash balance in PKR (integer)' })
  totalBalance!: number;

  @ApiProperty({ type: [DashboardAccountBalanceDto] })
  accounts!: DashboardAccountBalanceDto[];
}

export class DashboardInventorySummaryDto {
  @ApiProperty({ example: 1400000, description: 'Inventory value in PKR (integer)' })
  totalValue!: number;

  @ApiProperty({ example: 120 })
  totalProducts!: number;

  @ApiProperty({ example: 9 })
  lowStockCount!: number;
}

export class DashboardReceivablesSummaryDto {
  @ApiProperty({ example: 500000, description: 'Total receivables in PKR (integer)' })
  totalAmount!: number;

  @ApiProperty({ example: 23 })
  customerCount!: number;

  @ApiProperty({ example: 180000, description: 'Overdue receivables in PKR (integer)' })
  overdueAmount!: number;

  @ApiProperty({ example: 8 })
  overdueCount!: number;
}

export class DashboardPayablesSummaryDto {
  @ApiProperty({ example: 300000, description: 'Total payables in PKR (integer)' })
  totalAmount!: number;

  @ApiProperty({ example: 15 })
  supplierCount!: number;

  @ApiProperty({ example: 90000, description: 'Overdue payables in PKR (integer)' })
  overdueAmount!: number;

  @ApiProperty({ example: 5 })
  overdueCount!: number;
}

export class DashboardRecentActivitySummaryDto {
  @ApiProperty({ example: 75000, description: 'Today sales in PKR (integer)' })
  todaySales!: number;

  @ApiProperty({ example: 45000, description: 'Today purchases in PKR (integer)' })
  todayPurchases!: number;

  @ApiProperty({ example: 20000, description: 'Today supplier payments in PKR (integer)' })
  todayPayments!: number;

  @ApiProperty({ example: 35000, description: 'Today customer receipts in PKR (integer)' })
  todayReceipts!: number;
}

export class DashboardSummaryResponseDto {
  @ApiProperty({ example: '2026-02-15', format: 'date' })
  asOfDate!: string;

  @ApiProperty({ type: DashboardCashSummaryDto })
  cash!: DashboardCashSummaryDto;

  @ApiProperty({ type: DashboardInventorySummaryDto })
  inventory!: DashboardInventorySummaryDto;

  @ApiProperty({ type: DashboardReceivablesSummaryDto })
  receivables!: DashboardReceivablesSummaryDto;

  @ApiProperty({ type: DashboardPayablesSummaryDto })
  payables!: DashboardPayablesSummaryDto;

  @ApiProperty({ type: DashboardRecentActivitySummaryDto })
  recentActivity!: DashboardRecentActivitySummaryDto;
}
