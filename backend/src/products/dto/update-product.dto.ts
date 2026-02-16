import { IsString, IsOptional, Length, MaxLength, Matches } from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateProductDto {
  @ApiPropertyOptional({ example: 'Sella Rice 25kg' })
  @IsOptional()
  @IsString()
  @Length(2, 200)
  name?: string;

  @ApiPropertyOptional({
    example: 'RICE-25KG',
    maxLength: 50,
    description: 'Uppercase letters, numbers, hyphens, underscores',
  })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  @Matches(/^[A-Z0-9\-_]*$/, { message: 'SKU must contain only uppercase letters, numbers, hyphens, and underscores' })
  @Transform(({ value }) => (typeof value === 'string' ? value.toUpperCase() : value))
  sku?: string;

  @ApiPropertyOptional({ example: 'Grocery', maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  category?: string;

  @ApiPropertyOptional({ example: 'bag', maxLength: 20 })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  unit?: string;
}
