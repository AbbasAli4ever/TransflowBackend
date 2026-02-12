# Data Integrity Testing Guide for zTester

## Core Principle: Accounting Integrity is Fundamental

The Finance System is a transaction-ledger system, meaning its core value lies in the absolute integrity and consistency of its financial data. Any deviation from accounting principles or data inconsistency is a **CRITICAL BUG**.

## Methodology: "Trust but Verify"

Always operate with the assumption that the system *could* be wrong, even if initial tests pass. Design tests that actively attempt to expose inconsistencies, violations of business rules, or data corruption.

-   **Event-Sourced Verification**: Focus on the immutability of events and the correct derivation of balances.
-   **Mathematical Precision**: Ensure all calculations, especially those involving money and quantities, are exact and avoid common pitfalls.
-   **System Invariants**: Rigorously test every defined "System Invariant" from `references/project_overview.md`.

## Specific Areas of Focus

### 1. Event-Sourced Core & Immutability

**Objective**: Verify that all financial and inventory changes flow exclusively through immutable events and entries.
-   **Event Generation**: For every business action (e.g., creating a transaction), verify that the appropriate `Transaction` event is created.
-   **Append-Only Entries**:
    -   `ledger_entries`, `inventory_movements`, and `payment_entries` must *never* be directly modified or deleted once they are "posted."
    -   Attempt API calls or direct database manipulation (if testing allows) to modify or delete these posted entries.
    -   Verify that corrections are handled through reversal or adjustment entries, not direct mutation.
-   **Derived Balances**:
    -   Ensure that all entity balances (`customer.currentBalance`, `supplier.currentBalance`, `paymentAccount.currentBalance`, `product.currentStock`) are computed dynamically from their respective entries, rather than being stored and directly updated.
    -   Test scenarios where entries are added/removed (in draft state) and verify that derived balances reflect these changes correctly.

### 2. Atomic & Idempotent Writes

**Objective**: Confirm that multi-step business operations are atomic and resilient to duplicate requests.
-   **Atomic Posting**:
    -   For complex operations (e.g., transaction posting that creates multiple `ledger_entries`, `inventory_movements`, `payment_entries`), simulate failures at various points within the operation (e.g., database connection loss, service crash).
    -   Verify that either all changes are successfully committed, or the entire transaction is rolled back, leaving no partial or inconsistent data.
-   **Idempotency Keys**:
    -   Repeatedly send the exact same write request (e.g., POST `/transactions/purchases/draft`) with the same idempotency key.
    -   Verify that only the first request results in data creation/modification, and subsequent identical requests return the same result without creating duplicates.

### 3. Money & Quantity Handling

**Objective**: Ensure numerical values are handled with precision and integrity.
-   **Integer Storage**: Confirm that all money values are consistently stored as integers (e.g., cents, paise, or the smallest unit of the base currency) to avoid floating-point arithmetic issues.
-   **Calculations**:
    -   Test all calculations involving monetary amounts (e.g., subtotals, totals, discounts, taxes) with various values, including zero, large numbers, and numbers that would typically cause floating-point errors if not handled as integers.
    -   Verify correct rounding rules are applied where necessary.
-   **Quantity Constraints**: Ensure quantities (`transactionLine.quantity`, `inventoryMovement.quantity`) are always positive and handled correctly (e.g., no negative stock unless explicitly allowed).

### 4. Referential Integrity

**Objective**: Guarantee that all data relationships are maintained and no "orphan" records exist.
-   **Foreign Key Enforcement**:
    -   Attempt to create child records (e.g., `transaction_line`) without valid parent records (`transaction`).
    -   Verify that the database correctly rejects such operations with foreign key constraint errors.
-   **`onDelete` Behavior**:
    -   Test the deletion of parent records (e.g., a `Transaction` in DRAFT status, or a `User`).
    -   Verify that related child records are handled according to the defined `onDelete` rules (e.g., `Restrict`, `Cascade`, `Set Null`). Especially for posted transactions, verify that they cannot be hard-deleted.
-   **Mandatory Audit Trails**: Confirm that `created_by`, `created_at`, `updated_at` are correctly populated for all relevant entities and are immutable after creation where appropriate.

### 5. Constraints & Business Rules

**Objective**: Re-verify all database-level and application-level constraints from a functional and business logic perspective.
-   **Unique Constraints**: Beyond security, verify that business-critical unique constraints (e.g., unique SKU per tenant, unique document number per tenant+type+series) are robustly enforced.
-   **Check Constraints**: Test that database-level check constraints (e.g., `amount >= 0`) and application-level business rules (e.g., cannot return more than purchased) are correctly applied.

## Summary

`zTester` must continuously challenge the system's ability to maintain perfect data integrity. Any scenario that leads to inconsistent balances, corrupted entries, or violated business rules must be identified and reported as a critical defect. Your role is to be the guardian of the Finance System's data truth.