import { Controller, Get, Post, Patch, Body, Param, Query, ParseUUIDPipe } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { PaymentAccountsService } from './payment-accounts.service';
import { CreatePaymentAccountDto } from './dto/create-payment-account.dto';
import { UpdatePaymentAccountDto } from './dto/update-payment-account.dto';
import { ListPaymentAccountsQueryDto } from './dto/list-payment-accounts-query.dto';
import { UpdateStatusDto } from '../common/dto/update-status.dto';
import { ApiErrorResponse } from '../common/swagger/api-error-response.dto';
import { Roles } from '../common/decorators/roles.decorator';
import {
  PaymentAccountBalanceResponseDto,
  PaymentAccountListResponseDto,
  PaymentAccountResponseDto,
} from './dto/payment-account-response.dto';

@ApiTags('Payment Accounts')
@ApiBearerAuth('bearer')
@Controller('payment-accounts')
export class PaymentAccountsController {
  constructor(private paymentAccountsService: PaymentAccountsService) {}

  @Post()
  @Roles('OWNER', 'ADMIN')
  @ApiOperation({ summary: 'Create payment account' })
  @ApiOkResponse({ description: 'Payment account created', type: PaymentAccountResponseDto })
  @ApiBadRequestResponse({ description: 'Validation failed', type: ApiErrorResponse })
  @ApiConflictResponse({ description: 'Payment account name already exists', type: ApiErrorResponse })
  @ApiUnauthorizedResponse({ description: 'Unauthorized', type: ApiErrorResponse })
  create(@Body() dto: CreatePaymentAccountDto) {
    return this.paymentAccountsService.create(dto);
  }

  @Get()
  @ApiOperation({ summary: 'List payment accounts' })
  @ApiOkResponse({ description: 'Payment account list', type: PaymentAccountListResponseDto })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'type', required: false, enum: ['CASH', 'BANK', 'WALLET', 'CARD'] })
  @ApiQuery({ name: 'status', required: false, enum: ['ACTIVE', 'INACTIVE', 'ALL'] })
  @ApiUnauthorizedResponse({ description: 'Unauthorized', type: ApiErrorResponse })
  findAll(@Query() query: ListPaymentAccountsQueryDto) {
    return this.paymentAccountsService.findAll(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get payment account by id' })
  @ApiParam({ name: 'id', description: 'Payment account UUID' })
  @ApiOkResponse({ description: 'Payment account detail', type: PaymentAccountResponseDto })
  @ApiNotFoundResponse({ description: 'Payment account not found', type: ApiErrorResponse })
  @ApiBadRequestResponse({ description: 'Invalid UUID', type: ApiErrorResponse })
  @ApiUnauthorizedResponse({ description: 'Unauthorized', type: ApiErrorResponse })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.paymentAccountsService.findOne(id);
  }

  @Patch(':id')
  @Roles('OWNER', 'ADMIN')
  @ApiOperation({ summary: 'Update payment account' })
  @ApiParam({ name: 'id', description: 'Payment account UUID' })
  @ApiOkResponse({ description: 'Payment account updated', type: PaymentAccountResponseDto })
  @ApiNotFoundResponse({ description: 'Payment account not found', type: ApiErrorResponse })
  @ApiConflictResponse({ description: 'Payment account name already exists', type: ApiErrorResponse })
  @ApiBadRequestResponse({ description: 'Validation failed', type: ApiErrorResponse })
  @ApiUnauthorizedResponse({ description: 'Unauthorized', type: ApiErrorResponse })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdatePaymentAccountDto) {
    return this.paymentAccountsService.update(id, dto);
  }

  @Patch(':id/status')
  @Roles('OWNER', 'ADMIN')
  @ApiOperation({ summary: 'Update payment account status' })
  @ApiParam({ name: 'id', description: 'Payment account UUID' })
  @ApiOkResponse({ description: 'Payment account status updated', type: PaymentAccountResponseDto })
  @ApiNotFoundResponse({ description: 'Payment account not found', type: ApiErrorResponse })
  @ApiBadRequestResponse({ description: 'Validation failed', type: ApiErrorResponse })
  @ApiUnauthorizedResponse({ description: 'Unauthorized', type: ApiErrorResponse })
  updateStatus(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateStatusDto) {
    return this.paymentAccountsService.updateStatus(id, dto);
  }

  @Get(':id/balance')
  @ApiOperation({ summary: 'Get payment account balance' })
  @ApiParam({ name: 'id', description: 'Payment account UUID' })
  @ApiOkResponse({ description: 'Payment account balance', type: PaymentAccountBalanceResponseDto })
  @ApiNotFoundResponse({ description: 'Payment account not found', type: ApiErrorResponse })
  @ApiBadRequestResponse({ description: 'Invalid UUID', type: ApiErrorResponse })
  @ApiUnauthorizedResponse({ description: 'Unauthorized', type: ApiErrorResponse })
  getBalance(@Param('id', ParseUUIDPipe) id: string) {
    return this.paymentAccountsService.getBalance(id);
  }
}
