# PHASE TRACE REPORT

Title:
Phase 9 — Transactions

--------------------------------------------
## API: GET /api/v1/transactions
--------------------------------------------

Route Entry:
Global middleware/guards chain: `RequestContextMiddleware` -> `TenantContextMiddleware` -> `JwtAuthGuard` -> `TenantScopeGuard` -> global `ValidationPipe`.

Controller:
`TransactionsController.findAll()` (`src/transactions/transactions.controller.ts:173-189`)

Service:
`TransactionsService.findAll()` (`src/transactions/transactions.service.ts:179-220`)

Repository:
Prisma direct reads: `transaction.findMany`, `transaction.count`.

DTO/Schema:
`ListTransactionsQueryDto` + `PaginationQueryDto`.
DB: `transactions`, `transaction_lines`.

Execution Trace:
1. Query params validated/transformed (type/status/date/supplier/customer/sort/pagination).
2. Service reads `tenantId` from async request context and builds `where` with tenant scoping.
3. Prisma fetches paginated transactions + count in parallel; returns `paginateResponse({data, meta})`.

Business Rules Observed:
- Tenant scoping is enforced at service query level.
- Pagination defaults exist and limit is capped at 100.
- Sort field is allowlisted (`transactionDate|createdAt|totalAmount`).

Missing Rules:
- No validation that `dateFrom <= dateTo`.
- No closed-period access constraints.

Security Risks:
- None critical in this endpoint; tenant filter is present.

Financial Risks:
- Listing includes DRAFT and POSTED together with no explicit business-date normalization; can produce ambiguous audit views when clients assume posting date semantics.

Edge Case Failures:
- Invalid date ranges silently return empty/partial sets instead of deterministic 400.

Concurrency Risks:
- Read-only endpoint; no write race.

Test Coverage:
- Covered: `test/integration/transactions.integration.spec.ts` (pagination, type/status filters, tenant isolation).
- Missing: date range ordering validation, sort-order corner cases, high-page behavior.

Verdict:
⚠ Risky

Required Fixes:
- Add DTO/class-level validator for `dateFrom <= dateTo`.
- Add explicit query mode/filter docs for DRAFT vs POSTED usage.

--------------------------------------------
## API: GET /api/v1/transactions/allocations
--------------------------------------------

Route Entry:
Global middleware/guards chain: `RequestContextMiddleware` -> `TenantContextMiddleware` -> `JwtAuthGuard` -> `TenantScopeGuard` -> global `ValidationPipe`.

Controller:
`TransactionsController.listAllocations()` (`src/transactions/transactions.controller.ts:142-156`)

Service:
`TransactionsService.listAllocations()` (`src/transactions/transactions.service.ts:634-679`)

Repository:
Prisma reads: `allocation.findMany`, `allocation.count` with relation includes.

DTO/Schema:
`ListAllocationsQueryDto`.
DB: `allocations`, `transactions` (payment/applies relations).

Execution Trace:
1. Query params parsed (supplier/customer/purchase/sale/date/page/limit).
2. Service enforces tenant context, builds allocation filter object including nested `paymentTransaction` conditions.
3. Prisma returns paginated allocations with payment/applied transaction summaries.

Business Rules Observed:
- Tenant scoping exists (`where.tenantId`).
- Supports filters by supplier/customer/document/date.

Missing Rules:
- No max limit cap (`limit` can be unbounded unlike shared pagination DTO).
- No rejection for mutually conflicting filters (`purchaseId` + `saleId`, supplier + customer).
- Date filter uses `createdAt`, not transaction/business date; not documented in endpoint contract.

Security Risks:
- Potential resource exhaustion via very large `limit` (DoS vector).

Financial Risks:
- Statement/allocation reports can be misleading when filtered by allocation creation timestamp instead of transaction date.

Edge Case Failures:
- If both `purchaseId` and `saleId` are passed, code silently prioritizes `purchaseId`.

Concurrency Risks:
- Read-only endpoint; no write race.

Test Coverage:
- Covered: `test/integration/allocations.integration.spec.ts` (empty list, filters, pagination, tenant isolation, auth).
- Missing: oversized `limit`, conflicting filter combinations, date semantics validation.

Verdict:
⚠ Risky

Required Fixes:
- Reuse `PaginationQueryDto` (or add `@Max(100)` to `limit`).
- Add validation for mutually exclusive filters.
- Decide and document whether filtering should be by `createdAt` or transaction date.

