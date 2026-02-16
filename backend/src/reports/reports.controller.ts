import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ReportsService } from './reports.service';
import { BalanceQueryDto } from './dto/balance-query.dto';
import { StatementQueryDto } from './dto/statement-query.dto';
import { PendingReceivablesQueryDto } from './dto/pending-receivables-query.dto';
import { PendingPayablesQueryDto } from './dto/pending-payables-query.dto';
import { ApiErrorResponse } from '../common/swagger/api-error-response.dto';
import { Roles } from '../common/decorators/roles.decorator';
import {
  CustomerBalanceReportResponseDto,
  CustomerStatementReportResponseDto,
  PaymentAccountBalanceReportResponseDto,
  PaymentAccountStatementReportResponseDto,
  PendingPayablesReportResponseDto,
  PendingReceivablesReportResponseDto,
  ProductStockReportResponseDto,
  SupplierBalanceReportResponseDto,
  SupplierStatementReportResponseDto,
} from './dto/report-response.dto';

@ApiTags('Reports')
@ApiBearerAuth('bearer')
@Roles('OWNER', 'ADMIN')
@Controller('reports')
export class ReportsController {
  constructor(private reportsService: ReportsService) {}

  // ─── Balance Reports ─────────────────────────────────────────────────────────

  @Get('suppliers/:id/balance')
  @ApiOperation({ summary: 'Supplier balance report (point-in-time)' })
  @ApiParam({ name: 'id', description: 'Supplier UUID' })
  @ApiQuery({ name: 'asOfDate', required: false, type: String, example: '2026-02-20' })
  @ApiOkResponse({ description: 'Supplier balance with breakdown', type: SupplierBalanceReportResponseDto })
  @ApiNotFoundResponse({ description: 'Supplier not found', type: ApiErrorResponse })
  @ApiUnauthorizedResponse({ description: 'Unauthorized', type: ApiErrorResponse })
  getSupplierBalance(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: BalanceQueryDto,
  ) {
    return this.reportsService.getSupplierBalance(id, query);
  }

  @Get('customers/:id/balance')
  @ApiOperation({ summary: 'Customer balance report (point-in-time)' })
  @ApiParam({ name: 'id', description: 'Customer UUID' })
  @ApiQuery({ name: 'asOfDate', required: false, type: String, example: '2026-02-20' })
  @ApiOkResponse({ description: 'Customer balance with breakdown', type: CustomerBalanceReportResponseDto })
  @ApiNotFoundResponse({ description: 'Customer not found', type: ApiErrorResponse })
  @ApiUnauthorizedResponse({ description: 'Unauthorized', type: ApiErrorResponse })
  getCustomerBalance(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: BalanceQueryDto,
  ) {
    return this.reportsService.getCustomerBalance(id, query);
  }

  @Get('payment-accounts/:id/balance')
  @ApiOperation({ summary: 'Payment account balance report (point-in-time)' })
  @ApiParam({ name: 'id', description: 'Payment account UUID' })
  @ApiQuery({ name: 'asOfDate', required: false, type: String, example: '2026-02-20' })
  @ApiOkResponse({ description: 'Payment account balance with breakdown', type: PaymentAccountBalanceReportResponseDto })
  @ApiNotFoundResponse({ description: 'Payment account not found', type: ApiErrorResponse })
  @ApiUnauthorizedResponse({ description: 'Unauthorized', type: ApiErrorResponse })
  getPaymentAccountBalance(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: BalanceQueryDto,
  ) {
    return this.reportsService.getPaymentAccountBalance(id, query);
  }

  @Get('products/:id/stock')
  @ApiOperation({ summary: 'Product stock report (point-in-time)' })
  @ApiParam({ name: 'id', description: 'Product UUID' })
  @ApiQuery({ name: 'asOfDate', required: false, type: String, example: '2026-02-20' })
  @ApiOkResponse({ description: 'Product stock with movement breakdown', type: ProductStockReportResponseDto })
  @ApiNotFoundResponse({ description: 'Product not found', type: ApiErrorResponse })
  @ApiUnauthorizedResponse({ description: 'Unauthorized', type: ApiErrorResponse })
  getProductStock(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: BalanceQueryDto,
  ) {
    return this.reportsService.getProductStock(id, query);
  }

