import { Injectable } from '@nestjs/common';
import { ImportModule } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

export interface FieldSpec {
  field: string;
  type: string;
  required: boolean;
}

export interface RowValidationResult {
  valid: boolean;
  errorMessage?: string;
  field?: string;
}

export const REQUIRED_FIELDS: Record<ImportModule, FieldSpec[]> = {
  SUPPLIERS: [
    { field: 'name', type: 'string', required: true },
    { field: 'phone', type: 'string', required: false },
    { field: 'address', type: 'string', required: false },
    { field: 'notes', type: 'string', required: false },
  ],
  CUSTOMERS: [
    { field: 'name', type: 'string', required: true },
    { field: 'phone', type: 'string', required: false },
    { field: 'address', type: 'string', required: false },
    { field: 'notes', type: 'string', required: false },
  ],
  PRODUCTS: [
    { field: 'name', type: 'string', required: true },
    { field: 'sku', type: 'string', required: false },
    { field: 'category', type: 'string', required: false },
    { field: 'unit', type: 'string', required: false },
  ],
  OPENING_BALANCES: [
    { field: 'accountName', type: 'string', required: true },
    { field: 'amount', type: 'integer', required: true },
    { field: 'accountType', type: 'string', required: false },
    { field: 'notes', type: 'string', required: false },
  ],
  TRANSACTIONS: [],
};

const PHONE_PATTERN = /^[\d\s\-+().]{7,20}$/;
const SKU_PATTERN = /^[a-zA-Z0-9\-_]+$/;

@Injectable()
export class RowValidatorService {
  constructor(private readonly prisma: PrismaService) {}

  async validateRows(
    module: ImportModule,
    rows: Record<string, string>[],
    tenantId: string,
  ): Promise<RowValidationResult[]> {
    // For OPENING_BALANCES, pre-fetch existing account names once
    let existingAccountNames: Set<string> | null = null;
    if (module === 'OPENING_BALANCES') {
      const accounts = await this.prisma.paymentAccount.findMany({
        where: { tenantId, status: 'ACTIVE' },
        select: { name: true },
      });
      existingAccountNames = new Set(accounts.map((a) => a.name.toLowerCase()));
    }

    return rows.map((row) => this.validateRow(module, row, existingAccountNames));
  }

  private validateRow(
    module: ImportModule,
    row: Record<string, string>,
    existingAccountNames: Set<string> | null,
  ): RowValidationResult {
    switch (module) {
      case 'SUPPLIERS':
      case 'CUSTOMERS':
        return this.validateSupplierCustomer(row);
      case 'PRODUCTS':
        return this.validateProduct(row);
      case 'OPENING_BALANCES':
        return this.validateOpeningBalance(row, existingAccountNames!);
      default:
        return { valid: true };
    }
  }

  private validateSupplierCustomer(row: Record<string, string>): RowValidationResult {
    const name = row['name']?.trim();
    if (!name) {
      return { valid: false, errorMessage: 'Name is required', field: 'name' };
    }
    if (name.length > 255) {
      return { valid: false, errorMessage: 'Name must be 255 characters or less', field: 'name' };
    }
    const phone = row['phone']?.trim();
    if (phone && !PHONE_PATTERN.test(phone)) {
      return { valid: false, errorMessage: 'Invalid phone format', field: 'phone' };
    }
    return { valid: true };
  }

  private validateProduct(row: Record<string, string>): RowValidationResult {
    const name = row['name']?.trim();
    if (!name) {
      return { valid: false, errorMessage: 'Name is required', field: 'name' };
    }
    if (name.length > 255) {
      return { valid: false, errorMessage: 'Name must be 255 characters or less', field: 'name' };
    }
    const sku = row['sku']?.trim();
    if (sku && !SKU_PATTERN.test(sku)) {
      return { valid: false, errorMessage: 'SKU must be alphanumeric with hyphens/underscores only', field: 'sku' };
    }
    return { valid: true };
  }

  private validateOpeningBalance(
    row: Record<string, string>,
    existingAccountNames: Set<string>,
  ): RowValidationResult {
    const accountName = row['accountName']?.trim();
    if (!accountName) {
      return { valid: false, errorMessage: 'Account name is required', field: 'accountName' };
    }
    if (!existingAccountNames.has(accountName.toLowerCase())) {
      return { valid: false, errorMessage: `Payment account "${accountName}" does not exist`, field: 'accountName' };
    }
    const amountStr = row['amount']?.trim();
    if (!amountStr) {
      return { valid: false, errorMessage: 'Amount is required', field: 'amount' };
    }
    const amount = parseInt(amountStr, 10);
    if (isNaN(amount) || String(amount) !== amountStr.replace(/\.0+$/, '')) {
      return { valid: false, errorMessage: 'Amount must be an integer', field: 'amount' };
    }
    if (amount < 0) {
      return { valid: false, errorMessage: 'Amount must be >= 0', field: 'amount' };
    }
    return { valid: true };
  }
}
