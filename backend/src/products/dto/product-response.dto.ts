import { ApiProperty } from '@nestjs/swagger';

export class ProductComputedDto {
  @ApiProperty({ example: 0, description: 'Derived current stock quantity' })
  currentStock!: number;

  @ApiProperty({ example: 0, description: 'Derived total purchased quantity' })
  totalPurchased!: number;

  @ApiProperty({ example: 0, description: 'Derived total sold quantity' })
  totalSold!: number;

  @ApiProperty({ example: null, nullable: true })
  lastPurchaseDate!: string | null;

  @ApiProperty({ example: null, nullable: true })
  lastSaleDate!: string | null;
}

export class ProductResponseDto {
  @ApiProperty({ example: '9f4b6e2c-0a2d-4cc5-8c4d-1a4a88c81a88' })
  id!: string;

  @ApiProperty({ example: '6c6f7f48-3d5b-4a3f-9b1d-9c0d73b0c3d2' })
  tenantId!: string;

  @ApiProperty({ example: 'Sella Rice 25kg' })
  name!: string;

  @ApiProperty({ example: 'RICE-25KG', required: false })
  sku?: string | null;

  @ApiProperty({ example: 'Grocery', required: false })
  category?: string | null;

  @ApiProperty({ example: 'bag', required: false })
  unit?: string | null;

  @ApiProperty({ example: 125000, description: 'Average cost in PKR (integer)' })
  avgCost!: number;

  @ApiProperty({ example: 'ACTIVE' })
  status!: string;

  @ApiProperty({ example: '2026-02-11T10:00:00.000Z' })
  createdAt!: string;

  @ApiProperty({ example: '2026-02-11T10:00:00.000Z' })
  updatedAt!: string;

  @ApiProperty({ example: 'd2f2c7b5-0c2a-4aa2-9c60-6b3f94b7e8d4', required: false })
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
  @ApiProperty({ example: '9f4b6e2c-0a2d-4cc5-8c4d-1a4a88c81a88' })
  productId!: string;

  @ApiProperty({ example: 'Sella Rice 25kg' })
  productName!: string;

  @ApiProperty({ example: 250 })
  currentStock!: number;

  @ApiProperty({ example: 125000, description: 'Average cost in PKR (integer)' })
  avgCost!: number;
}
