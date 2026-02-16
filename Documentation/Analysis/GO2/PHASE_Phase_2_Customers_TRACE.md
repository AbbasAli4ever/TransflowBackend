# PHASE TRACE REPORT

Title:
Phase 2 — Customers

--------------------------------------------
## API: GET /api/v1/customers
--------------------------------------------

Route Entry:
`src/main.ts` global prefix + validation pipe, then global guards in `src/app.module.ts`.

Controller:
`CustomersController.findAll` (`src/customers/customers.controller.ts:44`).

Service:
`CustomersService.findAll` (`src/customers/customers.service.ts:37`).

Repository:
Prisma ORM `customer.findMany` + `customer.count` (`src/customers/customers.service.ts:57-65`).

DTO/Schema:
`ListCustomersQueryDto` (`src/customers/dto/list-customers-query.dto.ts`) + `PaginationQueryDto` (`src/common/dto/pagination-query.dto.ts`).
DB model/index: `Customer` + `@@index([tenantId, name])` (`prisma/schema.prisma:192-212`).

Execution Trace:
1. Request enters `api/v1/customers` with JWT; `JwtAuthGuard` authenticates (`src/common/guards/jwt-auth.guard.ts:12-23`).
2. `TenantScopeGuard` requires `user.tenantId` and writes request context (`src/common/guards/tenant-scope.guard.ts:20-34`).
3. Query params are validated/transformed by global validation pipe (`src/common/pipes/validation.pipe.ts:21-33`).
4. Controller passes validated query DTO to service (`src/customers/customers.controller.ts:54-55`).
5. Service forces tenant scoping via `where: { tenantId }`, optional search/status filters, and controlled sort fields (`src/customers/customers.service.ts:44-55`).
6. Prisma executes paginated read + count; response shaped via `paginateResponse` (`src/common/utils/paginate.ts:1-10`).

Business Rules Observed:
- Tenant scoping required for all reads.
- Default filter excludes inactive customers (`status='ACTIVE'`).
- Search is case-insensitive on `name` and `phone`.
- Pagination has bounded `limit <= 100`.

Missing Rules:
- No explicit max length on `search` query.
- No deterministic secondary sort (same `name` can reorder between pages).

Security Risks:
- No direct SQL injection risk (Prisma ORM path).
- Read endpoint has no role restriction by design (any authenticated role can read).

Financial Risks:
- None direct (master-data list endpoint).

Edge Case Failures:
- Large same-name datasets can produce unstable page ordering.

Concurrency Risks:
- None critical; read-only endpoint.

Test Coverage:
- Covered: happy path, search, tenant isolation (`test/integration/customers.integration.spec.ts:80-117`).
- Missing: invalid query combos, invalid enum values, unauthenticated read case.

Verdict:
✅ Safe

Required Fixes:
- Add deterministic secondary sort (`id`) for stable pagination.
- Add query validation tests for invalid `status/sortBy/sortOrder`.

--------------------------------------------
## API: GET /api/v1/customers/{id}
--------------------------------------------

Route Entry:
Global middleware/guards/pipes as above.

Controller:
`CustomersController.findOne` (`src/customers/customers.controller.ts:58`).

Service:
`CustomersService.findOne` (`src/customers/customers.service.ts:70`).

Repository:
Prisma ORM `customer.findFirst({ where: { id, tenantId } })` (`src/customers/customers.service.ts:74-76`).

DTO/Schema:
Path UUID validation via `ParseUUIDPipe` (`src/customers/customers.controller.ts:65`).
DB model: `Customer` (`prisma/schema.prisma:192-212`).

Execution Trace:
1. JWT auth + tenant context enforced globally.
2. `ParseUUIDPipe` rejects malformed UUID before service call.
3. Service re-checks tenant context and fetches customer by `(id, tenantId)`.
4. Missing row returns `NotFoundException('Customer not found')`.
5. Raw customer row returned.

Business Rules Observed:
- Cross-tenant access is masked as 404.
- No soft-delete filter; inactive customers are still retrievable.

Missing Rules:
- No explicit projection; returns all customer columns (currently acceptable but brittle if sensitive fields added later).

Security Risks:
- Good tenant isolation at query level.

