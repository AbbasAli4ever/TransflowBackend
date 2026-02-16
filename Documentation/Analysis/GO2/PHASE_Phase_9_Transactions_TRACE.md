# PHASE TRACE REPORT

Title:
Phase 9 — Transactions

--------------------------------------------
## API: GET /api/v1/transactions
--------------------------------------------

Route Entry:
- Global prefix: `src/main.ts` (`/api/v1`)
- Middleware chain: `RequestContextMiddleware` -> `TenantContextMiddleware` (`src/app.module.ts`)
- Guard chain: `JwtAuthGuard` -> `TenantScopeGuard` -> `RolesGuard` (`src/app.module.ts`)

Controller:
- `TransactionsController.findAll` (`src/transactions/transactions.controller.ts`)

Service:
- `TransactionsService.findAll` (`src/transactions/transactions.service.ts`)

Repository:
- `prisma.transaction.findMany`
- `prisma.transaction.count`

DTO/Schema:
- `ListTransactionsQueryDto`
- `PaginationQueryDto`

Execution Trace:
1. Auth/tenant middleware+guards resolve user and `tenantId` into AsyncLocalStorage context.
2. Query params are validated/transformed (`page`, `limit`, enums, dates).
3. Service builds Prisma `where` with tenant filter and optional filters (`type`, `status`, date range, supplier/customer).
4. Service queries transactions with lines + total count in parallel.
5. Response is paginated with `paginateResponse`.

Business Rules Observed:
- Tenant isolation enforced in query (`where: { tenantId, ... }`).
- Max page size capped at 100 via shared pagination DTO.
- Sort field/order constrained by DTO.

Missing Rules:
- No validation that `dateFrom <= dateTo`.
- No field-level projection guard; always includes `transactionLines`.
- Swagger enums in controller are outdated (`RETURN`, `TRANSFER`, `VOID`) vs schema/runtime enums.

Security Risks:
- Any authenticated tenant user can list all tenant transactions; no role-based read scope.

Financial Risks:
- Consumers can mistakenly treat draft rows as finalized if UI does not enforce status checks.

Edge Case Failures:
- Large tenants may hit heavy payloads due always-included lines.

Concurrency Risks:
- Read path only; no write race in this endpoint.

Test Coverage:
- Covered in `test/integration/transactions.integration.spec.ts` for pagination, type/status filters, tenant isolation.
- Missing tests for `dateFrom/dateTo`, `supplierId/customerId`, and sorting permutations.

Verdict:
⚠ Risky

Required Fixes:
- Add range validation (`dateFrom <= dateTo`).
- Add optional `includeLines`/projection control.
- Align Swagger query enums with actual `TransactionType`/`TransactionStatus`.

--------------------------------------------
## API: GET /api/v1/transactions/allocations
--------------------------------------------

Route Entry:
- Global prefix + same middleware/guard chain as above.

Controller:
- `TransactionsController.listAllocations`

Service:
- `TransactionsService.listAllocations`

Repository:
- `prisma.allocation.findMany`
- `prisma.allocation.count`

DTO/Schema:
- `ListAllocationsQueryDto`

Execution Trace:
1. Auth/tenant context is established.
2. Query params are validated (`UUID`s, dates, page/limit).
3. Service builds allocation filter with `tenantId`, optional entity/doc/date filters.
4. Service loads allocations and related payment/applied transactions.
5. Paginated response is returned.

Business Rules Observed:
- Tenant isolation enforced (`where.tenantId`).
- Supports supplier/customer/document/date filters.

Missing Rules:
- `limit` has no upper bound (DoS risk).
- No validation that `dateFrom <= dateTo`.
- If both `purchaseId` and `saleId` are provided, `saleId` is silently ignored.
- No endpoint contract in `Documentation/docs/04-api-spec.md` for this route.

Security Risks:
- Unbounded `limit` allows very large result sets per request.

Financial Risks:
- Date filtering uses allocation `createdAt` instead of business `transactionDate`; reporting windows can diverge from finance expectations.

Edge Case Failures:
- Ambiguous behavior when both `supplierId` and `customerId` are sent.

