import {
  IsUUID,
  IsDateString,
  IsInt,
  Min,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateInternalTransferDraftDto {
  @ApiProperty({ example: 'from-account-uuid' })
  @IsUUID()
  fromPaymentAccountId!: string;

  @ApiProperty({ example: 'to-account-uuid' })
  @IsUUID()
  toPaymentAccountId!: string;

  @ApiProperty({ example: 5000, description: 'Transfer amount in PKR (integer)' })
  @IsInt()
  @Min(1)
  amount!: number;

  @ApiProperty({ example: '2026-02-10' })
  @IsDateString()
  transactionDate!: string;

  @ApiPropertyOptional({ example: 'Monthly cash transfer to bank', maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}