--------------------------------------------
## API: GET /api/v1/transactions/{id}
--------------------------------------------

Route Entry:
Global middleware/guards chain: `RequestContextMiddleware` -> `TenantContextMiddleware` -> `JwtAuthGuard` -> `TenantScopeGuard` -> global `ValidationPipe`.

Controller:
`TransactionsController.findOne()` (`src/transactions/transactions.controller.ts:191-200`)

Service:
`TransactionsService.findOne()` (`src/transactions/transactions.service.ts:222-239`)

Repository:
Prisma read: `transaction.findFirst` with includes.

DTO/Schema:
Path param uses `ParseUUIDPipe`.
DB: `transactions`, `transaction_lines`, `inventory_movements`, `ledger_entries`, `payment_entries`, `suppliers`, `customers`.

Execution Trace:
1. Path `id` validated as UUID.
2. Service fetches tenant-scoped transaction and related rows.
3. Returns full transaction graph or 404.

Business Rules Observed:
- Strong tenant isolation via `where: {id, tenantId}`.
- Not found behavior is deterministic.

Missing Rules:
- No role-based restriction for sensitive transaction internals (all authenticated tenant users can read full financial posting internals).

Security Risks:
- Over-broad data exposure if tenant roles should have least-privilege visibility.

Financial Risks:
- None directly; read-only.

Edge Case Failures:
- Large relation payload could become heavy for transactions with many lines/entries.

Concurrency Risks:
- Read-only endpoint.

Test Coverage:
- Covered: `test/integration/transactions.integration.spec.ts` (happy path, 404, tenant isolation, auth).
- Missing: large payload behavior, posted vs draft access policy tests.

Verdict:
✅ Safe

Required Fixes:
- If role segmentation is required, add read-scope authorization.

--------------------------------------------
## API: POST /api/v1/transactions/adjustments/draft
--------------------------------------------

Route Entry:
Global middleware/guards chain: `RequestContextMiddleware` -> `TenantContextMiddleware` -> `JwtAuthGuard` -> `TenantScopeGuard` -> global `ValidationPipe`.

Controller:
`TransactionsController.createAdjustmentDraft()` (`src/transactions/transactions.controller.ts:131-140`)

Service:
`TransactionsService.createAdjustmentDraft()` (`src/transactions/transactions.service.ts:578-632`)

Repository:
Prisma reads/writes: `product.findFirst`, `transaction.create`, `transactionLine.createMany`, `transaction.findFirst`.

DTO/Schema:
`CreateAdjustmentDraftDto`, `AdjustmentLineDto`.
DB: `transactions`, `transaction_lines`, `products`.

Execution Trace:
1. Service checks role from request context (`OWNER|ADMIN` only), validates date not future.
2. Validates each product exists and is ACTIVE within tenant.
3. Creates ADJUSTMENT draft and lines (direction/reason encoded in `description` as `"DIRECTION|reason"`).

Business Rules Observed:
- Admin-only draft creation is enforced.
- Product status validation present.

Missing Rules:
- No enforcement that top-level adjustment reason exists (only line reason required).
- No stock validation for OUT lines at draft stage.

Security Risks:
- Authorization is token-claim based only; no DB re-check of current role/status.

Financial Risks:
- Encodes financial control fields in free-text `description`; brittle parsing can break audit semantics.

Edge Case Failures:
- Line reason containing `|` can distort encoded format expectations.

Concurrency Risks:
- None material at draft creation.

Test Coverage:
- Covered: `test/integration/posting-adjustment.integration.spec.ts` (role restrictions, unknown/inactive/future/enum checks).
- Missing: encoded-description robustness tests and line reason delimiter handling.

Verdict:
⚠ Risky

Required Fixes:
- Store `direction` and `reason` in explicit columns (or structured JSON), not encoded string.
- Add validation strategy for OUT adjustments against stock policy.

--------------------------------------------
## API: POST /api/v1/transactions/customer-payments/draft
--------------------------------------------

Route Entry:
Global middleware/guards chain: `RequestContextMiddleware` -> `TenantContextMiddleware` -> `JwtAuthGuard` -> `TenantScopeGuard` -> global `ValidationPipe`.

Controller:
`TransactionsController.createCustomerPaymentDraft()` (`src/transactions/transactions.controller.ts:87-96`)

Service:
`TransactionsService.createCustomerPaymentDraft()` (`src/transactions/transactions.service.ts:280-317`)

