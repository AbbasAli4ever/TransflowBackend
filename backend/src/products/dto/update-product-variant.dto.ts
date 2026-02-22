import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MinLength, MaxLength } from 'class-validator';

export class UpdateProductVariantDto {
  @ApiPropertyOptional({ example: 'XL', description: 'New size label — must be unique within this product' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  size?: string;

  @ApiPropertyOptional({ example: 'CT-001-XL', nullable: true, description: 'New SKU (null to clear)' })
  @IsOptional()
  @IsString()
  sku?: string | null;
}
