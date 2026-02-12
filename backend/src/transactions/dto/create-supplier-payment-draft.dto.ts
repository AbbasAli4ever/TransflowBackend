import { IsUUID, IsInt, Min, IsDateString, IsOptional, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateSupplierPaymentDraftDto {
  @ApiProperty({ description: 'Supplier UUID' })
  @IsUUID()
  supplierId!: string;

  @ApiProperty({ description: 'Payment amount in PKR (integer, Min 1)' })
  @IsInt()
  @Min(1)
  amount!: number;

  @ApiProperty({ description: 'Payment account UUID' })
  @IsUUID()
  paymentAccountId!: string;

  @ApiProperty({ example: '2026-02-12', description: 'Transaction date (YYYY-MM-DD)' })
  @IsDateString()
  transactionDate!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @MaxLength(1000)
  notes?: string;
}
