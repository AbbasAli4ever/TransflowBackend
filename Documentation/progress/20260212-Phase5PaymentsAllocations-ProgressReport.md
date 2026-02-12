# Progress Report - Phase 5: Payments + Allocations - 2026-02-12

## Phase/Feature: Phase 5: Payments + Allocations

## Reporting Period: 2026-02-12

## Status:
- [ ] On Track
- [ ] At Risk
- [ ] Delayed
- [x] Completed

## Achievements in this Period:
- Implemented Payment + Allocation logic for supplier and customer payments.
- Created DTOs: `payment-allocation-item.dto.ts`, `create-supplier-payment-draft.dto.ts`, `create-customer-payment-draft.dto.ts`, and `list-allocations-query.dto.ts`.
- Extended `post-transaction.dto.ts` with optional `allocations?: PaymentAllocationItemDto[]`.
- Added `postSupplierPayment()`, `postCustomerPayment()`, `autoAllocate()`, `applyManualAllocations()` to `posting.service.ts`.
- Extended `generateDocumentNumber()` for SPY/CPY prefixes and the `post()` dispatcher in `posting.service.ts`.
- Added `createSupplierPaymentDraft()`, `createCustomerPaymentDraft()`, `listAllocations()` to `transactions.service.ts`.
- Added new routes: `POST supplier-payments/draft`, `POST customer-payments/draft`, `GET allocations` to `transactions.controller.ts`.
- Added `getOpenDocuments()` to `suppliers.service.ts` and `customers.service.ts`.
- Added `GET :id/open-documents` routes to `suppliers.controller.ts` and `customers.controller.ts`.
- Added `createAndPostSupplierPayment()` to `test/helpers/test-factories.ts`.
- Created new integration tests: `posting-supplier-payment.integration.spec.ts` (18 tests), `posting-customer-payment.integration.spec.ts` (13 tests), `open-documents.integration.spec.ts` (9 tests), `allocations.integration.spec.ts` (7 tests).

## Blockers/Challenges:
- None

## Decisions Made:
- Allocations at Posting Time (not Draft Time): Accepted allocations as an optional field in PostTransactionDto at posting time. If no allocations provided, auto-allocate oldest-first. This simplifies the process, avoids hacking the source column, and is equally usable.
- Payment Account Storage on Draft: Used fromPaymentAccountId to store the payment account for both SUPPLIER_PAYMENT and CUSTOMER_PAYMENT drafts.
- No Transaction Lines for Payments: Payment transactions carry a single totalAmount on the transaction header, without TransactionLine rows.
- Document Prefixes: Implemented SPY-YYYY-NNNN for SUPPLIER_PAYMENT and CPY-YYYY-NNNN for CUSTOMER_PAYMENT.

## Next Steps (for next reporting period):
- None specified by the coding agent.

## Metrics/Key Performance Indicators (if applicable):
- Total tests passing: 291/291
- New tests added: 44

## Created By: zTracker (Progress Reporting Agent)
