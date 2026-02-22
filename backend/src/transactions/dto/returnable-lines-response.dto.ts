import { ApiProperty } from '@nestjs/swagger';

export class ReturnableLineDto {
  @ApiProperty({ format: 'uuid' })
  lineId!: string;

  @ApiProperty({ example: 'Cotton T-Shirt' })
  productName!: string;

  @ApiProperty({ example: 'M' })
  variantSize!: string;

  @ApiProperty({ example: 10 })
  originalQty!: number;

  @ApiProperty({ example: 3 })
  alreadyReturned!: number;

  @ApiProperty({ example: 7 })
  returnableQty!: number;
}

export class ReturnableLinesResponseDto {
  @ApiProperty({ format: 'uuid' })
  transactionId!: string;

  @ApiProperty({ type: [ReturnableLineDto] })
  lines!: ReturnableLineDto[];
}
