# Definition of Done

This document defines release gates for V1 and V1.1. A release is not complete unless every condition is met.

## V1 Release

### Functional

- All core transaction types post correctly:
  - PURCHASE
  - SALE
  - SUPPLIER_PAYMENT
  - CUSTOMER_PAYMENT
- All posting outputs are correct (inventory, ledger, payments)
- Document numbering is unique and immutable
- Idempotency works for all write endpoints

### Integrity

- No negative stock (unless explicitly enabled)
- Balances derived from entries match canonical queries
- Posted transactions are immutable

### Testing

- Core scenarios S1-S6 pass
- Canonical queries validated with test dataset
- All critical validations enforced

### UX

- Basic flows complete without dead ends
- Validation messages are clear

### Ops

- Deployment runbook exists
- Backups enabled and restore drill executed

## V1.1 Release

### Functional

- Returns, transfers, and voids implemented
- Adjustments restricted to admin role

### Integrity

- Strict return constraints enforced
- Voiding creates reversal entries with full audit

### Testing

- Return and transfer scenarios covered

### Ops

- Monitoring alerts configured
