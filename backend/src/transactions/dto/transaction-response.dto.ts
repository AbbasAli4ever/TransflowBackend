import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class TransactionLineResponseDto {
  @ApiProperty({ example: 'f2bb9d7a-7c7b-4a6d-95d6-5f2d4e1f1b3a', format: 'uuid' })
  id!: string;

  @ApiProperty({ example: '9f4b6e2c-0a2d-4cc5-8c4d-1a4a88c81a88', format: 'uuid' })
  transactionId!: string;

  @ApiProperty({ example: 'c4c8d1e8-2d1b-4f2b-9f8a-2b3d9a8d1f0a', format: 'uuid', description: 'ProductVariant UUID' })
  variantId!: string;

  @ApiPropertyOptional({ type: String, example: '38', description: 'Size label from the variant', nullable: true })
  variantSize?: string | null;

  @ApiPropertyOptional({ type: String, example: 'e1c3f8d2-1b2a-4a3b-9b8c-1a2b3c4d5e6f', format: 'uuid', nullable: true, description: 'Parent product UUID' })
  productId?: string | null;

  @ApiProperty({ example: 5 })
  quantity!: number;

  @ApiPropertyOptional({ example: 12000, description: 'Unit cost in PKR (integer) — present on purchase-type transactions', type: 'number' })
  unitCost?: number;

  @ApiPropertyOptional({ example: 15000, description: 'Unit price in PKR (integer) — present on sale-type transactions', type: 'number' })
  unitPrice?: number;

  @ApiProperty({ example: 0, description: 'Discount amount in PKR (integer)' })
  discountAmount!: number;

  @ApiProperty({ example: 60000, description: 'Line total in PKR (integer)' })
  lineTotal!: number;

  @ApiProperty({ example: 60000, description: 'Cost total in PKR (integer)' })
  costTotal!: number;
}

export class TransactionResponseDto {
  @ApiProperty({ example: '9f4b6e2c-0a2d-4cc5-8c4d-1a4a88c81a88', format: 'uuid' })
  id!: string;

  @ApiProperty({ example: '6c6f7f48-3d5b-4a3f-9b1d-9c0d73b0c3d2', format: 'uuid' })
  tenantId!: string;

  @ApiProperty({ example: 'PURCHASE' })
  type!: string;

  @ApiProperty({ example: 'DRAFT' })
  status!: string;

  @ApiProperty({ example: '2026-02-10T00:00:00.000Z', format: 'date-time' })
  transactionDate!: string;

  @ApiPropertyOptional({ type: String, example: 'supplier-uuid', format: 'uuid', nullable: true })
  supplierId?: string | null;

  @ApiPropertyOptional({ type: String, example: 'customer-uuid', format: 'uuid', nullable: true })
  customerId?: string | null;

  @ApiProperty({ example: 50000, description: 'Subtotal in PKR (integer)' })
  subtotal!: number;

  @ApiProperty({ example: 0, description: 'Discount total in PKR (integer)' })
  discountTotal!: number;

  @ApiProperty({ example: 2000, description: 'Delivery fee in PKR (integer)' })
  deliveryFee!: number;

  @ApiProperty({ example: 52000, description: 'Total amount in PKR (integer)' })
  totalAmount!: number;

  @ApiPropertyOptional({ type: String, example: 'DELIVERY', nullable: true })
  deliveryType?: string | null;

  @ApiPropertyOptional({ type: String, example: 'Karachi, Pakistan', nullable: true })
  deliveryAddress?: string | null;

  @ApiPropertyOptional({ type: String, example: 'Urgent', nullable: true })
  notes?: string | null;

  @ApiProperty({ example: '2026-02-11T10:00:00.000Z', format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ example: '2026-02-11T10:00:00.000Z', format: 'date-time' })
  updatedAt!: string;

  @ApiProperty({ type: [TransactionLineResponseDto] })
  transactionLines!: TransactionLineResponseDto[];

  @ApiPropertyOptional({ type: Object, nullable: true, description: 'Supplier name — present on list responses' })
  supplier?: { id: string; name: string } | null;

  @ApiPropertyOptional({ type: Object, nullable: true, description: 'Customer name — present on list responses' })
  customer?: { id: string; name: string } | null;
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

export class AllocationTransactionRefDto {
  @ApiProperty({ example: '9f4b6e2c-0a2d-4cc5-8c4d-1a4a88c81a88', format: 'uuid' })
  id!: string;

  @ApiPropertyOptional({ type: String, example: 'TXN-0001', nullable: true })
  documentNumber?: string | null;

  @ApiProperty({ example: '2026-02-11', format: 'date' })
  transactionDate!: string;

  @ApiProperty({ example: 52000, description: 'Transaction total amount in PKR (integer)' })
  totalAmount!: number;

  @ApiProperty({ example: 'SUPPLIER_PAYMENT' })
  type!: string;
}

export class AllocationResponseDto {
  @ApiProperty({ example: 'c01b86e8-6c66-4906-9f84-c3588308c532', format: 'uuid' })
  id!: string;

  @ApiProperty({ example: '6c6f7f48-3d5b-4a3f-9b1d-9c0d73b0c3d2', format: 'uuid' })
  tenantId!: string;

  @ApiProperty({ example: 'e2005751-702e-4b3f-bec9-78c8697ddf46', format: 'uuid' })
  paymentTransactionId!: string;

  @ApiProperty({ example: '0125c4dc-7c64-4560-aac2-f5f3f98ff1a8', format: 'uuid' })
  appliesToTransactionId!: string;

  @ApiProperty({ example: 15000, description: 'Allocation amount in PKR (integer)' })
  amountApplied!: number;

  @ApiProperty({ example: '2026-02-11T10:00:00.000Z', format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ example: '2026-02-11T10:00:00.000Z', format: 'date-time' })
  updatedAt!: string;

  @ApiProperty({ type: AllocationTransactionRefDto })
  paymentTransaction!: AllocationTransactionRefDto;

  @ApiProperty({ type: AllocationTransactionRefDto })
  appliesToTransaction!: AllocationTransactionRefDto;
}

export class AllocationListMetaDto {
  @ApiProperty({ example: 1 })
  page!: number;

  @ApiProperty({ example: 20 })
  limit!: number;

  @ApiProperty({ example: 120 })
  total!: number;

  @ApiProperty({ example: 6 })
  totalPages!: number;
}

export class AllocationListResponseDto {
  @ApiProperty({ type: [AllocationResponseDto] })
  data!: AllocationResponseDto[];

  @ApiProperty({ type: AllocationListMetaDto })
  meta!: AllocationListMetaDto;
}
