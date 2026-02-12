import { ApiProperty } from '@nestjs/swagger';

export class SupplierComputedDto {
  @ApiProperty({ example: 0, description: 'Derived total purchases in PKR (integer)' })
  totalPurchases!: number;

  @ApiProperty({ example: 0, description: 'Derived current balance in PKR (integer)' })
  currentBalance!: number;

  @ApiProperty({ example: null, nullable: true })
  lastPurchaseDate!: string | null;
}

export class SupplierResponseDto {
  @ApiProperty({ example: '9f4b6e2c-0a2d-4cc5-8c4d-1a4a88c81a88' })
  id!: string;

  @ApiProperty({ example: '6c6f7f48-3d5b-4a3f-9b1d-9c0d73b0c3d2' })
  tenantId!: string;

  @ApiProperty({ example: 'Acme Supplies' })
  name!: string;

  @ApiProperty({ example: '03001234567', required: false })
  phone?: string | null;

  @ApiProperty({ example: 'Site Area, Karachi', required: false })
  address?: string | null;

  @ApiProperty({ example: 'Preferred supplier', required: false })
  notes?: string | null;

  @ApiProperty({ example: 'ACTIVE' })
  status!: string;

  @ApiProperty({ example: '2026-02-11T10:00:00.000Z' })
  createdAt!: string;

  @ApiProperty({ example: '2026-02-11T10:00:00.000Z' })
  updatedAt!: string;

  @ApiProperty({ example: 'd2f2c7b5-0c2a-4aa2-9c60-6b3f94b7e8d4', required: false })
  createdBy?: string | null;

  @ApiProperty({ type: SupplierComputedDto })
  _computed!: SupplierComputedDto;
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
  @ApiProperty({ example: '9f4b6e2c-0a2d-4cc5-8c4d-1a4a88c81a88' })
  supplierId!: string;

  @ApiProperty({ example: 150000, description: 'Total purchases in PKR (integer)' })
  totalPurchases!: number;

  @ApiProperty({ example: 50000, description: 'Total paid in PKR (integer)' })
  totalPaid!: number;

  @ApiProperty({ example: 100000, description: 'Current balance in PKR (integer)' })
  currentBalance!: number;
}