Financial Risks:
- None direct.

Edge Case Failures:
- None material in current schema.

Concurrency Risks:
- None critical; single-row read.

Test Coverage:
- Covered: success + cross-tenant 404 (`test/integration/customers.integration.spec.ts:119-141`).
- Missing: invalid UUID test and unauthenticated test for this route.

Verdict:
✅ Safe

Required Fixes:
- Add invalid UUID and unauthenticated integration tests.

--------------------------------------------
## API: GET /api/v1/customers/{id}/balance
--------------------------------------------

Route Entry:
Global middleware/guards/pipes as above.

Controller:
`CustomersController.getBalance` (`src/customers/customers.controller.ts:94`).

Service:
`CustomersService.getBalance` (`src/customers/customers.service.ts:142`).

Repository:
Prisma `customer.findFirst` + raw SQL aggregate on `ledger_entries` (`src/customers/customers.service.ts:146-159`).

DTO/Schema:
Path UUID via `ParseUUIDPipe`; response contract `CustomerBalanceResponseDto` (`src/customers/dto/customer-response.dto.ts:69-84`).
DB tables/indexes: `ledger_entries` with `@@index([tenantId, customerId, transactionDate])` (`prisma/schema.prisma:368-390`).

Execution Trace:
1. Auth + tenant scope enforced globally.
2. Controller validates UUID and calls service.
3. Service verifies customer exists under tenant.
4. Raw SQL sums AR ledger entries:
   - `AR_INCREASE` => `totalSales`
   - `AR_DECREASE` => `totalReceived`
5. `safeMoney` converts bigint -> number with overflow guard (`src/common/utils/money.ts:13-19`).
6. Response returns `currentBalance = totalSales - totalReceived`.

Business Rules Observed:
- Balance is derived from append-only ledger entries (invariant-aligned).
- Tenant filter applied in SQL.

Missing Rules:
- No breakdown separating customer payments vs customer returns inside `AR_DECREASE`.
- No `asOfDate` parameter (point-in-time balance not supported on this endpoint).

Security Risks:
- SQL is parameterized via Prisma tagged template; no injection vector.

Financial Risks:
- `totalReceived` is semantically overloaded: includes returns (`CUSTOMER_RETURN`) and actual payments. This can mislead collections and reconciliation consumers while `currentBalance` remains numerically correct.

Edge Case Failures:
- If ledger sums exceed JS safe range, endpoint throws 500 by design (`safeMoney`), which is safer than silent corruption but still operationally disruptive.

Concurrency Risks:
- Read committed snapshot may lag concurrent postings; acceptable for query endpoint.

Test Coverage:
- Covered: no transactions, sale impact, payment impact, unknown id, cross-tenant (`test/integration/balance-queries.integration.spec.ts:238-341`).
- Missing: customer return effect on `totalReceived`, credit-balance scenarios, overflow boundary behavior.

Verdict:
⚠ Risky

Required Fixes:
- Split response into `totalPaymentsReceived` and `totalReturns` (or rename field to `totalArDecrease`).
- Add customer-return and credit-balance integration tests.

--------------------------------------------
## API: GET /api/v1/customers/{id}/open-documents
--------------------------------------------

Route Entry:
Global middleware/guards/pipes as above.

Controller:
`CustomersController.getOpenDocuments` (`src/customers/customers.controller.ts:105`).

Service:
`CustomersService.getOpenDocuments` (`src/customers/customers.service.ts:172`).

Repository:
Prisma `customer.findFirst` + raw SQL over `transactions` left-joined `allocations` (`src/customers/customers.service.ts:181-207`).

DTO/Schema:
Path UUID via `ParseUUIDPipe`.
DB tables/indexes: `transactions` (`prisma/schema.prisma:258-310`), `allocations` (`prisma/schema.prisma:422-440`).

Execution Trace:
1. Auth + tenant context validated.
2. Service confirms customer exists in tenant.
3. SQL fetches POSTED SALE documents, computes:
   - `paid_amount = SUM(allocations.amount_applied)`
   - `outstanding = total_amount - paid_amount`
   - filters only `outstanding > 0`.
4. Service maps bigint fields with `safeMoney`; returns summary and documents.