Concurrency Risks:
- Read-only endpoint; no write race.

Test Coverage:
- Covered in `test/integration/allocations.integration.spec.ts` for basic list, supplier filter, purchase filter, pagination, tenant isolation, auth.
- Missing coverage for `customerId`, `saleId`, date filters, and extreme `limit` values.

Verdict:
⚠ Risky

Required Fixes:
- Add `@Max(100)` to `limit`.
- Validate mutual exclusivity/combinations for purchase/sale filters.
- Define explicit API contract for this endpoint in docs.
- Confirm and document whether date filters should use `createdAt` or transaction business date.

--------------------------------------------
## API: GET /api/v1/transactions/{id}
--------------------------------------------

Route Entry:
- Global prefix + same middleware/guard chain.

Controller:
- `TransactionsController.findOne` (UUID param pipe)

Service:
- `TransactionsService.findOne`

Repository:
- `prisma.transaction.findFirst` with deep includes

DTO/Schema:
- Path param validated by `ParseUUIDPipe`

Execution Trace:
1. Auth/tenant context is resolved.
2. `id` is validated as UUID at controller layer.
3. Service queries one transaction scoped by `tenantId`.
4. Includes lines, inventory/ledger/payment entries, supplier/customer.
5. Returns 404 if not found.

Business Rules Observed:
- Strict tenant scoping for lookup.
- Not found for cross-tenant IDs (no existence leakage).

Missing Rules:
- No read-scope RBAC beyond tenant-level authentication.

Security Risks:
- Full detail read is available to all authenticated tenant users.

Financial Risks:
- None directly on this read path.

Edge Case Failures:
- Large posted transactions with many related rows may create heavy payload/latency.

Concurrency Risks:
- Read-only path.

Test Coverage:
- Covered in `test/integration/transactions.integration.spec.ts` for success, unknown ID, tenant isolation, unauthenticated access.

Verdict:
✅ Safe

Required Fixes:
- Optional: add role-based read scopes if business policy requires least privilege.
- Optional: support selective include/summary mode for large records.

--------------------------------------------
## API: POST /api/v1/transactions/adjustments/draft
--------------------------------------------

Route Entry:
- Global prefix + same middleware/guard chain.

Controller:
- `TransactionsController.createAdjustmentDraft`

Service:
- `TransactionsService.createAdjustmentDraft`

Repository:
- `prisma.product.findFirst` (per line)
- `prisma.transaction.create`
- `prisma.transactionLine.createMany`

DTO/Schema:
- `CreateAdjustmentDraftDto`
- `AdjustmentLineDto`

Execution Trace:
1. Auth context resolved; service checks `userRole` is OWNER/ADMIN.
2. Validates non-future date.
3. For each line, validates product exists and is ACTIVE for tenant.
4. Creates ADJUSTMENT draft transaction and line rows in DB transaction.
5. Stores line direction/reason as JSON string in `transaction_lines.description`.

Business Rules Observed:
- OWNER/ADMIN gate enforced.
- Product activity and tenant checks enforced.

Missing Rules:
- No idempotency for draft creation (duplicate requests create duplicate drafts).
- No closed-period enforcement.
- Top-level `reason` in API docs is not accepted by DTO.

Security Risks:
- Role check is in service logic only (not declarative route metadata), which is easier to bypass in future refactors if service reuse changes.

Financial Risks:
- Adjustment intent metadata is serialized in free-form `description` JSON, not typed columns; future parsing drift can alter movement direction semantics.

Edge Case Failures:
- `@IsEnum(['IN','OUT'])` on array literal can accept index-like string values in class-validator edge cases.

Concurrency Risks:
- Draft creation is transactional; low race risk.

Test Coverage:
- Strong coverage in `test/integration/posting-adjustment.integration.spec.ts` and additional role/stock checks in `test/integration/transactions.integration.spec.ts`.
- Missing tests for malicious enum edge values and duplicate draft submissions.

Verdict:
⚠ Risky

Required Fixes:
- Replace array-literal enum validators with real TS enum/object validators.
- Add idempotency key support for draft creates or explicit duplicate-prevention policy.
- Align DTO with documented top-level `reason` field, or update docs.

