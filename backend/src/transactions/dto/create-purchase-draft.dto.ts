import {
  IsUUID,
  IsDateString,
  IsArray,
  ValidateNested,
  ArrayMinSize,
  IsOptional,
  IsInt,
  Min,
  IsString,
  MaxLength,
} from 'class-validator';
import { Type } from 'class-transformer';
import { PurchaseLineDto } from './purchase-line.dto';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreatePurchaseDraftDto {
  @ApiProperty({ example: 'supplier-uuid' })
  @IsUUID()
  supplierId!: string;

  @ApiProperty({ example: '2026-02-10' })
  @IsDateString()
  transactionDate!: string;

  @ApiProperty({ type: [PurchaseLineDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @ArrayMinSize(1)
  @Type(() => PurchaseLineDto)
  lines!: PurchaseLineDto[];

  @ApiPropertyOptional({ example: 2000, description: 'Delivery fee in PKR (integer)' })
  @IsOptional()
  @IsInt()
  @Min(0)
  deliveryFee?: number;

  @ApiPropertyOptional({ example: 'Handle with care', maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}
