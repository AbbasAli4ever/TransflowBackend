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

export class CreateSaleDraftDto {
  @IsUUID()
  customerId!: string;

  @IsDateString()
  transactionDate!: string;

  @IsArray()
  @ValidateNested({ each: true })
  @ArrayMinSize(1)
  @Type(() => SaleLineDto)
  lines!: SaleLineDto[];

  @IsOptional()
  @IsInt()
  @Min(0)
  deliveryFee?: number;

  @IsOptional()
  @IsEnum(DeliveryType)
  deliveryType?: DeliveryType;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  deliveryAddress?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}
