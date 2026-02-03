# Data Model (Full Specification)

This document is the single source of truth for the Finance System data model. It includes tables, fields, defaults, constraints, indexes, and canonical queries.

## ERD

![Finance System ERD](Documentation/Financial%20System/ERD%20+%20Explanation/Blank_diagram.svg)

## Conventions (Apply to All Tables)

- Every table has: `id (uuid)`, `tenant_id (uuid)`, `created_at`, `updated_at`.
- Money is stored as integer PKR (no floats).
- Quantities are integers (whole units only).
- Optional audit fields: `created_by (uuid -> users.id)`, `source`, `notes`.

## Domain Modules (Logical Grouping)

1. Company and Users (Identity)
2. Core Records (Master Data)
3. Transactions (Events)
4. Transaction Items (Lines)
5. Posting Outputs (System Truth Tables)
6. Payment Allocation
7. Imports and Audit

## Standard Types (Fixed Lists Used Everywhere)

### Transaction Types

- PURCHASE
- SALE
- SUPPLIER_PAYMENT
- CUSTOMER_PAYMENT
- SUPPLIER_RETURN
- CUSTOMER_RETURN
- INTERNAL_TRANSFER
- ADJUSTMENT (reserved, not V1)

### Inventory Movement Types

- PURCHASE_IN
- SALE_OUT
- SUPPLIER_RETURN_OUT
- CUSTOMER_RETURN_IN
- ADJUSTMENT_IN
- ADJUSTMENT_OUT

### Ledger Entry Types

- AP_INCREASE
- AP_DECREASE
- AR_INCREASE
- AR_DECREASE

### Payment Entry Types

- MONEY_IN
- MONEY_OUT
- TRANSFER (two-leg internal movement)

### Document Status

- DRAFT
- POSTED
- VOIDED (reserved for V1.1)

Rule: Only POSTED transactions affect stock and balances.

## Cost Method (V1)

Weighted Average Costing is used in V1.

- Purchase line cost is the truth (qty, unit_cost, total cost).
- Product `avg_cost` is cached for speed but must be rebuildable from purchase history.

Example:

- Buy 50 @ 1,000 = 50,000
- Buy 50 @ 1,500 = 75,000
- Total stock 100, total cost 125,000
- Average cost = 125,000 / 100 = 1,250

## Tables and Fields (With Defaults, Constraints, and Indexes)

### A) Identity

#### 1) `tenants`

Fields:

- `id` uuid PK
- `name` text not null
- `base_currency` text not null default 'PKR'
- `timezone` text not null default 'Asia/Karachi'
- `status` text not null default 'ACTIVE'
- `created_at` timestamps not null default now()
- `updated_at` timestamps not null default now()

Constraints:

- CHECK base_currency = 'PKR'

#### 2) `users`

Fields:

- `id` uuid PK
- `tenant_id` uuid FK -> tenants.id (on delete restrict)
- `full_name` text not null
- `email` text not null
- `password_hash` text not null
- `role` text not null default 'OWNER'
- `status` text not null default 'ACTIVE'
- `last_login_at` timestamps null
- `created_at`, `updated_at`

Constraints:

- UNIQUE (tenant_id, email)

### B) Master Data

#### 3) `suppliers`

Fields:

- `id` uuid PK
- `tenant_id` uuid FK -> tenants.id
- `name` text not null
- `phone` text null
- `address` text null
- `notes` text null
- `status` text not null default 'ACTIVE'
- `created_by` uuid FK -> users.id null
- `created_at`, `updated_at`

Constraints / Indexes:

- INDEX (tenant_id, name)

#### 4) `customers`

Fields:

- `id` uuid PK
- `tenant_id` uuid FK -> tenants.id
- `name` text not null
- `phone` text null
- `address` text null
- `notes` text null
- `status` text not null default 'ACTIVE'
- `created_by` uuid FK -> users.id null
- `created_at`, `updated_at`

