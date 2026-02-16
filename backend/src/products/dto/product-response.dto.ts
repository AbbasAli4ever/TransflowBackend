import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ProductComputedDto {
  @ApiProperty({ example: 0, description: 'Derived current stock quantity' })
  currentStock!: number;

  @ApiProperty({ example: 0, description: 'Derived total purchased quantity' })
  totalPurchased!: number;

  @ApiProperty({ example: 0, description: 'Derived total sold quantity' })
  totalSold!: number;

  @ApiProperty({ type: String, example: null, nullable: true, format: 'date-time' })
  lastPurchaseDate!: string | null;

  @ApiProperty({ type: String, example: null, nullable: true, format: 'date-time' })
  lastSaleDate!: string | null;
}

export class ProductResponseDto {
  @ApiProperty({ example: '9f4b6e2c-0a2d-4cc5-8c4d-1a4a88c81a88', format: 'uuid' })
  id!: string;

  @ApiProperty({ example: '6c6f7f48-3d5b-4a3f-9b1d-9c0d73b0c3d2', format: 'uuid' })
  tenantId!: string;

  @ApiProperty({ example: 'Sella Rice 25kg' })
  name!: string;

  @ApiPropertyOptional({ type: String, example: 'RICE-25KG', nullable: true })
  sku?: string | null;

  @ApiPropertyOptional({ type: String, example: 'Grocery', nullable: true })
  category?: string | null;

  @ApiPropertyOptional({ type: String, example: 'bag', nullable: true })
  unit?: string | null;

  @ApiProperty({ example: 125000, description: 'Average cost in PKR (integer)' })
  avgCost!: number;

  @ApiProperty({ example: 'ACTIVE' })
  status!: string;

  @ApiProperty({ example: '2026-02-11T10:00:00.000Z', format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ example: '2026-02-11T10:00:00.000Z', format: 'date-time' })
  updatedAt!: string;

  @ApiPropertyOptional({ type: String, example: 'd2f2c7b5-0c2a-4aa2-9c60-6b3f94b7e8d4', format: 'uuid', nullable: true })
  createdBy?: string | null;

  @ApiProperty({ type: ProductComputedDto })
  _computed!: ProductComputedDto;
}

export class ProductListMetaDto {
  @ApiProperty({ example: 1 })
  page!: number;

  @ApiProperty({ example: 20 })
  limit!: number;

  @ApiProperty({ example: 120 })
  total!: number;

  @ApiProperty({ example: 6 })
  totalPages!: number;
}

export class ProductListResponseDto {
  @ApiProperty({ type: [ProductResponseDto] })
  data!: ProductResponseDto[];

  @ApiProperty({ type: ProductListMetaDto })
  meta!: ProductListMetaDto;
}

export class ProductStockResponseDto {
  @ApiProperty({ example: '9f4b6e2c-0a2d-4cc5-8c4d-1a4a88c81a88', format: 'uuid' })
  productId!: string;

  @ApiProperty({ example: 'Sella Rice 25kg' })
  productName!: string;

  @ApiProperty({ example: 250 })
  currentStock!: number;

  @ApiProperty({ example: 125000, description: 'Average cost in PKR (integer)' })
  avgCost!: number;
}
