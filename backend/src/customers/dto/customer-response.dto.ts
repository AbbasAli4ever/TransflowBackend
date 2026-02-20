import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CustomerResponseDto {
  @ApiProperty({ example: '9f4b6e2c-0a2d-4cc5-8c4d-1a4a88c81a88', format: 'uuid' })
  id!: string;

  @ApiProperty({ example: '6c6f7f48-3d5b-4a3f-9b1d-9c0d73b0c3d2', format: 'uuid' })
  tenantId!: string;

  @ApiProperty({ example: 'Zaeem Hassan' })
  name!: string;

  @ApiPropertyOptional({ type: String, example: '03001234567', nullable: true })
  phone?: string | null;

  @ApiPropertyOptional({ type: String, example: 'Street 10, Karachi', nullable: true })
  address?: string | null;

  @ApiPropertyOptional({ type: String, example: 'VIP customer', nullable: true })
  notes?: string | null;

  @ApiProperty({ example: 'ACTIVE' })
  status!: string;

  @ApiProperty({ example: '2026-02-11T10:00:00.000Z', format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ example: '2026-02-11T10:00:00.000Z', format: 'date-time' })
  updatedAt!: string;

  @ApiPropertyOptional({ type: String, example: 'd2f2c7b5-0c2a-4aa2-9c60-6b3f94b7e8d4', format: 'uuid', nullable: true })
  createdBy?: string | null;

  @ApiPropertyOptional({ example: 3000, description: 'Current AR balance in PKR (integer) — present on list responses', nullable: true })
  currentBalance?: number;
}

export class CustomerListMetaDto {
  @ApiProperty({ example: 1 })
  page!: number;

  @ApiProperty({ example: 20 })
  limit!: number;

  @ApiProperty({ example: 120 })
  total!: number;

  @ApiProperty({ example: 6 })
  totalPages!: number;
}

export class CustomerListResponseDto {
  @ApiProperty({ type: [CustomerResponseDto] })
  data!: CustomerResponseDto[];

  @ApiProperty({ type: CustomerListMetaDto })
  meta!: CustomerListMetaDto;
}

export class CustomerBalanceResponseDto {
  @ApiProperty({ example: '9f4b6e2c-0a2d-4cc5-8c4d-1a4a88c81a88', format: 'uuid' })
  customerId!: string;

  @ApiProperty({ example: 150000, description: 'Total sales in PKR (integer)' })
  totalSales!: number;

  @ApiProperty({ example: 40000, description: 'Total payments received in PKR (integer)' })
  totalPayments!: number;

  @ApiProperty({ example: 10000, description: 'Total return credits in PKR (integer)' })
  totalReturns!: number;

  @ApiProperty({ example: 100000, description: 'Current balance in PKR (integer)' })
  currentBalance!: number;
}

export class CustomerOpenDocumentDto {
  @ApiProperty({ example: '0d2bc4f0-5429-4f2d-a9ac-bf4a030f2556', format: 'uuid' })
  id!: string;

  @ApiPropertyOptional({ type: String, example: 'SAL-0001', nullable: true })
  documentNumber?: string | null;

  @ApiProperty({ example: '2026-02-11T00:00:00.000Z', format: 'date-time' })
  transactionDate!: string;

  @ApiProperty({ example: 60000, description: 'Total amount in PKR (integer)' })
  totalAmount!: number;

  @ApiProperty({ example: 20000, description: 'Paid amount in PKR (integer)' })
  paidAmount!: number;

  @ApiProperty({ example: 40000, description: 'Outstanding amount in PKR (integer)' })
  outstanding!: number;
}

export class CustomerOpenDocumentsResponseDto {
  @ApiProperty({ example: '9f4b6e2c-0a2d-4cc5-8c4d-1a4a88c81a88', format: 'uuid' })
  customerId!: string;

  @ApiProperty({ example: 'Big Corp' })
  customerName!: string;

  @ApiProperty({ example: 120000, description: 'Sum of outstanding sale documents in PKR (integer)' })
  totalOutstanding!: number;

  @ApiProperty({ example: 5000, description: 'Unapplied customer return credits in PKR (integer)' })
  unappliedCredits!: number;

  @ApiProperty({ example: 115000, description: 'Net outstanding after applying credits in PKR (integer)' })
  netOutstanding!: number;

  @ApiProperty({ type: [CustomerOpenDocumentDto] })
  documents!: CustomerOpenDocumentDto[];
}
