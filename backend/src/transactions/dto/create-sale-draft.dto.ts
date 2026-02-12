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
  IsEnum,
} from 'class-validator';
import { Type } from 'class-transformer';
import { DeliveryType } from '@prisma/client';
import { SaleLineDto } from './sale-line.dto';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateSaleDraftDto {
  @ApiProperty({ example: 'customer-uuid' })
  @IsUUID()
  customerId!: string;

  @ApiProperty({ example: '2026-02-10' })
  @IsDateString()
  transactionDate!: string;

  @ApiProperty({ type: [SaleLineDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @ArrayMinSize(1)
  @Type(() => SaleLineDto)
  lines!: SaleLineDto[];

  @ApiPropertyOptional({ example: 1500, description: 'Delivery fee in PKR (integer)' })
  @IsOptional()
  @IsInt()
  @Min(0)
  deliveryFee?: number;

  @ApiPropertyOptional({ enum: DeliveryType })
  @IsOptional()
  @IsEnum(DeliveryType)
  deliveryType?: DeliveryType;

  @ApiPropertyOptional({ example: 'Street 10, Karachi', maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  deliveryAddress?: string;

  @ApiPropertyOptional({ example: 'Deliver before 5 PM', maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}
