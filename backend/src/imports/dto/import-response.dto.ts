import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ImportModule, ImportStatus } from '@prisma/client';

export class ImportRequiredFieldDto {
  @ApiProperty({ example: 'name' })
  field!: string;

  @ApiProperty({ example: true })
  required!: boolean;
}

export class ImportUploadResponseDto {
  @ApiProperty({ example: '47bd46cc-38aa-4d9f-8553-c0ec6f8885e6', format: 'uuid' })
  id!: string;

  @ApiProperty({ enum: ImportModule })
  module!: ImportModule;

  @ApiPropertyOptional({ type: String, example: 'suppliers.csv', nullable: true })
  fileName?: string | null;

  @ApiProperty({ example: 200 })
  totalRows!: number;

  @ApiProperty({ enum: ImportStatus, example: 'PENDING_MAPPING' })
  status!: ImportStatus;

  @ApiProperty({ type: [String], example: ['Company Name', 'Phone'] })
  detectedColumns!: string[];

  @ApiProperty({ type: [ImportRequiredFieldDto] })
  requiredFields!: ImportRequiredFieldDto[];

  @ApiProperty({ example: '2026-02-16T10:00:00.000Z', format: 'date-time' })
  createdAt!: string;
}

export class ImportMapErrorDto {
  @ApiProperty({ example: 3 })
  rowNumber!: number;

  @ApiPropertyOptional({ type: String, example: 'name', nullable: true })
  field?: string | null;

  @ApiProperty({ example: 'name is required' })
  error!: string;

  @ApiProperty({ example: '' })
  value!: string;
}

export class ImportMapPreviewItemDto {
  @ApiProperty({ example: 1 })
  rowNumber!: number;

  @ApiProperty({
    type: 'object',
    additionalProperties: { type: 'string' },
    example: { name: 'Acme Supplies', phone: '03001234567' },
  })
  data!: Record<string, string>;

  @ApiProperty({ example: 'VALID' })
  status!: string;
}

export class ImportMapResponseDto {
  @ApiProperty({ example: '47bd46cc-38aa-4d9f-8553-c0ec6f8885e6', format: 'uuid' })
  id!: string;

  @ApiProperty({ enum: ImportStatus, example: 'VALIDATED' })
  status!: ImportStatus;

  @ApiProperty({ example: 200 })
  totalRows!: number;

  @ApiProperty({ example: 190 })
  validRows!: number;

  @ApiProperty({ example: 10 })
  invalidRows!: number;

  @ApiProperty({ type: [ImportMapErrorDto] })
  errors!: ImportMapErrorDto[];

  @ApiProperty({ type: [ImportMapPreviewItemDto] })
  preview!: ImportMapPreviewItemDto[];
}

export class ImportCreatedRecordDto {
  @ApiProperty({ example: 1 })
  rowNumber!: number;

  @ApiProperty({ example: '9f4b6e2c-0a2d-4cc5-8c4d-1a4a88c81a88', format: 'uuid' })
  recordId!: string;

  @ApiProperty({ example: 'SUPPLIER' })
  recordType!: string;
}

export class ImportCommitResponseDto {
  @ApiProperty({ example: '47bd46cc-38aa-4d9f-8553-c0ec6f8885e6', format: 'uuid' })
  id!: string;

  @ApiProperty({ enum: ImportStatus, example: 'COMPLETED' })
  status!: ImportStatus;

  @ApiProperty({ example: 200 })
  totalRows!: number;

  @ApiProperty({ example: 190 })
  successRows!: number;

  @ApiProperty({ example: 5 })
  failedRows!: number;

  @ApiProperty({ example: 5 })
  skippedRows!: number;

  @ApiProperty({ type: [ImportCreatedRecordDto] })
  createdRecords!: ImportCreatedRecordDto[];

  @ApiProperty({ example: '2026-02-16T10:10:00.000Z', format: 'date-time' })
  completedAt!: string;
}

