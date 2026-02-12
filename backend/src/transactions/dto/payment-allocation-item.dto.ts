import { IsUUID, IsInt, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class PaymentAllocationItemDto {
  @ApiProperty({ description: 'The purchase/sale transaction being allocated to' })
  @IsUUID()
  transactionId!: string;

  @ApiProperty({ description: 'Amount to apply (integer, Min 1)' })
  @IsInt()
  @Min(1)
  amount!: number;
}
