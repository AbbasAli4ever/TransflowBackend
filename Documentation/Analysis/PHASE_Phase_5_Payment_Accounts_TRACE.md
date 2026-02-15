# PHASE TRACE REPORT

Title:
Phase 5 — Payment Accounts

--------------------------------------------
## API: GET /api/v1/payment-accounts
--------------------------------------------

Route Entry:
`main.ts` global prefix `/api/v1` + global `ValidationPipe`; `RequestContextMiddleware` sets requestId; `TenantContextMiddleware` parses bearer JWT into async context (best-effort); `JwtAuthGuard` enforces JWT auth; `TenantScopeGuard` requires `request.user.tenantId` and sets tenant/user context.
Controller:
`PaymentAccountsController.findAll(@Query() query)`
Service:
`PaymentAccountsService.findAll(query)`
Repository:
`PrismaService.paymentAccount.findMany()` + `PrismaService.paymentAccount.count()`
DTO/Schema:
`ListPaymentAccountsQueryDto` (inherits `PaginationQueryDto`): `page>=1`, `limit<=100`, optional `type` enum, optional `status` enum default `ACTIVE`; `payment_accounts` table with tenant scoping and unique `(tenant_id,name)`.

Execution Trace:
1. Request query is validated/transformed by global ValidationPipe (whitelist+forbid unknown query fields).
2. Service pulls `tenantId` from async request context; missing tenant => `401 UnauthorizedException`.
3. Service builds `where={tenantId}` plus optional `status`/`type`, runs paginated `findMany` ordered by `name asc` and total `count`.
4. Service maps each row through `withComputed()` and returns `paginateResponse({data,meta})`.

Business Rules Observed:
- Tenant isolation at service query layer (`where: { tenantId, ... }`).
- Default behavior excludes inactive records (`status` defaults to `ACTIVE`).
- Filter options: `type`, `status`, pagination.

Missing Rules:
- No search by account name despite other master-data modules using search patterns.
- `_computed` fields are hardcoded placeholders, not derived values.
- No role-based authorization (any authenticated role can list accounts).

Security Risks:
- Authorization is authentication-only; no RBAC restriction for sensitive finance master data.

Financial Risks:
- Response exposes `_computed.currentBalance/totalIn/totalOut/lastTransactionDate` as fixed zeros/null, which can mislead consumers into treating non-zero accounts as zero.

Edge Case Failures:
- No test for `status=INACTIVE` or `status=ALL` combined with pagination limits.
- No explicit normalization (`trim`, case-folding) of names shown in list (display consistency risk).

Concurrency Risks:
- Low for read path; no transactional consistency snapshot. Concurrent postings can make list stale between `findMany` and `count`.

Test Coverage:
- Covered: `test/integration/payment-accounts.integration.spec.ts` (pagination, type filter, tenant isolation).
- Unit behavior covered in `src/payment-accounts/payment-accounts.service.spec.ts`.
- Missing: explicit status-filter tests, pagination boundary tests (`page`, `limit`).

Verdict:
⚠ Risky

Required Fixes:
- Replace placeholder `_computed` values with true derived metrics or remove `_computed` from this endpoint.
- Add explicit tests for `status=ACTIVE/INACTIVE/ALL` and pagination edge boundaries.
- Add RBAC policy for who can enumerate finance accounts.

--------------------------------------------
## API: GET /api/v1/payment-accounts/{id}
--------------------------------------------

Route Entry:
`main.ts` global prefix + validation; request/tenant middleware; `JwtAuthGuard`; `TenantScopeGuard`.
Controller:
`PaymentAccountsController.findOne(@Param('id', ParseUUIDPipe) id)`
Service:
`PaymentAccountsService.findOne(id)`
Repository:
`PrismaService.paymentAccount.findFirst({ where: { id, tenantId } })`
DTO/Schema:
`ParseUUIDPipe` on `id`; `payment_accounts` row shape.

Execution Trace:
1. `id` is validated as UUID by `ParseUUIDPipe` (`400` on invalid format).
2. Service resolves `tenantId` from context; missing tenant => `401`.
3. Service queries account by `id+tenantId`; not found => `404 NotFoundException('Payment account not found')`.
4. Service returns record through `withComputed()`.

