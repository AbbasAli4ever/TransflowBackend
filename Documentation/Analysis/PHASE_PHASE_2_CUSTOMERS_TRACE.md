# PHASE TRACE REPORT

Title:
Phase 2 — Customers

--------------------------------------------
## API: GET /api/v1/customers
--------------------------------------------

Route Entry:
- `src/customers/customers.controller.ts:42`

Controller:
- `CustomersController.findAll(@Query() query: ListCustomersQueryDto)`

Service:
- `CustomersService.findAll(query)` in `src/customers/customers.service.ts:36`

Repository:
- `prisma.customer.findMany({ where, skip, take, orderBy })`
- `prisma.customer.count({ where })`

DTO/Schema:
- Query DTO: `src/customers/dto/list-customers-query.dto.ts:5`
- Pagination DTO: `src/common/dto/pagination-query.dto.ts`
- Validation pipe: `src/common/pipes/validation.pipe.ts:21`
- Customer table/index: `prisma/schema.prisma:176` and `prisma/schema.prisma:194`

Execution Trace:
1. Request enters global middleware chain (`RequestContextMiddleware`, `TenantContextMiddleware`) via `src/app.module.ts:73`.
2. `JwtAuthGuard` enforces JWT unless route is public (`src/common/guards/jwt-auth.guard.ts:12`).
3. `TenantScopeGuard` requires `request.user.tenantId` and injects tenant/user into async request context (`src/common/guards/tenant-scope.guard.ts:20`).
4. Global `ValidationPipe` transforms and validates query params (page/limit/status/sort). Invalid values trigger 400 (`src/common/pipes/validation.pipe.ts:21`).
5. Controller delegates to `customersService.findAll(query)`.
6. Service reads `tenantId` from request context; if missing, throws `UnauthorizedException`.
7. Service builds `where` with hard tenant filter, optional status filter (`ACTIVE` default), optional OR search on `name`/`phone`.
8. Service executes `findMany` + `count` in parallel and returns paginated response with placeholder `_computed`.

Business Rules Observed:
- Tenant scoping is mandatory in query (`where: { tenantId }`).
- Default listing excludes inactive records unless `status=ALL`.
- Query sort fields are constrained to `name` and `createdAt`.

Missing Rules:
- No role-based authorization boundary (all authenticated users can list all tenant customers).
- No explicit maximum search length guard (can increase DB load via large substring searches).

Security Risks:
- Low: broad tenant-internal read access without role checks.

Financial Risks:
- Low: endpoint is read-only master data listing; no direct financial mutation.

Edge Case Failures:
- No explicit test for invalid `status/sortBy/sortOrder/page/limit` response shape.

Concurrency Risks:
- None material for read path.

Test Coverage:
- Covered: pagination/search/tenant isolation in `test/integration/customers.integration.spec.ts:80`.
- Missing: unauthorized GET list test, invalid query value tests, sort/order behavior tests.

Verdict:
⚠ Risky

Required Fixes:
- Add integration tests for invalid query values and unauthorized access.
- Add role/permission policy if tenant users should not all see full customer directory.

--------------------------------------------
## API: GET /api/v1/customers/{id}
--------------------------------------------

Route Entry:
- `src/customers/customers.controller.ts:56`

Controller:
- `CustomersController.findOne(@Param('id', ParseUUIDPipe) id)`

Service:
- `CustomersService.findOne(id)` in `src/customers/customers.service.ts:69`

Repository:
- `prisma.customer.findFirst({ where: { id, tenantId } })`

DTO/Schema:
- Path validation: `ParseUUIDPipe` in controller param.
- Customer schema: `prisma/schema.prisma:176`.

Execution Trace:
1. Middleware and auth guards run as above.
2. `ParseUUIDPipe` rejects malformed UUID with 400 before service.
3. Service requires `tenantId` from request context.
4. Service queries `customers` by `id + tenantId`.
5. Missing record returns `NotFoundException('Customer not found')`.
6. Success returns customer + `_computed` placeholder object.

Business Rules Observed:
- Hard cross-tenant isolation by tenant-scoped lookup.
- 404 masking is used for cross-tenant IDs.

Missing Rules:
- No status gate (inactive customer can still be fetched; may be intended, not documented here).

Security Risks:
- Low: route correctly uses tenant-scoped lookup.

Financial Risks:
- Low: read-only master-data lookup.

Edge Case Failures:
- No explicit test for invalid UUID path at integration level.

Concurrency Risks:
- None material for read path.

