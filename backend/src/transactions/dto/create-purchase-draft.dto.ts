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

export class CreatePurchaseDraftDto {
  @IsUUID()
  supplierId!: string;

  @IsDateString()
  transactionDate!: string;

  @IsArray()
  @ValidateNested({ each: true })
  @ArrayMinSize(1)
  @Type(() => PurchaseLineDto)
  lines!: PurchaseLineDto[];

  @IsOptional()
  @IsInt()
  @Min(0)
  deliveryFee?: number;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}