Repository:
Prisma reads/writes: `customer.findFirst`, `paymentAccount.findFirst`, `transaction.create`.

DTO/Schema:
`CreateCustomerPaymentDraftDto`.
DB: `transactions`, `customers`, `payment_accounts`.

Execution Trace:
1. Validates tenant context and non-future transaction date.
2. Verifies customer and payment account exist in tenant and are ACTIVE.
3. Creates DRAFT `CUSTOMER_PAYMENT` transaction with account link and amount totals.

Business Rules Observed:
- Amount is integer and >=1.
- Active customer/account required.

Missing Rules:
- No idempotency for draft creation (docs state POST endpoints should be retry-safe).

Security Risks:
- None critical; tenant and auth checks exist.

Financial Risks:
- Draft can become stale if account/customer status changes before posting; post path does not re-check status consistently.

Edge Case Failures:
- No explicit prevention of duplicate draft creation from repeated client retry.

Concurrency Risks:
- Duplicate drafts can be created under network retry storms.

Test Coverage:
- Covered: `test/integration/posting-customer-payment.integration.spec.ts` (create, unknown customer, amount validation).
- Missing: inactive customer/account rejection tests at draft level, duplicate-request behavior.

Verdict:
⚠ Risky

Required Fixes:
- Add optional idempotency support for draft-creation endpoints.
- Add post-time revalidation of account/customer active state.

--------------------------------------------
## API: POST /api/v1/transactions/customer-returns/draft
--------------------------------------------

Route Entry:
Global middleware/guards chain: `RequestContextMiddleware` -> `TenantContextMiddleware` -> `JwtAuthGuard` -> `TenantScopeGuard` -> global `ValidationPipe`.

Controller:
`TransactionsController.createCustomerReturnDraft()` (`src/transactions/transactions.controller.ts:109-118`)

Service:
`TransactionsService.createCustomerReturnDraft()` (`src/transactions/transactions.service.ts:427-533`)

Repository:
Prisma reads/writes + raw SQL: `customer.findFirst`, `transactionLine.findFirst`, `$queryRaw` (already returned qty), `transaction.create`, `transactionLine.createMany`.

DTO/Schema:
`CreateCustomerReturnDraftDto`, `CustomerReturnLineDto`.
DB: `transactions`, `transaction_lines`.

Execution Trace:
1. Validates customer exists/ACTIVE and date is not future.
2. For each line: validates source line belongs to POSTED SALE for same customer; computes returnable via posted returns aggregate query.
3. Creates DRAFT `CUSTOMER_RETURN` transaction and return lines with source references.

Business Rules Observed:
- Strict source-line linkage to posted SALE enforced.
- Quantity > 0 enforced.

Missing Rules:
- No cumulative validation for duplicate `sourceTransactionLineId` entries within same request.
- No uniqueness enforcement on source line per draft.

Security Risks:
- None critical in route authorization.

Financial Risks:
- Over-return can be drafted by splitting one source line across duplicate request lines (each checked independently), allowing total return > original sold.

Edge Case Failures:
- Duplicate source lines in one payload can bypass returnable quantity intent.

Concurrency Risks:
- Draft-level checks are not lock-based; concurrent draft creation can both pass (posting stage should guard, but posting has same per-line non-cumulative weakness).

Test Coverage:
- Covered: `test/integration/posting-customer-return.integration.spec.ts` (happy paths, wrong customer/source, over-return across posted history).
- Missing: duplicate source line in same draft payload.

Verdict:
❌ Unsafe

Required Fixes:
- Aggregate requested quantities by `sourceTransactionLineId` before validation.
- Reject duplicate source line IDs in DTO/service.

--------------------------------------------
## API: POST /api/v1/transactions/internal-transfers/draft
--------------------------------------------

Route Entry:
Global middleware/guards chain: `RequestContextMiddleware` -> `TenantContextMiddleware` -> `JwtAuthGuard` -> `TenantScopeGuard` -> global `ValidationPipe`.

Controller:
`TransactionsController.createInternalTransferDraft()` (`src/transactions/transactions.controller.ts:120-129`)

Service:
`TransactionsService.createInternalTransferDraft()` (`src/transactions/transactions.service.ts:535-576`)

Repository:
Prisma reads/writes: `paymentAccount.findFirst` (from/to), `transaction.create`.

DTO/Schema:
`CreateInternalTransferDraftDto`.
DB: `transactions`, `payment_accounts`.

