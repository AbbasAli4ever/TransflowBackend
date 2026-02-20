import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SupplierResponseDto {
  @ApiProperty({ example: '9f4b6e2c-0a2d-4cc5-8c4d-1a4a88c81a88', format: 'uuid' })
  id!: string;

  @ApiProperty({ example: '6c6f7f48-3d5b-4a3f-9b1d-9c0d73b0c3d2', format: 'uuid' })
  tenantId!: string;

  @ApiProperty({ example: 'Acme Supplies' })
  name!: string;

  @ApiPropertyOptional({ type: String, example: '03001234567', nullable: true })
  phone?: string | null;

  @ApiPropertyOptional({ type: String, example: 'Site Area, Karachi', nullable: true })
  address?: string | null;

  @ApiPropertyOptional({ type: String, example: 'Preferred supplier', nullable: true })
  notes?: string | null;

  @ApiProperty({ example: 'ACTIVE' })
  status!: string;

  @ApiProperty({ example: '2026-02-11T10:00:00.000Z', format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ example: '2026-02-11T10:00:00.000Z', format: 'date-time' })
  updatedAt!: string;

  @ApiPropertyOptional({ type: String, example: 'd2f2c7b5-0c2a-4aa2-9c60-6b3f94b7e8d4', format: 'uuid', nullable: true })
  createdBy?: string | null;

  @ApiPropertyOptional({ example: 5000, description: 'Current AP balance in PKR (integer) — present on list responses', nullable: true })
  currentBalance?: number;
}

export class SupplierListMetaDto {
  @ApiProperty({ example: 1 })
  page!: number;

  @ApiProperty({ example: 20 })
  limit!: number;

  @ApiProperty({ example: 120 })
  total!: number;

  @ApiProperty({ example: 6 })
  totalPages!: number;
}

export class SupplierListResponseDto {
  @ApiProperty({ type: [SupplierResponseDto] })
  data!: SupplierResponseDto[];

  @ApiProperty({ type: SupplierListMetaDto })
  meta!: SupplierListMetaDto;
}

export class SupplierBalanceResponseDto {
  @ApiProperty({ example: '9f4b6e2c-0a2d-4cc5-8c4d-1a4a88c81a88', format: 'uuid' })
  supplierId!: string;

  @ApiProperty({ example: 150000, description: 'Total purchases in PKR (integer)' })
  totalPurchases!: number;

  @ApiProperty({ example: 50000, description: 'Total paid in PKR (integer)' })
  totalPaid!: number;

  @ApiProperty({ example: 100000, description: 'Current balance in PKR (integer)' })
  currentBalance!: number;
}

export class SupplierOpenDocumentDto {
  @ApiProperty({ example: '0d2bc4f0-5429-4f2d-a9ac-bf4a030f2556', format: 'uuid' })
  id!: string;

  @ApiPropertyOptional({ type: String, example: 'PUR-0001', nullable: true })
  documentNumber?: string | null;

  @ApiProperty({ example: '2026-02-11T00:00:00.000Z', format: 'date-time' })
  transactionDate!: string;

  @ApiProperty({ example: 50000, description: 'Total amount in PKR (integer)' })
  totalAmount!: number;

  @ApiProperty({ example: 15000, description: 'Paid amount in PKR (integer)' })
  paidAmount!: number;

  @ApiProperty({ example: 35000, description: 'Outstanding amount in PKR (integer)' })
  outstanding!: number;
}

export class SupplierOpenDocumentsResponseDto {
  @ApiProperty({ example: '9f4b6e2c-0a2d-4cc5-8c4d-1a4a88c81a88', format: 'uuid' })
  supplierId!: string;

  @ApiProperty({ example: 'Acme Supplies' })
  supplierName!: string;

  @ApiProperty({ example: 100000, description: 'Sum of outstanding purchase documents in PKR (integer)' })
  totalOutstanding!: number;

  @ApiProperty({ example: 10000, description: 'Unapplied supplier return credits in PKR (integer)' })
  unappliedCredits!: number;

  @ApiProperty({ example: 90000, description: 'Net outstanding after applying credits in PKR (integer)' })
  netOutstanding!: number;

  @ApiProperty({ type: [SupplierOpenDocumentDto] })
  documents!: SupplierOpenDocumentDto[];
}
