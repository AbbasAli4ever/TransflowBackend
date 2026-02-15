import { IsUUID, IsInt, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SupplierReturnLineDto {
  @ApiProperty({ example: 'source-transaction-line-uuid' })
  @IsUUID()
  sourceTransactionLineId!: string;

  @ApiProperty({ example: 2 })
  @IsInt()
  @Min(1)
  quantity!: number;
}
