import { Controller, Get, Post, Patch, Body, Param, Query, ParseUUIDPipe } from '@nestjs/common';
import { PaymentAccountsService } from './payment-accounts.service';
import { CreatePaymentAccountDto } from './dto/create-payment-account.dto';
import { UpdatePaymentAccountDto } from './dto/update-payment-account.dto';
import { ListPaymentAccountsQueryDto } from './dto/list-payment-accounts-query.dto';
import { UpdateStatusDto } from '../common/dto/update-status.dto';

@Controller('payment-accounts')
export class PaymentAccountsController {
  constructor(private paymentAccountsService: PaymentAccountsService) {}

  @Post()
  create(@Body() dto: CreatePaymentAccountDto) {
    return this.paymentAccountsService.create(dto);
  }

  @Get()
  findAll(@Query() query: ListPaymentAccountsQueryDto) {
    return this.paymentAccountsService.findAll(query);
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.paymentAccountsService.findOne(id);
  }

  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdatePaymentAccountDto) {
    return this.paymentAccountsService.update(id, dto);
  }

  @Patch(':id/status')
  updateStatus(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateStatusDto) {
    return this.paymentAccountsService.updateStatus(id, dto);
  }

  @Get(':id/balance')
  getBalance(@Param('id', ParseUUIDPipe) id: string) {
    return this.paymentAccountsService.getBalance(id);
  }
}
