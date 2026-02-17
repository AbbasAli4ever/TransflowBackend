import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ImportModule, ImportStatus, ImportRowStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { getContext } from '../common/request-context';
import { CsvParserService } from './parsers/csv-parser.service';
import { XlsxParserService } from './parsers/xlsx-parser.service';
import { RowValidatorService, REQUIRED_FIELDS } from './validators/row-validator.service';
import { CreateImportDto } from './dto/create-import.dto';
import { ColumnMappingDto } from './dto/column-mapping.dto';
import { CommitImportDto } from './dto/commit-import.dto';
import { ListImportsQueryDto } from './dto/list-imports-query.dto';

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_ROWS = 10_000;
const ALLOWED_MIMETYPES = ['text/csv', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-excel'];
const ALLOWED_EXTENSIONS = ['.csv', '.xlsx', '.xls'];

@Injectable()
export class ImportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly csvParser: CsvParserService,
    private readonly xlsxParser: XlsxParserService,
    private readonly rowValidator: RowValidatorService,
  ) {}

  private requireTenantId(): string {
    const ctx = getContext();
    if (!ctx?.tenantId) throw new Error('Missing tenant context');
    return ctx.tenantId;
  }

  private requireUserId(): string | undefined {
    return getContext()?.userId;
  }

  // ─── EP-11: Upload File ──────────────────────────────────────────────────────

  async uploadFile(file: Express.Multer.File, dto: CreateImportDto) {
    const tenantId = this.requireTenantId();
    const userId = this.requireUserId();

    // Validate file presence
    if (!file) {
      throw new BadRequestException('File is required');
    }

    // Validate file size
    if (file.size > MAX_FILE_SIZE) {
      throw new BadRequestException('File too large. Maximum size is 10MB');
    }

    // Detect file type by extension
    const originalName = file.originalname?.toLowerCase() ?? '';
    const ext = originalName.substring(originalName.lastIndexOf('.'));
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      throw new BadRequestException('Unsupported file type. Only CSV and XLSX files are allowed');
    }

    // Task 7.5: validate MIME type to prevent content-type spoofing
    if (file.mimetype && !ALLOWED_MIMETYPES.includes(file.mimetype)) {
      throw new BadRequestException('Unsupported file MIME type');
    }

    const isCsv = ext === '.csv';
    const isXlsx = ext === '.xlsx' || ext === '.xls';

    // Parse file
    let parsed: { headers: string[]; rows: Record<string, string>[] };
    if (isCsv) {
      parsed = this.csvParser.parse(file.buffer);
    } else if (isXlsx) {
      parsed = this.xlsxParser.parse(file.buffer);
    } else {
      throw new BadRequestException('Unsupported file type');
    }

    // Validate row count
    if (parsed.rows.length > MAX_ROWS) {
      throw new BadRequestException(`Too many rows. Maximum is ${MAX_ROWS}`);
    }

    const sourceType = isCsv ? 'CSV' : 'EXCEL';

    // Create batch + rows in a transaction
    const batch = await this.prisma.$transaction(async (tx) => {
      const created = await tx.importBatch.create({
        data: {
          tenantId,
          sourceType,
          module: dto.module,
          fileName: file.originalname,
          status: 'PENDING_MAPPING',
          totalRows: parsed.rows.length,
          createdBy: userId,
        },
      });

      if (parsed.rows.length > 0) {
        await tx.importRow.createMany({
          data: parsed.rows.map((row, idx) => ({
            tenantId,
            importBatchId: created.id,
            rowNumber: idx + 1,
            rawDataJson: row,
            status: 'PENDING' as ImportRowStatus,
          })),
        });
      }

      return created;
    });

    return {
      id: batch.id,
      module: batch.module,
      fileName: batch.fileName,
      totalRows: batch.totalRows,
      status: batch.status,
      detectedColumns: parsed.headers,
      requiredFields: REQUIRED_FIELDS[dto.module] ?? [],
      createdAt: batch.createdAt,
    };
  }

  // ─── EP-12: Map Columns ──────────────────────────────────────────────────────

  async mapColumns(batchId: string, dto: ColumnMappingDto) {
    const tenantId = this.requireTenantId();

    const batch = await this.prisma.importBatch.findFirst({
      where: { id: batchId, tenantId },
    });
    if (!batch) throw new NotFoundException('Import batch not found');
    if (batch.status !== 'PENDING_MAPPING') {
      throw new BadRequestException(`Batch must be in PENDING_MAPPING status, got ${batch.status}`);
    }

    // Verify all required fields are mapped
    const requiredFields = REQUIRED_FIELDS[batch.module].filter((f) => f.required).map((f) => f.field);
    const mappedSystemFields = Object.keys(dto.columnMappings);
    const missingFields = requiredFields.filter((f) => !mappedSystemFields.includes(f));
    if (missingFields.length > 0) {
      throw new BadRequestException(`Missing required field mappings: ${missingFields.join(', ')}`);
    }

    // Fetch all rows
    const rows = await this.prisma.importRow.findMany({
      where: { importBatchId: batchId, tenantId },
      orderBy: { rowNumber: 'asc' },
    });

    // Apply mapping: rawDataJson was { "CSV Column": value }, transform to { systemField: value }
    const mappedRows = rows.map((row) => {
      const rawData = row.rawDataJson as Record<string, string>;
      const mapped: Record<string, string> = {};
      for (const [systemField, csvColumn] of Object.entries(dto.columnMappings)) {
        mapped[systemField] = rawData[csvColumn] ?? '';
      }
      return { ...row, mappedData: mapped };
    });

    // Validate each mapped row
    const validationResults = await this.rowValidator.validateRows(
      batch.module,
      mappedRows.map((r) => r.mappedData),
      tenantId,
    );

    // Update rows in DB
    const errors: Array<{ rowNumber: number; field?: string; error: string; value: string }> = [];
    const preview: Array<{ rowNumber: number; data: Record<string, string>; status: string }> = [];

    await this.prisma.$transaction(async (tx) => {
      // CAS: atomically claim the PENDING_MAPPING → VALIDATED transition
      const { count } = await tx.importBatch.updateMany({
        where: { id: batchId, tenantId, status: 'PENDING_MAPPING' },
        data: { status: 'VALIDATED' },
      });
      if (count === 0) {
        throw new ConflictException('Batch is no longer in PENDING_MAPPING state');
      }

      for (let i = 0; i < mappedRows.length; i++) {
        const r = mappedRows[i];
        const result = validationResults[i];
        const newStatus: ImportRowStatus = result.valid ? 'VALID' : 'INVALID';

        await tx.importRow.update({
          where: { id: r.id },
          data: {
            rawDataJson: r.mappedData,
            status: newStatus,
            errorMessage: result.valid ? null : result.errorMessage,
          },
        });

        if (!result.valid) {
          errors.push({
            rowNumber: r.rowNumber,
            field: result.field,
            error: result.errorMessage!,
            value: r.mappedData[result.field ?? ''] ?? '',
          });
        }

        if (preview.length < 5) {
          preview.push({ rowNumber: r.rowNumber, data: r.mappedData, status: newStatus });
        }
      }
    });

    const validRows = mappedRows.length - errors.length;

    return {
      id: batchId,
      status: 'VALIDATED' as ImportStatus,
      totalRows: rows.length,
      validRows,
      invalidRows: errors.length,
      errors,
      preview,
    };
  }

  // ─── EP-13: Commit Import ────────────────────────────────────────────────────

  async commitImport(batchId: string, dto: CommitImportDto) {
    const tenantId = this.requireTenantId();
    const userId = this.requireUserId();

    const batch = await this.prisma.importBatch.findFirst({
      where: { id: batchId, tenantId },
    });
    if (!batch) throw new NotFoundException('Import batch not found');
    if (batch.status !== 'VALIDATED') {
      throw new BadRequestException(`Batch must be in VALIDATED status, got ${batch.status}`);
    }

    const skipInvalidRows = dto.skipInvalidRows !== false; // default true

    const validRows = await this.prisma.importRow.findMany({
      where: { importBatchId: batchId, tenantId, status: 'VALID' },
      orderBy: { rowNumber: 'asc' },
    });

    const invalidRows = await this.prisma.importRow.findMany({
      where: { importBatchId: batchId, tenantId, status: 'INVALID' },
      select: { id: true },
    });

    if (!skipInvalidRows && invalidRows.length > 0) {
      throw new BadRequestException(
        `Cannot commit: ${invalidRows.length} invalid row(s) exist and skipInvalidRows is false`,
      );
    }

    const createdRecords: Array<{ rowNumber: number; recordId: string; recordType: string }> = [];
    let successCount = 0;
    let failedCount = 0;

    await this.prisma.$transaction(async (tx) => {
      // Task 7.2: CAS — atomically claim the VALIDATED → PROCESSING transition
      const { count: claimed } = await tx.importBatch.updateMany({
        where: { id: batchId, tenantId, status: 'VALIDATED' },
        data: { status: 'PROCESSING' },
      });
      if (claimed === 0) {
        throw new ConflictException('Batch is no longer in VALIDATED state');
      }

      for (const row of validRows) {
        const data = row.rawDataJson as Record<string, string>;
        let recordId: string | null = null;
        let recordType: string | null = null;
        let failReason: string | null = null;
        let updatedRawData: Record<string, unknown> | null = null;

        try {
          if (batch.module === 'SUPPLIERS') {
            const name = data['name']?.trim();
            // Use findFirst inside the tx (case-insensitive) — P2002 cannot be caught inside
            // a $transaction without aborting the PostgreSQL transaction.
            const existing = await tx.supplier.findFirst({
              where: { tenantId, name: { equals: name, mode: 'insensitive' } },
              select: { id: true },
            });
            if (existing) {
              failReason = 'Duplicate name';
            } else {
              const created = await tx.supplier.create({
                data: {
                  tenantId,
                  name,
                  phone: data['phone']?.trim() || null,
                  address: data['address']?.trim() || null,
                  notes: data['notes']?.trim() || null,
                  createdBy: userId,
                },
              });
              recordId = created.id;
              recordType = 'SUPPLIER';
            }
          } else if (batch.module === 'CUSTOMERS') {
            const name = data['name']?.trim();
            const existing = await tx.customer.findFirst({
              where: { tenantId, name: { equals: name, mode: 'insensitive' } },
              select: { id: true },
            });
            if (existing) {
              failReason = 'Duplicate name';
            } else {
              const created = await tx.customer.create({
                data: {
                  tenantId,
                  name,
                  phone: data['phone']?.trim() || null,
                  address: data['address']?.trim() || null,
                  notes: data['notes']?.trim() || null,
                  createdBy: userId,
                },
              });
              recordId = created.id;
              recordType = 'CUSTOMER';
            }
          } else if (batch.module === 'PRODUCTS') {
            const name = data['name']?.trim();
            const sku = data['sku']?.trim() || null;
            if (sku) {
              const existing = await tx.product.findFirst({
                where: { tenantId, sku: { equals: sku, mode: 'insensitive' } },
                select: { id: true },
              });
              if (existing) failReason = 'Duplicate SKU';
            }
            if (!failReason) {
              const created = await tx.product.create({
                data: {
                  tenantId,
                  name,
                  sku: sku || null,
                  category: data['category']?.trim() || null,
                  unit: data['unit']?.trim() || 'piece',
                  createdBy: userId,
                  variants: {
                    create: [{ tenantId, size: 'one-size', createdBy: userId }],
                  },
                },
              });
              recordId = created.id;
              recordType = 'PRODUCT';
            }
          } else if (batch.module === 'OPENING_BALANCES') {
            const accountName = data['accountName']?.trim();
            const amount = parseInt(data['amount'], 10);
            // Task 7.3: fetch current value before overwriting so rollback can restore it
            const account = await tx.paymentAccount.findFirst({
              where: { tenantId, name: { equals: accountName, mode: 'insensitive' }, status: 'ACTIVE' },
              select: { id: true, openingBalance: true },
            });
            if (!account) {
              failReason = `Payment account "${accountName}" not found`;
            } else {
              const entryCount = await tx.paymentEntry.count({
                where: { paymentAccountId: account.id },
              });
              if (entryCount > 0) {
                failReason = `Cannot overwrite opening balance for account "${accountName}": account has existing transaction history`;
              } else {
                await tx.paymentAccount.update({
                  where: { id: account.id },
                  data: { openingBalance: amount },
                });
                // Task 7.3: embed previousOpeningBalance in rawDataJson for rollback restoration
                updatedRawData = {
                  ...(row.rawDataJson as Record<string, unknown>),
                  previousOpeningBalance: account.openingBalance,
                };
                recordId = account.id;
                recordType = 'PAYMENT_ACCOUNT';
              }
            }
          }
        } catch (err: any) {
          if (!failReason) failReason = err.message ?? 'Unknown error';
        }

        if (failReason) {
          await tx.importRow.update({
            where: { id: row.id },
            data: { status: 'FAILED', errorMessage: failReason },
          });
          failedCount++;
        } else {
          await tx.importRow.update({
            where: { id: row.id },
            data: {
              status: 'SUCCESS',
              createdRecordId: recordId,
              createdRecordType: recordType,
              ...(updatedRawData ? { rawDataJson: updatedRawData as any } : {}),
            },
          });
          successCount++;
          if (recordId && recordType) {
            createdRecords.push({ rowNumber: row.rowNumber, recordId, recordType });
          }
        }
      }

      await tx.importBatch.update({
        where: { id: batchId },
        data: {
          status: 'COMPLETED',
          successRows: successCount,
          failedRows: failedCount + invalidRows.length,
        },
      });
    });

    return {
      id: batchId,
      status: 'COMPLETED' as ImportStatus,
      totalRows: batch.totalRows,
      successRows: successCount,
      failedRows: failedCount,
      skippedRows: invalidRows.length,
      createdRecords,
      completedAt: new Date().toISOString(),
    };
  }

  // ─── EP-14: Rollback Import ──────────────────────────────────────────────────

  async rollbackImport(batchId: string) {
    const tenantId = this.requireTenantId();

    const batch = await this.prisma.importBatch.findFirst({
      where: { id: batchId, tenantId },
    });
    if (!batch) throw new NotFoundException('Import batch not found');
    if (batch.status !== 'COMPLETED') {
      throw new BadRequestException(`Batch must be in COMPLETED status, got ${batch.status}`);
    }

    // Pre-fetch success rows (needed for dependency checking inside tx)
    const successRows = await this.prisma.importRow.findMany({
      where: {
        importBatchId: batchId,
        tenantId,
        status: 'SUCCESS',
        NOT: { createdRecordId: null },
      },
      orderBy: { rowNumber: 'asc' },
    });

    let rolledBackCount = 0;

    // Task 7.4: dependency check + rollback mutations in a single Serializable transaction
    await this.prisma.$transaction(
      async (tx) => {
        // Dependency check (now inside the transaction — eliminates TOCTOU)
        for (const row of successRows) {
          const recordId = row.createdRecordId!;
          const recordType = row.createdRecordType;

          if (recordType === 'SUPPLIER') {
            const count = await tx.transaction.count({ where: { tenantId, supplierId: recordId } });
            if (count > 0) throw new ConflictException('Cannot rollback: records have dependencies');
          } else if (recordType === 'CUSTOMER') {
            const count = await tx.transaction.count({ where: { tenantId, customerId: recordId } });
            if (count > 0) throw new ConflictException('Cannot rollback: records have dependencies');
          } else if (recordType === 'PRODUCT') {
            const count = await tx.transactionLine.count({
              where: { tenantId, variant: { productId: recordId } },
            });
            if (count > 0) throw new ConflictException('Cannot rollback: records have dependencies');
          } else if (recordType === 'PAYMENT_ACCOUNT') {
            const count = await tx.paymentEntry.count({ where: { tenantId, paymentAccountId: recordId } });
            if (count > 0) throw new ConflictException('Cannot rollback: records have dependencies');
          }
        }

        // Task 7.3: for opening-balance rows, process in REVERSE rowNumber order so that
        // if the same account appears multiple times, we restore to the true original value.
        const orderedRows = [...successRows].sort((a, b) => b.rowNumber - a.rowNumber);
        // Track which accounts have already been restored to avoid double-restoration
        const restoredAccountIds = new Set<string>();

        for (const row of orderedRows) {
          const recordId = row.createdRecordId!;
          const recordType = row.createdRecordType;

          if (recordType === 'SUPPLIER') {
            await tx.supplier.update({ where: { id: recordId, tenantId }, data: { status: 'INACTIVE' } });
          } else if (recordType === 'CUSTOMER') {
            await tx.customer.update({ where: { id: recordId, tenantId }, data: { status: 'INACTIVE' } });
          } else if (recordType === 'PRODUCT') {
            await tx.product.update({ where: { id: recordId, tenantId }, data: { status: 'INACTIVE' } });
          } else if (recordType === 'PAYMENT_ACCOUNT' && !restoredAccountIds.has(recordId)) {
            // Restore to the previousOpeningBalance stored at commit time for this account.
            // First occurrence in reverse order = the row that originally held the pre-import value.
            const rawData = row.rawDataJson as Record<string, unknown>;
            const previousBalance = rawData.previousOpeningBalance as number ?? 0;
            await tx.paymentAccount.update({
              where: { id: recordId, tenantId },
              data: { openingBalance: previousBalance },
            });
            restoredAccountIds.add(recordId);
          }

          await tx.importRow.update({
            where: { id: row.id, tenantId },
            data: { status: 'VALID', createdRecordId: null, createdRecordType: null },
          });

          rolledBackCount++;
        }

        await tx.importBatch.update({
          where: { id: batchId, tenantId },
          data: { status: 'ROLLED_BACK' },
        });
      },
      { isolationLevel: 'Serializable' },
    );

    return {
      id: batchId,
      status: 'ROLLED_BACK' as ImportStatus,
      rolledBackCount,
      rolledBackAt: new Date().toISOString(),
    };
  }

  // ─── EP-15: List Import Batches ──────────────────────────────────────────────

  async listBatches(query: ListImportsQueryDto) {
    const tenantId = this.requireTenantId();
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const where: any = { tenantId };
    if (query.module) where.module = query.module;
    if (query.status) where.status = query.status;

    const [total, batches] = await Promise.all([
      this.prisma.importBatch.count({ where }),
      this.prisma.importBatch.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          module: true,
          fileName: true,
          status: true,
          totalRows: true,
          successRows: true,
          failedRows: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
    ]);

    return {
      data: batches,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  // ─── EP-16: Get Import Batch Detail ─────────────────────────────────────────

  async getBatchDetail(batchId: string, page = 1, limit = 50) {
    const tenantId = this.requireTenantId();

    const batch = await this.prisma.importBatch.findFirst({
      where: { id: batchId, tenantId },
    });
    if (!batch) throw new NotFoundException('Import batch not found');

    const [totalRows, rows] = await Promise.all([
      this.prisma.importRow.count({ where: { importBatchId: batchId, tenantId } }),
      this.prisma.importRow.findMany({
        where: { importBatchId: batchId, tenantId },
        orderBy: { rowNumber: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          rowNumber: true,
          rawDataJson: true,
          status: true,
          errorMessage: true,
          createdRecordId: true,
          createdRecordType: true,
        },
      }),
    ]);

    return {
      ...batch,
      rows,
      rowsPagination: {
        total: totalRows,
        page,
        limit,
        totalPages: Math.ceil(totalRows / limit),
      },
    };
  }
}
