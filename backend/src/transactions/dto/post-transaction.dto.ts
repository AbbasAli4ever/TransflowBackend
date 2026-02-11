import {
  IsString,
  IsNotEmpty,
  MaxLength,
  IsOptional,
  IsInt,
  Min,
  IsUUID,
} from 'class-validator';

export class PostTransactionDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  idempotencyKey!: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  paidNow?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  receivedNow?: number;

  @IsOptional()
  @IsUUID()
  paymentAccountId?: string;
}
