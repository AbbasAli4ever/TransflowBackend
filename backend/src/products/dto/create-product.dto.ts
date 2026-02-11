import { IsString, IsNotEmpty, IsOptional, Length, MaxLength, Matches } from 'class-validator';
import { Transform } from 'class-transformer';

export class CreateProductDto {
  @IsString()
  @IsNotEmpty()
  @Length(2, 200)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  @Matches(/^[A-Z0-9\-_]*$/, { message: 'SKU must contain only uppercase letters, numbers, hyphens, and underscores' })
  @Transform(({ value }) => value?.toUpperCase())
  sku?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  category?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  unit?: string = 'piece';
}
