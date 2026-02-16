import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ReportAmountCountDto {
  @ApiProperty({ example: 12 })
  count!: number;

  @ApiProperty({ example: 125000, description: 'Amount in PKR (integer)' })
  totalAmount!: number;
}

export class SupplierBalanceBreakdownDto {
  @ApiProperty({ type: ReportAmountCountDto })
  purchases!: ReportAmountCountDto;

  @ApiProperty({ type: ReportAmountCountDto })
  payments!: ReportAmountCountDto;

  @ApiProperty({ type: ReportAmountCountDto })
  returns!: ReportAmountCountDto;

  @ApiProperty({ example: 100000, description: 'Net payable in PKR (integer)' })
  netPayable!: number;
}

export class SupplierBalanceReportResponseDto {
  @ApiProperty({ example: '9f4b6e2c-0a2d-4cc5-8c4d-1a4a88c81a88', format: 'uuid' })
  supplierId!: string;

  @ApiProperty({ example: 'Acme Supplies' })
  supplierName!: string;

  @ApiProperty({ example: '2026-02-20', format: 'date' })
  asOfDate!: string;

  @ApiProperty({ example: 100000, description: 'Balance in PKR (integer)' })
  balance!: number;

  @ApiProperty({ example: 'PAYABLE' })
  balanceType!: string;

  @ApiProperty({ type: SupplierBalanceBreakdownDto })
  breakdown!: SupplierBalanceBreakdownDto;
}

export class CustomerBalanceBreakdownDto {
  @ApiProperty({ type: ReportAmountCountDto })
  sales!: ReportAmountCountDto;

  @ApiProperty({ type: ReportAmountCountDto })
  payments!: ReportAmountCountDto;

  @ApiProperty({ type: ReportAmountCountDto })
  returns!: ReportAmountCountDto;

  @ApiProperty({ example: 100000, description: 'Net receivable in PKR (integer)' })
  netReceivable!: number;
}

export class CustomerBalanceReportResponseDto {
  @ApiProperty({ example: '9f4b6e2c-0a2d-4cc5-8c4d-1a4a88c81a88', format: 'uuid' })
  customerId!: string;

  @ApiProperty({ example: 'Big Corp' })
  customerName!: string;

  @ApiProperty({ example: '2026-02-20', format: 'date' })
  asOfDate!: string;

  @ApiProperty({ example: 100000, description: 'Balance in PKR (integer)' })
  balance!: number;

  @ApiProperty({ example: 'RECEIVABLE' })
  balanceType!: string;

  @ApiProperty({ type: CustomerBalanceBreakdownDto })
  breakdown!: CustomerBalanceBreakdownDto;
}

export class PaymentAccountBalanceBreakdownDto {
  @ApiProperty({ example: 25000, description: 'Opening balance in PKR (integer)' })
  openingBalance!: number;

  @ApiProperty({ type: ReportAmountCountDto })
  moneyIn!: ReportAmountCountDto;

  @ApiProperty({ type: ReportAmountCountDto })
  moneyOut!: ReportAmountCountDto;

  @ApiProperty({ example: 125000, description: 'Current balance in PKR (integer)' })
  currentBalance!: number;
}

export class PaymentAccountBalanceReportResponseDto {
  @ApiProperty({ example: '9f4b6e2c-0a2d-4cc5-8c4d-1a4a88c81a88', format: 'uuid' })
  accountId!: string;

  @ApiProperty({ example: 'Main Cash' })
  accountName!: string;

  @ApiProperty({ example: 'CASH' })
  accountType!: string;

  @ApiProperty({ example: '2026-02-20', format: 'date' })
  asOfDate!: string;

  @ApiProperty({ example: 125000, description: 'Balance in PKR (integer)' })
  balance!: number;

  @ApiProperty({ type: PaymentAccountBalanceBreakdownDto })
  breakdown!: PaymentAccountBalanceBreakdownDto;
}

export class ProductStockBreakdownDto {
  @ApiProperty({ example: 100 })
  purchasesIn!: number;

  @ApiProperty({ example: 30 })
  salesOut!: number;

  @ApiProperty({ example: 5 })
  customerReturnsIn!: number;

