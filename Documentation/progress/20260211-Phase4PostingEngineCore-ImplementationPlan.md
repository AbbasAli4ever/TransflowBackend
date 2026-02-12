# Progress Report - Phase 4: Posting Engine Core - Implementation Plan - 2026-02-11

## Phase/Feature: Phase 4: Posting Engine Core - Implementation Plan

## Reporting Period: 2026-02-11

## Status:
- [ ] On Track
- [ ] At Risk
- [ ] Delayed
- [x] Completed (Documentation of Implementation Plan)
- [ ] In Progress (Implementation)

## Achievements in this Period:
- Documented the comprehensive implementation plan for Phase 4: Posting Engine Core. This plan details the development of the core logic to convert PURCHASE and SALE draft transactions into immutable ledger entries, inventory movements, payment entries, and allocations.

## Blockers/Challenges:
- N/A (This report documents the plan, not its execution.)

## Decisions Made:
- The `Transactions` module will be introduced as a new module.
- Existing modules (Products, Suppliers, Customers, Payment Accounts) will be extended with new endpoints for balance and stock calculations.
- No new schema migrations are required as all necessary tables and enums are already in `schema.prisma`.
- The posting logic will be isolated within a `posting.service.ts` to maintain a clean `transactions.service.ts`.
- `Serializable` isolation level and a 10-second timeout will be used for `prisma.$transaction` in the posting process to ensure data integrity and handle concurrency.
- Stock and balance calculations will utilize raw SQL `$queryRaw` due to Prisma's aggregate limitations for conditional sums.
- Specific idempotency and serialization conflict handling strategies are defined.

## Next Steps (for next reporting period):
- Commence the implementation of Phase 4: Posting Engine Core, following the detailed plan outlined in this document.
- Regular updates will be provided as development progresses through the module and associated tests.

## Metrics/Key Performance Indicators (if applicable):
- Plan for ~100 new tests across various integration and unit test files.
- Expected total tests after Phase 4: ~260–280.
- Successful implementation of transactional integrity, idempotency, and concurrency control for purchase and sale postings.

## Created By: DocuMind (Progress Reporting Agent)

---

### Phase 4: Posting Engine Core - Implementation Details Summary

#### Context
Phases 1-3 (Backend Foundation, Schema V1, Master Data APIs) are complete and tested. Phase 4 focuses on the core posting engine, which converts draft `PURCHASE` and `SALE` transactions into various immutable entries (`ledger_entries`, `inventory_movements`, `payment_entries`, `allocations`). This is the most complex phase due to atomic multi-step database operations, idempotency, concurrency control, and derived balance calculations. No schema migrations are needed.

#### What to Build

**New Module: Transactions**

| Method | Route                          | Description                     |
|--------|--------------------------------|---------------------------------|
| POST   | `/api/v1/transactions/purchases/draft` | Create PURCHASE draft           |
| POST   | `/api/v1/transactions/sales/draft`     | Create SALE draft               |
| POST   | `/api/v1/transactions/:id/post`  | Post a DRAFT → POSTED           |
| GET    | `/api/v1/transactions`         | List with filters + pagination  |
| GET    | `/api/v1/transactions/:id`     | Get full transaction with entries |

**Extensions to Existing Modules**

| Module           | New Endpoint                      | Logic                                                  |
|------------------|-----------------------------------|--------------------------------------------------------|
| Products         | `GET /api/v1/products/:id/stock`    | Sum `inventory_movements` for running balance          |
| Suppliers        | `GET /api/v1/suppliers/:id/balance` | Sum `AP_INCREASE` − `AP_DECREASE` from `ledger_entries` |
| Customers        | `GET /api/v1/customers/:id/balance` | Sum `AR_INCREASE` − `AR_DECREASE` from `ledger_entries` |
| Payment Accounts | `GET /api/v1/payment-accounts/:id/balance` | `openingBalance` + SUM(`IN`) − SUM(`OUT`) from `payment_entries` |

#### Files to Create

*   **`backend/src/transactions/`**:
    *   `transactions.module.ts`
    *   `transactions.controller.ts`
    *   `transactions.service.ts`
    *   `posting.service.ts` (isolated posting logic)
    *   **`dto/`**:
        *   `purchase-line.dto.ts`
        *   `sale-line.dto.ts`
        *   `create-purchase-draft.dto.ts`
        *   `create-sale-draft.dto.ts`
        *   `post-transaction.dto.ts`
        *   `list-transactions-query.dto.ts`
*   **`backend/test/integration/`**:
    *   `transactions.integration.spec.ts`
    *   `posting-purchase.integration.spec.ts`
    *   `posting-sale.integration.spec.ts`
    *   `posting-concurrency.integration.spec.ts`
    *   `balance-queries.integration.spec.ts`