--------------------------------------------
## API: POST /api/v1/transactions/customer-payments/draft
--------------------------------------------

Route Entry:
- Global prefix + same middleware/guard chain.

Controller:
- `TransactionsController.createCustomerPaymentDraft`

Service:
- `TransactionsService.createCustomerPaymentDraft`

Repository:
- `prisma.customer.findFirst`
- `prisma.paymentAccount.findFirst`
- `prisma.transaction.create`

DTO/Schema:
- `CreateCustomerPaymentDraftDto`

Execution Trace:
1. Auth/tenant context is resolved.
2. Date checked for future.
3. Customer and payment account are verified within tenant and ACTIVE.
4. CUSTOMER_PAYMENT draft is created with amount in subtotal/total.

Business Rules Observed:
- Tenant isolation and active-entity checks enforced.
- Amount min(1) enforced by DTO.

Missing Rules:
- No idempotency on draft endpoint.
- No closed-period enforcement.

Security Risks:
- Any authenticated tenant user can create payment drafts.

Financial Risks:
- No upper bound on amount; JS number overflow risk beyond safe integer range.

Edge Case Failures:
- No account currency/policy compatibility check (if multi-currency is introduced later).

Concurrency Risks:
- Duplicate draft creation possible under retries.

Test Coverage:
- Covered in `test/integration/posting-customer-payment.integration.spec.ts` for success, unknown customer, amount validation.
- Missing draft tests for unknown/inactive payment account, future date, and unauthenticated request.

Verdict:
⚠ Risky

Required Fixes:
- Add draft idempotency support.
- Add amount upper bounds (safe integer/business cap).
- Add missing integration tests for account status/date/auth paths.

--------------------------------------------
## API: POST /api/v1/transactions/customer-returns/draft
--------------------------------------------

Route Entry:
- Global prefix + same middleware/guard chain.

Controller:
- `TransactionsController.createCustomerReturnDraft`

Service:
- `TransactionsService.createCustomerReturnDraft`

Repository:
- `prisma.customer.findFirst`
- `prisma.transactionLine.findFirst` + source transaction include
- Raw SQL for prior returns aggregation
- `prisma.transaction.create` + `transactionLine.createMany`

DTO/Schema:
- `CreateCustomerReturnDraftDto`
- `CustomerReturnLineDto`

Execution Trace:
1. Auth/tenant context resolved; future date blocked.
2. Rejects duplicate `sourceTransactionLineId` in request.
3. Verifies customer ACTIVE and each source line belongs to posted SALE for same customer.
4. Computes returnable quantity from posted return history.
5. Creates CUSTOMER_RETURN draft with copied unit price from source lines.

Business Rules Observed:
- Strict source-line linkage and over-return prevention.
- Tenant isolation at every lookup.

Missing Rules:
- No idempotency for draft creation.
- No closed-period enforcement.
- API docs include per-line `reason`; DTO rejects it (whitelist+forbid mode).

Security Risks:
- None critical beyond standard tenant-wide write access.

Financial Risks:
- Return valuation ignores original line discounts: `lineTotal = qty * sourceLine.unitPrice` can over-credit AR/refund for discounted sales.

Edge Case Failures:
- Discounted-source partial returns can produce rounding/allocation inconsistencies (no explicit rounding rule).

Concurrency Risks:
- Draft-time over-return check is non-locking; race is mitigated later at posting, but users can still create conflicting drafts.

Test Coverage:
- Good coverage for happy path and source-line validation in `test/integration/posting-customer-return.integration.spec.ts` + wave tests in `test/integration/transactions.integration.spec.ts`.
- Missing tests for discounted-source valuation correctness and request `reason` compatibility.

Verdict:
❌ Unsafe

Required Fixes:
- Recompute return value from original effective per-unit amount (consider discount and partial-return rounding policy).
- Add explicit rounding policy for partial discounted returns.
- Align DTO with documented `reason` fields or fix docs.
- Add discounted-return regression tests.

--------------------------------------------
## API: POST /api/v1/transactions/internal-transfers/draft
--------------------------------------------