  @ApiProperty({ example: 2 })
  supplierReturnsOut!: number;

  @ApiProperty({ example: 3 })
  adjustmentsIn!: number;

  @ApiProperty({ example: 1 })
  adjustmentsOut!: number;

  @ApiProperty({ example: 75 })
  netStock!: number;
}

export class ProductStockReportResponseDto {
  @ApiProperty({ example: '9f4b6e2c-0a2d-4cc5-8c4d-1a4a88c81a88', format: 'uuid' })
  productId!: string;

  @ApiProperty({ example: 'Sella Rice 25kg' })
  productName!: string;

  @ApiPropertyOptional({ type: String, example: 'RICE-25KG', nullable: true })
  sku?: string | null;

  @ApiProperty({ example: '2026-02-20', format: 'date' })
  asOfDate!: string;

  @ApiProperty({ example: 75 })
  currentStock!: number;

  @ApiProperty({ example: 1200, description: 'Average cost in PKR (integer)' })
  avgCost!: number;

  @ApiProperty({ example: 90000, description: 'Stock valuation in PKR (integer)' })
  stockValue!: number;

  @ApiProperty({ type: ProductStockBreakdownDto })
  breakdown!: ProductStockBreakdownDto;
}

export class PendingDocumentDto {
  @ApiPropertyOptional({ type: String, example: 'SAL-0001', nullable: true })
  documentNumber?: string | null;

  @ApiProperty({ example: '2026-02-10', format: 'date' })
  transactionDate!: string;

  @ApiProperty({ example: 50000, description: 'Document total in PKR (integer)' })
  totalAmount!: number;

  @ApiProperty({ example: 10000, description: 'Paid amount in PKR (integer)' })
  paidAmount!: number;

  @ApiProperty({ example: 40000, description: 'Outstanding amount in PKR (integer)' })
  outstanding!: number;

  @ApiProperty({ example: 10 })
  daysPastDue!: number;
}

export class PendingReceivableCustomerDto {
  @ApiProperty({ example: '9f4b6e2c-0a2d-4cc5-8c4d-1a4a88c81a88', format: 'uuid' })
  customerId!: string;

  @ApiProperty({ example: 'Big Corp' })
  customerName!: string;

  @ApiProperty({ example: 120000, description: 'Customer outstanding balance in PKR (integer)' })
  balance!: number;

  @ApiPropertyOptional({ type: String, example: '2026-01-25', nullable: true, format: 'date' })
  oldestInvoiceDate?: string | null;

  @ApiProperty({ example: 26 })
  daysPastDue!: number;

  @ApiProperty({ type: [PendingDocumentDto] })
  openDocuments!: PendingDocumentDto[];
}

export class PendingReceivablesReportResponseDto {
  @ApiProperty({ example: '2026-02-20', format: 'date' })
  asOfDate!: string;

  @ApiProperty({ example: 350000, description: 'Total receivables in PKR (integer)' })
  totalReceivables!: number;

  @ApiProperty({ example: 7 })
  customerCount!: number;

  @ApiProperty({ type: [PendingReceivableCustomerDto] })
  customers!: PendingReceivableCustomerDto[];
}

export class PendingPayableSupplierDto {
  @ApiProperty({ example: '9f4b6e2c-0a2d-4cc5-8c4d-1a4a88c81a88', format: 'uuid' })
  supplierId!: string;

  @ApiProperty({ example: 'Acme Supplies' })
  supplierName!: string;

  @ApiProperty({ example: 98000, description: 'Supplier outstanding balance in PKR (integer)' })
  balance!: number;

  @ApiPropertyOptional({ type: String, example: '2026-01-23', nullable: true, format: 'date' })
  oldestInvoiceDate?: string | null;

  @ApiProperty({ example: 28 })
  daysPastDue!: number;

  @ApiProperty({ type: [PendingDocumentDto] })
  openDocuments!: PendingDocumentDto[];
}

export class PendingPayablesReportResponseDto {
  @ApiProperty({ example: '2026-02-20', format: 'date' })
  asOfDate!: string;

  @ApiProperty({ example: 280000, description: 'Total payables in PKR (integer)' })
  totalPayables!: number;

