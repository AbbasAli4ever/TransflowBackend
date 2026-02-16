import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class PaymentAccountComputedDto {
  @ApiProperty({ example: 0, description: 'Derived current balance in PKR (integer)' })
  currentBalance!: number;

  @ApiProperty({ example: 0, description: 'Derived total in amount in PKR (integer)' })
  totalIn!: number;

  @ApiProperty({ example: 0, description: 'Derived total out amount in PKR (integer)' })
  totalOut!: number;

  @ApiProperty({ type: String, example: null, nullable: true, format: 'date-time' })
  lastTransactionDate!: string | null;
}

export class PaymentAccountResponseDto {
  @ApiProperty({ example: '9f4b6e2c-0a2d-4cc5-8c4d-1a4a88c81a88', format: 'uuid' })
  id!: string;

  @ApiProperty({ example: '6c6f7f48-3d5b-4a3f-9b1d-9c0d73b0c3d2', format: 'uuid' })
  tenantId!: string;

  @ApiProperty({ example: 'Main Cash' })
  name!: string;

  @ApiProperty({ example: 'CASH' })
  type!: string;

  @ApiProperty({ example: 25000, description: 'Opening balance in PKR (integer)' })
  openingBalance!: number;

  @ApiProperty({ example: 'ACTIVE' })
  status!: string;

  @ApiProperty({ example: '2026-02-11T10:00:00.000Z', format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ example: '2026-02-11T10:00:00.000Z', format: 'date-time' })
  updatedAt!: string;

  @ApiPropertyOptional({ type: String, example: 'd2f2c7b5-0c2a-4aa2-9c60-6b3f94b7e8d4', format: 'uuid', nullable: true })
  createdBy?: string | null;

  @ApiProperty({ type: PaymentAccountComputedDto })
  _computed!: PaymentAccountComputedDto;
}

export class PaymentAccountListMetaDto {
  @ApiProperty({ example: 1 })
  page!: number;

  @ApiProperty({ example: 20 })
  limit!: number;

  @ApiProperty({ example: 120 })
  total!: number;

  @ApiProperty({ example: 6 })
  totalPages!: number;
}

export class PaymentAccountListResponseDto {
  @ApiProperty({ type: [PaymentAccountResponseDto] })
  data!: PaymentAccountResponseDto[];

  @ApiProperty({ type: PaymentAccountListMetaDto })
  meta!: PaymentAccountListMetaDto;
}

export class PaymentAccountBalanceResponseDto {
  @ApiProperty({ example: '9f4b6e2c-0a2d-4cc5-8c4d-1a4a88c81a88', format: 'uuid' })
  paymentAccountId!: string;

  @ApiProperty({ example: 25000, description: 'Opening balance in PKR (integer)' })
  openingBalance!: number;

  @ApiProperty({ example: 150000, description: 'Total in amount in PKR (integer)' })
  totalIn!: number;

  @ApiProperty({ example: 50000, description: 'Total out amount in PKR (integer)' })
  totalOut!: number;

  @ApiProperty({ example: 125000, description: 'Current balance in PKR (integer)' })
  currentBalance!: number;
}