export class ImportRollbackResponseDto {
  @ApiProperty({ example: '47bd46cc-38aa-4d9f-8553-c0ec6f8885e6', format: 'uuid' })
  id!: string;

  @ApiProperty({ enum: ImportStatus, example: 'ROLLED_BACK' })
  status!: ImportStatus;

  @ApiProperty({ example: 12 })
  rolledBackCount!: number;

  @ApiProperty({ example: '2026-02-16T10:20:00.000Z', format: 'date-time' })
  rolledBackAt!: string;
}

export class ImportBatchListItemDto {
  @ApiProperty({ example: '47bd46cc-38aa-4d9f-8553-c0ec6f8885e6', format: 'uuid' })
  id!: string;

  @ApiProperty({ enum: ImportModule })
  module!: ImportModule;

  @ApiPropertyOptional({ type: String, example: 'suppliers.csv', nullable: true })
  fileName?: string | null;

  @ApiProperty({ enum: ImportStatus })
  status!: ImportStatus;

  @ApiProperty({ example: 200 })
  totalRows!: number;

  @ApiProperty({ example: 190 })
  successRows!: number;

  @ApiProperty({ example: 10 })
  failedRows!: number;

  @ApiProperty({ example: '2026-02-16T10:00:00.000Z', format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ example: '2026-02-16T10:08:00.000Z', format: 'date-time' })
  updatedAt!: string;
}

export class ImportListResponseDto {
  @ApiProperty({ type: [ImportBatchListItemDto] })
  data!: ImportBatchListItemDto[];

  @ApiProperty({ example: 35 })
  total!: number;

  @ApiProperty({ example: 1 })
  page!: number;

  @ApiProperty({ example: 20 })
  limit!: number;

  @ApiProperty({ example: 2 })
  totalPages!: number;
}

export class ImportBatchRowDto {
  @ApiProperty({ example: '6e8752ab-4de7-4dd5-9fde-c6a13298cd0d', format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 1 })
  rowNumber!: number;

  @ApiProperty({ type: 'object', additionalProperties: true })
  rawDataJson!: Record<string, unknown>;

  @ApiProperty({ example: 'VALID' })
  status!: string;

  @ApiPropertyOptional({ type: String, example: 'name is required', nullable: true })
  errorMessage?: string | null;

  @ApiPropertyOptional({ type: String, example: '9f4b6e2c-0a2d-4cc5-8c4d-1a4a88c81a88', format: 'uuid', nullable: true })
  createdRecordId?: string | null;

  @ApiPropertyOptional({ type: String, example: 'SUPPLIER', nullable: true })
  createdRecordType?: string | null;
}

export class ImportRowsPaginationDto {
  @ApiProperty({ example: 200 })
  total!: number;

  @ApiProperty({ example: 1 })
  page!: number;

  @ApiProperty({ example: 20 })
  limit!: number;

  @ApiProperty({ example: 10 })
  totalPages!: number;
}

export class ImportBatchDetailResponseDto {
  @ApiProperty({ example: '47bd46cc-38aa-4d9f-8553-c0ec6f8885e6', format: 'uuid' })
  id!: string;

  @ApiProperty({ enum: ImportModule })
  module!: ImportModule;

  @ApiPropertyOptional({ type: String, example: 'suppliers.csv', nullable: true })
  fileName?: string | null;

  @ApiProperty({ enum: ImportStatus })
  status!: ImportStatus;

  @ApiProperty({ example: 200 })
  totalRows!: number;

  @ApiProperty({ example: 190 })
  successRows!: number;

  @ApiProperty({ example: 10 })
  failedRows!: number;

  @ApiProperty({ example: '2026-02-16T10:00:00.000Z', format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ example: '2026-02-16T10:08:00.000Z', format: 'date-time' })
  updatedAt!: string;

  @ApiProperty({ type: [ImportBatchRowDto] })
  rows!: ImportBatchRowDto[];

  @ApiProperty({ type: ImportRowsPaginationDto })
  rowsPagination!: ImportRowsPaginationDto;
}