Business Rules Observed:
- Strict tenant scoping, including cross-tenant UUID probes returning 404.
- Consistent not-found behavior for unknown or foreign IDs.

Missing Rules:
- `_computed` values are not actually computed.
- No status-based access rule (inactive accounts are still retrievable, likely intended but undocumented).

Security Risks:
- No object-level authorization beyond tenant boundary (role/permission model absent).

Financial Risks:
- `_computed` fields are financially incorrect placeholders and can drive incorrect UI/decisions.

Edge Case Failures:
- No dedicated integration test for invalid UUID on this endpoint.
- No test asserting behavior for inactive account retrieval.

Concurrency Risks:
- Minimal read-only race risk.

Test Coverage:
- Covered: `test/integration/payment-accounts.integration.spec.ts` (happy path + cross-tenant 404), `test/integration/security.integration.spec.ts` (tenant isolation attack).
- Unit not-found covered in `src/payment-accounts/payment-accounts.service.spec.ts`.

Verdict:
⚠ Risky

Required Fixes:
- Compute `_computed` from `payment_entries` and latest transaction date, or remove it from payload.
- Add explicit invalid-UUID and inactive-account retrieval tests.

--------------------------------------------
## API: GET /api/v1/payment-accounts/{id}/balance
--------------------------------------------

Route Entry:
`main.ts` global prefix + validation; request/tenant middleware; `JwtAuthGuard`; `TenantScopeGuard`.
Controller:
`PaymentAccountsController.getBalance(@Param('id', ParseUUIDPipe) id)`
Service:
`PaymentAccountsService.getBalance(id)`
Repository:
`PrismaService.paymentAccount.findFirst()` + `PrismaService.$queryRaw` on `payment_entries`
DTO/Schema:
`ParseUUIDPipe` on `id`; SQL sums `payment_entries.amount` by `direction` (`IN`/`OUT`) for `tenant_id` + `payment_account_id`; adds `opening_balance` from `payment_accounts`.

Execution Trace:
1. `id` UUID validated; tenant context enforced.
2. Service verifies account exists in current tenant; else `404`.
3. Raw SQL aggregates `SUM(CASE WHEN direction='IN' THEN amount ELSE 0 END)` and `SUM(...'OUT'...)` with parameterized UUIDs.
4. Service converts `bigint` sums to JS `number`, computes `currentBalance = openingBalance + totalIn - totalOut`.
5. Returns `{paymentAccountId, openingBalance, totalIn, totalOut, currentBalance}`.

Business Rules Observed:
- Balance is derived from immutable payment entries + opening balance.
- Tenant filter applied both at account lookup and aggregate query.
- SQL uses bound parameters (`$queryRaw` template literal), preventing SQL injection.

Missing Rules:
- No as-of-date support on this endpoint (only current cumulative balance).
- No safeguard for numeric overflow/safe-integer boundaries when converting `bigint` totals.
- No explicit filter to `POSTED` transactions; relies on invariant that only posted transactions create `payment_entries`.

Security Risks:
- Low direct injection risk due parameterized query.
- Same RBAC gap (any authenticated tenant user can read all account balances).

Financial Risks:
- `bigint -> number` conversion can lose precision for large cumulative balances, causing silent monetary drift in API output.

Edge Case Failures:
- Potential precision loss when totals exceed `Number.MAX_SAFE_INTEGER`.
- No explicit handling for corrupted negative `payment_entries.amount` values (would skew balance).

Concurrency Risks:
- Read consistency is non-transactional; balance may reflect intermediate state during concurrent postings (eventual consistency for reads).

Test Coverage:
- Strong integration coverage in `test/integration/balance-queries.integration.spec.ts`: no transactions, MONEY_OUT, MONEY_IN, mixed in/out, unknown ID, tenant isolation.
- Missing: very large totals/precision stress, internal-transfer-specific two-leg reconciliation test for this endpoint.