Execution Trace:
1. Validates date, amount >=1, and `fromPaymentAccountId != toPaymentAccountId`.
2. Ensures both accounts exist in tenant and ACTIVE.
3. Creates DRAFT `INTERNAL_TRANSFER` with both account references and amount.

Business Rules Observed:
- Same-account transfers blocked.
- Tenant and active status checks present.

Missing Rules:
- No draft idempotency.

Security Risks:
- None critical.

Financial Risks:
- No pre-check for available balance on source account (policy-dependent, but if overdraft not allowed this is missing).

Edge Case Failures:
- Repeated identical client retries create duplicate drafts.

Concurrency Risks:
- Duplicate draft creation under retries.

Test Coverage:
- Covered: `test/integration/posting-internal-transfer.integration.spec.ts` draft scenarios.
- Missing: inactive account transitions between draft and post, duplicate-request idempotency.

Verdict:
⚠ Risky

Required Fixes:
- Define and enforce source-account overdraft policy.
- Add optional idempotency for draft creation.

--------------------------------------------
## API: POST /api/v1/transactions/purchases/draft
--------------------------------------------

Route Entry:
Global middleware/guards chain: `RequestContextMiddleware` -> `TenantContextMiddleware` -> `JwtAuthGuard` -> `TenantScopeGuard` -> global `ValidationPipe`.

Controller:
`TransactionsController.createPurchaseDraft()` (`src/transactions/transactions.controller.ts:48-60`)

Service:
`TransactionsService.createPurchaseDraft()` + helper `validateAndProcessPurchaseLines()` (`src/transactions/transactions.service.ts:32-96`, `691-724`)

Repository:
Prisma reads/writes: `supplier.findFirst`, `product.findFirst`, `transaction.create`, `transactionLine.createMany`, `transaction.findFirst`.

DTO/Schema:
`CreatePurchaseDraftDto`, `PurchaseLineDto`.
DB: `transactions`, `transaction_lines`, `suppliers`, `products`.

Execution Trace:
1. Validates tenant/date/supplier active state.
2. Validates each product active and discount <= line gross; computes totals.
3. Creates DRAFT purchase transaction + lines atomically.

Business Rules Observed:
- Supplier and product must be tenant-local and ACTIVE.
- Discount cannot exceed line gross.
- Integer money model used end-to-end.

Missing Rules:
- DTO allows `unitCost = 0` (`@Min(0)`), while posting spec requires `unit_cost > 0`.

Security Risks:
- None critical.

Financial Risks:
- Zero-cost purchases can enter inventory and distort valuation/balance logic.

Edge Case Failures:
- No explicit duplicate-product line consolidation policy; behavior left to client.

Concurrency Risks:
- No major write race at draft stage (single create transaction).

Test Coverage:
- Covered: `test/integration/transactions.integration.spec.ts` (happy paths, future date, unknown/inactive entities, discount validation).
- Missing: explicit `unitCost=0` rejection test.

Verdict:
⚠ Risky

Required Fixes:
- Change `PurchaseLineDto.unitCost` validation to `@Min(1)` (or explicit business-approved minimum).
- Add regression tests for zero-cost rejection.

--------------------------------------------
## API: POST /api/v1/transactions/sales/draft
--------------------------------------------

Route Entry:
Global middleware/guards chain: `RequestContextMiddleware` -> `TenantContextMiddleware` -> `JwtAuthGuard` -> `TenantScopeGuard` -> global `ValidationPipe`.

Controller:
`TransactionsController.createSaleDraft()` (`src/transactions/transactions.controller.ts:62-74`)

Service:
`TransactionsService.createSaleDraft()` + helper `validateAndProcessSaleLines()` (`src/transactions/transactions.service.ts:98-164`, `726-759`)

Repository:
Prisma reads/writes: `customer.findFirst`, `product.findFirst`, `transaction.create`, `transactionLine.createMany`, `transaction.findFirst`.

DTO/Schema:
`CreateSaleDraftDto`, `SaleLineDto`.
DB: `transactions`, `transaction_lines`, `customers`, `products`.

Execution Trace:
1. Validates tenant/date/customer active state.
2. Validates products active and discount constraints; computes line and header totals.
3. Persists DRAFT sale and lines in one transaction.

Business Rules Observed:
- Customer/product must be ACTIVE and tenant-owned.
- Discount guard exists.

Missing Rules:
- DTO allows `unitPrice = 0` (`@Min(0)`), but posting spec requires `unit_price > 0`.

Security Risks:
- None critical.