Route Entry:
- Global prefix + same middleware/guard chain.

Controller:
- `TransactionsController.createInternalTransferDraft`

Service:
- `TransactionsService.createInternalTransferDraft`

Repository:
- `prisma.paymentAccount.findFirst` (from/to)
- `prisma.transaction.create`

DTO/Schema:
- `CreateInternalTransferDraftDto`

Execution Trace:
1. Auth/tenant context resolved.
2. Future dates blocked.
3. Validates from != to account.
4. Verifies both accounts exist, tenant-scoped, ACTIVE.
5. Creates INTERNAL_TRANSFER draft with amount.

Business Rules Observed:
- Same-account transfer blocked.
- Active account checks enforced.

Missing Rules:
- No idempotency for draft create.
- No closed-period enforcement.
- No optional policy check for insufficient source-account balance.

Security Risks:
- Any authenticated user can initiate transfer drafts.

Financial Risks:
- If business policy requires non-negative cash/bank balances, draft/post path currently allows overdraft scenarios.

Edge Case Failures:
- Very large amounts not bounded by safe integer caps.

Concurrency Risks:
- Duplicate drafts under client retries.

Test Coverage:
- Strong draft-path coverage in `test/integration/posting-internal-transfer.integration.spec.ts` (same account, unknown account, future date, auth).

Verdict:
⚠ Risky

Required Fixes:
- Add draft idempotency.
- Define and enforce source-account overdraft policy.
- Add amount upper bounds.

--------------------------------------------
## API: POST /api/v1/transactions/purchases/draft
--------------------------------------------

Route Entry:
- Global prefix + same middleware/guard chain.

Controller:
- `TransactionsController.createPurchaseDraft`

Service:
- `TransactionsService.createPurchaseDraft`
- helper: `validateAndProcessPurchaseLines`

Repository:
- `prisma.supplier.findFirst`
- `prisma.product.findFirst` (per line)
- `prisma.transaction.create`
- `prisma.transactionLine.createMany`

DTO/Schema:
- `CreatePurchaseDraftDto`
- `PurchaseLineDto`

Execution Trace:
1. Auth/tenant context resolved.
2. Future date blocked.
3. Supplier validated as ACTIVE.
4. Each line product validated ACTIVE; discount bounded by line gross.
5. Service computes subtotal/discount/delivery/total and persists draft + lines in one DB transaction.

Business Rules Observed:
- Strict tenant/entity status checks.
- Integer money and non-negative discount enforcement.

Missing Rules:
- No idempotency for draft creation.
- No closed-period restriction.

Security Risks:
- Any authenticated tenant user can create purchase drafts.

Financial Risks:
- No max bounds on quantity/unitCost/total beyond int checks; potential precision loss in JS arithmetic at extreme values.

Edge Case Failures:
- Duplicate product lines in same draft are allowed without explicit normalization rule.

Concurrency Risks:
- Duplicate drafts can be created via retries.

Test Coverage:
- Strong draft-path coverage in `test/integration/transactions.integration.spec.ts` (valid create, discounts, future date, unknown/inactive entities, validation).

Verdict:
⚠ Risky

Required Fixes:
- Add draft idempotency strategy.
- Add safe integer/business caps.
- Define duplicate-line policy.

--------------------------------------------
## API: POST /api/v1/transactions/sales/draft
--------------------------------------------

Route Entry:
- Global prefix + same middleware/guard chain.

Controller:
- `TransactionsController.createSaleDraft`

Service:
- `TransactionsService.createSaleDraft`
- helper: `validateAndProcessSaleLines`

Repository:
- `prisma.customer.findFirst`
- `prisma.product.findFirst` (per line)
- `prisma.transaction.create`
- `prisma.transactionLine.createMany`

DTO/Schema:
- `CreateSaleDraftDto`
- `SaleLineDto`

Execution Trace:
1. Auth/tenant context resolved.
2. Future date blocked.
3. Customer validated ACTIVE.
4. Product lines validated ACTIVE; discount bounded.
5. Totals computed and SALE draft persisted with lines.

