import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { TransactionStatus, TransactionType } from '@prisma/client';
import { TransactionsService } from './transactions.service';
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
import { ApiErrorResponse } from '../common/swagger/api-error-response.dto';
import {
  AllocationListResponseDto,
  TransactionListResponseDto,
  TransactionResponseDto,
} from './dto/transaction-response.dto';
import { ReturnableLinesResponseDto } from './dto/returnable-lines-response.dto';
import { PatchTransactionDto } from './dto/patch-transaction.dto';

@ApiTags('Transactions')
@ApiBearerAuth('bearer')
@Controller('transactions')
export class TransactionsController {
  constructor(private transactionsService: TransactionsService) {}

  @Post('purchases/draft')
  @ApiOperation({ summary: 'Create purchase draft' })
  @ApiCreatedResponse({ description: 'Purchase draft created', type: TransactionResponseDto })
  @ApiBadRequestResponse({ description: 'Validation failed', type: ApiErrorResponse })
  @ApiNotFoundResponse({ description: 'Supplier or product not found', type: ApiErrorResponse })
  @ApiUnprocessableEntityResponse({
    description: 'Supplier or product inactive',
    type: ApiErrorResponse,
  })
  @ApiUnauthorizedResponse({ description: 'Unauthorized', type: ApiErrorResponse })
  createPurchaseDraft(@Body() dto: CreatePurchaseDraftDto) {
    return this.transactionsService.createPurchaseDraft(dto);
  }

  @Post('sales/draft')
  @ApiOperation({ summary: 'Create sale draft' })
  @ApiCreatedResponse({ description: 'Sale draft created', type: TransactionResponseDto })
  @ApiBadRequestResponse({ description: 'Validation failed', type: ApiErrorResponse })
  @ApiNotFoundResponse({ description: 'Customer or product not found', type: ApiErrorResponse })
  @ApiUnprocessableEntityResponse({
    description: 'Customer or product inactive',
    type: ApiErrorResponse,
  })
  @ApiUnauthorizedResponse({ description: 'Unauthorized', type: ApiErrorResponse })
  createSaleDraft(@Body() dto: CreateSaleDraftDto) {
    return this.transactionsService.createSaleDraft(dto);
  }

  @Post('supplier-payments/draft')
  @ApiOperation({ summary: 'Create supplier payment draft' })
  @ApiCreatedResponse({ description: 'Supplier payment draft created', type: TransactionResponseDto })
  @ApiBadRequestResponse({ description: 'Validation failed', type: ApiErrorResponse })
  @ApiNotFoundResponse({ description: 'Supplier or payment account not found', type: ApiErrorResponse })
  @ApiUnprocessableEntityResponse({ description: 'Supplier or payment account inactive', type: ApiErrorResponse })
  @ApiUnauthorizedResponse({ description: 'Unauthorized', type: ApiErrorResponse })
  createSupplierPaymentDraft(@Body() dto: CreateSupplierPaymentDraftDto) {
    return this.transactionsService.createSupplierPaymentDraft(dto);
  }

  @Post('customer-payments/draft')
  @ApiOperation({ summary: 'Create customer payment draft' })
  @ApiCreatedResponse({ description: 'Customer payment draft created', type: TransactionResponseDto })
  @ApiBadRequestResponse({ description: 'Validation failed', type: ApiErrorResponse })
  @ApiNotFoundResponse({ description: 'Customer or payment account not found', type: ApiErrorResponse })
  @ApiUnprocessableEntityResponse({ description: 'Customer or payment account inactive', type: ApiErrorResponse })
  @ApiUnauthorizedResponse({ description: 'Unauthorized', type: ApiErrorResponse })
  createCustomerPaymentDraft(@Body() dto: CreateCustomerPaymentDraftDto) {
    return this.transactionsService.createCustomerPaymentDraft(dto);
  }

