import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ProductMovementDto {
  @ApiProperty({ example: '2026-02-10', format: 'date' })
  date!: string;

  @ApiPropertyOptional({ type: String, example: 'PUR-0001', nullable: true })
  documentNumber!: string | null;

  @ApiProperty({ example: 'PURCHASE' })
  type!: string;

  @ApiProperty({ example: 'M' })
  variantSize!: string;

  @ApiProperty({ example: 20 })
  quantityIn!: number;

  @ApiProperty({ example: 0 })
  quantityOut!: number;

  @ApiProperty({ example: 20, description: 'Running stock after this movement' })
  runningStock!: number;
}

export class ProductMovementsMetaDto {
  @ApiProperty({ example: 1 })
  page!: number;

  @ApiProperty({ example: 20 })
  limit!: number;

  @ApiProperty({ example: 45 })
  total!: number;

  @ApiProperty({ example: 3 })
  totalPages!: number;
}

export class ProductMovementsResponseDto {
  @ApiProperty({ type: [ProductMovementDto] })
  data!: ProductMovementDto[];

  @ApiProperty({ type: ProductMovementsMetaDto })
  meta!: ProductMovementsMetaDto;
}
