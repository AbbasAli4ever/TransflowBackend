import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ProductVariantResponseDto {
  @ApiProperty({ example: 'a1b2c3d4-0000-0000-0000-000000000001', format: 'uuid' })
  id!: string;

  @ApiProperty({ example: '9f4b6e2c-0a2d-4cc5-8c4d-1a4a88c81a88', format: 'uuid' })
  productId!: string;

  @ApiProperty({ example: '38', description: 'Size label, e.g. S, M, L, 38, 40, one-size' })
  size!: string;

  @ApiPropertyOptional({ type: String, example: 'SUIT-NAVY-38', nullable: true })
  sku?: string | null;

  @ApiProperty({ example: 12000, description: 'Average cost in PKR (integer)' })
  avgCost!: number;

  @ApiPropertyOptional({ example: 15, description: 'Current stock units — present on list and stock responses' })
  currentStock?: number;

  @ApiProperty({ example: 'ACTIVE' })
  status!: string;

  @ApiProperty({ example: '2026-02-11T10:00:00.000Z', format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ example: '2026-02-11T10:00:00.000Z', format: 'date-time' })
  updatedAt!: string;
}

export class ProductResponseDto {
  @ApiProperty({ example: '9f4b6e2c-0a2d-4cc5-8c4d-1a4a88c81a88', format: 'uuid' })
  id!: string;

  @ApiProperty({ example: '6c6f7f48-3d5b-4a3f-9b1d-9c0d73b0c3d2', format: 'uuid' })
  tenantId!: string;

  @ApiProperty({ example: 'Gul Ahmed Suit - Navy' })
  name!: string;

  @ApiPropertyOptional({ type: String, example: 'SUIT-NAVY', nullable: true })
  sku?: string | null;

  @ApiPropertyOptional({ type: String, example: 'Suits', nullable: true })
  category?: string | null;

  @ApiPropertyOptional({ type: String, example: 'piece', nullable: true })
  unit?: string | null;

  @ApiProperty({ example: 'ACTIVE' })
  status!: string;

  @ApiProperty({ example: '2026-02-11T10:00:00.000Z', format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ example: '2026-02-11T10:00:00.000Z', format: 'date-time' })
  updatedAt!: string;

  @ApiPropertyOptional({ type: String, example: 'd2f2c7b5-0c2a-4aa2-9c60-6b3f94b7e8d4', format: 'uuid', nullable: true })
  createdBy?: string | null;

  @ApiPropertyOptional({ example: 45, description: 'Total stock across all variants — present on list responses' })
  totalStock?: number;

  @ApiProperty({ type: [ProductVariantResponseDto] })
  variants!: ProductVariantResponseDto[];
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

export class VariantStockDto {
  @ApiProperty({ example: 'a1b2c3d4-0000-0000-0000-000000000001', format: 'uuid' })
  variantId!: string;

  @ApiProperty({ example: '38' })
  size!: string;

  @ApiPropertyOptional({ type: String, example: 'SUIT-NAVY-38', nullable: true })
  sku?: string | null;

  @ApiProperty({ example: 15 })
  currentStock!: number;

  @ApiProperty({ example: 12000, description: 'Average cost in PKR (integer)' })
  avgCost!: number;
}

export class ProductStockResponseDto {
  @ApiProperty({ example: '9f4b6e2c-0a2d-4cc5-8c4d-1a4a88c81a88', format: 'uuid' })
  productId!: string;

  @ApiProperty({ example: 'Gul Ahmed Suit - Navy' })
  productName!: string;

  @ApiProperty({ example: 45, description: 'Total stock across all sizes' })
  totalStock!: number;

  @ApiProperty({ type: [VariantStockDto], description: 'Per-size breakdown' })
  variants!: VariantStockDto[];
}
