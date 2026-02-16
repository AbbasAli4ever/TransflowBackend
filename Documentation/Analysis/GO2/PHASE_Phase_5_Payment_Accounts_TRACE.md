# PHASE TRACE REPORT

Title:
Phase 5 — Payment Accounts

--------------------------------------------
## API: GET /api/v1/payment-accounts
--------------------------------------------

Route Entry:
- Global prefix: `/api/v1` (`src/main.ts`)
- Route: `GET /payment-accounts` (`src/payment-accounts/payment-accounts.controller.ts`, `findAll`)
- Middleware chain: `RequestContextMiddleware` -> `TenantContextMiddleware` (`src/app.module.ts`)
- Guard chain: `JwtAuthGuard` -> `TenantScopeGuard` -> `RolesGuard` (`src/app.module.ts`)

Controller:
- `PaymentAccountsController.findAll(@Query() query: ListPaymentAccountsQueryDto)`

Service:
- `PaymentAccountsService.findAll(query)`

Repository:
- Prisma direct calls via `PrismaService`:
  - `paymentAccount.findMany`
  - `paymentAccount.count`

DTO/Schema:
- Query DTO: `ListPaymentAccountsQueryDto` + `PaginationQueryDto`
- DB model: `PaymentAccount` (`prisma/schema.prisma`)

Execution Trace:
1. Request enters global middleware; request context and tenant/user context are populated from JWT.
2. `JwtAuthGuard` enforces authentication; `TenantScopeGuard` enforces tenant presence; `RolesGuard` allows because endpoint has no `@Roles` metadata.
3. Validation pipe transforms/validates query (`page`, `limit`, optional `type`, optional `status`), rejects unknown query fields.
4. Controller forwards query to service.
5. Service resolves `tenantId` from async context; if missing, throws `UnauthorizedException`.
6. Service builds `where = { tenantId }`; adds `status` unless `ALL`; adds `type` if provided.
7. Service executes `findMany` and `count` in parallel; orders by `name ASC`; paginates by skip/take.
8. Service returns `paginateResponse({ data, meta })`.

Business Rules Observed:
- Tenant isolation is enforced at query level (`where: { tenantId }`).
- Default status filter is `ACTIVE` unless explicitly `ALL`.
- Type filter restricted to `CASH|BANK|WALLET|CARD`.

Missing Rules:
- No search support despite phase docs discussing searchable master lists.
- API docs/DTO advertise `_computed`, but list response returns raw rows only.

Security Risks:
- No endpoint-specific tests for unauthorized access (401) on this read endpoint.

Financial Risks:
- Consumers may assume `_computed.currentBalance` exists (per response DTO/docs) and make wrong financial decisions when field is absent.

Edge Case Failures:
- No tests for invalid `status`/`type` query combinations beyond happy path.
- No tests for page/limit boundaries on this endpoint.

Concurrency Risks:
- Low for read path; no write side effects.

Test Coverage:
- Integration: pagination success, type filter, tenant isolation (`test/integration/payment-accounts.integration.spec.ts`).
- Missing: auth failure, validation boundary tests, response-contract tests for `_computed`.

Verdict:
⚠ Risky

Required Fixes:
- Align runtime response with documented contract: either return `_computed` or change DTO/spec.
- Add integration tests for unauthorized access and query boundary validation.

--------------------------------------------
## API: GET /api/v1/payment-accounts/{id}
--------------------------------------------

Route Entry:
- Route: `GET /payment-accounts/:id` (`PaymentAccountsController.findOne`)
- `:id` parsed by `ParseUUIDPipe`
- Same middleware and guards as above

Controller:
- `findOne(@Param('id', ParseUUIDPipe) id: string)`

Service:
- `PaymentAccountsService.findOne(id)`

Repository:
- Prisma direct call: `paymentAccount.findFirst({ where: { id, tenantId } })`

DTO/Schema:
- Param validation: UUID pipe
- DB model: `PaymentAccount`

