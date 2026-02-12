import {
  Controller,
  Get,
  Post,
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
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { TransactionsService } from './transactions.service';
import { CreatePurchaseDraftDto } from './dto/create-purchase-draft.dto';
import { CreateSaleDraftDto } from './dto/create-sale-draft.dto';
import { PostTransactionDto } from './dto/post-transaction.dto';
import { ListTransactionsQueryDto } from './dto/list-transactions-query.dto';
import { ApiErrorResponse } from '../common/swagger/api-error-response.dto';
import {
  TransactionListResponseDto,
  TransactionResponseDto,
} from './dto/transaction-response.dto';

@ApiTags('Transactions')
@ApiBearerAuth('bearer')
@Controller('transactions')
export class TransactionsController {
  constructor(private transactionsService: TransactionsService) {}

  @Post('purchases/draft')
  @ApiOperation({ summary: 'Create purchase draft' })
  @ApiOkResponse({ description: 'Purchase draft created', type: TransactionResponseDto })
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
  @ApiOkResponse({ description: 'Sale draft created', type: TransactionResponseDto })
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
  @ApiQuery({ name: 'type', required: false, enum: ['PURCHASE', 'SALE', 'RETURN', 'TRANSFER'] })
  @ApiQuery({ name: 'status', required: false, enum: ['DRAFT', 'POSTED', 'VOID'] })
  @ApiQuery({ name: 'dateFrom', required: false, type: String })
  @ApiQuery({ name: 'dateTo', required: false, type: String })
  @ApiQuery({ name: 'supplierId', required: false, type: String })
  @ApiQuery({ name: 'customerId', required: false, type: String })
  @ApiQuery({ name: 'sortBy', required: false, enum: ['transactionDate', 'createdAt', 'totalAmount'] })
  @ApiQuery({ name: 'sortOrder', required: false, enum: ['asc', 'desc'] })
  @ApiUnauthorizedResponse({ description: 'Unauthorized', type: ApiErrorResponse })
  findAll(@Query() query: ListTransactionsQueryDto) {
    return this.transactionsService.findAll(query);
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
}