Constraints / Indexes:

- INDEX (tenant_id, name)

#### 5) `products`

Fields:

- `id` uuid PK
- `tenant_id` uuid FK -> tenants.id
- `name` text not null
- `sku` text null
- `category` text null
- `unit` text null default 'piece'
- `status` text not null default 'ACTIVE'
- `avg_cost` int not null default 0
- `created_by` uuid FK -> users.id null
- `created_at`, `updated_at`

Constraints / Indexes:

- UNIQUE (tenant_id, sku) where sku is not null
- INDEX (tenant_id, name)

#### 6) `payment_accounts`

Fields:

- `id` uuid PK
- `tenant_id` uuid FK -> tenants.id
- `name` text not null
- `type` text not null (CASH/BANK/WALLET/CARD)
- `status` text not null default 'ACTIVE'
- `opening_balance` int not null default 0
- `created_by` uuid FK -> users.id null
- `created_at`, `updated_at`

Constraints:

- UNIQUE (tenant_id, name)

### C) Transactions

#### 7) `transactions`

Fields:

- `id` uuid PK
- `tenant_id` uuid FK -> tenants.id

Classification:

- `type` text not null (PURCHASE, SALE, SUPPLIER_PAYMENT, CUSTOMER_PAYMENT, SUPPLIER_RETURN, CUSTOMER_RETURN, INTERNAL_TRANSFER, ADJUSTMENT)
- `status` text not null default 'DRAFT' (DRAFT/POSTED/VOIDED)

Document numbering:

- `series` text null
- `document_number` text null (required when posted)

Dates:

- `transaction_date` date not null
- `posted_at` timestamptz null

Party links:

- `supplier_id` uuid null FK -> suppliers.id
- `customer_id` uuid null FK -> customers.id

Totals:

- `subtotal` int not null default 0
- `discount_total` int not null default 0
- `delivery_fee` int not null default 0
- `total_amount` int not null default 0

Payment summary:

- `paid_now` int not null default 0

Delivery (SALE only):

- `delivery_type` text null (STORE_PICKUP / HOME_DELIVERY)
- `delivery_address` text null
- `delivered_by` text null
- `delivery_notes` text null

Internal transfer (INTERNAL_TRANSFER only):

- `from_payment_account_id` uuid null FK -> payment_accounts.id
- `to_payment_account_id` uuid null FK -> payment_accounts.id

Idempotency:

- `idempotency_key` text null

Void fields:

- `void_reason` text null
- `voided_at` timestamptz null
- `voided_by` uuid null FK -> users.id

Audit:

- `created_by` uuid null FK -> users.id
- `notes` text null
- `source` text null (UI/API/IMPORT)
- `created_at`, `updated_at`

Constraints:

- UNIQUE (tenant_id, type, series, document_number) where document_number is not null
- UNIQUE (tenant_id, idempotency_key) where idempotency_key is not null
- CHECK (paid_now >= 0 and subtotal >= 0 and total_amount >= 0)
- CHECK (from_payment_account_id is null OR to_payment_account_id is null OR from_payment_account_id <> to_payment_account_id)

Indexes:

- (tenant_id, transaction_date)
- (tenant_id, type, status)

### D) Transaction Lines

#### 8) `transaction_lines`

Fields:

- `id` uuid PK
- `tenant_id` uuid FK -> tenants.id
- `transaction_id` uuid FK -> transactions.id (on delete restrict)
- `product_id` uuid FK -> products.id
- `description` text null
- `quantity` int not null
- `unit` text null

Pricing:

- `unit_price` int not null default 0
- `unit_cost` int not null default 0
- `discount_amount` int not null default 0
- `line_total` int not null default 0
- `cost_total` int not null default 0 (qty * unit_cost for purchases)

Strict returns linking:

- `source_transaction_line_id` uuid null FK -> transaction_lines.id

Audit:

- `created_by` uuid null FK -> users.id
- `created_at`, `updated_at`

