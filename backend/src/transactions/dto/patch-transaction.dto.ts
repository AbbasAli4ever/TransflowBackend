import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsOptional,
  IsUUID,
  IsInt,
  IsString,
  IsDateString,
  IsIn,
  IsArray,
  ValidateNested,
  Min,
  MaxLength,
} from 'class-validator';
import { Type } from 'class-transformer';

export class PatchTransactionLineDto {
  /** For RETURN types: identifies which existing line to update */
  @ApiPropertyOptional({ format: 'uuid', description: 'Existing line ID (for RETURN types — identifies line to update)' })
  @IsOptional()
  @IsUUID()
  lineId?: string;

  /** For PURCHASE, SALE, ADJUSTMENT: variant to add/replace */
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  variantId?: string;

  @ApiPropertyOptional({ example: 5 })
  @IsOptional()
  @IsInt()
  @Min(1)
  quantity?: number;

  /** PURCHASE lines */
  @ApiPropertyOptional({ example: 1200 })
  @IsOptional()
  @IsInt()
  @Min(1)
  unitCost?: number;

  /** SALE lines */
  @ApiPropertyOptional({ example: 1500 })
  @IsOptional()
  @IsInt()
  @Min(1)
  unitPrice?: number;

  @ApiPropertyOptional({ example: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  discountAmount?: number;

  /** ADJUSTMENT lines only */
  @ApiPropertyOptional({ enum: ['IN', 'OUT'] })
  @IsOptional()
  @IsIn(['IN', 'OUT'])
  direction?: 'IN' | 'OUT';

  @ApiPropertyOptional({ example: 'Damaged stock' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class PatchTransactionDto {
  @ApiPropertyOptional({ example: '2026-02-20' })
  @IsOptional()
  @IsDateString()
  transactionDate?: string;

  @ApiPropertyOptional({ example: 'Updated notes' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;

  /** PURCHASE, SUPPLIER_PAYMENT */
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  supplierId?: string;

  /** SALE, CUSTOMER_PAYMENT */
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  customerId?: string;

  @ApiPropertyOptional({ example: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  deliveryFee?: number;

  @ApiPropertyOptional({ example: 'HOME_DELIVERY' })
  @IsOptional()
  @IsString()
  deliveryType?: string;

  @ApiPropertyOptional({ example: '123 Main St' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  deliveryAddress?: string;

  /** SUPPLIER_PAYMENT, CUSTOMER_PAYMENT, INTERNAL_TRANSFER */
  @ApiPropertyOptional({ example: 50000 })
  @IsOptional()
  @IsInt()
  @Min(1)
  amount?: number;

  /** SUPPLIER_PAYMENT, CUSTOMER_PAYMENT, INTERNAL_TRANSFER (from account) */
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  fromPaymentAccountId?: string;

  /** INTERNAL_TRANSFER (to account) */
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  toPaymentAccountId?: string;

  /** PURCHASE, SALE, ADJUSTMENT, RETURN (quantity-only for returns) */
  @ApiPropertyOptional({ type: [PatchTransactionLineDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PatchTransactionLineDto)
  lines?: PatchTransactionLineDto[];
}