Execution Trace:
1. Middleware and guards run (auth + tenant context).
2. `ParseUUIDPipe` rejects malformed IDs with 400.
3. Controller passes validated `id` to service.
4. Service reads `tenantId` from context; throws 401 if absent.
5. Service queries `payment_accounts` with both `id` and `tenantId`.
6. If no row, throws `NotFoundException('Payment account not found')`.
7. Returns raw account record.

Business Rules Observed:
- Cross-tenant lookup returns 404 by design (tenant-scoped find).

Missing Rules:
- No computed balance payload despite DTO advertising `_computed`.

Security Risks:
- Read allowed to any authenticated role (no role restriction). This may be intended but is not explicitly documented in endpoint contract.

Financial Risks:
- Missing computed fields can cause client-side fallback calculations or stale assumptions.

Edge Case Failures:
- No integration test for invalid UUID on this endpoint.

Concurrency Risks:
- Low for read path.

Test Coverage:
- Integration: success, cross-tenant 404.
- Security integration: cross-tenant read blocked.
- Missing: invalid UUID 400, unauthenticated 401, contract parity for `_computed`.

Verdict:
⚠ Risky

Required Fixes:
- Resolve `_computed` contract drift.
- Add explicit tests for UUID validation and unauthenticated access.

--------------------------------------------
## API: GET /api/v1/payment-accounts/{id}/balance
--------------------------------------------

Route Entry:
- Route: `GET /payment-accounts/:id/balance` (`PaymentAccountsController.getBalance`)
- `:id` validated by `ParseUUIDPipe`
- Same middleware/guards chain

Controller:
- `getBalance(@Param('id', ParseUUIDPipe) id: string)`

Service:
- `PaymentAccountsService.getBalance(id)`

Repository:
- Prisma direct:
  - `paymentAccount.findFirst({ where: { id, tenantId } })`
  - raw SQL aggregate on `payment_entries`

DTO/Schema:
- Response DTO: `PaymentAccountBalanceResponseDto`
- DB models: `PaymentAccount`, `PaymentEntry`
- Index support: `@@index([tenantId, paymentAccountId, transactionDate])` on `payment_entries`

Execution Trace:
1. Middleware + guards enforce auth and tenant context.
2. UUID parsing on `id`.
3. Service validates tenant context and account existence in same tenant.
4. Service executes SQL:
   - `total_in = SUM(amount where direction='IN')`
   - `total_out = SUM(amount where direction='OUT')`
5. `safeMoney` converts bigint aggregates to JS numbers with MAX_SAFE_INTEGER guard.
6. Service computes `currentBalance = openingBalance + totalIn - totalOut`.
7. Returns `{ paymentAccountId, openingBalance, totalIn, totalOut, currentBalance }`.

Business Rules Observed:
- Balance is derived from append-only `payment_entries` + `openingBalance`.
- Tenant isolation enforced in both account existence check and SQL predicate.

Missing Rules:
- No as-of-date parameter (current balance only); acceptable for this endpoint, but not explicitly documented as current-only behavior.
- No overflow guard on final `currentBalance` arithmetic after `safeMoney` conversion.

Security Risks:
- None found beyond standard auth/tenant controls.

Financial Risks:
- Potential precision overflow on final arithmetic (`openingBalance + totalIn - totalOut`) is not explicitly guarded.
- If `_computed` is expected elsewhere, contract inconsistency may cause duplicated balance logic in clients.

Edge Case Failures:
- No tests for extreme values near JS safe-integer bounds.
- No test for malformed UUID on this route.

Concurrency Risks:
- Read is non-atomic with concurrent writes (normal for current-state read APIs); snapshot inconsistency is possible during heavy write traffic.

Test Coverage:
- Integration coverage is strong for normal finance flows (opening only, money out, money in, mixed, unknown account, cross-tenant access) in `test/integration/balance-queries.integration.spec.ts`.
- Missing: numeric boundary tests and malformed UUID test.

Verdict:
⚠ Risky

