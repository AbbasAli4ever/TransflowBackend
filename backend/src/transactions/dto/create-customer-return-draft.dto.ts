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
import { CustomerReturnLineDto } from './customer-return-line.dto';

export class CreateCustomerReturnDraftDto {
  @ApiProperty({ example: 'customer-uuid' })
  @IsUUID()
  customerId!: string;

  @ApiProperty({ example: '2026-02-10' })
  @IsDateString()
  transactionDate!: string;

  @ApiProperty({ type: [CustomerReturnLineDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @ArrayMinSize(1)
  @Type(() => CustomerReturnLineDto)
  lines!: CustomerReturnLineDto[];

  @ApiPropertyOptional({ example: 'Customer returned wrong size', maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}