Test Coverage:
- Covered: success + cross-tenant 404 in `test/integration/customers.integration.spec.ts:119`.
- Covered (security suite): cross-tenant read denial in `test/integration/security.integration.spec.ts:103`.
- Missing: unauthorized and invalid-UUID tests for this route.

Verdict:
✅ Safe

Required Fixes:
- Add tests for malformed UUID and unauthenticated call behavior.

--------------------------------------------
## API: GET /api/v1/customers/{id}/balance
--------------------------------------------

Route Entry:
- `src/customers/customers.controller.ts:90`

Controller:
- `CustomersController.getBalance(id)`

Service:
- `CustomersService.getBalance(id)` in `src/customers/customers.service.ts:122`

Repository:
- `prisma.customer.findFirst({ where: { id, tenantId } })`
- Raw SQL on `ledger_entries` via `prisma.$queryRaw`:
  - Sum `AR_INCREASE`
  - Sum `AR_DECREASE`

DTO/Schema:
- Path validation via `ParseUUIDPipe`.
- Ledger schema uses integer `amount`: `prisma/schema.prisma` (`LedgerEntry.amount Int`).
- Data-model invariant: only POSTED transactions should affect balances (`../Documentation/docs/02-data-model.md:67`).

Execution Trace:
1. Middleware + JWT guard + tenant scope guard establish tenant context.
2. Path UUID is validated by `ParseUUIDPipe`.
3. Service confirms customer belongs to tenant.
4. Service executes aggregate SQL on `ledger_entries` for this `tenant_id + customer_id`.
5. SQL returns bigint sums; service converts to JS `Number`.
6. Response shape: `{ customerId, totalSales, totalReceived, currentBalance }`.

Business Rules Observed:
- Balance is derived from ledger entries, not cached fields.
- Tenant and customer existence checks are enforced before aggregation.

Missing Rules:
- No `asOfDate` support for point-in-time balance on this endpoint.
- No explicit guard against numeric overflow when converting bigint aggregates to `Number`.

Security Risks:
- Low: raw SQL uses parameterized template and tenant/customer filters.

Financial Risks:
- Medium: `bigint -> Number` conversion can silently lose precision for large cumulative balances (`src/customers/customers.service.ts:141-142`).
- Medium: endpoint relies on invariant that only POSTED transactions produce ledger entries; no defensive join to `transactions.status`.

Edge Case Failures:
- Large historical ledgers can exceed JS safe integer range.
- Negative balances (customer credit) are possible and currently untested for this endpoint.

Concurrency Risks:
- Read-consistency risk only (standard snapshot effects under concurrent posting). No write hazard in this endpoint.

Test Coverage:
- Covered: zero/sale/payment/unknown/cross-tenant in `test/integration/balance-queries.integration.spec.ts:235`.
- Missing: huge-value precision test, negative credit-balance case, unauthorized and invalid-UUID tests.
- Unit coverage missing for `getBalance` path (`src/customers/customers.service.spec.ts` has no `getBalance` block).

Verdict:
⚠ Risky

Required Fixes:
- Return monetary aggregates as stringified integers (or `bigint` serialization strategy), not JS Number.
- Add `asOfDate` query option if required by reporting/business users.
- Add tests for credit balances and precision limits.

--------------------------------------------
## API: GET /api/v1/customers/{id}/open-documents
--------------------------------------------

Route Entry:
- `src/customers/customers.controller.ts:101`

Controller:
- `CustomersController.getOpenDocuments(id)`

Service:
- `CustomersService.getOpenDocuments(id)` in `src/customers/customers.service.ts:152`

Repository:
- `prisma.customer.findFirst({ where: { id, tenantId } })`
- Raw SQL on `transactions` + `allocations` via `prisma.$queryRaw`

DTO/Schema:
- Path UUID validation via `ParseUUIDPipe`.
- Transactions/allocations schema: `prisma/schema.prisma` (`Transaction.totalAmount Int`, `Allocation.amountApplied Int`).
- Phase plan specifies `asOfDate` and `includeFullyPaid` query options for open-docs (`../Documentation/IMPLEMENTATION_PLAN_PHASES_4-7.md:1887-1890`).

Execution Trace:
1. Middleware and global guards enforce authentication and tenant context.
2. `ParseUUIDPipe` validates `id`.
3. Service verifies tenant-owned customer exists.
4. SQL selects posted `SALE` transactions for that customer, left-joins allocations, computes `paid_amount` and `outstanding` per document.
5. Query filters `outstanding > 0` via HAVING and orders oldest first.
6. Service computes `totalOutstanding` in JS and maps rows into response document list.