Business Rules Observed:
- Only POSTED SALE transactions considered.
- Outstanding is allocation-based (explicit settlement model).
- Tenant scoping enforced in both transaction and allocation filters.

Missing Rules:
- Does not account for customer-return credits (`AR_DECREASE`) when computing open document outstanding.
- Does not expose allocation details (payment document refs/date), despite plan examples.
- No `asOfDate` or `includeFullyPaid` support.

Security Risks:
- Parameterized SQL; no injection risk.

Financial Risks:
- High reconciliation risk: open-document totals can diverge from true AR after returns/credits because only allocations are considered.
- Frontend collection screens can overstate collectible amount.

Edge Case Failures:
- Cross-tenant customer open-documents behavior is not directly tested.
- Unauthenticated access for customer open-documents not directly tested.

Concurrency Risks:
- Read-time race acceptable; no write.

Test Coverage:
- Covered: no sales, posted sale appears, unknown customer (`test/integration/open-documents.integration.spec.ts:182-240`).
- Missing: partial/full settlement via customer payment allocations, cross-tenant access, returns/credit impact.

Verdict:
❌ Unsafe

Required Fixes:
- Include return-credit adjustment logic or explicit credit application model in outstanding computation.
- Add integration tests for: partial allocation, full payment exclusion, cross-tenant 404, and return-credit scenarios.
- Add query options (`asOfDate`, `includeFullyPaid`) or remove from docs.

--------------------------------------------
## API: PATCH /api/v1/customers/{id}
--------------------------------------------

Route Entry:
Global middleware/guards/pipes + roles guard.

Controller:
`CustomersController.update` (`src/customers/customers.controller.ts:69`).

Service:
`CustomersService.update` (`src/customers/customers.service.ts:82`).

Repository:
Prisma `customer.findFirst` then `customer.update` (`src/customers/customers.service.ts:86-95`).

DTO/Schema:
`UpdateCustomerDto` (`src/customers/dto/update-customer.dto.ts`) + UUID pipe.
DB uniqueness for names enforced by functional index (`prisma/migrations/20260215100000_add_uniqueness_indexes/migration.sql:7-8`).

Execution Trace:
1. JWT + tenant guards validate request; `@Roles('OWNER','ADMIN')` enforced by `RolesGuard`.
2. Body validated against `UpdateCustomerDto` (all fields optional).
3. Service verifies customer exists in tenant.
4. Prisma update executes with tenant-scoped where; unique conflicts converted to 409.
5. Updated row returned.

Business Rules Observed:
- Only OWNER/ADMIN can modify customer master data.
- Duplicate names blocked by DB unique index and mapped to Conflict.

Missing Rules:
- No guard against empty patch body (`{}`) even though implementation plan calls for 400 on no fields.
- No normalization for phone/address/notes (name is trimmed, others are not).

Security Risks:
- Authorization logic is metadata-based and centrally enforced; no obvious bypass in this path.

Financial Risks:
- Moderate data-quality risk (empty updates/no-op updates can pollute audit chronology via `updatedAt`).

Edge Case Failures:
- Potentially accepts whitespace-only optional fields for non-name attributes.

Concurrency Risks:
- Last-write-wins; no optimistic concurrency/version check.

Test Coverage:
- Covered: happy path update + cross-tenant denial (in separate security suite) (`test/integration/customers.integration.spec.ts:143-156`, `test/integration/security.integration.spec.ts:113-124`).
- Missing: duplicate-name conflict on update, empty payload rejection, role-forbidden (STAFF), invalid UUID.

Verdict:
⚠ Risky

Required Fixes:
- Reject empty update payloads.
- Add role-forbidden and duplicate-update tests.
- Optionally trim/sanitize optional text fields.

--------------------------------------------
## API: PATCH /api/v1/customers/{id}/status
--------------------------------------------

Route Entry:
Global middleware/guards/pipes + roles guard.

Controller:
`CustomersController.updateStatus` (`src/customers/customers.controller.ts:82`).

Service:
`CustomersService.updateStatus` (`src/customers/customers.service.ts:103`).