Constraints:

- CHECK (quantity > 0)
- CHECK (unit_price >= 0 and unit_cost >= 0 and discount_amount >= 0 and line_total >= 0)
- INDEX (tenant_id, transaction_id)
- INDEX (tenant_id, source_transaction_line_id)

Note: source_transaction_line_id required for return types is enforced in backend (and optionally DB later).

### E) Posting Outputs (Truth Tables)

#### 9) `inventory_movements`

Fields:

- `id` uuid PK
- `tenant_id` uuid FK -> tenants.id
- `transaction_id` uuid FK -> transactions.id
- `transaction_line_id` uuid null FK -> transaction_lines.id
- `product_id` uuid FK -> products.id
- `movement_type` text not null (PURCHASE_IN, SALE_OUT, SUPPLIER_RETURN_OUT, CUSTOMER_RETURN_IN, ADJUSTMENT_IN, ADJUSTMENT_OUT)
- `quantity` int not null
- `unit_cost_at_time` int not null default 0
- `transaction_date` date not null
- `created_by` uuid null FK -> users.id
- `created_at`

Constraints:

- CHECK (quantity > 0)
- INDEX (tenant_id, product_id, transaction_date)

#### 10) `ledger_entries`

Fields:

- `id` uuid PK
- `tenant_id` uuid FK -> tenants.id
- `transaction_id` uuid FK -> transactions.id
- `entry_type` text not null (AP_INCREASE, AP_DECREASE, AR_INCREASE, AR_DECREASE)
- `supplier_id` uuid null FK -> suppliers.id
- `customer_id` uuid null FK -> customers.id
- `amount` int not null
- `transaction_date` date not null
- `notes` text null
- `created_by` uuid null FK -> users.id
- `created_at`

Constraints:

- CHECK (amount > 0)
- CHECK (
  (entry_type in ('AP_INCREASE','AP_DECREASE') AND supplier_id is not null AND customer_id is null)
  OR (entry_type in ('AR_INCREASE','AR_DECREASE') AND customer_id is not null AND supplier_id is null)
)
- INDEX (tenant_id, supplier_id, transaction_date)
- INDEX (tenant_id, customer_id, transaction_date)

#### 11) `payment_entries`

Fields:

- `id` uuid PK
- `tenant_id` uuid FK -> tenants.id
- `transaction_id` uuid FK -> transactions.id
- `payment_account_id` uuid FK -> payment_accounts.id
- `entry_type` text not null (MONEY_IN, MONEY_OUT, TRANSFER)
- `direction` text not null (IN, OUT)
- `amount` int not null
- `transfer_group_id` uuid null
- `transaction_date` date not null
- `supplier_id` uuid null FK -> suppliers.id
- `customer_id` uuid null FK -> customers.id
- `notes` text null
- `created_by` uuid null FK -> users.id
- `created_at`

Constraints:

- CHECK (amount > 0)
- INDEX (tenant_id, payment_account_id, transaction_date)
- INDEX (tenant_id, transfer_group_id)

### F) Allocations (Partial Payments)

#### 12) `allocations`

Fields:

- `id` uuid PK
- `tenant_id` uuid FK -> tenants.id
- `payment_transaction_id` uuid FK -> transactions.id
- `applies_to_transaction_id` uuid FK -> transactions.id
- `amount_applied` int not null
- `notes` text null
- `created_by` uuid null FK -> users.id
- `created_at`

Constraints:

- CHECK (amount_applied > 0)
- INDEX (tenant_id, payment_transaction_id)
- INDEX (tenant_id, applies_to_transaction_id)

Note: payment must be CUSTOMER_PAYMENT/SUPPLIER_PAYMENT is enforced in backend.

### G) Imports (Excel Migration)

#### 13) `import_batches`

Fields:

