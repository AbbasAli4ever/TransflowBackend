# Testing Strategy and Core Scenarios

This document defines the minimum test coverage required to protect accounting integrity. Financial systems must be test-first because a small bug can corrupt balances permanently.

## Testing Goals

1. Ensure posting creates the correct outputs for every transaction type.
2. Protect invariants (no negative stock, append-only entries, balances derived from entries).
3. Verify idempotency (no double-posts on retries).
4. Validate allocations and pending balances.
5. Keep statements and dashboards correct at scale.

## Test Layers

### 1) Unit Tests

Focus: deterministic business logic and calculations.

- Posting calculation helpers
- Allocation logic (manual + auto)
- Totals/discount calculations
- Weighted average cost updates
- Document numbering rules

### 2) Integration Tests

Focus: API endpoints + database writes.

- POST /purchases
- POST /sales
- POST /supplier-payments
- POST /customer-payments
- Allocation application
- Stock validation

### 3) Invariant Tests

Focus: system integrity across full workflows.

- Ledger balances == sum of ledger entries
- Account balances == sum of payment entries
- Stock levels == sum of inventory movements
- No edits to posted data

### 4) End-to-End Tests (Optional but Recommended)

Focus: UI workflows and business outcomes.

- Create supplier -> purchase -> payment -> statement
- Create customer -> sale -> payment -> statement

## Core Scenarios (Minimum Required)

### S1) Purchase -> Sale -> Stock Check

- Create purchase of 10 units @ cost
- Sale 3 units
- Stock must equal 7

### S2) Partial Payment -> Full Payment

- Purchase 10,000
- Pay 4,000 now
- Pay remaining 6,000 later
- Supplier balance should reach 0

### S3) Concurrent Sales (No Negative Stock)

- Stock 5 units
- Two sales of 4 units concurrently
- Only one should succeed

### S4) Return Cannot Exceed Original Quantity

- Purchase 10 units
- Return 6 units
- Second return of 5 units should fail

### S5) Idempotency

- Same request with same idempotency key should not create duplicate entries

### S6) Internal Transfer Two-Leg Rule

- Transfer 10,000 from Cash to Bank
- Must create one MONEY_OUT + one MONEY_IN

## Canonical Query Tests

Validate all canonical queries using known datasets:

- Supplier balance
- Customer balance
- Payment account balance
- Product stock
- Pending payables/receivables
- Statements
- Document-level pending

## Sample Test Data Sets

### Tenant A

- Suppliers: 2
- Customers: 2
- Products: 3
- Payment accounts: Cash + Bank
- Purchases: 2
- Sales: 2
- Payments: 2

### Tenant B (Isolation)

- Same structure to prove tenant isolation

## Assertions (Invariant Checks)

- Sum of AP entries = supplier balance
- Sum of AR entries = customer balance
- Sum of payment entries = payment account balance
- Sum of inventory movements = product stock
- Each entry references a valid transaction
- No `POSTED` transaction is updated

## Test Tools (Recommended)

- Backend: Jest or Vitest
- API: Supertest
- DB: Testcontainers (Postgres)

## Non-Functional Test Hooks

- Posting under load (100 concurrent posts)
- Statement queries return within target time
- Dashboard summary remains under 700ms