Business Rules Observed:
- Tenant/entity validation and integer money checks.

Missing Rules:
- No idempotency for draft creation.
- No closed-period restriction.

Security Risks:
- Any authenticated tenant user can create sales drafts.

Financial Risks:
- No upper bounds for quantity/unitPrice totals; possible numeric precision corruption at large values.

Edge Case Failures:
- Duplicate product lines can be posted as separate rows without deterministic merge rule.

Concurrency Risks:
- Duplicate draft creation under retries.

Test Coverage:
- Covered in `test/integration/transactions.integration.spec.ts` for success and key validation errors.
- Missing explicit tests for unknown/inactive products in SALE draft path (present in PURCHASE path).

Verdict:
⚠ Risky

Required Fixes:
- Add draft idempotency.
- Add numeric upper bounds.
- Add missing SALE draft validation tests for product status/not-found.

--------------------------------------------
## API: POST /api/v1/transactions/supplier-payments/draft
--------------------------------------------

Route Entry:
- Global prefix + same middleware/guard chain.

Controller:
- `TransactionsController.createSupplierPaymentDraft`

Service:
- `TransactionsService.createSupplierPaymentDraft`

Repository:
- `prisma.supplier.findFirst`
- `prisma.paymentAccount.findFirst`
- `prisma.transaction.create`

DTO/Schema:
- `CreateSupplierPaymentDraftDto`

Execution Trace:
1. Auth/tenant context resolved.
2. Future date blocked.
3. Supplier/account validated as tenant-scoped and ACTIVE.
4. SUPPLIER_PAYMENT draft created with amount in totals.

Business Rules Observed:
- Active-entity checks enforced.
- Positive amount enforced.

Missing Rules:
- No draft idempotency.
- No closed-period restriction.

Security Risks:
- Any authenticated tenant user can create supplier payment drafts.

Financial Risks:
- No safe upper bound on payment amount.

Edge Case Failures:
- Notes type has only length guard in DTO (less explicit than typed string+length pattern used elsewhere).

Concurrency Risks:
- Retry duplicates can create multiple drafts.

Test Coverage:
- Strong draft coverage in `test/integration/posting-supplier-payment.integration.spec.ts` (404s, min amount, future date, auth).

Verdict:
⚠ Risky

Required Fixes:
- Add idempotent draft creation.
- Add amount caps and normalize input validation consistency.

--------------------------------------------
## API: POST /api/v1/transactions/supplier-returns/draft
--------------------------------------------

Route Entry:
- Global prefix + same middleware/guard chain.

Controller:
- `TransactionsController.createSupplierReturnDraft`

Service:
- `TransactionsService.createSupplierReturnDraft`

Repository:
- `prisma.supplier.findFirst`
- `prisma.transactionLine.findFirst` + source transaction include
- Raw SQL over posted returns
- `prisma.transaction.create` + `transactionLine.createMany`

DTO/Schema:
- `CreateSupplierReturnDraftDto`
- `SupplierReturnLineDto`

Execution Trace:
1. Auth/tenant context resolved and date validated.
2. Duplicate source-line IDs are rejected.
3. Supplier ACTIVE is verified.
4. Each source line is validated as posted PURCHASE for same supplier.
5. Prior returns are aggregated; over-return blocked.
6. Draft is created with unit cost copied from source line.

Business Rules Observed:
- Source traceability and over-return checks enforced.
- Tenant isolation on all lookups.

Missing Rules:
- No draft idempotency.
- No closed-period restriction.
- API docs show per-line `reason`; DTO rejects it.

Security Risks:
- No critical auth gap beyond tenant-wide write scope.

Financial Risks:
- Return valuation ignores original purchase discount effects; can overstate AP decrease/credit on discounted purchases.

Edge Case Failures:
- Partial discounted returns lack documented rounding distribution.

Concurrency Risks:
- Draft-time returnable check is non-locking; conflicting drafts can coexist until posting.

Test Coverage:
- Good coverage in `test/integration/posting-supplier-return.integration.spec.ts` and wave tests.
- Missing discounted-purchase return valuation tests and request-shape compatibility tests for documented `reason`.