Financial Risks:
- Zero-priced sales can reduce stock with zero receivable, distorting profitability and valuation.

Edge Case Failures:
- No explicit check that delivery fields are consistent with delivery type.

Concurrency Risks:
- Draft stage has no material race.

Test Coverage:
- Covered: `test/integration/transactions.integration.spec.ts` (happy path, future date, unknown/inactive customer).
- Missing: `unitPrice=0` rejection, line-discount edge tests for sale draft.

Verdict:
⚠ Risky

Required Fixes:
- Enforce `@Min(1)` for `unitPrice` unless zero-price sales are explicitly allowed with role/flag.
- Add tests for zero-price rejection.

--------------------------------------------
## API: POST /api/v1/transactions/supplier-payments/draft
--------------------------------------------

Route Entry:
Global middleware/guards chain: `RequestContextMiddleware` -> `TenantContextMiddleware` -> `JwtAuthGuard` -> `TenantScopeGuard` -> global `ValidationPipe`.

Controller:
`TransactionsController.createSupplierPaymentDraft()` (`src/transactions/transactions.controller.ts:76-85`)

Service:
`TransactionsService.createSupplierPaymentDraft()` (`src/transactions/transactions.service.ts:241-278`)

Repository:
Prisma reads/writes: `supplier.findFirst`, `paymentAccount.findFirst`, `transaction.create`.

DTO/Schema:
`CreateSupplierPaymentDraftDto`.
DB: `transactions`, `suppliers`, `payment_accounts`.

Execution Trace:
1. Validates tenant/date and supplier active state.
2. Validates payment account exists and ACTIVE.
3. Creates DRAFT `SUPPLIER_PAYMENT` transaction with amount.

Business Rules Observed:
- Amount integer >=1.
- Active supplier/account checks.

Missing Rules:
- No draft idempotency.

Security Risks:
- None critical.

Financial Risks:
- Status can change between draft and posting; post path does not re-check account active state for this type.

Edge Case Failures:
- Duplicate client retries can create duplicate drafts.

Concurrency Risks:
- Retry storms can multiply drafts.

Test Coverage:
- Covered: `test/integration/posting-supplier-payment.integration.spec.ts` draft checks.
- Missing: inactive status at post-time regression tests.

Verdict:
⚠ Risky

Required Fixes:
- Revalidate account/supplier status at posting for supplier payments.
- Add optional idempotency for draft creation.

--------------------------------------------
## API: POST /api/v1/transactions/supplier-returns/draft
--------------------------------------------

Route Entry:
Global middleware/guards chain: `RequestContextMiddleware` -> `TenantContextMiddleware` -> `JwtAuthGuard` -> `TenantScopeGuard` -> global `ValidationPipe`.

Controller:
`TransactionsController.createSupplierReturnDraft()` (`src/transactions/transactions.controller.ts:98-107`)

Service:
`TransactionsService.createSupplierReturnDraft()` (`src/transactions/transactions.service.ts:319-425`)

Repository:
Prisma + raw SQL: `supplier.findFirst`, `transactionLine.findFirst`, `$queryRaw` returned-qty aggregate, `transaction.create`, `transactionLine.createMany`.

DTO/Schema:
`CreateSupplierReturnDraftDto`, `SupplierReturnLineDto`.
DB: `transactions`, `transaction_lines`.

Execution Trace:
1. Validates supplier active and date not future.
2. Per line: validates source line belongs to POSTED PURCHASE for supplier; computes returnable quantity via aggregate of posted returns.
3. Creates DRAFT supplier return and source-linked lines.

Business Rules Observed:
- Strict source linkage to posted purchases.
- Return quantity check against historical posted returns.

Missing Rules:
- No cumulative check when the same `sourceTransactionLineId` appears multiple times in one request.
- No stock-availability validation at draft or persisted warning.

Security Risks:
- None critical in route auth.

Financial Risks:
- Over-return can be drafted by splitting duplicate source lines in one payload.

Edge Case Failures:
- Duplicate source line IDs can bypass intended cap.

Concurrency Risks:
- Draft checks are non-locking; concurrent draft creation may both pass.

Test Coverage:
- Covered: `test/integration/posting-supplier-return.integration.spec.ts` (happy paths, wrong supplier, over-return across prior returns, tenant isolation).
- Missing: duplicate source line in same request payload.

Verdict:
❌ Unsafe

Required Fixes:
- Enforce uniqueness of `sourceTransactionLineId` within payload.
- Validate aggregated requested quantity per source line.

