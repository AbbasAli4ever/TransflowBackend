import { IsString, IsNotEmpty, IsOptional, MaxLength, Matches } from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateProductVariantDto {
  @ApiProperty({ example: '38', description: 'Size label, e.g. S, M, L, 38, 40, one-size' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  size!: string;

  @ApiPropertyOptional({
    example: 'SUIT-NAVY-38',
    maxLength: 50,
    description: 'Variant-specific SKU (uppercase letters, numbers, hyphens, underscores)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  @Matches(/^[A-Z0-9\-_]*$/, { message: 'SKU must contain only uppercase letters, numbers, hyphens, and underscores' })
  @Transform(({ value }) => (typeof value === 'string' ? value.toUpperCase() : value))
  sku?: string;
}