  @Post('supplier-returns/draft')
  @ApiOperation({ summary: 'Create supplier return draft' })
  @ApiCreatedResponse({ description: 'Supplier return draft created', type: TransactionResponseDto })
  @ApiBadRequestResponse({ description: 'Validation failed', type: ApiErrorResponse })
  @ApiNotFoundResponse({ description: 'Supplier or source line not found', type: ApiErrorResponse })
  @ApiUnprocessableEntityResponse({ description: 'Over-return or invalid source line', type: ApiErrorResponse })
  @ApiUnauthorizedResponse({ description: 'Unauthorized', type: ApiErrorResponse })
  createSupplierReturnDraft(@Body() dto: CreateSupplierReturnDraftDto) {
    return this.transactionsService.createSupplierReturnDraft(dto);
  }

  @Post('customer-returns/draft')
  @ApiOperation({ summary: 'Create customer return draft' })
  @ApiCreatedResponse({ description: 'Customer return draft created', type: TransactionResponseDto })
  @ApiBadRequestResponse({ description: 'Validation failed', type: ApiErrorResponse })
  @ApiNotFoundResponse({ description: 'Customer or source line not found', type: ApiErrorResponse })
  @ApiUnprocessableEntityResponse({ description: 'Over-return or invalid source line', type: ApiErrorResponse })
  @ApiUnauthorizedResponse({ description: 'Unauthorized', type: ApiErrorResponse })
  createCustomerReturnDraft(@Body() dto: CreateCustomerReturnDraftDto) {
    return this.transactionsService.createCustomerReturnDraft(dto);
  }

  @Post('internal-transfers/draft')
  @ApiOperation({ summary: 'Create internal transfer draft' })
  @ApiCreatedResponse({ description: 'Internal transfer draft created', type: TransactionResponseDto })
  @ApiBadRequestResponse({ description: 'Validation failed or same account', type: ApiErrorResponse })
  @ApiNotFoundResponse({ description: 'Payment account not found', type: ApiErrorResponse })
  @ApiUnprocessableEntityResponse({ description: 'Payment account inactive', type: ApiErrorResponse })
  @ApiUnauthorizedResponse({ description: 'Unauthorized', type: ApiErrorResponse })
  createInternalTransferDraft(@Body() dto: CreateInternalTransferDraftDto) {
    return this.transactionsService.createInternalTransferDraft(dto);
  }

  @Post('adjustments/draft')
  @ApiOperation({ summary: 'Create adjustment draft (OWNER/ADMIN only)' })
  @ApiCreatedResponse({ description: 'Adjustment draft created', type: TransactionResponseDto })
  @ApiBadRequestResponse({ description: 'Validation failed', type: ApiErrorResponse })
  @ApiNotFoundResponse({ description: 'Product not found', type: ApiErrorResponse })
  @ApiUnprocessableEntityResponse({ description: 'Product inactive', type: ApiErrorResponse })
  @ApiUnauthorizedResponse({ description: 'Unauthorized', type: ApiErrorResponse })
  createAdjustmentDraft(@Body() dto: CreateAdjustmentDraftDto) {
    return this.transactionsService.createAdjustmentDraft(dto);
  }

  @Get('allocations')
  @ApiOperation({ summary: 'List allocations' })
  @ApiOkResponse({ description: 'Allocation list', type: AllocationListResponseDto })
  @ApiQuery({ name: 'supplierId', required: false, type: String })
  @ApiQuery({ name: 'customerId', required: false, type: String })
  @ApiQuery({ name: 'purchaseId', required: false, type: String })
  @ApiQuery({ name: 'saleId', required: false, type: String })
  @ApiQuery({ name: 'dateFrom', required: false, type: String })
  @ApiQuery({ name: 'dateTo', required: false, type: String })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiUnauthorizedResponse({ description: 'Unauthorized', type: ApiErrorResponse })
  listAllocations(@Query() query: ListAllocationsQueryDto) {
    return this.transactionsService.listAllocations(query);
  }