Verdict:
⚠ Risky

Required Fixes:
- Return monetary aggregates as stringified bigint or enforce safe-range checks before casting.
- Add precision/overflow tests and explicit reconciliation tests with transfer legs.
- Consider optional `asOfDate` for audit/reconciliation parity with reports endpoint.

--------------------------------------------
## API: PATCH /api/v1/payment-accounts/{id}
--------------------------------------------

Route Entry:
`main.ts` global prefix + validation; request/tenant middleware; `JwtAuthGuard`; `TenantScopeGuard`.
Controller:
`PaymentAccountsController.update(@Param('id', ParseUUIDPipe) id, @Body() dto)`
Service:
`PaymentAccountsService.update(id, dto)`
Repository:
`PrismaService.paymentAccount.findFirst()` then `PrismaService.paymentAccount.update()`
DTO/Schema:
`UpdatePaymentAccountDto` permits only optional `name` (2..100 chars). Validation whitelist forbids non-declared fields.

Execution Trace:
1. `id` validated as UUID; body validated against `UpdatePaymentAccountDto`.
2. Service checks tenant context and existence (`findFirst` by `id+tenantId`), else 404.
3. Service executes update with `data: dto`; Prisma unique violation `P2002` mapped to `409 ConflictException`.
4. Updated entity returned with placeholder `_computed` block.

Business Rules Observed:
- Type and opening balance are effectively immutable through this endpoint (DTO excludes them).
- Duplicate name protection enforced via DB unique `(tenant_id,name)`.
- Tenant-scoped updates only.

Missing Rules:
- No normalization of `name` (trim/case policy) before uniqueness check.
- No explicit guard for empty PATCH payload (currently accepted, no-op update semantics).
- No domain checks for reserved names documented in implementation plan.

Security Risks:
- RBAC missing for master-data mutation (any authenticated role can rename payment accounts).

Financial Risks:
- Returning placeholder `_computed` can propagate false financial data immediately after update.
- Name changes are allowed regardless of posting history; audit note/reason not captured.

Edge Case Failures:
- No explicit test for duplicate rename through this endpoint (integration).
- No test for invalid UUID and not-found in this specific endpoint suite.

Concurrency Risks:
- Lost-update risk on concurrent renames (last write wins; no optimistic version check).

Test Coverage:
- Integration: `test/integration/payment-accounts.integration.spec.ts` validates successful rename and rejection of non-whitelisted `type` update.
- Cross-tenant mutation blocked in `test/integration/security.integration.spec.ts`.
- Unit: duplicate conflict path covered.
- Missing: no-op patch, duplicate rename integration, invalid UUID path.

Verdict:
⚠ Risky

Required Fixes:
- Add `name` normalization (`trim`, canonical case policy) and corresponding unique policy.
- Reject empty update payloads with clear 400.
- Add endpoint tests for duplicate rename, invalid UUID, and no-op behavior.
- Introduce RBAC for mutation endpoints.

--------------------------------------------
## API: PATCH /api/v1/payment-accounts/{id}/status
--------------------------------------------

Route Entry:
`main.ts` global prefix + validation; request/tenant middleware; `JwtAuthGuard`; `TenantScopeGuard`.
Controller:
`PaymentAccountsController.updateStatus(@Param('id', ParseUUIDPipe) id, @Body() dto)`
Service:
`PaymentAccountsService.updateStatus(id, dto)`
Repository:
`PrismaService.paymentAccount.findFirst()` then `PrismaService.paymentAccount.update()`
DTO/Schema:
`UpdateStatusDto`: `status` in `ACTIVE|INACTIVE`, optional `reason` string.

Execution Trace:
1. `id` UUID validated; body validated (`status` enum, optional `reason`).
2. Service loads tenant context and checks account existence by `id+tenantId`; not found => 404.
3. Service updates `status` only; ignores `reason` entirely.
4. Returns updated account via `withComputed()` placeholder values.

Business Rules Observed:
- Status transition constrained to ACTIVE/INACTIVE.
- Cross-tenant status changes blocked at service query layer.