Repository:
Prisma `customer.findFirst`, raw SQL balance check on `ledger_entries`, then Prisma transaction with `customer.update` + `statusChangeLog.create` (`src/customers/customers.service.ts:107-137`).

DTO/Schema:
`UpdateStatusDto` (`src/common/dto/update-status.dto.ts`) + UUID pipe.
DB log table: `status_change_logs` (`prisma/schema.prisma:487-500`).

Execution Trace:
1. JWT + tenant + role (`OWNER|ADMIN`) enforced.
2. DTO validates `status in {ACTIVE, INACTIVE}`; `reason` optional.
3. Service confirms customer ownership by tenant.
4. If inactivating, SQL computes net AR (`AR_INCREASE - AR_DECREASE`) and blocks only when balance > 0.
5. Transaction atomically updates customer status and inserts status-change audit row.

Business Rules Observed:
- Cannot deactivate with outstanding receivable balance.
- Status change is audit-logged.

Missing Rules:
- `reason` is not required for deactivation.
- Rule checks only positive AR; negative AR (customer credit liability) does not block deactivation.
- No pending-draft/open-document checks.

Security Risks:
- No direct injection risk; all SQL parameters bound.

Financial Risks:
- Deactivation can proceed while tenant owes customer credit (negative balance), potentially hiding liabilities from active master-data workflows.

Edge Case Failures:
- Status can be set to same current value, still logs another status-change entry (idempotency not enforced).

Concurrency Risks:
- TOCTOU race: balance check occurs outside the transaction that updates status. A concurrent posting can create AR between check and commit.

Test Coverage:
- Covered: basic status update + cross-tenant denial (`test/integration/customers.integration.spec.ts:158-170`, `test/integration/security.integration.spec.ts:126-137`).
- Missing: outstanding-balance block, negative-credit deactivation policy, reason validation, status log assertions, concurrency race tests.

Verdict:
❌ Unsafe

Required Fixes:
- Move balance check inside a single serializable transaction with row-level lock on customer.
- Enforce deactivation policy for any non-zero net balance (or document why credits are exempt).
- Make `reason` mandatory for `INACTIVE` with max length.
- Add invariant and concurrency tests.

--------------------------------------------
## API: POST /api/v1/customers
--------------------------------------------

Route Entry:
Global middleware/guards/pipes + roles guard.

Controller:
`CustomersController.create` (`src/customers/customers.controller.ts:33`).

Service:
`CustomersService.create` (`src/customers/customers.service.ts:21`).

Repository:
Prisma `customer.create` (`src/customers/customers.service.ts:27-29`).

DTO/Schema:
`CreateCustomerDto` (`src/customers/dto/create-customer.dto.ts`).
DB uniqueness from functional index `customers_tenant_name_ci_unique` (`prisma/migrations/20260215100000_add_uniqueness_indexes/migration.sql:7-8`).

Execution Trace:
1. JWT + tenant scope + roles enforce authenticated OWNER/ADMIN only.
2. Body validation enforces required `name` length and optional field max lengths.
3. Service reads tenant/user from request context and persists record with `tenantId` and `createdBy`.
4. DB unique violation (`P2002`) is mapped to `409 Customer name already exists`.
5. New customer row returned.

Business Rules Observed:
- Tenant ownership is server-assigned, not client-supplied.
- Case-insensitive duplicate names prevented at DB layer.

Missing Rules:
- No fuzzy duplicate warning workflow described in implementation plan.
- No explicit idempotency handling for create endpoint.

Security Risks:
- Good role restriction and tenant-scoped writes.

Financial Risks:
- Low direct financial risk (master-data creation).

Edge Case Failures:
- Optional text fields are not trimmed; can store inconsistent whitespace.

Concurrency Risks:
- Concurrent duplicate creation handled by DB unique index + 409 mapping.

Test Coverage:
- Covered: create success, duplicate, missing name, auth required, case-insensitive duplicate, concurrent duplicate (`test/integration/customers.integration.spec.ts:40-77`, `174-203`).
- Missing: role-forbidden (STAFF), max-length boundary checks for optional fields.

Verdict:
✅ Safe

Required Fixes:
- Add role-forbidden test and field-boundary validation tests.
- Optionally add idempotency-key support if required by global API policy.