- `id` uuid PK
- `tenant_id` uuid FK -> tenants.id
- `source_type` text not null (CSV/EXCEL/MANUAL)
- `module` text not null (SUPPLIERS/CUSTOMERS/PRODUCTS/OPENING_BALANCES/TRANSACTIONS)
- `file_name` text null
- `status` text not null (PROCESSING/COMPLETED/FAILED)
- `total_rows` int not null default 0
- `success_rows` int not null default 0
- `failed_rows` int not null default 0
- `created_by` uuid null FK -> users.id
- `notes` text null
- `created_at`, `updated_at`

Indexes:

- (tenant_id, module, created_at)

#### 14) `import_rows`

Fields:

- `id` uuid PK
- `tenant_id` uuid FK -> tenants.id
- `import_batch_id` uuid FK -> import_batches.id
- `row_number` int not null
- `raw_data_json` jsonb not null
- `status` text not null (SUCCESS/FAILED)
- `error_message` text null
- `created_record_type` text null
- `created_record_id` uuid null
- `created_at`

Indexes:

- (tenant_id, import_batch_id, row_number)
- (tenant_id, import_batch_id, status)

## Relationships Summary (for ERD)

- tenants 1-* users
- tenants 1-* suppliers / customers / products / payment_accounts
- tenants 1-* transactions
- transactions 1-* transaction_lines
- transactions 1-* inventory_movements / ledger_entries / payment_entries
- transaction_lines *-1 products
- transaction_lines (returns) *-1 transaction_lines (source_transaction_line_id)
- allocations *-1 transactions (payment_transaction_id)
- allocations *-1 transactions (applies_to_transaction_id)
- import_batches 1-* import_rows

## Constraints (Global, Non-Negotiable)

### Tenant Isolation

- Every table must include `tenant_id` (NOT NULL).
- Every query must filter by tenant_id.

### Foreign Keys (No Orphans)

Examples:

- `transactions.tenant_id` -> `tenants.id`
- `transaction_lines.transaction_id` -> `transactions.id`
- `ledger_entries.transaction_id` -> `transactions.id`
- `payment_entries.payment_account_id` -> `payment_accounts.id`
- `inventory_movements.product_id` -> `products.id`
- `allocations.payment_transaction_id` -> `transactions.id`
- `allocations.applies_to_transaction_id` -> `transactions.id`

### Uniqueness Constraints

Document numbers (posted):

- Unique `(tenant_id, type, series, document_number)`

Idempotency:

Option 1: store on transactions

- `transactions.idempotency_key` nullable
- Unique `(tenant_id, idempotency_key)` when not null

Option 2: separate table

- `idempotency_keys(tenant_id, key, scope, created_at)`
- Unique `(tenant_id, scope, key)`

### Check Constraints

- Money fields: `amount >= 0`
- Quantity fields: `quantity > 0`
- Internal transfer: `from_payment_account_id != to_payment_account_id`
- Entry ownership rules:
  - AP entries require supplier_id and customer_id must be null
  - AR entries require customer_id and supplier_id must be null

### Posting Immutability

- If `status = POSTED`, block updates to header, lines, and outputs.
- Backend rule required; DB trigger optional later.

### Return Constraints (Strict Returns)

- For SUPPLIER_RETURN and CUSTOMER_RETURN lines:
  - `source_transaction_line_id` is required.
  - Return quantity cannot exceed remaining quantity on the original line:
    - original_qty - already_returned_qty

Enforcement: backend validation required; DB enforcement optional later.

## Indexes (Performance Rules)

Core query indexes:

- `ledger_entries(tenant_id, supplier_id, transaction_date)`
- `ledger_entries(tenant_id, customer_id, transaction_date)`
- `inventory_movements(tenant_id, product_id, transaction_date)`
- `payment_entries(tenant_id, payment_account_id, transaction_date)`
- `transactions(tenant_id, transaction_date)`
- `transactions(tenant_id, type, status)`

Highly recommended extra indexes:

