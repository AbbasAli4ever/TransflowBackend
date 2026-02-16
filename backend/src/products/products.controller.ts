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
import { ProductsService } from './products.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { ListProductsQueryDto } from './dto/list-products-query.dto';
import { UpdateStatusDto } from '../common/dto/update-status.dto';
import { ApiErrorResponse } from '../common/swagger/api-error-response.dto';
import { Roles } from '../common/decorators/roles.decorator';
import {
  ProductListResponseDto,
  ProductResponseDto,
  ProductStockResponseDto,
} from './dto/product-response.dto';

@ApiTags('Products')
@ApiBearerAuth('bearer')
@Controller('products')
export class ProductsController {
  constructor(private productsService: ProductsService) {}

  @Post()
  @Roles('OWNER', 'ADMIN')
  @ApiOperation({ summary: 'Create product' })
  @ApiCreatedResponse({ description: 'Product created', type: ProductResponseDto })
  @ApiBadRequestResponse({ description: 'Validation failed', type: ApiErrorResponse })
  @ApiConflictResponse({ description: 'SKU already exists for this tenant', type: ApiErrorResponse })
  @ApiUnauthorizedResponse({ description: 'Unauthorized', type: ApiErrorResponse })
  create(@Body() dto: CreateProductDto) {
    return this.productsService.create(dto);
  }

  @Get()
  @ApiOperation({ summary: 'List products' })
  @ApiOkResponse({ description: 'Product list', type: ProductListResponseDto })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'search', required: false, type: String })
  @ApiQuery({ name: 'status', required: false, enum: ['ACTIVE', 'INACTIVE', 'ALL'] })
  @ApiQuery({ name: 'category', required: false, type: String })
  @ApiUnauthorizedResponse({ description: 'Unauthorized', type: ApiErrorResponse })
  findAll(@Query() query: ListProductsQueryDto) {
    return this.productsService.findAll(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get product by id' })
  @ApiParam({ name: 'id', description: 'Product UUID' })
  @ApiOkResponse({ description: 'Product detail', type: ProductResponseDto })
  @ApiNotFoundResponse({ description: 'Product not found', type: ApiErrorResponse })
  @ApiBadRequestResponse({ description: 'Invalid UUID', type: ApiErrorResponse })
  @ApiUnauthorizedResponse({ description: 'Unauthorized', type: ApiErrorResponse })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.productsService.findOne(id);
  }

  @Patch(':id')
  @Roles('OWNER', 'ADMIN')
  @ApiOperation({ summary: 'Update product' })
  @ApiParam({ name: 'id', description: 'Product UUID' })
  @ApiOkResponse({ description: 'Product updated', type: ProductResponseDto })
  @ApiNotFoundResponse({ description: 'Product not found', type: ApiErrorResponse })
  @ApiConflictResponse({ description: 'SKU already exists for this tenant', type: ApiErrorResponse })
  @ApiBadRequestResponse({ description: 'Validation failed', type: ApiErrorResponse })
  @ApiUnauthorizedResponse({ description: 'Unauthorized', type: ApiErrorResponse })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateProductDto) {
    return this.productsService.update(id, dto);
  }

  @Patch(':id/status')
  @Roles('OWNER', 'ADMIN')
  @ApiOperation({ summary: 'Update product status' })
  @ApiParam({ name: 'id', description: 'Product UUID' })
  @ApiOkResponse({ description: 'Product status updated', type: ProductResponseDto })
  @ApiNotFoundResponse({ description: 'Product not found', type: ApiErrorResponse })
  @ApiBadRequestResponse({ description: 'Validation failed', type: ApiErrorResponse })
  @ApiUnauthorizedResponse({ description: 'Unauthorized', type: ApiErrorResponse })
  updateStatus(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateStatusDto) {
    return this.productsService.updateStatus(id, dto);
  }

  @Get(':id/stock')
  @ApiOperation({ summary: 'Get product stock and average cost' })
  @ApiParam({ name: 'id', description: 'Product UUID' })
  @ApiOkResponse({ description: 'Product stock', type: ProductStockResponseDto })
  @ApiNotFoundResponse({ description: 'Product not found', type: ApiErrorResponse })
  @ApiBadRequestResponse({ description: 'Invalid UUID', type: ApiErrorResponse })
  @ApiUnauthorizedResponse({ description: 'Unauthorized', type: ApiErrorResponse })
  getStock(@Param('id', ParseUUIDPipe) id: string) {
    return this.productsService.getStock(id);
  }
}
