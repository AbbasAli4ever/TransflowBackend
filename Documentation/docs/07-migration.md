# Data Migration and Imports (Excel/CSV)

This document defines the migration strategy for Excel-based businesses. Imports must be auditable, reversible, and safe.

## Goals

- Enable onboarding from Excel without manual re-entry
- Preserve auditability and trust
- Support opening balances for suppliers, customers, payment accounts, and stock

## Import Modules (Supported)

- Suppliers
- Customers
- Products
- Payment Accounts
- Opening Balances

## Import Tables

### import_batches

Tracks each import session.

Fields (minimum):

- `id`
- `tenant_id`
- `source_type` (CSV / EXCEL / MANUAL)
- `module` (SUPPLIERS / CUSTOMERS / PRODUCTS / OPENING_BALANCES / TRANSACTIONS)
- `file_name`
- `status` (PROCESSING / COMPLETED / FAILED)
- `total_rows`
- `success_rows`
- `failed_rows`
- `created_at`
- `created_by`
- `notes`

### import_rows

Tracks row-level results.

Fields (minimum):

- `id`
- `tenant_id`
- `import_batch_id`
- `row_number`
- `raw_data_json`
- `status` (SUCCESS / FAILED)
- `error_message`
- `created_at`

Optional links:

- `created_record_type`
- `created_record_id`

## CSV Template Formats

### Suppliers

Headers:

`name,phone,address,notes,status`

### Customers

Headers:

`name,phone,address,notes,status`

### Products

Headers:

`name,sku,category,unit,avg_cost,status`

### Payment Accounts

Headers:

`name,type,opening_balance,status`

### Opening Balances

Supplier payable:

`supplier_id,amount`

Customer receivable:

`customer_id,amount`

Payment account opening balance:

`payment_account_id,amount`

Product opening stock:

`product_id,qty,unit_cost`

## Validation Rules

- Required columns must be present.
- Amounts and quantities must be positive integers.
- All referenced IDs must exist.
- Duplicate rows are rejected unless explicitly allowed.
- Import must be tenant-scoped (no cross-tenant IDs).

## Opening Balance Logic

Opening balances are posted as system-generated transactions.

### Supplier Opening Payable

- Create ledger entry: AP_INCREASE
- Creates a transaction with type OPENING_BALANCE or PURCHASE (implementation choice)

### Customer Opening Receivable

- Create ledger entry: AR_INCREASE
- Creates a transaction with type OPENING_BALANCE or SALE

### Payment Account Opening Balance

- Create payment entry: MONEY_IN
- Link to opening transaction

### Product Opening Stock

- Create inventory movement: PURCHASE_IN
- Store unit_cost_at_time from import
- Update avg_cost

## Import Safety

- Each batch has `import_batch_id`.
- Failed rows are captured with full error details.
- Imports are traceable and auditable.

## Rollback Strategy

- If batch is marked FAILED, allow rollback by reversing all entries linked to that batch.
- Never delete posted rows; always reverse with entries.

## User Experience

- Show a preview of rows before import.
- Provide a downloadable error report for failed rows.
- Allow retry for failed rows only.
