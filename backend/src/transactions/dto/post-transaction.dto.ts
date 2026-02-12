import {
  IsString,
  IsNotEmpty,
  MaxLength,
  IsOptional,
  IsInt,
  Min,
  IsUUID,
  IsArray,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaymentAllocationItemDto } from './payment-allocation-item.dto';

export class PostTransactionDto {
  @ApiProperty({
    example: 'post-2026-02-11-0001',
    description: 'Idempotency key to prevent double posting',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  idempotencyKey!: string;

  @ApiPropertyOptional({ example: 0, description: 'Amount paid now in PKR (integer)' })
  @IsOptional()
  @IsInt()
  @Min(0)
  paidNow?: number;

  @ApiPropertyOptional({ example: 0, description: 'Amount received now in PKR (integer)' })
  @IsOptional()
  @IsInt()
  @Min(0)
  receivedNow?: number;

  @ApiPropertyOptional({ example: 'payment-account-uuid' })
  @IsOptional()
  @IsUUID()
  paymentAccountId?: string;

  @ApiPropertyOptional({
    description: 'Manual allocations (for SUPPLIER_PAYMENT / CUSTOMER_PAYMENT only). Omit for auto-allocation.',
    type: [PaymentAllocationItemDto],
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PaymentAllocationItemDto)
  allocations?: PaymentAllocationItemDto[];
}