Business Rules Observed:
- Only posted sales are considered (`t.status='POSTED'` + `t.type='SALE'`).
- Outstanding amount derives from transaction total minus allocations.

Missing Rules:
- No support for `asOfDate` / `includeFullyPaid` query controls documented in implementation plan.
- No allocation detail expansion in response (`allocations[]` not returned, despite documented example).
- No explicit filter that joined allocations come only from valid posted payment transactions (assumes allocation table integrity).

Security Risks:
- Low: tenant filter is present on both customer check and transaction/allocation query.

Financial Risks:
- Medium: same bigint-to-Number precision risk for `total_amount`, `paid_amount`, `outstanding` (`src/customers/customers.service.ts:189-201`).
- Medium: if future reversal/void flows leave historical allocations, current query may overstate paid amounts because it sums all allocations by document ID without payment-status qualification.

Edge Case Failures:
- No defensive handling for very large totals (precision).
- No tested behavior for partial/final customer-payment allocations on this customer endpoint.

Concurrency Risks:
- Read-only endpoint; no write race. Snapshot timing can make results briefly stale under concurrent posting.

Test Coverage:
- Covered: empty list, one open sale, unknown customer in `test/integration/open-documents.integration.spec.ts:182`.
- Missing: cross-tenant customer open-doc access test, unauthorized test, invalid UUID test, partial payment and fully-paid exclusion tests for customer path.
- Unit coverage missing for `getOpenDocuments` in `src/customers/customers.service.spec.ts`.

Verdict:
⚠ Risky

Required Fixes:
- Implement and validate `asOfDate`/`includeFullyPaid` query params (or update spec to remove them).
- Consider joining allocations to payment transactions with `status='POSTED'` to harden against future reversal semantics.
- Return money as safe integer strings and expand test matrix for customer-specific allocation scenarios.

--------------------------------------------
## API: PATCH /api/v1/customers/{id}
--------------------------------------------

Route Entry:
- `src/customers/customers.controller.ts:67`

Controller:
- `CustomersController.update(id, dto)`

Service:
- `CustomersService.update(id, dto)` in `src/customers/customers.service.ts:81`

Repository:
- `prisma.customer.findFirst({ where: { id, tenantId } })`
- Duplicate check: `prisma.customer.findFirst({ where: { tenantId, name equals insensitive, NOT { id }}})`
- Update: `prisma.customer.update({ where: { id, tenantId }, data: dto })`

DTO/Schema:
- Body DTO: `src/customers/dto/update-customer.dto.ts:5`
- Validation via global pipe (whitelist + forbidNonWhitelisted).
- DB currently has index on `(tenant_id, name)` but no unique key (`prisma/schema.prisma:194`).

Execution Trace:
1. Middleware/guards/auth/tenant context run.
2. `ParseUUIDPipe` validates path ID.
3. Body DTO validates optional fields and lengths; unknown keys are rejected.
4. Service checks tenant context and existing record.
5. If name changes, service performs case-insensitive duplicate lookup.
6. Service applies update and returns updated customer + `_computed` placeholder.

Business Rules Observed:
- Tenant-scoped update only.
- Name uniqueness is attempted at service layer (case-insensitive compare).

Missing Rules:
- No database-enforced unique customer name per tenant (service-only check is not race-safe).
- No check preventing updates on inactive/locked customer records.

Security Risks:
- Low: cross-tenant update blocked by tenant-scoped existence check.

Financial Risks:
- Medium: duplicate customer names can occur under concurrent writes due check-then-update race, increasing risk of posting against wrong master record.

Edge Case Failures:
- Empty PATCH `{}` is accepted and treated as no-op; behavior not explicitly documented.
- Service ignores potential normalization for phone/address/notes (name only is trimmed).

Concurrency Risks:
- High: non-atomic uniqueness guard around name update without DB unique constraint.

Test Coverage:
- Covered: happy-path update in `test/integration/customers.integration.spec.ts:143`.
- Covered: cross-tenant denial in `test/integration/security.integration.spec.ts:113`.
- Missing: duplicate-name conflict on update, 404 unknown ID, invalid UUID, bad payload validation, unauthorized.

Verdict:
⚠ Risky

Required Fixes:
- Add DB unique constraint for normalized customer name per tenant (e.g., unique index on `tenant_id, lower(name)`).
- Catch Prisma unique violation (`P2002`) and map to 409.
- Add full negative test coverage for update validations/conflicts.

--------------------------------------------
## API: PATCH /api/v1/customers/{id}/status
--------------------------------------------

Route Entry:
- `src/customers/customers.controller.ts:79`

