import { IsString, IsNotEmpty, IsOptional, Length, MaxLength, Matches } from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateProductDto {
  @ApiProperty({ example: 'Sella Rice 25kg' })
  @IsString()
  @IsNotEmpty()
  @Length(2, 200)
  name!: string;

  @ApiPropertyOptional({
    example: 'RICE-25KG',
    maxLength: 50,
    description: 'Uppercase letters, numbers, hyphens, underscores',
  })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  @Matches(/^[A-Z0-9\-_]*$/, { message: 'SKU must contain only uppercase letters, numbers, hyphens, and underscores' })
  @Transform(({ value }) => value?.toUpperCase())
  sku?: string;

  @ApiPropertyOptional({ example: 'Grocery', maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  category?: string;

  @ApiPropertyOptional({ example: 'bag', maxLength: 20, default: 'piece' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  unit?: string = 'piece';
}
