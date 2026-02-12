import { ApiProperty } from '@nestjs/swagger';

export class TransactionLineResponseDto {
  @ApiProperty({ example: 'f2bb9d7a-7c7b-4a6d-95d6-5f2d4e1f1b3a' })
  id!: string;

  @ApiProperty({ example: '9f4b6e2c-0a2d-4cc5-8c4d-1a4a88c81a88' })
  transactionId!: string;

  @ApiProperty({ example: 'c4c8d1e8-2d1b-4f2b-9f8a-2b3d9a8d1f0a' })
  productId!: string;

  @ApiProperty({ example: 5 })
  quantity!: number;

  @ApiProperty({ example: 12000, description: 'Unit cost/price in PKR (integer)' })
  unitCost?: number;

  @ApiProperty({ example: 15000, description: 'Unit cost/price in PKR (integer)' })
  unitPrice?: number;

  @ApiProperty({ example: 0, description: 'Discount amount in PKR (integer)' })
  discountAmount!: number;

  @ApiProperty({ example: 60000, description: 'Line total in PKR (integer)' })
  lineTotal!: number;

  @ApiProperty({ example: 60000, description: 'Cost total in PKR (integer)' })
  costTotal!: number;
}

export class TransactionResponseDto {
  @ApiProperty({ example: '9f4b6e2c-0a2d-4cc5-8c4d-1a4a88c81a88' })
  id!: string;

  @ApiProperty({ example: '6c6f7f48-3d5b-4a3f-9b1d-9c0d73b0c3d2' })
  tenantId!: string;

  @ApiProperty({ example: 'PURCHASE' })
  type!: string;

  @ApiProperty({ example: 'DRAFT' })
  status!: string;

  @ApiProperty({ example: '2026-02-10T00:00:00.000Z' })
  transactionDate!: string;

  @ApiProperty({ example: 'supplier-uuid', required: false })
  supplierId?: string | null;

  @ApiProperty({ example: 'customer-uuid', required: false })
  customerId?: string | null;

  @ApiProperty({ example: 50000, description: 'Subtotal in PKR (integer)' })
  subtotal!: number;

  @ApiProperty({ example: 0, description: 'Discount total in PKR (integer)' })
  discountTotal!: number;

  @ApiProperty({ example: 2000, description: 'Delivery fee in PKR (integer)' })
  deliveryFee!: number;

  @ApiProperty({ example: 52000, description: 'Total amount in PKR (integer)' })
  totalAmount!: number;

  @ApiProperty({ example: 'DELIVERY', required: false })
  deliveryType?: string | null;

  @ApiProperty({ example: 'Karachi, Pakistan', required: false })
  deliveryAddress?: string | null;

  @ApiProperty({ example: 'Urgent', required: false })
  notes?: string | null;

  @ApiProperty({ example: '2026-02-11T10:00:00.000Z' })
  createdAt!: string;

  @ApiProperty({ example: '2026-02-11T10:00:00.000Z' })
  updatedAt!: string;

  @ApiProperty({ type: [TransactionLineResponseDto] })
  transactionLines!: TransactionLineResponseDto[];
}

export class TransactionListMetaDto {
  @ApiProperty({ example: 1 })
  page!: number;

  @ApiProperty({ example: 20 })
  limit!: number;

  @ApiProperty({ example: 120 })
  total!: number;

  @ApiProperty({ example: 6 })
  totalPages!: number;
}

export class TransactionListResponseDto {
  @ApiProperty({ type: [TransactionResponseDto] })
  data!: TransactionResponseDto[];

  @ApiProperty({ type: TransactionListMetaDto })
  meta!: TransactionListMetaDto;
}