Missing Rules:
- No check preventing inactivation of non-zero-balance account (explicitly required in implementation plan text).
- `reason` is accepted but not persisted anywhere (audit trail gap).
- No idempotent short-circuit when requested status already equals current.
- No check for downstream operational impact (e.g., disabling account with pending settlements).

Security Risks:
- RBAC absent; any authenticated role can deactivate/activate payment accounts.

Financial Risks:
- Deactivating account with funds can strand operational cash movement workflows (draft creation/posting paths require active account).
- Missing deactivation rationale undermines auditability for financial control actions.
- Placeholder `_computed` returned as zeros.

Edge Case Failures:
- No test for inactive->inactive idempotent behavior.
- No test for inactivation with non-zero balance.
- No test asserting `reason` persistence (it is currently dropped).

Concurrency Risks:
- Concurrent status toggles are last-write-wins with no version check.

Test Coverage:
- Basic happy path in `test/integration/payment-accounts.integration.spec.ts`.
- Cross-tenant status mutation blocked in `test/integration/security.integration.spec.ts`.
- Missing most business-rule tests for status transitions.

Verdict:
❌ Unsafe

Required Fixes:
- Enforce `cannot inactivate when currentBalance != 0` (or define explicit override flow).
- Persist `reason` to audit trail (e.g., notes/audit table/event log).
- Add transition validation and idempotent semantics tests.
- Restrict status changes to privileged roles.

--------------------------------------------
## API: POST /api/v1/payment-accounts
--------------------------------------------

Route Entry:
`main.ts` global prefix + validation; request/tenant middleware; `JwtAuthGuard`; `TenantScopeGuard`.
Controller:
`PaymentAccountsController.create(@Body() dto)`
Service:
`PaymentAccountsService.create(dto)`
Repository:
`PrismaService.paymentAccount.create()`
DTO/Schema:
`CreatePaymentAccountDto`: `name` string 2..100, `type` enum (`CASH|BANK|WALLET|CARD`), optional integer `openingBalance` (default 0); DB unique `(tenant_id,name)`.

Execution Trace:
1. Body validated/transformed by ValidationPipe; unknown fields rejected.
2. Service reads `tenantId` and `userId` from context; missing tenant => 401.
3. Service inserts account row with tenant scoping and optional `createdBy`, catches Prisma `P2002` to return 409 on duplicate name.
4. Returns created row with `withComputed()` placeholder values.

Business Rules Observed:
- Enforces allowed account types and integer money input.
- Allows negative opening balances (consistent with overdraft use case).
- Tenant-scoped uniqueness enforced by DB constraint and conflict mapping.

Missing Rules:
- No reserved-name validation (`Cash`, `Bank`, etc.) despite documented requirement.
- No `name` normalization (leading/trailing spaces and case variants can bypass practical uniqueness expectations).
- No explicit numeric range guard for `openingBalance` (DB overflow can surface as unhandled 500).
- No role-based restriction for account creation.

Security Risks:
- Mutation allowed for all authenticated roles.

Financial Risks:
- `_computed` financial fields are hardcoded zeros on create response.
- Potential integer overflow path for very large opening balances can cause unpredictable failures.

Edge Case Failures:
- Names differing only by case/whitespace may coexist depending DB collation and input formatting.
- Very large absolute opening balances may cause DB error (not mapped to domain error).

Concurrency Risks:
- Concurrent duplicate-name creates rely on DB unique index; one request correctly fails with 409.

Test Coverage:
- Integration (`test/integration/payment-accounts.integration.spec.ts`): happy path, opening balance, negative opening balance, duplicate name, invalid/missing type, auth required.
- Unit (`src/payment-accounts/payment-accounts.service.spec.ts`): success, duplicate conflict, missing-tenant unauthorized.
- Missing: reserved-name validation, whitespace/case normalization, overflow/error-mapping tests.

Verdict:
⚠ Risky

Required Fixes:
- Implement input normalization + reserved-name policy.
- Add explicit bounded integer validation for opening balances.
- Remove or correctly compute `_computed` in create response.
- Add RBAC enforcement for account creation.
