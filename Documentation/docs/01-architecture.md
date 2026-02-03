# Architecture and Invariants

This document defines the system architecture, core invariants, and the accounting model. These rules are non-negotiable and must be enforced at the database and application layers.

## Architecture Overview

Finance System is event-sourced at the business level:

- A **Transaction** is the single source of truth for a business event.
- **Posting** converts a transaction into immutable system outputs (entries).
- **Balances and stock** are derived from those entries, never directly stored or mutated.

This prevents silent data corruption and ensures auditability.

## System Invariants (Non-Negotiables)

### 1) Truth Model (Accounting Engine)

- **Event -> Entries only**: Every business action creates a **Transaction (event)** and posts one or more **entries** (inventory/ledger/payment). No other code path is allowed to change balances.
- **Append-only entries**: `ledger_entries`, `payment_entries`, and `inventory_movements` are append-only. Posted entries are never edited in-place.
- **Balances are derived**: Supplier/Customer/Payment balances are computed from entries (snapshots/caches allowed only if fully rebuildable from entries).
- **Atomic posting**: Posting runs inside a single DB transaction — all entries created or none (no partial posting).
- **Idempotency**: All write endpoints are idempotent using an idempotency key per tenant, so duplicate requests can’t double-post.

### 2) Transaction Lifecycle & Document Semantics

- **Transaction states are explicit**: Draft -> Posted -> (Voided/Adjusted in later versions). V1 must at least support Draft/Posted.
- **No hard deletes for posted**:
  - Drafts can be deleted.
  - Posted cannot be deleted.
  - Voiding is the only way to negate posted impact (V1.1).
- **Void semantics are deterministic**:
  - A void must create reversal entries (preferred) or post a reversal transaction.
  - Voids require reason + actor + timestamp.
- **Stable document numbering**:
  - Every posted transaction has an immutable `document_number`.
  - Unique per tenant, per transaction type, per series.
  - Number gaps allowed (drafts/voids), duplicates never allowed.

### 3) Inventory Integrity & Costing

- **Inventory changes only via inventory movements** (Purchase In, Sale Out, Supplier Return Out, Customer Return In, Adjustment).
- **No negative stock** (default): System blocks any posting that would create negative stock unless explicitly enabled by tenant settings.
- **Concurrency-safe stock posting**: Sales posting must use a concurrency control method (row locks / optimistic versioning / atomic checks). If concurrent posting would violate stock policy, one transaction fails.
- **Cost basis captured at receipt**: Stock-in lines store cost details at the time of purchase (unit cost, qty, supplier, date). Returns must reference a cost basis method.
- **Cost method is a tenant-level invariant** (pick and lock for V1):
  - Weighted Average (V1)
  - FIFO (later)

### 4) Payment Accounts & Double-Entry Money Movement

- **Payment methods are real accounts**: Cash, JazzCash, Bank, Card are accounts with balances derived from `payment_entries`.
- **No floating money**: Every payment must identify:
  - the payment account used, and
  - what it settles (supplier/customer/expense) when applicable.
- **Internal transfer is always two-leg**:
  - from_account entry (negative)
  - to_account entry (positive)
  - linked by a shared transfer/group id

### 5) Settlement Allocation (Partial Payments)

- **Payments must be allocatable**: Every supplier/customer payment can be allocated to one or more open documents (purchase bills/sales invoices).
- **Unapplied amounts become credit**:
  - customer credit (you owe customer)
  - supplier credit (supplier owes you)
- **Allocation is explicit via a join table**:
  - `allocations(payment_entry_id, document_id, amount_applied)`
- **Deterministic allocation rules** (choose one and enforce it):
  - Manual allocation by user (V1-friendly)
  - Auto-allocation oldest-first (FIFO on invoices) with override

### 6) Referential Integrity & Auditability

- **No orphans ever**:
  - Every entry references the transaction event (`transaction_id`).
  - Lines reference product/customer/supplier as required.
- **Returns should reference origin** (strongly recommended, enforce where possible):
  - customer return references original sale line OR sale document
  - supplier return references original purchase line OR purchase document
- **Audit trail is mandatory**:
  - created_by, created_at, source (ui/api/import), notes
  - void_reason/voided_by/voided_at for voids

### 7) Period Closing / Backdating Control

- **Financial periods can be closed**:
  - No posting/voiding/adjusting transactions dated in a closed period.
  - Owner override allowed only with explicit audit trail (who/why/when).
- **Posting date vs transaction date is explicit**:
  - store `transaction_date` (business date)
  - store `posted_at` (system timestamp)

### 8) Currency & Money Storage Rules

- **Single-currency tenant (V1)**:
  - Tenant has a base currency (PKR).
  - All transactions/accounts/entries must use tenant currency only.
- **Money stored as integers** (minor units):
  - PKR stored as integer rupees (or paisa if you want precision).
  - never store floats.
- **Rounding rules are defined** for:
  - discounts (percentage)
  - prorated returns
  - allocation remainders (where extra rupee goes)

### 9) Data Import Safety

- **All imports are traceable**: Every imported row has `import_batch_id`.
- **Import rollback is possible**:
  - Option A: imports create drafts by default
  - Option B: posted imports are reversible only by a rollback operation that posts reversals (never deletes posted rows)

### 10) Tenant & Security Model

- **Tenant isolation**: every record is scoped to `tenant_id` and enforced at query-level.
- **V1 security simplicity (allowed)**:
  - You may start with single-owner user for V1.
  - Keep audit fields now so adding staff later doesn’t change the accounting engine.

## Ownership Tree (Tenant Root)

Tenant owns all business records:

- Customers
- Suppliers
- Products
- Payment_Accounts
- Transactions
- Transaction_Line
- Inventory_Movements
- Ledger_Entries
- Payment_Entries
- Allocations
- Import_Batches
- Import_Rows

Users belong to the tenant and operate the system. Customers and suppliers do not log in.

## Architecture: Transactions at the Center

A transaction represents one business event:

- Purchase
- Sale
- Supplier Payment
- Customer Payment
- Supplier Return
- Customer Return
- Internal Transfer
- Adjustment (later)

A transaction contains multiple **transaction_line** rows (items). Posting a transaction generates system outputs:

- **Inventory movements** (stock truth)
- **Ledger entries** (AP/AR truth)
- **Payment entries** (cash/bank truth)

Stock, balances, and cash are always computed from these outputs.

## Internal Transfers

Internal transfer is stored on the **Transaction** header:

- `from_payment_account_id`
- `to_payment_account_id`

Posting creates two entries:

- MONEY_OUT from the source account
- MONEY_IN to the destination account

## Allocations (Payments to Documents)

Allocations answer: “Which payment paid which invoice?”

- Allocation links a **payment transaction** to an **invoice/bill transaction**.
- Supports partial payments and credits.

## Document Status Rule

Only **POSTED** transactions affect stock and balances. **DRAFT** transactions do not.

## Source Specs

- Non-Negotiables: `Documentation/Financial System/Non-Negotiables (System Invariants) 2f991bf6339080f58c0dd54a1563cd8f.md`
- ERD explanation: `Documentation/Financial System/ERD + Explanation 2fa91bf63390800f9d2ffcf6681aa503.md`
- Standard types: `Documentation/Financial System/Data Model/2 2 Standard Types (Fixed Lists Used Everywhere) 2fa91bf6339080bda1f4cbbdb775fd77.md`
- Domain modules: `Documentation/Financial System/Data Model/2 1 Domain Modules (How we organize the system) 2fa91bf6339080dda2a7d1358a134cd0.md`