Required Fixes:
- Add explicit safe-range guard for final `currentBalance` computation.
- Add stress/boundary tests for large aggregate sums.

--------------------------------------------
## API: PATCH /api/v1/payment-accounts/{id}
--------------------------------------------

Route Entry:
- Route: `PATCH /payment-accounts/:id` (`PaymentAccountsController.update`)
- Guarded by `@Roles('OWNER', 'ADMIN')`
- Same middleware + global guards

Controller:
- `update(@Param('id', ParseUUIDPipe) id, @Body() dto: UpdatePaymentAccountDto)`

Service:
- `PaymentAccountsService.update(id, dto)`

Repository:
- Prisma direct:
  - `paymentAccount.findFirst({ where: { id, tenantId } })`
  - `paymentAccount.update({ where: { id, tenantId }, data: dto })`

DTO/Schema:
- `UpdatePaymentAccountDto` (only optional `name`, length 2..100)
- Global validation pipe: whitelist + forbid non-whitelisted

Execution Trace:
1. Middleware sets request context; guards enforce auth/tenant; roles guard enforces OWNER/ADMIN.
2. UUID pipe validates `id`; validation pipe validates body and rejects unknown fields.
3. Service checks tenant context.
4. Service checks existence by `id + tenantId`; 404 if missing.
5. Service runs update with DTO data.
6. Prisma P2002 (duplicate name by unique index `[tenantId, name]`) mapped to 409.
7. Updated row returned.

Business Rules Observed:
- Only `name` is updatable via DTO; `type` and `openingBalance` updates are blocked at validation layer.
- Tenant isolation and cross-tenant 404 behavior are enforced.

Missing Rules:
- No normalization/trim on `name` before save.
- No reserved-name validation from implementation plan (`Cash`, `Bank`, etc.).

Security Risks:
- No integration test proving non-OWNER/ADMIN gets 403.

Financial Risks:
- Semantic duplicates (`"Cash"` vs `" cash "` vs case variants) can fragment account usage/reporting.

Edge Case Failures:
- Whitespace-only names can pass length checks.
- Empty payload behavior is not explicitly tested.

Concurrency Risks:
- Concurrent rename collisions rely on DB unique constraint (good); one request fails 409.

Test Coverage:
- Integration: rename success; type update rejected (400).
- Security integration: cross-tenant update blocked.
- Unit: duplicate name conflict mapping.
- Missing: 403 role tests, normalization tests, whitespace/case-variant duplication tests.

Verdict:
⚠ Risky

Required Fixes:
- Normalize `name` (`trim`, optional canonical case policy) before persistence.
- Add role-based authorization tests (403) and input-normalization tests.

--------------------------------------------
## API: PATCH /api/v1/payment-accounts/{id}/status
--------------------------------------------

Route Entry:
- Route: `PATCH /payment-accounts/:id/status` (`PaymentAccountsController.updateStatus`)
- Guarded by `@Roles('OWNER', 'ADMIN')`

Controller:
- `updateStatus(@Param('id', ParseUUIDPipe) id, @Body() dto: UpdateStatusDto)`

Service:
- `PaymentAccountsService.updateStatus(id, dto)`

Repository:
- Prisma direct + raw SQL:
  - `paymentAccount.findFirst`
  - `$queryRaw` balance check on `payment_entries`
  - `$transaction([paymentAccount.update, statusChangeLog.create])`

DTO/Schema:
- `UpdateStatusDto` (`status` ACTIVE/INACTIVE, optional `reason`)
- DB model: `StatusChangeLog`

Execution Trace:
1. Middleware/guards execute; roles guard enforces OWNER/ADMIN.
2. UUID + body validation occurs.
3. Service resolves tenant context and reads existing account (`id + tenantId`), else 404.
4. If target status is `INACTIVE`, service runs SQL to compute current balance:
   - `opening_balance + SUM(IN as +, OUT as -)`.
5. If computed balance is non-zero, throws 400.
6. Otherwise executes DB transaction:
   - updates payment account status
   - inserts `status_change_logs` audit row
