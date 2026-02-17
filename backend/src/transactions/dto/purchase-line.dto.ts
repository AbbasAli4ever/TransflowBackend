import { IsUUID, IsInt, Min, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class PurchaseLineDto {
  @ApiProperty({ example: 'variant-uuid', description: 'ProductVariant UUID (specific size)' })
  @IsUUID()
  variantId!: string;

  @ApiProperty({ example: 5 })
  @IsInt()
  @Min(1)
  quantity!: number;

  @ApiProperty({ example: 12000, description: 'Unit cost in PKR (integer)' })
  @IsInt()
  @Min(1)
  unitCost!: number;

  @ApiPropertyOptional({ example: 0, description: 'Discount amount in PKR (integer)' })
  @IsOptional()
  @IsInt()
  @Min(0)
  discountAmount?: number;
}
