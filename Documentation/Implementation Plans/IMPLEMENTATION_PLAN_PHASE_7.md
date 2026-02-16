# Phase 7: Implementation Plan

> **Status**: 📋 Planned
> **Pre-requisite**: Phases 1–6 complete (341 tests passing)
> **Estimated Sub-phases**: 4 (7A → 7B → 7C → 7D)

---

## Table of Contents

1. [Overview & Strategy](#1-overview--strategy)
2. [Phase 7A — Reports Module (Canonical Queries)](#2-phase-7a--reports-module-canonical-queries)
3. [Phase 7B — Dashboard Summary](#3-phase-7b--dashboard-summary)
4. [Phase 7C — Excel/CSV Import System](#4-phase-7c--excelcsv-import-system)
5. [Phase 7D — Production Hardening](#5-phase-7d--production-hardening)
6. [Schema Changes Summary](#6-schema-changes-summary)
7. [Cross-cutting Concerns](#7-cross-cutting-concerns)
8. [Full Endpoint Inventory](#8-full-endpoint-inventory)
9. [Acceptance Criteria (All Sub-phases)](#9-acceptance-criteria-all-sub-phases)

---

## 1. Overview & Strategy

### What Phase 7 Delivers

Phase 7 is the final phase. It transforms the system from a working backend into a **production-grade, query-rich, importable finance platform**. It has four distinct sub-phases, each independently testable and commitable.

### Why Four Sub-phases

| Sub-phase | Scope | Risk | Dependencies |
|-----------|-------|------|--------------|
| **7A** | Reports module (9 query endpoints) | Low — read-only queries, no schema changes | None |
| **7B** | Dashboard summary (1 aggregate endpoint) | Low — composes existing queries | 7A (reuses report service methods) |
| **7C** | Import system (5 endpoints, schema migration) | Medium — file I/O, new module, schema change | None (parallel-safe with 7A/7B) |
| **7D** | Production hardening (Docker, CI/CD, security, monitoring, backup, 12-factor) | Low — config/infra, no business logic | 7A + 7B + 7C complete |

### What Already Exists (No Duplication)

These endpoints were built in Phases 4–5 and will **NOT** be rebuilt:

| Existing Endpoint | Module | Returns |
|-------------------|--------|---------|
| `GET /suppliers/:id/balance` | Suppliers | `{ totalPurchases, totalPaid, currentBalance }` |
| `GET /suppliers/:id/open-documents` | Suppliers | Outstanding purchase documents |
| `GET /customers/:id/balance` | Customers | `{ totalSales, totalReceived, currentBalance }` |
| `GET /customers/:id/open-documents` | Customers | Outstanding sale documents |
| `GET /products/:id/stock` | Products | `{ currentStock, avgCost }` |
| `GET /payment-accounts/:id/balance` | PaymentAccounts | `{ openingBalance, totalIn, totalOut, currentBalance }` |

### What Phase 7 Reports Add (New Value)

The new `/reports/*` endpoints are **richer analytical queries** compared to the simple balance snapshots above:

1. **`asOfDate` filtering** — point-in-time queries (existing endpoints don't support date filters)
2. **Detailed breakdowns** — purchases vs payments vs returns counted separately
3. **Statements** — date-range ledger with running balance (completely new)
4. **Pending dashboards** — cross-entity aggregation (all customers/suppliers at once)
5. **Stock detail** — per-movement-type breakdown + stock value calculation

---

## 2. Phase 7A — Reports Module (Canonical Queries)

### 2.1 Module Structure

```
backend/src/reports/
├── reports.module.ts
├── reports.controller.ts
├── reports.service.ts
└── dto/
    ├── balance-query.dto.ts          # { asOfDate? }
    ├── statement-query.dto.ts        # { dateFrom, dateTo }
    ├── pending-query.dto.ts          # { asOfDate?, customerId?/supplierId?, minAmount? }
    ├── supplier-balance.response.ts  # Response type doc (Swagger)
    ├── customer-balance.response.ts
    ├── payment-account-balance.response.ts
    ├── product-stock.response.ts
    ├── statement-entry.response.ts
    └── pending-item.response.ts
```

### 2.2 Endpoints — Full Specification

---

#### EP-1: Supplier Balance Report

**`GET /api/v1/reports/suppliers/:id/balance`**

| Param | Type | Required | Default |
|-------|------|----------|---------|
| `id` | UUID (path) | Yes | — |
| `asOfDate` | date (query) | No | today |

**SQL** (raw query via `$queryRaw`):
```sql
SELECT
  COUNT(CASE WHEN le.entry_type = 'AP_INCREASE' THEN 1 END)::int AS "purchaseCount",
  COALESCE(SUM(CASE WHEN le.entry_type = 'AP_INCREASE' THEN le.amount ELSE 0 END), 0)::bigint AS "totalPurchases",
  COUNT(CASE WHEN le.entry_type = 'AP_DECREASE' THEN 1 END)::int AS "paymentCount",
  COALESCE(SUM(CASE WHEN le.entry_type = 'AP_DECREASE' THEN le.amount ELSE 0 END), 0)::bigint AS "totalPayments"
FROM ledger_entries le
JOIN transactions t ON t.id = le.transaction_id
WHERE le.tenant_id = $1
  AND le.supplier_id = $2
  AND le.transaction_date <= $3
  AND t.status = 'POSTED'
```

**Response** (200):
```json
{
  "supplierId": "uuid",
  "supplierName": "ABC Textiles",
  "asOfDate": "2026-02-20",
  "balance": 45000,
  "balanceType": "PAYABLE",
  "breakdown": {
    "purchases": { "count": 5, "totalAmount": 250000 },
    "payments": { "count": 3, "totalAmount": 200000 },
    "returns": { "count": 1, "totalAmount": 5000 },
    "netPayable": 45000
  }
}
```

**Notes**:
- `balanceType`: `"PAYABLE"` if balance > 0, `"CREDIT"` if balance < 0, `"SETTLED"` if 0
- Returns are AP_DECREASE entries from SUPPLIER_RETURN transactions — need to distinguish from payment AP_DECREASE entries by joining on `transactions.type`

---

#### EP-2: Customer Balance Report

**`GET /api/v1/reports/customers/:id/balance`**

Mirror of EP-1 using AR entries. Same `asOfDate` param.

**Response** (200):
```json
{
  "customerId": "uuid",
  "customerName": "Retail Shop A",
  "asOfDate": "2026-02-20",
  "balance": 85000,
  "balanceType": "RECEIVABLE",
  "breakdown": {
    "sales": { "count": 10, "totalAmount": 350000 },
    "payments": { "count": 7, "totalAmount": 250000 },
    "returns": { "count": 2, "totalAmount": 15000 },
    "netReceivable": 85000
  }
}
```

**Notes**:
- `balanceType`: `"RECEIVABLE"` if > 0, `"CREDIT"` if < 0, `"SETTLED"` if 0
- Returns are AR_DECREASE entries from CUSTOMER_RETURN transactions

---

#### EP-3: Payment Account Balance Report

**`GET /api/v1/reports/payment-accounts/:id/balance`**

**Response** (200):
```json
{
  "accountId": "uuid",
  "accountName": "Cash",
  "accountType": "CASH",
  "asOfDate": "2026-02-20",
  "balance": 125000,
  "breakdown": {
    "openingBalance": 0,
    "moneyIn": { "count": 10, "totalAmount": 500000 },
    "moneyOut": { "count": 8, "totalAmount": 375000 },
    "currentBalance": 125000
  }
}
```

---

#### EP-4: Product Stock Report

**`GET /api/v1/reports/products/:id/stock`**

**Response** (200):
```json
{
  "productId": "uuid",
  "productName": "Men Suit - Black",
  "sku": "SUIT-BLK-001",
  "asOfDate": "2026-02-20",
  "currentStock": 45,
  "avgCost": 5200,
  "stockValue": 234000,
  "breakdown": {
    "purchasesIn": 100,
    "salesOut": 50,
    "customerReturnsIn": 3,
    "supplierReturnsOut": 5,
    "adjustmentsIn": 2,
    "adjustmentsOut": 5,
    "netStock": 45
  }
}
```

**Notes**:
- `stockValue = currentStock * avgCost`
- `avgCost` computed from total purchase cost / total purchase qty (up to asOfDate)

---

#### EP-5: Pending Receivables

**`GET /api/v1/reports/pending-receivables`**

| Param | Type | Required | Default |
|-------|------|----------|---------|
| `asOfDate` | date (query) | No | today |
| `customerId` | UUID (query) | No | all customers |
| `minAmount` | int (query) | No | 0 |

**SQL strategy**: Aggregate AR balances grouped by customer, filter balance > 0. For each customer, fetch open documents (SALE transactions where outstanding > 0).

**Response** (200):
```json
{
  "asOfDate": "2026-02-20",
  "totalReceivables": 250000,
  "customerCount": 15,
  "customers": [
    {
      "customerId": "uuid",
      "customerName": "Retail Shop A",
      "balance": 85000,
      "oldestInvoiceDate": "2026-01-15",
      "daysPastDue": 36,
      "openDocuments": [
        {
          "documentNumber": "SAL-2026-0012",
          "transactionDate": "2026-01-15",
          "totalAmount": 50000,
          "paidAmount": 0,
          "outstanding": 50000,
          "daysPastDue": 36
        }
      ]
    }
  ]
}
```

**Notes**:
- `daysPastDue = asOfDate - transactionDate` (in days)
- `outstanding = totalAmount - SUM(allocations.amountApplied)`
- Only include documents where `outstanding > 0`

---

#### EP-6: Pending Payables

**`GET /api/v1/reports/pending-payables`**

Mirror of EP-5 for suppliers. Same query params (`asOfDate`, `supplierId`, `minAmount`).

---

#### EP-7: Supplier Statement

**`GET /api/v1/reports/suppliers/:id/statement`**

| Param | Type | Required |
|-------|------|----------|
| `id` | UUID (path) | Yes |
| `dateFrom` | date (query) | Yes |
| `dateTo` | date (query) | Yes |

**SQL** (window function for running balance):
```sql
WITH opening AS (
  SELECT COALESCE(
    SUM(CASE WHEN le.entry_type = 'AP_INCREASE' THEN le.amount ELSE -le.amount END), 0
  )::bigint AS balance
  FROM ledger_entries le
  JOIN transactions t ON t.id = le.transaction_id
  WHERE le.tenant_id = $1 AND le.supplier_id = $2
    AND le.transaction_date < $3
    AND t.status = 'POSTED'
),
ledger AS (
  SELECT
    t.transaction_date AS date,
    t.document_number AS "documentNumber",
    t.type,
    le.entry_type,
    le.amount
  FROM ledger_entries le
  JOIN transactions t ON t.id = le.transaction_id
  WHERE le.tenant_id = $1 AND le.supplier_id = $2
    AND le.transaction_date BETWEEN $3 AND $4
    AND t.status = 'POSTED'
  ORDER BY t.transaction_date, t.created_at
)
SELECT
  date,
  "documentNumber",
  type,
  CASE WHEN entry_type = 'AP_INCREASE' THEN amount ELSE 0 END AS debit,
  CASE WHEN entry_type = 'AP_DECREASE' THEN amount ELSE 0 END AS credit
FROM ledger
```

**Response** (200):
```json
{
  "supplierId": "uuid",
  "supplierName": "ABC Textiles",
  "dateFrom": "2026-01-01",
  "dateTo": "2026-02-20",
  "openingBalance": 0,
  "closingBalance": 45000,
  "entries": [
    {
      "date": "2026-01-05",
      "documentNumber": "PUR-2026-0001",
      "type": "PURCHASE",
      "debit": 50000,
      "credit": 0,
      "runningBalance": 50000
    }
  ]
}
```

**Notes**:
- `openingBalance` = sum of all AP entries BEFORE `dateFrom`
- `runningBalance` computed in application code: `openingBalance + cumulative(debit - credit)`
- `closingBalance` = last entry's `runningBalance`

---

#### EP-8: Customer Statement

**`GET /api/v1/reports/customers/:id/statement`**

Mirror of EP-7 using AR entries. Same params (`dateFrom`, `dateTo`).

---

#### EP-9: Payment Account Statement

**`GET /api/v1/reports/payment-accounts/:id/statement`**

Same pattern as EP-7/EP-8 but using `payment_entries` table.

**Opening balance** = `payment_account.opening_balance + SUM(entries before dateFrom)`

---

### 2.3 Tests — Phase 7A

**File**: `backend/test/integration/reports.integration.spec.ts`

| # | Test Case | Validates |
|---|-----------|-----------|
| 1 | Supplier balance with asOfDate filters correctly | Point-in-time query |
| 2 | Supplier balance breakdown separates purchases, payments, returns | Category counting |
| 3 | Customer balance with asOfDate | Point-in-time query |
| 4 | Customer balance breakdown separates sales, payments, returns | Category counting |
| 5 | Payment account balance with asOfDate | Point-in-time query |
| 6 | Payment account balance includes opening balance | Opening balance handling |
| 7 | Product stock with asOfDate | Point-in-time query |
| 8 | Product stock breakdown by movement type | Per-type counting |
| 9 | Product stock value = stock × avgCost | Value calculation |
| 10 | Pending receivables lists only positive-balance customers | Filter logic |
| 11 | Pending receivables minAmount filter | Threshold filtering |
| 12 | Pending receivables customerId filter | Single-entity filter |
| 13 | Pending receivables shows open documents with outstanding | Document-level detail |
| 14 | Pending receivables daysPastDue calculated correctly | Date math |
| 15 | Pending payables lists only positive-balance suppliers | Filter logic |
| 16 | Pending payables supplierId filter | Single-entity filter |
| 17 | Supplier statement opening balance computed from pre-range entries | Opening balance |
| 18 | Supplier statement running balance accumulates correctly | Window function |
| 19 | Supplier statement closing balance = last running balance | Consistency |
| 20 | Customer statement mirrors supplier statement logic | AR entries |
| 21 | Payment account statement includes opening balance | Opening balance |
| 22 | Payment account statement running balance correct | Window function |
| 23 | All report endpoints return 404 for non-existent entity | Error handling |
| 24 | All report endpoints enforce tenant isolation | Security |
| 25 | Statement with empty date range returns opening = closing | Edge case |
| 26 | Balance report defaults asOfDate to today when omitted | Default handling |

**Estimated test count**: ~26 tests

---

### 2.4 Validation Gate — Phase 7A

```
□ ReportsModule registered in AppModule
□ All 9 endpoints responding correctly
□ All ~26 integration tests passing
□ No TypeScript errors (npm run build)
□ Swagger docs updated for all endpoints
□ Existing 341 tests still passing (no regressions)
```

---

## 3. Phase 7B — Dashboard Summary

### 3.1 Module Structure

```
backend/src/dashboard/
├── dashboard.module.ts
├── dashboard.controller.ts
└── dashboard.service.ts
```

### 3.2 Endpoint

#### EP-10: Dashboard Summary

**`GET /api/v1/dashboard/summary`**

| Param | Type | Required | Default |
|-------|------|----------|---------|
| `asOfDate` | date (query) | No | today |

**Implementation strategy**: Execute multiple aggregation queries in parallel using `Promise.all`. Reuse SQL patterns from ReportsService where possible (import ReportsService into DashboardModule, or extract shared query helpers).

**Response** (200):
```json
{
  "asOfDate": "2026-02-20",
  "cash": {
    "totalBalance": 325000,
    "accounts": [
      { "name": "Cash", "balance": 125000 },
      { "name": "HBL Bank", "balance": 200000 }
    ]
  },
  "inventory": {
    "totalValue": 2500000,
    "totalProducts": 150,
    "lowStockCount": 12
  },
  "receivables": {
    "totalAmount": 250000,
    "customerCount": 15,
    "overdueAmount": 120000,
    "overdueCount": 8
  },
  "payables": {
    "totalAmount": 180000,
    "supplierCount": 10,
    "overdueAmount": 45000,
    "overdueCount": 3
  },
  "recentActivity": {
    "todaySales": 85000,
    "todayPurchases": 120000,
    "todayPayments": 50000,
    "todayReceipts": 75000
  }
}
```

**Sub-queries** (all filtered by tenant_id + asOfDate):

1. **Cash**: `SELECT pa.name, pa.opening_balance + COALESCE(SUM(CASE WHEN pe.direction='IN' THEN pe.amount ELSE 0 END),0) - COALESCE(SUM(CASE WHEN pe.direction='OUT' THEN pe.amount ELSE 0 END),0) AS balance FROM payment_accounts pa LEFT JOIN payment_entries pe ...` grouped by account.

2. **Inventory**: Aggregate all products' stock × avgCost. `lowStockCount` = products where stock ≤ 5 (hardcoded threshold V1; configurable later).

3. **Receivables**: Sum of positive AR balances grouped by customer. `overdueAmount` = balances where oldest open document date + 30 days < asOfDate (30-day default overdue threshold V1).

4. **Payables**: Same as receivables but for AP.

5. **Recent Activity**: Sum of `total_amount` from POSTED transactions WHERE `transaction_date = asOfDate`, grouped by type.

### 3.3 Tests — Phase 7B

**File**: `backend/test/integration/dashboard.integration.spec.ts`

| # | Test Case |
|---|-----------|
| 1 | Returns all zero values for tenant with no data |
| 2 | Cash section shows all payment accounts with correct balances |
| 3 | Inventory section shows total value and product count |
| 4 | Inventory lowStockCount counts products with stock ≤ 5 |
| 5 | Receivables shows positive AR balances only |
| 6 | Payables shows positive AP balances only |
| 7 | Recent activity sums today's posted transactions by type |
| 8 | asOfDate param filters all sections correctly |
| 9 | Tenant isolation enforced |

**Estimated test count**: ~9 tests

### 3.4 Validation Gate — Phase 7B

```
□ DashboardModule registered in AppModule
□ Dashboard endpoint responding < 2 seconds
□ All ~9 tests passing
□ No TypeScript errors
□ Swagger docs for dashboard endpoint
□ All previous tests still passing
```

---

## 4. Phase 7C — Excel/CSV Import System

### 4.1 Schema Migration Required

The existing `ImportBatch` schema needs additional status values. A Prisma migration is required:

**Change `ImportStatus` enum**:
```
Current:  PROCESSING | COMPLETED | FAILED
Required: PENDING_MAPPING | VALIDATED | PROCESSING | COMPLETED | FAILED | ROLLED_BACK
```

**Change `ImportRowStatus` enum**:
```
Current:  SUCCESS | FAILED
Required: PENDING | VALID | INVALID | SUCCESS | FAILED
```

This is the **only schema migration** in all of Phase 7.

### 4.2 New Dependency

```bash
npm install multer @types/multer csv-parse xlsx
```

- `multer` — NestJS file upload (already included in `@nestjs/platform-express`)
- `csv-parse` — CSV parsing
- `xlsx` — Excel file parsing (XLSX/XLS)

### 4.3 Module Structure

```
backend/src/imports/
├── imports.module.ts
├── imports.controller.ts
├── imports.service.ts
├── parsers/
│   ├── csv-parser.service.ts
│   └── xlsx-parser.service.ts
├── validators/
│   └── row-validator.service.ts        # Per-module validation rules
└── dto/
    ├── create-import.dto.ts            # { module } (file via @UploadedFile)
    ├── column-mapping.dto.ts           # { columnMappings: Record<string, string> }
    ├── commit-import.dto.ts            # { skipInvalidRows: boolean }
    └── import-response.dto.ts          # Swagger response types
```

### 4.4 Endpoints — Full Specification

---

#### EP-11: Upload File (Create Import Batch)

**`POST /api/v1/imports`** (multipart/form-data)

| Field | Type | Required | Constraints |
|-------|------|----------|-------------|
| `file` | File (multipart) | Yes | CSV or XLSX, max 10MB |
| `module` | string (form field) | Yes | `SUPPLIERS` / `CUSTOMERS` / `PRODUCTS` / `OPENING_BALANCES` |

**Process**:
1. Validate file type (extension + MIME check)
2. Parse file to extract column headers
3. Count total rows
4. Create `ImportBatch` record (status = `PENDING_MAPPING`)
5. Store raw data as `ImportRow` records (status = `PENDING`, rawDataJson = each row as object)
6. Return batch info with detected columns and required field mapping

**Validations**:
- File size ≤ 10MB → 400 `File too large`
- Extension must be `.csv` or `.xlsx` → 400 `Unsupported file type`
- Row count ≤ 10,000 → 400 `Too many rows`
- Module must be valid enum → 400 (class-validator)

**Response** (201):
```json
{
  "id": "uuid",
  "module": "SUPPLIERS",
  "fileName": "suppliers.csv",
  "totalRows": 250,
  "status": "PENDING_MAPPING",
  "detectedColumns": ["Company Name", "Phone Number", "Address", "Notes"],
  "requiredFields": [
    { "field": "name", "type": "string", "required": true },
    { "field": "phone", "type": "string", "required": false },
    { "field": "address", "type": "string", "required": false },
    { "field": "notes", "type": "string", "required": false }
  ],
  "createdAt": "2026-02-20T10:00:00.000Z"
}
```

**Required fields per module**:

| Module | Required Fields | Optional Fields |
|--------|----------------|-----------------|
| `SUPPLIERS` | `name` | `phone`, `address`, `notes` |
| `CUSTOMERS` | `name` | `phone`, `address`, `notes` |
| `PRODUCTS` | `name` | `sku`, `category`, `unit` |
| `OPENING_BALANCES` | `accountName`, `amount` | `accountType`, `notes` |

---

#### EP-12: Map Columns

**`POST /api/v1/imports/:id/map`**

| Field | Type | Required |
|-------|------|----------|
| `columnMappings` | `Record<string, string>` | Yes |

**Process**:
1. Verify batch status = `PENDING_MAPPING` → else 400
2. Verify all required fields are mapped → else 400
3. Apply mapping to each `ImportRow.rawDataJson`
4. Validate each row against module-specific rules
5. Update each `ImportRow` status to `VALID` or `INVALID` (with errorMessage)
6. Update `ImportBatch` status to `VALIDATED`

**Validation rules per module**:

| Module | Field | Rule |
|--------|-------|------|
| SUPPLIERS | `name` | Required, non-empty, max 255 chars |
| SUPPLIERS | `phone` | Optional, valid phone pattern if present |
| CUSTOMERS | Same as SUPPLIERS |
| PRODUCTS | `name` | Required, non-empty, max 255 chars |
| PRODUCTS | `sku` | Optional, alphanumeric + hyphens if present |
| OPENING_BALANCES | `accountName` | Required, must match existing payment account name |
| OPENING_BALANCES | `amount` | Required, must be integer ≥ 0 |

**Response** (200):
```json
{
  "id": "uuid",
  "status": "VALIDATED",
  "totalRows": 250,
  "validRows": 245,
  "invalidRows": 5,
  "errors": [
    { "rowNumber": 12, "field": "name", "error": "Name is required", "value": "" }
  ],
  "preview": [
    {
      "rowNumber": 1,
      "data": { "name": "ABC Suppliers", "phone": "+92-300-1234567" },
      "status": "VALID"
    }
  ]
}
```

---

#### EP-13: Commit Import

**`POST /api/v1/imports/:id/commit`**

| Field | Type | Required | Default |
|-------|------|----------|---------|
| `skipInvalidRows` | boolean | No | `true` |

**Process**:
1. Verify batch status = `VALIDATED` → else 400
2. Update batch status → `PROCESSING`
3. Begin Prisma `$transaction`
4. For each row where status = `VALID`:
   - Create the entity (Supplier/Customer/Product/PaymentAccount)
   - Update `ImportRow`: `status = SUCCESS`, `createdRecordId`, `createdRecordType`
5. If `skipInvalidRows = false` and any row is `INVALID` → abort (400)
6. Update batch: `status = COMPLETED`, `successRows`, `failedRows`
7. Commit

**Duplicate handling**:
- SUPPLIERS/CUSTOMERS: Skip if `(tenant_id, name)` already exists (mark row as `FAILED` with `"Duplicate name"`)
- PRODUCTS: Skip if `(tenant_id, sku)` already exists (when sku is non-null)
- OPENING_BALANCES: Update `opening_balance` on existing payment account (upsert behavior)

**Response** (200):
```json
{
  "id": "uuid",
  "status": "COMPLETED",
  "totalRows": 250,
  "successRows": 245,
  "failedRows": 5,
  "skippedRows": 5,
  "createdRecords": [
    {
      "rowNumber": 1,
      "recordId": "uuid",
      "recordType": "SUPPLIER"
    }
  ],
  "completedAt": "2026-02-20T10:15:00.000Z"
}
```

---

#### EP-14: Rollback Import

**`POST /api/v1/imports/:id/rollback`**

**Process**:
1. Verify batch status = `COMPLETED` → else 400
2. For each `ImportRow` where `status = SUCCESS` and `createdRecordId IS NOT NULL`:
   - Check if the created record has dependencies (transactions referencing it) → if yes, abort with 409
3. Begin Prisma `$transaction`
4. Delete all created records (soft-delete: set `status = INACTIVE` if applicable, or hard-delete if no FK references)
5. Update each `ImportRow` status back to `VALID`
6. Update batch status → `ROLLED_BACK`
7. Commit

**Error cases**:
- Batch not `COMPLETED` → 400
- Any created record has transactions → 409 `Cannot rollback: records have dependencies`

**Response** (200):
```json
{
  "id": "uuid",
  "status": "ROLLED_BACK",
  "rolledBackCount": 245,
  "rolledBackAt": "2026-02-20T11:00:00.000Z"
}
```

---

#### EP-15: List Import Batches

**`GET /api/v1/imports`**

| Param | Type | Required | Default |
|-------|------|----------|---------|
| `module` | string (query) | No | all |
| `status` | string (query) | No | all |
| `page` | int (query) | No | 1 |
| `limit` | int (query) | No | 20 |

**Response** (200): Paginated list of import batches with metadata.

---

#### EP-16: Get Import Batch Detail

**`GET /api/v1/imports/:id`**

Returns batch info + paginated `importRows` with their statuses.

---

### 4.5 Tests — Phase 7C

**File**: `backend/test/integration/imports.integration.spec.ts`

| # | Test Case |
|---|-----------|
| 1 | Upload CSV creates batch with PENDING_MAPPING status |
| 2 | Upload XLSX creates batch correctly |
| 3 | Upload rejects unsupported file type (400) |
| 4 | Upload rejects file > 10MB (400) |
| 5 | Upload rejects unknown module (400) |
| 6 | Upload detects column headers correctly |
| 7 | Map columns validates required fields mapped |
| 8 | Map columns rejects if batch not PENDING_MAPPING |
| 9 | Map columns validates each row and reports errors |
| 10 | Map columns updates batch to VALIDATED |
| 11 | Commit creates supplier records from valid rows |
| 12 | Commit creates customer records from valid rows |
| 13 | Commit creates product records from valid rows |
| 14 | Commit skips invalid rows when skipInvalidRows=true |
| 15 | Commit aborts when skipInvalidRows=false and invalid rows exist |
| 16 | Commit rejects if batch not VALIDATED |
| 17 | Commit handles duplicate names (skip as FAILED) |
| 18 | Commit sets createdRecordId on import rows |
| 19 | Rollback deletes created records when no dependencies |
| 20 | Rollback returns 409 when records have transactions |
| 21 | Rollback rejects if batch not COMPLETED |
| 22 | Rollback sets batch status to ROLLED_BACK |
| 23 | List batches with module filter |
| 24 | List batches with status filter |
| 25 | Get batch detail includes import rows |
| 26 | Tenant isolation on all import endpoints |
| 27 | OPENING_BALANCES import updates payment account opening balance |

**Estimated test count**: ~27 tests

### 4.6 Validation Gate — Phase 7C

```
□ Prisma migration for new enum values applied
□ ImportsModule registered in AppModule
□ File upload (CSV + XLSX) working
□ Column mapping → validation → commit flow works end-to-end
□ Rollback works for records without dependencies
□ Rollback blocked for records with dependencies (409)
□ All ~27 tests passing
□ No TypeScript errors
□ Swagger docs for all import endpoints
□ All previous tests still passing
```

---

## 5. Phase 7D — Production Hardening

### 5.1 Overview

This sub-phase has **no new business logic endpoints**. It focuses on making the application production-ready following 12-factor app methodology, with concrete deliverables across containerization, security, performance, monitoring, deployment, and documentation.

---

### 5.2 Containerization & Infrastructure

#### D-1: Dockerfile

```dockerfile
# Multi-stage build
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json package-lock.json ./
RUN npm ci
COPY . .
RUN npx prisma generate
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/prisma ./prisma
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -q --spider http://localhost:3000/api/v1/health || exit 1
CMD ["node", "dist/main.js"]
```

**File**: `backend/Dockerfile`

---

#### D-2: .dockerignore

```
node_modules
dist
.env
*.spec.ts
test/
.git
Documentation/
```

**File**: `backend/.dockerignore`

---

#### D-3: docker-compose.yml (Development)

```yaml
services:
  db:
    image: postgres:14-alpine
    environment:
      POSTGRES_USER: finance
      POSTGRES_PASSWORD: finance_dev
      POSTGRES_DB: finance_system
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U finance"]
      interval: 10s
      timeout: 5s
      retries: 5

  app:
    build: ./backend
    ports:
      - "3000:3000"
    environment:
      DATABASE_URL: postgresql://finance:finance_dev@db:5432/finance_system
      JWT_SECRET: dev-secret-change-in-prod
      NODE_ENV: development
    depends_on:
      db:
        condition: service_healthy

volumes:
  pgdata:
```

**File**: `docker-compose.yml` (project root)

---

#### D-4: docker-compose.prod.yml (Production Template)

```yaml
services:
  db:
    image: postgres:14-alpine
    environment:
      POSTGRES_USER: ${DB_USER}
      POSTGRES_PASSWORD: ${DB_PASSWORD}
      POSTGRES_DB: ${DB_NAME}
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${DB_USER}"]
      interval: 10s
      timeout: 5s
      retries: 5
    restart: unless-stopped

  app:
    build: ./backend
    ports:
      - "${PORT:-3000}:3000"
    environment:
      DATABASE_URL: postgresql://${DB_USER}:${DB_PASSWORD}@db:5432/${DB_NAME}?connection_limit=20&pool_timeout=20
      JWT_SECRET: ${JWT_SECRET}
      NODE_ENV: production
    depends_on:
      db:
        condition: service_healthy
    restart: unless-stopped
    deploy:
      resources:
        limits:
          memory: 512M

volumes:
  pgdata:
```

**File**: `docker-compose.prod.yml` (project root)

---

### 5.3 Graceful Shutdown & Process Management

#### D-5: Graceful Shutdown

Modify `backend/src/main.ts`:

```typescript
app.enableShutdownHooks();
```

NestJS will handle SIGTERM/SIGINT and close connections cleanly. Prisma's `$disconnect` is called via `onModuleDestroy` in PrismaService.

Verify PrismaService implements `OnModuleDestroy`:
```typescript
async onModuleDestroy() {
  await this.$disconnect();
}
```

**Startup target**: Application must start in < 10 seconds.

---

### 5.4 Configuration & Environment

#### D-6: .env.example

```env
# ──────────────────────────────────────────────────────
# Application
# ──────────────────────────────────────────────────────
NODE_ENV=development
PORT=3000
API_PREFIX=api/v1
CORS_ORIGIN=http://localhost:3000

# ──────────────────────────────────────────────────────
# Database
# ──────────────────────────────────────────────────────
DATABASE_URL=postgresql://user:password@localhost:5432/finance_system?connection_limit=10&pool_timeout=20

# ──────────────────────────────────────────────────────
# Authentication
# ──────────────────────────────────────────────────────
JWT_SECRET=change-me-in-production
JWT_EXPIRES_IN=1h
JWT_REFRESH_EXPIRES_IN=7d

# ──────────────────────────────────────────────────────
# Rate Limiting
# ──────────────────────────────────────────────────────
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=100

# ──────────────────────────────────────────────────────
# File Upload (Import System)
# ──────────────────────────────────────────────────────
MAX_FILE_SIZE_MB=10
MAX_IMPORT_ROWS=10000

# ──────────────────────────────────────────────────────
# Logging
# ──────────────────────────────────────────────────────
LOG_LEVEL=info
# LOG_FORMAT=json  (default in production)
```

**File**: `backend/.env.example`

---

#### D-7: Database Connection Pooling

Prisma 6.x handles connection pooling via the query engine. The `DATABASE_URL` in `.env.example` includes:
- `connection_limit=10` — max connections per Prisma Client instance
- `pool_timeout=20` — seconds to wait for a connection from pool

Production recommendation: `connection_limit=20` for single-instance, adjust based on load.

---

### 5.5 Health Check Enhancement

#### D-8: Enhanced Health Endpoint

Extend existing `/health` endpoint to return:

```json
{
  "status": "ok",
  "uptime": 3600,
  "version": "1.0.0",
  "database": "connected",
  "timestamp": "2026-02-20T10:00:00.000Z"
}
```

The enhanced health check serves as the **load balancer health check target** for production deployments.

---

### 5.6 Security Hardening

#### D-9: Production Security Audit & Fixes

| Item | Status | Action Required |
|------|--------|-----------------|
| Helmet.js (security headers) | ✅ Done (Phase 1) | Verify headers in production mode |
| Rate limiting (global) | ✅ Done (Phase 1) | Already in `main.ts` |
| CORS with whitelist | ✅ Done (Phase 1) | Configurable via `CORS_ORIGIN` env |
| Input validation | ✅ Done (Phase 1) | Global ValidationPipe with whitelist |
| JWT authentication | ✅ Done (Phase 1) | Global JwtAuthGuard |
| Tenant isolation | ✅ Done (Phase 1) | Global TenantScopeGuard |
| SQL injection protection | ✅ Done | Prisma parameterized queries + `$queryRaw` with tagged templates |
| Structured logging (JSON) | ✅ Done (Phase 1) | Winston JSON format to stdout |
| API versioning | ✅ Done (Phase 1) | `/api/v1` prefix |
| Request body size limit | 🔲 **Add** | `express.json({ limit: '1mb' })` in `main.ts` |
| File upload size limit | 🔲 **Add** | Multer config `limits: { fileSize: 10 * 1024 * 1024 }` in imports controller |
| HTTPS enforcement | 🔲 **Document** | Handled at reverse proxy level (nginx/ALB), document in deployment guide |
| Brute force protection | ✅ Covered | Rate limiting covers this; login endpoint under global rate limit |

**Action items**:
1. Add `express.json({ limit: '1mb' })` to `main.ts`
2. Ensure import file upload size limit is enforced via Multer config
3. Document HTTPS requirement in deployment guide

---

### 5.7 Performance Optimization

#### D-10: Query Performance Verification

All report queries (Phase 7A) use `$queryRaw` with indexed columns. Verify against existing schema indexes:

| Query | Index Used |
|-------|-----------|
| Supplier balance | `ledger_entries(tenant_id, supplier_id, transaction_date)` |
| Customer balance | `ledger_entries(tenant_id, customer_id, transaction_date)` |
| Payment account balance | `payment_entries(tenant_id, payment_account_id, transaction_date)` |
| Product stock | `inventory_movements(tenant_id, product_id, transaction_date)` |
| Pending receivables | `ledger_entries(tenant_id, customer_id, ...)` + `allocations(tenant_id, applies_to_transaction_id)` |
| Pending payables | `ledger_entries(tenant_id, supplier_id, ...)` + `allocations(tenant_id, applies_to_transaction_id)` |
| Statements | Same ledger/payment indexes with date range |

**Action items**:
1. Run `EXPLAIN ANALYZE` on each report query with sample data to verify index usage
2. Verify no N+1 patterns exist in report/dashboard service code (all queries are raw SQL, so N+1 risk is minimal)
3. Dashboard uses `Promise.all` for parallel sub-queries (no serial dependency)

#### Performance Targets

| Category | Target |
|----------|--------|
| Health endpoint | < 100ms |
| Balance/stock reports | < 150ms |
| Statement queries | < 300ms |
| Pending receivables/payables | < 500ms |
| Dashboard summary | < 2 seconds |
| Import commit (1000 rows) | < 30 seconds |
| Application startup | < 10 seconds |
| Database connection pool | 10–50 connections |
| Max query timeout | 5 seconds |
| Max transaction time | 10 seconds |

#### Scalability Targets (V1)

| Metric | Target |
|--------|--------|
| Concurrent users | 100 |
| Transactions/day | 1,000 |
| Transactions/tenant | 100,000 |
| Tenants | 100 |

---

### 5.8 Logging Standards

#### D-11: Logging Configuration

Winston is already configured for JSON output to stdout (Phase 1). Verify these standards:

**Log levels**:
- `error` — Unrecoverable failures, unhandled exceptions
- `warn` — Recoverable issues (retries, fallbacks, deprecated usage)
- `info` — Request/response lifecycle, business events (transaction posted, import committed)
- `debug` — SQL queries, intermediate state (development only)

**What to log**:
- Every HTTP request (method, path, status, duration) — ✅ already done via LoggingInterceptor
- Transaction lifecycle events (draft created, posted, voided)
- Import lifecycle events (uploaded, mapped, validated, committed, rolled back)
- Authentication events (login, token refresh, failed attempts)
- Errors with stack traces

**What NOT to log**:
- Passwords, JWT tokens, or secrets
- Full request/response bodies (log only summaries)
- PII beyond what's needed for debugging

**Production**: Logs go to stdout/stderr → external aggregation (CloudWatch, ELK, etc.). No file-based logging.

---

### 5.9 Monitoring & Observability

#### D-12: Monitoring Instrumentation

For V1, monitoring is implemented as **structured log events** that can be consumed by any log aggregation service. Full APM/Prometheus/Sentry integration is deferred to post-V1 but the hooks are in place.

**Business metrics (logged as structured events)**:

| Metric | Trigger | Log Level |
|--------|---------|-----------|
| `transaction.posted` | PostingService completes | `info` |
| `import.committed` | Import batch committed | `info` |
| `import.rolled_back` | Import batch rolled back | `info` |
| `dashboard.loaded` | Dashboard endpoint completes | `info` (with duration) |
| `report.generated` | Any report endpoint completes | `info` (with duration) |

**Implementation**: Add timing + structured log fields in interceptor or service methods. No new dependencies required.

**Post-V1 roadmap** (documented, not implemented):
- Prometheus metrics endpoint (`/metrics`)
- Sentry error tracking
- Distributed tracing (OpenTelemetry)
- PagerDuty/Slack alerting

---

### 5.10 Deployment & CI/CD

#### D-13: CI/CD Pipeline Configuration

**File**: `.github/workflows/ci.yml`

```yaml
name: CI
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:14-alpine
        env:
          POSTGRES_USER: test
          POSTGRES_PASSWORD: test
          POSTGRES_DB: finance_test
        ports:
          - 5432:5432
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
          cache-dependency-path: backend/package-lock.json
      - run: cd backend && npm ci
      - run: cd backend && npx prisma generate
      - run: cd backend && npx prisma migrate deploy
        env:
          DATABASE_URL: postgresql://test:test@localhost:5432/finance_test
      - run: cd backend && npm run build
      - run: cd backend && npm test
        env:
          DATABASE_URL: postgresql://test:test@localhost:5432/finance_test
          JWT_SECRET: ci-test-secret

  docker:
    runs-on: ubuntu-latest
    needs: test
    steps:
      - uses: actions/checkout@v4
      - run: docker build -t finance-system ./backend
```

#### D-14: Database Migration Automation

Ensure `npx prisma migrate deploy` runs as part of:
1. CI pipeline (before tests)
2. Docker entrypoint (or init container in production)
3. docker-compose startup sequence

**Migration strategy**: Always use `migrate deploy` (not `migrate dev`) in CI/production. `migrate dev` is for local development only.

---

### 5.11 Backup & Recovery

#### D-15: Database Backup Scripts

**File**: `scripts/backup-db.sh`

```bash
#!/bin/bash
# Usage: ./scripts/backup-db.sh [output_dir]
set -euo pipefail

BACKUP_DIR="${1:-./backups}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
FILENAME="finance_backup_${TIMESTAMP}.sql.gz"

mkdir -p "$BACKUP_DIR"

pg_dump "$DATABASE_URL" | gzip > "${BACKUP_DIR}/${FILENAME}"

echo "Backup created: ${BACKUP_DIR}/${FILENAME}"
```

**File**: `scripts/restore-db.sh`

```bash
#!/bin/bash
# Usage: ./scripts/restore-db.sh <backup_file>
set -euo pipefail

BACKUP_FILE="${1:?Backup file required}"

if [[ ! -f "$BACKUP_FILE" ]]; then
  echo "Error: File not found: $BACKUP_FILE"
  exit 1
fi

gunzip -c "$BACKUP_FILE" | psql "$DATABASE_URL"

echo "Restore complete from: $BACKUP_FILE"
```

**Backup recommendations** (documented, not automated in V1):
- Daily automated backups via cron or cloud scheduler
- Point-in-time recovery via PostgreSQL WAL archiving (cloud-managed DBs provide this)
- Test restore procedure monthly
- Retain backups for 30 days minimum

---

### 5.12 12-Factor Compliance Checklist

| Factor | Requirement | Status |
|--------|-------------|--------|
| I. Codebase | Single repo, same code all environments | ✅ Git repo |
| II. Dependencies | Explicit in package.json, lock file committed | ✅ package-lock.json |
| III. Config | All config via env vars | ✅ ConfigService + .env.example |
| IV. Backing Services | DB as attached resource via URL | ✅ DATABASE_URL |
| V. Build, Release, Run | Strict separation via Docker multi-stage | ✅ Dockerfile |
| VI. Processes | Stateless, no local session storage | ✅ JWT (stateless auth) |
| VII. Port Binding | Self-contained, exports HTTP via port | ✅ NestJS listen(PORT) |
| VIII. Concurrency | Horizontal scale via process model | ✅ Stateless enables this |
| IX. Disposability | Fast startup, graceful shutdown | 🔲 Add `enableShutdownHooks()` |
| X. Dev/Prod Parity | Same DB type, same backing services | ✅ Docker standardizes |
| XI. Logs | Structured JSON to stdout | ✅ Winston |
| XII. Admin Processes | Migrations via CLI, same codebase | ✅ `prisma migrate deploy` |

---

### 5.13 Tests — Phase 7D

**File**: `backend/test/integration/hardening.integration.spec.ts`

| # | Test Case |
|---|-----------|
| 1 | Health endpoint returns uptime, version, database status, and timestamp |
| 2 | Graceful shutdown: PrismaService.onModuleDestroy disconnects cleanly |
| 3 | Request body > 1MB rejected (413) |
| 4 | Application starts in < 10 seconds |
| 5 | Structured log output is valid JSON |
| 6 | Docker build succeeds (manual / CI verification) |

**Estimated test count**: ~6 tests

### 5.14 Validation Gate — Phase 7D

```
□ Dockerfile builds successfully
□ docker-compose up starts app + db (both dev and prod variants)
□ Graceful shutdown works (kill -SIGTERM → clean exit)
□ Application starts in < 10 seconds
□ .env.example documents ALL config variables
□ Health check returns uptime + version + database status
□ Request body size limit enforced (1MB)
□ File upload size limit enforced (10MB)
□ CI/CD pipeline config committed (.github/workflows/ci.yml)
□ Backup/restore scripts committed and tested manually
□ 12-factor compliance checklist all green
□ EXPLAIN ANALYZE verified on report queries
□ All ~6 new tests passing
□ All previous tests still passing
□ npm run build clean
□ Logs are structured JSON to stdout
```

---

## 6. Schema Changes Summary

| Sub-phase | Schema Change | Migration Required |
|-----------|--------------|-------------------|
| 7A | None | No |
| 7B | None | No |
| 7C | Add `PENDING_MAPPING`, `VALIDATED`, `ROLLED_BACK` to `ImportStatus`; Add `PENDING`, `VALID`, `INVALID` to `ImportRowStatus` | **Yes** |
| 7D | None | No |

**Total migrations**: 1 (in Phase 7C only)

---

## 7. Cross-cutting Concerns

### 7.1 Swagger Documentation

Every new endpoint must include:
- `@ApiTags()` group
- `@ApiOperation({ summary })`
- `@ApiResponse()` for 200, 400, 401, 404, 409
- `@ApiBearerAuth()`
- Response type decorators

### 7.2 Tenant Isolation

Every new service method must:
1. Call `getContext()?.tenantId`
2. Throw `UnauthorizedException` if missing
3. Include `tenant_id` in every SQL query

### 7.3 Error Handling

Follow existing patterns:
- `NotFoundException` — entity not found or cross-tenant access
- `BadRequestException` — validation failures, wrong status transitions
- `ConflictException` — dependency conflicts (rollback blocked)
- `PayloadTooLargeException` — request body or file exceeds size limit
- `UnauthorizedException` — missing tenant context

**Error response format** (already enforced by global HttpExceptionFilter):
```json
{
  "statusCode": 400,
  "message": "Validation failed",
  "errors": [{ "field": "name", "message": "Name is required" }],
  "timestamp": "2026-02-20T10:00:00.000Z",
  "path": "/api/v1/imports/uuid/map",
  "requestId": "uuid"
}
```

### 7.4 Test Factory Additions

Add to `test-factories.ts`:
- `createAndPostSale(app, token, opts)` — if not already present
- `createAndPostSupplierPayment(app, token, opts)` — if not already present
- `createAndPostCustomerPayment(app, token, opts)` — if not already present
- `createCsvBuffer(headers, rows)` — creates in-memory CSV for upload tests
- `createXlsxBuffer(headers, rows)` — creates in-memory XLSX for upload tests

---

## 8. Full Endpoint Inventory

### New Endpoints (Phase 7)

| # | Method | Path | Sub-phase | Module |
|---|--------|------|-----------|--------|
| 1 | GET | `/api/v1/reports/suppliers/:id/balance` | 7A | Reports |
| 2 | GET | `/api/v1/reports/customers/:id/balance` | 7A | Reports |
| 3 | GET | `/api/v1/reports/payment-accounts/:id/balance` | 7A | Reports |
| 4 | GET | `/api/v1/reports/products/:id/stock` | 7A | Reports |
| 5 | GET | `/api/v1/reports/pending-receivables` | 7A | Reports |
| 6 | GET | `/api/v1/reports/pending-payables` | 7A | Reports |
| 7 | GET | `/api/v1/reports/suppliers/:id/statement` | 7A | Reports |
| 8 | GET | `/api/v1/reports/customers/:id/statement` | 7A | Reports |
| 9 | GET | `/api/v1/reports/payment-accounts/:id/statement` | 7A | Reports |
| 10 | GET | `/api/v1/dashboard/summary` | 7B | Dashboard |
| 11 | POST | `/api/v1/imports` | 7C | Imports |
| 12 | POST | `/api/v1/imports/:id/map` | 7C | Imports |
| 13 | POST | `/api/v1/imports/:id/commit` | 7C | Imports |
| 14 | POST | `/api/v1/imports/:id/rollback` | 7C | Imports |
| 15 | GET | `/api/v1/imports` | 7C | Imports |
| 16 | GET | `/api/v1/imports/:id` | 7C | Imports |

**Total new endpoints**: 16

### New Modules

| Module | Sub-phase | Registered In |
|--------|-----------|---------------|
| `ReportsModule` | 7A | `AppModule` |
| `DashboardModule` | 7B | `AppModule` |
| `ImportsModule` | 7C | `AppModule` |

---

## 9. Acceptance Criteria (All Sub-phases)

### Phase 7 Complete When ALL True:

**Functionality**:
- [ ] All 9 canonical query endpoints return accurate data with `asOfDate` support
- [ ] Dashboard summary loads with all 5 sections populated
- [ ] Full import flow works: upload → map → validate → commit
- [ ] Import rollback works for records without dependencies
- [ ] Import rollback blocked (409) for records with transactions
- [ ] Import commit response includes `createdRecords` array with `rowNumber`, `recordId`, `recordType`

**Performance**:
- [ ] Health endpoint < 100ms
- [ ] Balance/stock reports < 150ms
- [ ] Statement queries < 300ms
- [ ] Pending receivables/payables < 500ms
- [ ] Dashboard endpoint < 2 seconds
- [ ] Import of 1000 rows commits in < 30 seconds
- [ ] Application starts in < 10 seconds
- [ ] All report queries use indexed columns (verified via EXPLAIN ANALYZE)
- [ ] No N+1 query patterns in service code

**Quality**:
- [ ] All new tests passing (~68 estimated: 26 + 9 + 27 + 6)
- [ ] All existing 341 tests still passing (zero regressions)
- [ ] No TypeScript errors (`npm run build` clean)
- [ ] Swagger documentation complete for all 16 new endpoints
- [ ] Structured logs are valid JSON to stdout

**Production Readiness**:
- [ ] Dockerfile builds and runs successfully
- [ ] docker-compose.yml starts full stack (dev + prod variants)
- [ ] Graceful shutdown implemented (`enableShutdownHooks`)
- [ ] PrismaService implements `onModuleDestroy`
- [ ] `.env.example` documents ALL config variables
- [ ] Request body size limit enforced (1MB)
- [ ] File upload size limit enforced (10MB)
- [ ] Health check returns version + uptime + database status
- [ ] CI/CD pipeline config committed
- [ ] Backup/restore scripts committed
- [ ] 12-factor compliance checklist all green

**Documentation**:
- [ ] This implementation plan (IMPLEMENTATION_PLAN_PHASE_7.md) complete and followed
- [ ] AGENTS.md Phase 7 status updated to ✅ Complete
- [ ] Progress report written (Documentation/progress/)
- [ ] Deployment guide (Documentation/docs/deployment-guide.md)
- [ ] Import user guide (Documentation/docs/import-guide.md)
- [ ] All code committed with proper messages

---

## Appendix: Execution Order

```
Phase 7A (Reports)     ─────────────────┐
                                         ├─→ Phase 7D (Hardening)
Phase 7B (Dashboard)   ─────────────────┤
                                         │
Phase 7C (Imports)     ─────────────────┘

7A → 7B (7B depends on report query patterns)
7C can be done in parallel with 7A/7B
7D is last (after all business logic is complete)
```

**Recommended sequence**: 7A → 7B → 7C → 7D

This keeps the maximum number of tests green at each step and builds knowledge progressively (queries → aggregation → file I/O → infra).