7. Returns updated account.

Business Rules Observed:
- Deactivation is blocked when current balance != 0.
- Status changes are audit-logged.

Missing Rules:
- No same-status idempotency short-circuit; repeated requests still write audit rows.
- No requirement that `reason` be present when deactivating.
- API plan expected 409 for non-zero balance, implementation returns 400.

Security Risks:
- No integration tests for role-based 403 behavior on this privileged endpoint.

Financial Risks:
- TOCTOU race: non-zero-balance check happens before update transaction; concurrent posting can create payment entries between check and status update.
- Possible end state: account set INACTIVE despite becoming non-zero during race window.

Edge Case Failures:
- No tests for deactivation block on non-zero balance.
- No tests for status-change log insertion correctness.
- No tests for repeated same-status requests.

Concurrency Risks:
- High risk on deactivation path due check/update split across separate DB operations.
- No explicit lock on `payment_accounts` row during pre-check.

Test Coverage:
- Integration: only happy-path status update.
- Security integration: cross-tenant status update blocked.
- Unit: happy-path updateStatus.
- Missing: core negative path (non-zero balance), race/concurrency tests, 403 role tests, same-status idempotency tests.

Verdict:
❌ Unsafe

Required Fixes:
- Move balance check + status update into one serializable transaction with row-level lock strategy.
- Add concurrency tests for status-change vs payment posting races.
- Enforce and test explicit behavior for same-status updates and deactivation reason policy.
- Align error code semantics (400 vs 409) with chosen API contract and document it.

--------------------------------------------
## API: POST /api/v1/payment-accounts
--------------------------------------------

Route Entry:
- Route: `POST /payment-accounts` (`PaymentAccountsController.create`)
- Guarded by `@Roles('OWNER', 'ADMIN')`

Controller:
- `create(@Body() dto: CreatePaymentAccountDto)`

Service:
- `PaymentAccountsService.create(dto)`

Repository:
- Prisma direct:
  - `paymentAccount.create`

DTO/Schema:
- `CreatePaymentAccountDto`:
  - `name` required, string, length 2..100
  - `type` enum `CASH|BANK|WALLET|CARD`
  - `openingBalance` optional integer (negative allowed)
- DB unique constraint: `@@unique([tenantId, name])`

Execution Trace:
1. Middleware + guards run; roles guard limits to OWNER/ADMIN.
2. Validation pipe enforces DTO and blocks unknown fields.
3. Service reads `tenantId`/`userId` from context.
4. Service inserts `payment_accounts` row with tenant-scoped data.
5. On Prisma P2002, service maps to 409 duplicate-name conflict.
6. Returns created account.

Business Rules Observed:
- Name uniqueness is enforced at DB level per tenant.
- Negative opening balances are allowed (overdraft scenario).
- Money stored as integer (`openingBalance` int).

Missing Rules:
- No reserved-name restriction from implementation plan.
- No name trimming/canonicalization before uniqueness check.
- No idempotency key enforcement for this write endpoint despite high-level API conventions.

Security Risks:
- No integration test confirming non-OWNER/ADMIN role receives 403.

Financial Risks:
- Name normalization gaps can create semantically duplicate accounts and reporting ambiguity.

Edge Case Failures:
- Whitespace-only names can pass validation.
- Case-variant duplicates are not prevented by code (DB collation-dependent behavior).

Concurrency Risks:
- Duplicate create race is safely handled by DB unique constraint + 409 mapping.

Test Coverage:
- Integration: create success, opening balance positive/negative, duplicate-name conflict, invalid/missing type, unauthenticated 401.
- Unit: success + duplicate P2002 mapping.
- Missing: 403 role checks, name normalization/reserved-name tests, numeric boundary tests for opening balance.

Verdict:
⚠ Risky

Required Fixes:
- Add deterministic name normalization and reserved-name rule (or explicitly de-scope in contract).
- Add role-based 403 integration test coverage.
- Document or enforce idempotency policy for master-data writes.

--------------------------------------------