Verdict:
❌ Unsafe

Required Fixes:
- Base return valuation on original effective unit amount (line total / qty) with deterministic rounding.
- Add discounted-return test matrix.
- Align DTO/docs for line reason fields.
- Add optional duplicate-draft prevention/idempotency.

--------------------------------------------
## API: POST /api/v1/transactions/{id}/post
--------------------------------------------

Route Entry:
- Global prefix + same middleware/guard chain.

Controller:
- `TransactionsController.post`

Service:
- `TransactionsService.post` (tenant check + transaction existence)
- `PostingService.post` (type-dispatched posting engine)

Repository:
- Transactional Prisma writes to:
  - `transactions`
  - `transaction_lines` (read)
  - `inventory_movements`
  - `ledger_entries`
  - `payment_entries`
  - `allocations`
  - `products` (avg cost updates)
- Raw SQL for stock and outstanding/returnable calculations

DTO/Schema:
- `PostTransactionDto`
- `PaymentAllocationItemDto`

Execution Trace:
1. Controller validates UUID; body validates idempotency and optional posting params.
2. Service ensures transaction exists in tenant.
3. Posting service opens SERIALIZABLE DB transaction.
4. Idempotency checks: same key on already-posted returns prior result; different key conflicts.
5. Type-specific posting logic executes (PURCHASE/SALE/SUPPLIER_PAYMENT/CUSTOMER_PAYMENT/SUPPLIER_RETURN/CUSTOMER_RETURN/INTERNAL_TRANSFER/ADJUSTMENT).
6. Posting updates transaction to POSTED with document number and generates immutable entry rows.
7. Returns fully loaded posted transaction.

Business Rules Observed:
- Atomic posting under DB transaction.
- Serializable isolation and conflict mapping for `P2034`.
- Idempotency key uniqueness enforced per tenant.
- No-negative-stock checks for SALE, SUPPLIER_RETURN, ADJUSTMENT_OUT.
- Manual/auto allocation logic with supplier/customer ownership validation.

Missing Rules:
- No closed-period enforcement for posting.
- Only `P2034` is mapped; other concurrency errors (e.g., unique collision `P2002`) are not normalized.
- `paidNow/receivedNow` semantics are not strictly type-gated in DTO.
- Draft endpoints are non-idempotent despite architecture-level write-idempotency requirement.

Security Risks:
- Most posting types have no role restriction (all authenticated tenant users can post).

Financial Risks:
- Return postings inherit potentially overstated draft totals for discounted source lines.
- Document number generation uses `count + 1`; uniqueness relies on race retries rather than a deterministic sequence primitive.
- No numeric upper-bound guards for large monetary values.

Edge Case Failures:
- `@IsEnum(['REFUND_NOW','STORE_CREDIT'])` is array-literal-based; edge enum values may bypass intent checks.

Concurrency Risks:
- Sequence generation via count can race under concurrent posting.
- Manual allocation outstanding checks are race-safe under SERIALIZABLE, but user-facing failures depend on conflict retries.

Test Coverage:
- Extensive integration coverage across:
  - `test/integration/posting-purchase.integration.spec.ts`
  - `test/integration/posting-sale.integration.spec.ts`
  - `test/integration/posting-supplier-payment.integration.spec.ts`
  - `test/integration/posting-customer-payment.integration.spec.ts`
  - `test/integration/posting-supplier-return.integration.spec.ts`
  - `test/integration/posting-customer-return.integration.spec.ts`
  - `test/integration/posting-internal-transfer.integration.spec.ts`
  - `test/integration/posting-adjustment.integration.spec.ts`
  - `test/integration/posting-concurrency.integration.spec.ts`
- Missing tests for discounted-return valuation, enum edge payloads, and `P2002` collision normalization behavior.

Verdict:
❌ Unsafe

Required Fixes:
- Replace document-number count strategy with sequence/atomic counter table.
- Normalize Prisma unique conflicts (`P2002`) to deterministic 409 domain errors.
- Fix return valuation for discounted source lines with explicit rounding policy.
- Enforce strict type-specific posting payload validation.
- Add closed-period posting guard.

