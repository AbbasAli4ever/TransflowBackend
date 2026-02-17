import { IsUUID, IsInt, Min, IsEnum, IsString, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class AdjustmentLineDto {
  @ApiProperty({ example: 'variant-uuid', description: 'ProductVariant UUID (specific size)' })
  @IsUUID()
  variantId!: string;

  @ApiProperty({ example: 5 })
  @IsInt()
  @Min(1)
  quantity!: number;

  @ApiProperty({ enum: ['IN', 'OUT'], example: 'IN' })
  @IsEnum(['IN', 'OUT'])
  direction!: 'IN' | 'OUT';

  @ApiProperty({ example: 'Damaged goods write-off', maxLength: 500 })
  @IsString()
  @MaxLength(500)
  reason!: string;
}