  @Post(':id/post')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Post transaction (finalize & create entries)' })
  @ApiParam({ name: 'id', description: 'Transaction UUID' })
  @ApiOkResponse({ description: 'Transaction posted', type: TransactionResponseDto })
  @ApiNotFoundResponse({ description: 'Transaction not found', type: ApiErrorResponse })
  @ApiBadRequestResponse({ description: 'Validation failed', type: ApiErrorResponse })
  @ApiUnauthorizedResponse({ description: 'Unauthorized', type: ApiErrorResponse })
  post(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PostTransactionDto,
  ) {
    return this.transactionsService.post(id, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List transactions' })
  @ApiOkResponse({ description: 'Transaction list', type: TransactionListResponseDto })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'type', required: false, enum: TransactionType })
  @ApiQuery({ name: 'status', required: false, enum: TransactionStatus })
  @ApiQuery({ name: 'dateFrom', required: false, type: String })
  @ApiQuery({ name: 'dateTo', required: false, type: String })
  @ApiQuery({ name: 'supplierId', required: false, type: String })
  @ApiQuery({ name: 'customerId', required: false, type: String })
  @ApiQuery({ name: 'sortBy', required: false, enum: ['transactionDate', 'createdAt', 'totalAmount'] })
  @ApiQuery({ name: 'sortOrder', required: false, enum: ['asc', 'desc'] })
  @ApiQuery({ name: 'partySearch', required: false, type: String, description: 'Search by supplier or customer name' })
  @ApiQuery({ name: 'productId', required: false, type: String, description: 'Filter by product UUID in lines' })
  @ApiUnauthorizedResponse({ description: 'Unauthorized', type: ApiErrorResponse })
  findAll(@Query() query: ListTransactionsQueryDto) {
    return this.transactionsService.findAll(query);
  }

  @Get(':id/returnable-lines')
  @ApiOperation({ summary: 'Get returnable line quantities for a POSTED PURCHASE or SALE' })
  @ApiParam({ name: 'id', description: 'Transaction UUID' })
  @ApiOkResponse({ description: 'Returnable lines per original line', type: ReturnableLinesResponseDto })
  @ApiNotFoundResponse({ description: 'Transaction not found', type: ApiErrorResponse })
  @ApiBadRequestResponse({ description: 'Transaction is not a POSTED PURCHASE or SALE', type: ApiErrorResponse })
  @ApiUnauthorizedResponse({ description: 'Unauthorized', type: ApiErrorResponse })
  getReturnableLines(@Param('id', ParseUUIDPipe) id: string) {
    return this.transactionsService.getReturnableLines(id);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get transaction by id' })
  @ApiParam({ name: 'id', description: 'Transaction UUID' })
  @ApiOkResponse({ description: 'Transaction detail', type: TransactionResponseDto })
  @ApiNotFoundResponse({ description: 'Transaction not found', type: ApiErrorResponse })
  @ApiBadRequestResponse({ description: 'Invalid UUID', type: ApiErrorResponse })
  @ApiUnauthorizedResponse({ description: 'Unauthorized', type: ApiErrorResponse })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.transactionsService.findOne(id);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a DRAFT transaction' })
  @ApiParam({ name: 'id', description: 'Transaction UUID' })
  @ApiOkResponse({ description: 'Transaction deleted', schema: { example: { message: 'Transaction deleted' } } })
  @ApiNotFoundResponse({ description: 'Transaction not found', type: ApiErrorResponse })
  @ApiBadRequestResponse({ description: 'Only DRAFT transactions can be deleted', type: ApiErrorResponse })
  @ApiUnauthorizedResponse({ description: 'Unauthorized', type: ApiErrorResponse })
  delete(@Param('id', ParseUUIDPipe) id: string) {
    return this.transactionsService.delete(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Edit a DRAFT transaction (all 8 types)' })
  @ApiParam({ name: 'id', description: 'Transaction UUID' })
  @ApiOkResponse({ description: 'Updated transaction', type: TransactionResponseDto })
  @ApiNotFoundResponse({ description: 'Transaction not found', type: ApiErrorResponse })
  @ApiBadRequestResponse({ description: 'Only DRAFT transactions can be edited', type: ApiErrorResponse })
  @ApiUnprocessableEntityResponse({ description: 'Variant/party inactive or qty exceeds returnable', type: ApiErrorResponse })
  @ApiUnauthorizedResponse({ description: 'Unauthorized', type: ApiErrorResponse })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: PatchTransactionDto) {
    return this.transactionsService.update(id, dto);
  }
}