  @ApiProperty({ example: 5 })
  supplierCount!: number;

  @ApiProperty({ type: [PendingPayableSupplierDto] })
  suppliers!: PendingPayableSupplierDto[];
}

export class StatementDebitCreditEntryDto {
  @ApiProperty({ example: '2026-02-10', format: 'date' })
  date!: string;

  @ApiPropertyOptional({ type: String, example: 'PUR-0001', nullable: true })
  documentNumber?: string | null;

  @ApiProperty({ example: 'PURCHASE' })
  type!: string;

  @ApiProperty({ example: 50000, description: 'Debit amount in PKR (integer)' })
  debit!: number;

  @ApiProperty({ example: 10000, description: 'Credit amount in PKR (integer)' })
  credit!: number;

  @ApiProperty({ example: 40000, description: 'Running balance in PKR (integer)' })
  runningBalance!: number;
}

export class SupplierStatementReportResponseDto {
  @ApiProperty({ example: '9f4b6e2c-0a2d-4cc5-8c4d-1a4a88c81a88', format: 'uuid' })
  supplierId!: string;

  @ApiProperty({ example: 'Acme Supplies' })
  supplierName!: string;

  @ApiProperty({ example: '2026-01-01', format: 'date' })
  dateFrom!: string;

  @ApiProperty({ example: '2026-02-20', format: 'date' })
  dateTo!: string;

  @ApiProperty({ example: 15000, description: 'Opening balance in PKR (integer)' })
  openingBalance!: number;

  @ApiProperty({ example: 100000, description: 'Closing balance in PKR (integer)' })
  closingBalance!: number;

  @ApiProperty({ type: [StatementDebitCreditEntryDto] })
  entries!: StatementDebitCreditEntryDto[];
}

export class CustomerStatementReportResponseDto {
  @ApiProperty({ example: '9f4b6e2c-0a2d-4cc5-8c4d-1a4a88c81a88', format: 'uuid' })
  customerId!: string;

  @ApiProperty({ example: 'Big Corp' })
  customerName!: string;

  @ApiProperty({ example: '2026-01-01', format: 'date' })
  dateFrom!: string;

  @ApiProperty({ example: '2026-02-20', format: 'date' })
  dateTo!: string;

  @ApiProperty({ example: 25000, description: 'Opening balance in PKR (integer)' })
  openingBalance!: number;

  @ApiProperty({ example: 130000, description: 'Closing balance in PKR (integer)' })
  closingBalance!: number;

  @ApiProperty({ type: [StatementDebitCreditEntryDto] })
  entries!: StatementDebitCreditEntryDto[];
}

export class StatementMoneyEntryDto {
  @ApiProperty({ example: '2026-02-10', format: 'date' })
  date!: string;

  @ApiPropertyOptional({ type: String, example: 'PAY-0001', nullable: true })
  documentNumber?: string | null;

  @ApiProperty({ example: 'SUPPLIER_PAYMENT' })
  type!: string;

  @ApiProperty({ example: 50000, description: 'Money in amount in PKR (integer)' })
  moneyIn!: number;

  @ApiProperty({ example: 10000, description: 'Money out amount in PKR (integer)' })
  moneyOut!: number;

  @ApiProperty({ example: 40000, description: 'Running balance in PKR (integer)' })
  runningBalance!: number;
}

export class PaymentAccountStatementReportResponseDto {
  @ApiProperty({ example: '9f4b6e2c-0a2d-4cc5-8c4d-1a4a88c81a88', format: 'uuid' })
  accountId!: string;

  @ApiProperty({ example: 'Main Cash' })
  accountName!: string;

  @ApiProperty({ example: '2026-01-01', format: 'date' })
  dateFrom!: string;

  @ApiProperty({ example: '2026-02-20', format: 'date' })
  dateTo!: string;

  @ApiProperty({ example: 25000, description: 'Opening balance in PKR (integer)' })
  openingBalance!: number;

  @ApiProperty({ example: 90000, description: 'Closing balance in PKR (integer)' })
  closingBalance!: number;

  @ApiProperty({ type: [StatementMoneyEntryDto] })
  entries!: StatementMoneyEntryDto[];
}
