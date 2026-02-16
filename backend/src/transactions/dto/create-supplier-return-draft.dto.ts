import {
  IsUUID,
  IsDateString,
  IsArray,
  ValidateNested,
  ArrayMinSize,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SupplierReturnLineDto } from './supplier-return-line.dto';

export class CreateSupplierReturnDraftDto {
  @ApiProperty({ example: 'supplier-uuid' })
  @IsUUID()
  supplierId!: string;

  @ApiProperty({ example: '2026-02-10' })
  @IsDateString()
  transactionDate!: string;

  @ApiProperty({ type: [SupplierReturnLineDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @ArrayMinSize(1)
  @Type(() => SupplierReturnLineDto)
  lines!: SupplierReturnLineDto[];

  @ApiPropertyOptional({ example: 'Defective items returned', maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;

  @ApiPropertyOptional({ example: 'client-generated-uuid-v4', maxLength: 64, description: 'Client-supplied idempotency key' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  idempotencyKey?: string;
}