  // ─── Pending Reports ─────────────────────────────────────────────────────────

  @Get('pending-receivables')
  @ApiOperation({ summary: 'Pending receivables — all customers with outstanding AR balances' })
  @ApiQuery({ name: 'asOfDate', required: false, type: String })
  @ApiQuery({ name: 'customerId', required: false, type: String })
  @ApiQuery({ name: 'minAmount', required: false, type: Number })
  @ApiOkResponse({ description: 'Pending receivables list with open documents', type: PendingReceivablesReportResponseDto })
  @ApiUnauthorizedResponse({ description: 'Unauthorized', type: ApiErrorResponse })
  getPendingReceivables(@Query() query: PendingReceivablesQueryDto) {
    return this.reportsService.getPendingReceivables(query);
  }

  @Get('pending-payables')
  @ApiOperation({ summary: 'Pending payables — all suppliers with outstanding AP balances' })
  @ApiQuery({ name: 'asOfDate', required: false, type: String })
  @ApiQuery({ name: 'supplierId', required: false, type: String })
  @ApiQuery({ name: 'minAmount', required: false, type: Number })
  @ApiOkResponse({ description: 'Pending payables list with open documents', type: PendingPayablesReportResponseDto })
  @ApiUnauthorizedResponse({ description: 'Unauthorized', type: ApiErrorResponse })
  getPendingPayables(@Query() query: PendingPayablesQueryDto) {
    return this.reportsService.getPendingPayables(query);
  }

  // ─── Statement Reports ───────────────────────────────────────────────────────

  @Get('suppliers/:id/statement')
  @ApiOperation({ summary: 'Supplier account statement with running balance' })
  @ApiParam({ name: 'id', description: 'Supplier UUID' })
  @ApiQuery({ name: 'dateFrom', required: true, type: String, example: '2026-01-01' })
  @ApiQuery({ name: 'dateTo', required: true, type: String, example: '2026-02-20' })
  @ApiOkResponse({ description: 'Supplier statement with opening/closing balance and ledger entries', type: SupplierStatementReportResponseDto })
  @ApiNotFoundResponse({ description: 'Supplier not found', type: ApiErrorResponse })
  @ApiUnauthorizedResponse({ description: 'Unauthorized', type: ApiErrorResponse })
  getSupplierStatement(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: StatementQueryDto,
  ) {
    return this.reportsService.getSupplierStatement(id, query);
  }

  @Get('customers/:id/statement')
  @ApiOperation({ summary: 'Customer account statement with running balance' })
  @ApiParam({ name: 'id', description: 'Customer UUID' })
  @ApiQuery({ name: 'dateFrom', required: true, type: String, example: '2026-01-01' })
  @ApiQuery({ name: 'dateTo', required: true, type: String, example: '2026-02-20' })
  @ApiOkResponse({ description: 'Customer statement with opening/closing balance and ledger entries', type: CustomerStatementReportResponseDto })
  @ApiNotFoundResponse({ description: 'Customer not found', type: ApiErrorResponse })
  @ApiUnauthorizedResponse({ description: 'Unauthorized', type: ApiErrorResponse })
  getCustomerStatement(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: StatementQueryDto,
  ) {
    return this.reportsService.getCustomerStatement(id, query);
  }

  @Get('payment-accounts/:id/statement')
  @ApiOperation({ summary: 'Payment account statement with running balance' })
  @ApiParam({ name: 'id', description: 'Payment account UUID' })
  @ApiQuery({ name: 'dateFrom', required: true, type: String, example: '2026-01-01' })
  @ApiQuery({ name: 'dateTo', required: true, type: String, example: '2026-02-20' })
  @ApiOkResponse({ description: 'Payment account statement with opening/closing balance', type: PaymentAccountStatementReportResponseDto })
  @ApiNotFoundResponse({ description: 'Payment account not found', type: ApiErrorResponse })
  @ApiUnauthorizedResponse({ description: 'Unauthorized', type: ApiErrorResponse })
  getPaymentAccountStatement(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: StatementQueryDto,
  ) {
    return this.reportsService.getPaymentAccountStatement(id, query);
  }
}
