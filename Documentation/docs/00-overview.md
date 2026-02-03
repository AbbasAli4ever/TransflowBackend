# Overview

## Purpose

Finance System is a transaction-ledger system for small businesses (wholesale/retail) that tracks purchases, sales, inventory, and payments with strong accounting integrity. The core design is event-sourced: every business action creates immutable entries that are used to derive balances.

## Audience

- Business owners and internal staff
- Backend and frontend engineers
- QA and operations

Suppliers and customers do **not** log in or perform actions in the system; they exist only as master records.

## Scope (V1)

- Single tenant (or single business per instance)
- Single currency (PKR)
- Single location (no multi-warehouse)
- Whole units only (no fractional quantities)
- Transaction states: DRAFT, POSTED (VOIDED/ADJUSTMENT reserved for later)
- Core transaction types:
  - PURCHASE
  - SALE
  - SUPPLIER_PAYMENT
  - CUSTOMER_PAYMENT

Planned for V1.1:

- SUPPLIER_RETURN
- CUSTOMER_RETURN
- INTERNAL_TRANSFER
- VOIDED status
- ADJUSTMENT transaction type

## System Principles (Non-Negotiables)

1. Event -> entries only. Balances and stock are derived from immutable entries.
2. Append-only entries. Posted entries are never edited in-place.
3. Atomic posting. Posting runs inside a single DB transaction.
4. Idempotent writes. Duplicate requests must not double-post.
5. No silent updates. Edits to posted data must be reversals/adjustments.
6. Inventory changes only via inventory movements.
7. Money moves only via payment entries.
8. Supplier/customer balances derive from ledger entries.
9. All records are tenant-scoped.
10. All money values are stored as integers (minor units).

## Domain Modules (How the system is organized)

1. Company & Users (Identity)
   - Company/business info
   - Users who can log in
2. Core Records (Master Data)
   - Suppliers
   - Customers
   - Products
   - Payment methods (Cash, Bank, JazzCash, Card)
3. Transactions (Events)
   - Purchase, sale, payments, returns, internal transfers
4. Transaction Items (Lines)
   - Line items with product, quantity, price/cost
5. System Posting Records (Outputs)
   - Inventory movements
   - Ledger entries
   - Payment entries
6. Payment Allocation
   - Allocation of payments to bills/invoices
7. Imports & History (Audit)
   - Import batches and rows
   - Audit history

One simple rule: we never directly change balances or stock. We only save a transaction, and the system generates the correct records automatically.

## Standard Types (Fixed Lists)

### Transaction Types

- PURCHASE
- SALE
- SUPPLIER_PAYMENT
- CUSTOMER_PAYMENT
- SUPPLIER_RETURN
- CUSTOMER_RETURN
- INTERNAL_TRANSFER
- ADJUSTMENT (not V1; reserved)

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

- DRAFT (saved but not final)
- POSTED (final and locked)
- VOIDED (reserved for V1.1)

Rule: only POSTED transactions affect stock and balances.

## Ownership Tree (Tenant Root)

Tenant owns:

- customers
- suppliers
- products
- payment_accounts
- transactions
- transaction_lines
- inventory_movements
- ledger_entries
- payment_entries
- allocations
- import_batches
- import_rows

Users belong to the tenant and operate the system.

## Data Model (Summary)

Transactions are the center of the system:

- A transaction represents one business event.
- A transaction contains multiple transaction_line rows (receipt items).
- Posting creates:
  - inventory_movements (stock truth)
  - ledger_entries (AP/AR truth)
  - payment_entries (cash/bank truth)
- Allocations connect payment transactions to invoice/bill transactions.

## Posting Outputs (What Gets Generated)

- Inventory movements: track stock in/out by product.
- Ledger entries: track supplier/customer balances (AP/AR).
- Payment entries: track money movement per payment account.

## Transfers

Internal transfer is stored on the transaction header and posts two payment entries:

- MONEY_OUT from the source account
- MONEY_IN to the destination account

## Imports (Excel Migration)

- Import batches contain import rows.
- Every imported row is traceable to a batch.
- Rollback should be possible by reversing batch entries.

## Reading Paths

- New engineer: `01-architecture.md` -> `02-data-model.md` -> `03-posting-patterns.md`
- API implementer: `04-api-spec.md` -> `03-posting-patterns.md` -> `05-testing.md`
- UI implementer: `06-ui-spec.md` -> `04-api-spec.md`
- Ops/DevOps: `09-operations.md` -> `10-nfrs.md`

## Documentation Map (Single Source of Truth)

Core:

- `Documentation/docs/01-architecture.md`
- `Documentation/docs/02-data-model.md`
- `Documentation/docs/03-posting-patterns.md`
- `Documentation/docs/16-tech-stack.md`

Implementation Guides:

- `Documentation/docs/04-api-spec.md`
- `Documentation/docs/05-testing.md`
- `Documentation/docs/06-ui-spec.md`
- `Documentation/docs/07-migration.md`
- `Documentation/docs/08-security.md`
- `Documentation/docs/09-operations.md`
- `Documentation/docs/10-nfrs.md`

Project Management:

- `Documentation/docs/11-roadmap.md`
- `Documentation/docs/12-definition-of-done.md`
- `Documentation/docs/13-technical-debt.md`
- `Documentation/docs/14-decision-log.md`
- `Documentation/docs/15-changelog.md`

## Legacy Reference (Do Not Use as Source of Truth)

The original Notion export is kept for traceability only:

- `Documentation/Financial System 2f991bf63390808a84b0f032fca4bc64.md`
- `Documentation/Financial System/`