- `allocations(tenant_id, payment_transaction_id)`
- `allocations(tenant_id, applies_to_transaction_id)`
- `transaction_lines(tenant_id, transaction_id)`
- `transaction_lines(tenant_id, source_transaction_line_id)`
- `transactions(tenant_id, type, series, document_number)`
- `payment_entries(tenant_id, transfer_group_id)`
- `import_batches(tenant_id, module, created_at)`
- `import_rows(tenant_id, import_batch_id, status)`

## Canonical Queries (Schema Proof)

These formulas are the system's official truth. All UI, reports, and APIs must use them.

### Supplier Balance (AP)

Supplier Balance = sum(AP_INCREASE) - sum(AP_DECREASE)

Filters:

- tenant_id
- supplier_id
- entry types: AP_INCREASE, AP_DECREASE
- posted transactions only
- optional date range

Result meaning:

- Positive: you owe supplier
- Zero: settled
- Negative: supplier credit

### Customer Balance (AR)

Customer Balance = sum(AR_INCREASE) - sum(AR_DECREASE)

Filters:

- tenant_id
- customer_id
- entry types: AR_INCREASE, AR_DECREASE
- posted transactions only
- optional date range

Result meaning:

- Positive: customer owes you
- Zero: settled
- Negative: customer credit

### Payment Account Balance

Account Balance = Opening Balance + sum(MONEY_IN) - sum(MONEY_OUT)

Filters:

- tenant_id
- payment_account_id
- entry types: MONEY_IN, MONEY_OUT
- posted transactions only
- optional date range

Transfers are covered automatically (one MONEY_OUT and one MONEY_IN).

### Product Stock

Stock = sum(In Movements) - sum(Out Movements)

In movements:

- PURCHASE_IN
- CUSTOMER_RETURN_IN
- ADJUSTMENT_IN

Out movements:

- SALE_OUT
- SUPPLIER_RETURN_OUT
- ADJUSTMENT_OUT

Filters:

- tenant_id
- product_id
- posted transactions only
- optional date range

Result meaning:

- Must never be negative if negative stock is disabled.

### Pending Receivables Dashboard

For each customer:

Customer Pending = Customer Balance (AR)

Show only customers where balance > 0.

Optional columns:

- total sales
- total received
- last transaction date
- overdue buckets (later)

### Pending Payables Dashboard

For each supplier:

Supplier Pending = Supplier Balance (AP)

Show only suppliers where balance > 0.

Optional columns:

- total purchases
- total paid
- last transaction date

### Statements (Date Range + Running Balance)

Supplier statement:

Running Balance = Previous Balance + AP_INCREASE - AP_DECREASE

Customer statement:

Running Balance = Previous Balance + AR_INCREASE - AR_DECREASE

Payment account statement:

Running Balance = Previous Balance + MONEY_IN - MONEY_OUT

Each row includes date, document number, type, and running balance.

### Invoice/Bill Pending (Document-Level)

Outstanding = Total Amount - sum(Allocations Applied to this document)

Filter allocations by `applies_to_transaction_id`.

### Cross-check Query (Integrity Sanity)

- Stock per product equals sum of inventory movements.
- Customer balance equals sum of open invoices outstanding (when allocations are fully applied).
- Total money in - out across all payment accounts matches net settlement changes over time.

## Legacy Reference (Notion Source)

- ERD + Explanation: `Documentation/Financial System/ERD + Explanation 2fa91bf63390800f9d2ffcf6681aa503.md`
- Complete schema: `Documentation/Financial System/Data Model/Step 2 8 — Complete Data Model (Tables + Fields +  2fa91bf63390808cb765cd1003dbdb65.md`
- Constraints: `Documentation/Financial System/Data Model/2 6 Constraints & Indexes (Integrity + Performance 2fa91bf6339080fc8fc0ccdf10a8ae5e.md`
- Canonical queries: `Documentation/Financial System/Data Model/2 7 Canonical Queries (Schema Proof) 2fa91bf63390805fa068c1cd8d440ba7.md`
