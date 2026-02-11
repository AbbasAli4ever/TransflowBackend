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
import { TransactionsService } from './transactions.service';
import { CreatePurchaseDraftDto } from './dto/create-purchase-draft.dto';
import { CreateSaleDraftDto } from './dto/create-sale-draft.dto';
import { PostTransactionDto } from './dto/post-transaction.dto';
import { ListTransactionsQueryDto } from './dto/list-transactions-query.dto';

@Controller('transactions')
export class TransactionsController {
  constructor(private transactionsService: TransactionsService) {}

  @Post('purchases/draft')
  createPurchaseDraft(@Body() dto: CreatePurchaseDraftDto) {
    return this.transactionsService.createPurchaseDraft(dto);
  }

  @Post('sales/draft')
  createSaleDraft(@Body() dto: CreateSaleDraftDto) {
    return this.transactionsService.createSaleDraft(dto);
  }

  @Post(':id/post')
  @HttpCode(HttpStatus.OK)
  post(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PostTransactionDto,
  ) {
    return this.transactionsService.post(id, dto);
  }

  @Get()
  findAll(@Query() query: ListTransactionsQueryDto) {
    return this.transactionsService.findAll(query);
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.transactionsService.findOne(id);
  }
}
