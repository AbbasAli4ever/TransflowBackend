import { Controller, Get, Post, Patch, Body, Param, Query, ParseUUIDPipe } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { SuppliersService } from './suppliers.service';
import { CreateSupplierDto } from './dto/create-supplier.dto';
import { UpdateSupplierDto } from './dto/update-supplier.dto';
import { ListSuppliersQueryDto } from './dto/list-suppliers-query.dto';
import { UpdateStatusDto } from '../common/dto/update-status.dto';
import { ApiErrorResponse } from '../common/swagger/api-error-response.dto';
import { Roles } from '../common/decorators/roles.decorator';
import {
  SupplierBalanceResponseDto,
  SupplierListResponseDto,
  SupplierOpenDocumentsResponseDto,
  SupplierResponseDto,
} from './dto/supplier-response.dto';

@ApiTags('Suppliers')
@ApiBearerAuth('bearer')
@Controller('suppliers')
export class SuppliersController {
  constructor(private suppliersService: SuppliersService) {}

  @Post()
  @Roles('OWNER', 'ADMIN')
  @ApiOperation({ summary: 'Create supplier' })
  @ApiCreatedResponse({ description: 'Supplier created', type: SupplierResponseDto })
  @ApiBadRequestResponse({ description: 'Validation failed', type: ApiErrorResponse })
  @ApiConflictResponse({ description: 'Supplier name already exists', type: ApiErrorResponse })
  @ApiUnauthorizedResponse({ description: 'Unauthorized', type: ApiErrorResponse })
  create(@Body() dto: CreateSupplierDto) {
    return this.suppliersService.create(dto);
  }

  @Get()
  @ApiOperation({ summary: 'List suppliers' })
  @ApiOkResponse({ description: 'Supplier list', type: SupplierListResponseDto })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'search', required: false, type: String })
  @ApiQuery({ name: 'status', required: false, enum: ['ACTIVE', 'INACTIVE', 'ALL'] })
  @ApiQuery({ name: 'sortBy', required: false, enum: ['name', 'createdAt'] })
  @ApiQuery({ name: 'sortOrder', required: false, enum: ['asc', 'desc'] })
  @ApiUnauthorizedResponse({ description: 'Unauthorized', type: ApiErrorResponse })
  findAll(@Query() query: ListSuppliersQueryDto) {
    return this.suppliersService.findAll(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get supplier by id' })
  @ApiParam({ name: 'id', description: 'Supplier UUID' })
  @ApiOkResponse({ description: 'Supplier detail', type: SupplierResponseDto })
  @ApiNotFoundResponse({ description: 'Supplier not found', type: ApiErrorResponse })
  @ApiBadRequestResponse({ description: 'Invalid UUID', type: ApiErrorResponse })
  @ApiUnauthorizedResponse({ description: 'Unauthorized', type: ApiErrorResponse })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.suppliersService.findOne(id);
  }

  @Patch(':id')
  @Roles('OWNER', 'ADMIN')
  @ApiOperation({ summary: 'Update supplier' })
  @ApiParam({ name: 'id', description: 'Supplier UUID' })
  @ApiOkResponse({ description: 'Supplier updated', type: SupplierResponseDto })
  @ApiNotFoundResponse({ description: 'Supplier not found', type: ApiErrorResponse })
  @ApiConflictResponse({ description: 'Supplier name already exists', type: ApiErrorResponse })
  @ApiBadRequestResponse({ description: 'Validation failed', type: ApiErrorResponse })
  @ApiUnauthorizedResponse({ description: 'Unauthorized', type: ApiErrorResponse })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateSupplierDto) {
    return this.suppliersService.update(id, dto);
  }

  @Patch(':id/status')
  @Roles('OWNER', 'ADMIN')
  @ApiOperation({ summary: 'Update supplier status' })
  @ApiParam({ name: 'id', description: 'Supplier UUID' })
  @ApiOkResponse({ description: 'Supplier status updated', type: SupplierResponseDto })
  @ApiNotFoundResponse({ description: 'Supplier not found', type: ApiErrorResponse })
  @ApiBadRequestResponse({ description: 'Validation failed', type: ApiErrorResponse })
  @ApiUnauthorizedResponse({ description: 'Unauthorized', type: ApiErrorResponse })
  updateStatus(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateStatusDto) {
    return this.suppliersService.updateStatus(id, dto);
  }

  @Get(':id/balance')
  @ApiOperation({ summary: 'Get supplier balance' })
  @ApiParam({ name: 'id', description: 'Supplier UUID' })
  @ApiOkResponse({ description: 'Supplier balance', type: SupplierBalanceResponseDto })
  @ApiNotFoundResponse({ description: 'Supplier not found', type: ApiErrorResponse })
  @ApiBadRequestResponse({ description: 'Invalid UUID', type: ApiErrorResponse })
  @ApiUnauthorizedResponse({ description: 'Unauthorized', type: ApiErrorResponse })
  getBalance(@Param('id', ParseUUIDPipe) id: string) {
    return this.suppliersService.getBalance(id);
  }

  @Get(':id/open-documents')
  @ApiOperation({ summary: 'Get outstanding purchase documents for a supplier' })
  @ApiParam({ name: 'id', description: 'Supplier UUID' })
  @ApiOkResponse({ description: 'Open documents list', type: SupplierOpenDocumentsResponseDto })
  @ApiNotFoundResponse({ description: 'Supplier not found', type: ApiErrorResponse })
  @ApiBadRequestResponse({ description: 'Invalid UUID', type: ApiErrorResponse })
  @ApiUnauthorizedResponse({ description: 'Unauthorized', type: ApiErrorResponse })
  getOpenDocuments(@Param('id', ParseUUIDPipe) id: string) {
    return this.suppliersService.getOpenDocuments(id);
  }
}
