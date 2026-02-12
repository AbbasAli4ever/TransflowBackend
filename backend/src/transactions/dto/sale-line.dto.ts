import { IsUUID, IsInt, Min, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SaleLineDto {
  @ApiProperty({ example: 'product-uuid' })
  @IsUUID()
  productId!: string;

  @ApiProperty({ example: 3 })
  @IsInt()
  @Min(1)
  quantity!: number;

  @ApiProperty({ example: 15000, description: 'Unit price in PKR (integer)' })
  @IsInt()
  @Min(0)
  unitPrice!: number;

  @ApiPropertyOptional({ example: 0, description: 'Discount amount in PKR (integer)' })
  @IsOptional()
  @IsInt()
  @Min(0)
  discountAmount?: number;
}