--------------------------------------------
## API: POST /api/v1/transactions/{id}/post
--------------------------------------------

Route Entry:
Global middleware/guards chain: `RequestContextMiddleware` -> `TenantContextMiddleware` -> `JwtAuthGuard` -> `TenantScopeGuard` -> global `ValidationPipe`.

Controller:
`TransactionsController.post()` (`src/transactions/transactions.controller.ts:158-171`)

Service:
`TransactionsService.post()` -> `PostingService.post()` -> type-specific handlers (`src/transactions/transactions.service.ts:166-177`, `src/transactions/posting.service.ts:18-1059`).

Repository:
Prisma serializable transaction + raw SQL across:
`transactions`, `transaction_lines`, `inventory_movements`, `ledger_entries`, `payment_entries`, `allocations`, `products`, `payment_accounts`.

DTO/Schema:
`PostTransactionDto`, `PaymentAllocationItemDto`.
DB constraints: unique `(tenant_id, idempotency_key)`, unique `(tenant_id, type, series, document_number)`.

Execution Trace:
1. Service ensures transaction exists for tenant, then posting service starts SERIALIZABLE DB transaction.
2. Posting service checks idempotency/status and dispatches by transaction type to create immutable entry rows and assign document number.
3. Full transaction graph is returned from DB (`fetchFullTransaction`) or errors (400/404/409/422).

Business Rules Observed:
- Atomic posting via single serializable transaction.
- Idempotency key enforced per tenant and per transaction lifecycle.
- Stock enforcement exists for `SALE`.
- Allocations have over-allocation checks and tenant/entity linkage checks.

Missing Rules:
- `SUPPLIER_RETURN` posting does not enforce stock availability before `SUPPLIER_RETURN_OUT`.
- `ADJUSTMENT` posting has no role check (any authenticated tenant user can post an adjustment draft created by admin).
- `ADJUSTMENT_OUT` has no stock check.
- `CUSTOMER_RETURN` does not require `returnHandling`; it is optional despite API contract saying selection is required.
- Return posting still validates each return line independently; duplicate source lines in one draft can over-return when aggregated.
- Supplier/customer payment posting does not re-check account active status before money movement.

Security Risks:
- Privilege escalation path: non-admin can post adjustment drafts (`postAdjustment` lacks role guard).

Financial Risks:
- Negative inventory possible through supplier returns and adjustment-out posting without stock checks.
- Over-return possible via duplicate source-line aggregation bug.
- Refund/store-credit behavior ambiguity when `returnHandling` omitted.

Edge Case Failures:
- For non-purchase txn types, top-level payment prevalidation uses `receivedNow`; extraneous fields can trigger unrelated validation errors.
- No automatic retry on serialization conflicts; API returns 409 requiring client retry logic.

Concurrency Risks:
- Serializable isolation reduces race windows, but code relies on client retries for `P2034` conflicts.
- Document number generation by `count+1` can conflict under concurrency; conflict handling is partial (serialization handled, other DB conflicts not normalized).

Test Coverage:
- Covered broadly by:
  - `test/integration/posting-purchase.integration.spec.ts`
  - `test/integration/posting-sale.integration.spec.ts`
  - `test/integration/posting-supplier-payment.integration.spec.ts`
  - `test/integration/posting-customer-payment.integration.spec.ts`
  - `test/integration/posting-supplier-return.integration.spec.ts`
  - `test/integration/posting-customer-return.integration.spec.ts`
  - `test/integration/posting-internal-transfer.integration.spec.ts`
  - `test/integration/posting-adjustment.integration.spec.ts`
  - `test/integration/posting-concurrency.integration.spec.ts`
  - `test/integration/ztester-payment-attacks.integration.spec.ts`
- Missing high-risk cases:
  - supplier return with insufficient current stock
  - adjustment posting by non-admin user
  - adjustment-out stock exhaustion
  - duplicate source line in same return draft
  - missing `returnHandling` behavior contract test
  - post-time inactive account/customer/supplier transition

Verdict:
❌ Unsafe

Required Fixes:
- Add stock checks for `SUPPLIER_RETURN_OUT` and `ADJUSTMENT_OUT` before writes.
- Enforce role check inside `postAdjustment`.
- Require `returnHandling` for customer returns at post-time.
- Aggregate duplicate source-line quantities during return validation (draft + post).
- Revalidate active status of account/entity at posting for payment txn types.
- Add regression tests for all above scenarios.