#### Files to Modify
*   `backend/src/app.module.ts`: Add `TransactionsModule`.
*   `backend/src/products/products.service.ts`: Add `getStock(id)` method.
*   `backend/src/products/products.controller.ts`: Add `@Get(':id/stock')` route.
*   `backend/src/suppliers/suppliers.service.ts`: Add `getBalance(id)` method.
*   `backend/src/suppliers/suppliers.controller.ts`: Add `@Get(':id/balance')` route.
*   `backend/src/customers/customers.service.ts`: Add `getBalance(id)` method.
*   `backend/src/customers/customers.controller.ts`: Add `@Get(':id/balance')` route.
*   `backend/src/payment-accounts/payment-accounts.service.ts`: Add `getBalance(id)` method.
*   `backend/src/payment-accounts/payment-accounts.controller.ts`: Add `@Get(':id/balance')` route.
*   `backend/test/helpers/test-factories.ts`: Add `createAndPostPurchase` helper factory.

#### Implementation Details

*   **DTO Design**:
    *   `PostTransactionDto`: Handles both `PURCHASE` and `SALE` posting. Includes `idempotencyKey` and `paymentAccountId` (if `paidNow`/`receivedNow` > 0).
    *   `ListTransactionsQueryDto`: Extends `PaginationQueryDto`, adds filters for `type`, `status`, `dateFrom`/`dateTo`, `supplierId`, `customerId`, and sorting options.
*   **TransactionsService (Draft Creation)**:
    *   Validation includes future `transactionDate`, active supplier/customer/product status, and discount amount logic.
    *   Calculates `lineTotal`, `subtotal`, `discountTotal`, `totalAmount`.
    *   Creates `Transaction (DRAFT)` and `TransactionLines` within a single `prisma.$transaction`.
*   **PostingService (Core Logic)**:
    *   `post()` method wrapped in `prisma.$transaction({ isolationLevel: 'Serializable', timeout: 10000 })`.
    *   Handles idempotency: returns existing `200 OK` for same `idempotencyKey`, throws `409 Conflict` for different key/transaction mismatch.
    *   Dispatches to `postPurchase()` or `postSale()`.
    *   **`postPurchase` Sequence**: Calculates pre-movement stock, generates document number, updates transaction status, creates `InventoryMovements` (PURCHASE_IN), updates product `avgCost`, creates `LedgerEntry` (AP_INCREASE), and if paid, creates `PaymentEntry` (MONEY_OUT), `LedgerEntry` (AP_DECREASE), and `Allocation`.
    *   **`postSale` Sequence**: Checks stock sufficiency (throws `422 UnprocessableEntityException` if insufficient), generates document number, updates transaction status, creates `InventoryMovements` (SALE_OUT) with `unitCostAtTime`, creates `LedgerEntry` (AR_INCREASE), and if received, creates `PaymentEntry` (MONEY_IN), `LedgerEntry` (AR_DECREASE), and `Allocation`.
*   **Document Numbers**: Format `PUR-{year}-{0001}` or `SAL-{year}-{0001}`, unique per `tenantId`, `type`, `series`, `documentNumber`.
*   **Serialization Conflicts**: `Prisma P2034` errors (Postgres serialization failures) will be caught and re-thrown as `409 ConflictException('Serialization conflict, please retry')`.
*   **Stock and Balance Calculations**: Uses raw SQL `$queryRaw` for conditional sums, handling bigint return types in TypeScript.
*   **Key Schema Notes**: `Transaction.series` is nullable (set at posting), `Transaction.paidNow` stores both purchase paid and sale received, `Allocation` self-references for immediate payments.

#### Implementation Order
1.  Module skeleton (`transactions/`) + `app.module.ts` registration.
2.  DTOs (all 5 files).
3.  Draft creation (`createPurchaseDraft`, `createSaleDraft`, read endpoints) + `transactions.integration.spec.ts`.
4.  `PostingService` helpers (`calculateProductStock`, `generateDocumentNumber`, `getDocumentPrefix`).
5.  `PURCHASE` posting (`postPurchase`, `post()` dispatcher) + `posting-purchase.integration.spec.ts`.
6.  Supplier + PaymentAccount balance endpoints + `balance-queries.integration.spec.ts` (relevant sections).
7.  Product stock endpoint + `balance-queries.integration.spec.ts` (relevant section).
8.  `SALE` posting (`postSale`) + `posting-sale.integration.spec.ts`.
9.  Customer balance endpoint + complete balance tests.
10. Concurrency tests (`posting-concurrency.integration.spec.ts`).
11. Factory helpers (`createAndPostPurchase` in `test-factories.ts`).
12. Full test run (`npm test`).

#### Test Coverage Plan
*   `transactions.integration.spec.ts`: Draft creation, validation, list filters, tenant isolation.
*   `posting-purchase.integration.spec.ts`: Full flow, no-payment, partial payment, avg cost update, sequential doc numbers, idempotency.
*   `posting-sale.integration.spec.ts`: Full flow, `SALE_OUT` movements, `avgCost`, insufficient stock handling, multi-product insufficient stock.
*   `posting-concurrency.integration.spec.ts`: Concurrent sales with stock checks (one success, one failure).
*   `balance-queries.integration.spec.ts`: Stock (`0`/`after purchase`/`after sale`), supplier/customer/account balances, tenant isolation.
*   Expected total after Phase 4: ~260–280 tests.

#### Verification
*   `npm run build` (no TypeScript errors).
*   `npm test` (all tests must pass).
*   End-to-end smoke test sequence via manual Swagger checks (create draft, post, verify balances/stock, test insufficient stock, test idempotency).