Controller:
- `CustomersController.updateStatus(id, dto)`

Service:
- `CustomersService.updateStatus(id, dto)` in `src/customers/customers.service.ts:105`

Repository:
- `prisma.customer.findFirst({ where: { id, tenantId } })`
- `prisma.customer.update({ where: { id, tenantId }, data: { status: dto.status } })`

DTO/Schema:
- `UpdateStatusDto` allows only `ACTIVE|INACTIVE` + optional `reason`: `src/common/dto/update-status.dto.ts:4`
- Customer `status` is unconstrained text at DB level (`prisma/schema.prisma:183`).

Execution Trace:
1. Middleware and guards enforce authenticated tenant context.
2. Path UUID validated by `ParseUUIDPipe`.
3. DTO validates allowed status values at API boundary.
4. Service verifies tenant-owned record exists.
5. Service updates status field and returns entity.

Business Rules Observed:
- Soft status transition exists (`ACTIVE`/`INACTIVE`).
- Cross-tenant status mutation blocked.

Missing Rules:
- No rule preventing deactivation when customer has outstanding receivables/open documents.
- `reason` field is accepted but discarded (not persisted/audited).
- No DB CHECK constraint for allowed status values.

Security Risks:
- Low: tenant isolation is enforced.

Financial Risks:
- Medium: inactivating debt-bearing customers without guard can hide operationally critical counterparties while balances remain open.

Edge Case Failures:
- Missing audit trail for status-change rationale.

Concurrency Risks:
- Low: last-write-wins on status updates; no optimistic locking/version guard.

Test Coverage:
- Covered: happy path in `test/integration/customers.integration.spec.ts:158`.
- Covered: cross-tenant denial in `test/integration/security.integration.spec.ts:126`.
- Missing: invalid status payload, unknown ID, unauthorized, and outstanding-balance guard tests.

Verdict:
⚠ Risky

Required Fixes:
- Enforce status transition policy (block INACTIVE when open balance/documents exist, or require override workflow).
- Persist status-change reason and actor for auditability.
- Add DB CHECK for allowed status values.

--------------------------------------------
## API: POST /api/v1/customers
--------------------------------------------

Route Entry:
- `src/customers/customers.controller.ts:32`

Controller:
- `CustomersController.create(dto)`

Service:
- `CustomersService.create(dto)` in `src/customers/customers.service.ts:19`

Repository:
- Duplicate probe: `prisma.customer.findFirst({ where: { tenantId, name equals insensitive }})`
- Create: `prisma.customer.create({ data: { tenantId, createdBy, ...dto }})`

DTO/Schema:
- `CreateCustomerDto` (`name` required, 2..200, trim) in `src/customers/dto/create-customer.dto.ts:5`.
- Validation pipe strips/blocks unknown fields.
- DB schema: no unique key on customer name (`prisma/schema.prisma:194` index only).

Execution Trace:
1. Request passes middleware and auth guards; tenant/user are injected into request context.
2. Body is validated and transformed by global `ValidationPipe`.
3. Service reads tenant/user from context; missing tenant raises 401.
4. Service performs case-insensitive duplicate name check in same tenant.
5. If duplicate exists => 409 conflict.
6. Otherwise inserts customer row with tenant and createdBy.
7. Response returns created row + `_computed` placeholder object.

Business Rules Observed:
- Tenant-local name uniqueness intended.
- Customer creation is blocked without authenticated tenant context.

Missing Rules:
- No DB-level uniqueness enforcement for customer name.
- No canonical normalization for phone/address/notes beyond basic string constraints.

Security Risks:
- Low: authenticated-only and tenant-scoped creation.

Financial Risks:
- Medium: duplicate party creation under concurrent requests can fragment AR by creating semantically identical customers.

Edge Case Failures:
- Name uniqueness relies on application check only; race window remains.

Concurrency Risks:
- High: `findFirst` then `create` is non-atomic without unique constraint/transaction retry strategy.

Test Coverage:
- Covered: create success/duplicate/missing-name/auth in `test/integration/customers.integration.spec.ts:40`.
- Covered in unit: duplicate conflict and basic success in `src/customers/customers.service.spec.ts:28`.
- Missing: concurrent duplicate creation test, same-name across different tenants test, invalid-field whitelist rejection test.

Verdict:
⚠ Risky

Required Fixes:
- Add DB unique constraint for normalized `(tenant_id, name)` and handle `P2002`.
- Add concurrent create integration test (parallel POST with same name).
- Optionally normalize phone/address input and add validation regex for phone if business requires.
