# PHASE TRACE REPORT

Title:
Phase 8 — Suppliers

--------------------------------------------
## API: GET /api/v1/suppliers
--------------------------------------------

Route Entry:
- Global prefix `api/v1` is applied in `src/main.ts:27`.
- Controller route is `@Controller('suppliers')` + `@Get()` in `src/suppliers/suppliers.controller.ts:28` and `src/suppliers/suppliers.controller.ts:42`.
- Request flow middleware/guards:
  - `RequestContextMiddleware` sets request ID in `src/common/middleware/request-context.middleware.ts:8`.
  - `TenantContextMiddleware` parses bearer JWT context in `src/common/middleware/tenant-context.middleware.ts:11`.
  - `JwtAuthGuard` enforces auth in `src/common/guards/jwt-auth.guard.ts:12`.
  - `TenantScopeGuard` enforces `tenantId` in `src/common/guards/tenant-scope.guard.ts:23`.

Controller:
- `SuppliersController.findAll()` in `src/suppliers/suppliers.controller.ts:52`.

Service:
- `SuppliersService.findAll()` in `src/suppliers/suppliers.service.ts:36`.

Repository:
- Prisma `supplier.findMany` + `supplier.count` in `src/suppliers/suppliers.service.ts:56`.

DTO/Schema:
- Query DTO: `ListSuppliersQueryDto` in `src/suppliers/dto/list-suppliers-query.dto.ts:5`.
- Pagination base: `PaginationQueryDto` in `src/common/dto/pagination-query.dto.ts:5`.
- Validation pipe: `buildValidationPipe()` in `src/common/pipes/validation.pipe.ts:27`.

Execution Trace:
1. HTTP request enters middleware chain, request context is initialized.
2. JWT is validated by passport guard; tenant context is enforced by tenant scope guard.
3. Query params are transformed/validated (`page`, `limit`, `status`, `sortBy`, `sortOrder`).
4. Service reads `tenantId` from async context and hard-filters all supplier reads by tenant.
5. Optional status/search filters are applied; paginated query and count are executed in parallel.
6. Response is returned via `paginateResponse` with `_computed` placeholders.

Business Rules Observed:
- Tenant isolation is enforced in query where-clause.
- Default status filter is `ACTIVE` unless `status=ALL`.
- Sorting is allowlisted to `name|createdAt` and `asc|desc`.

Missing Rules:
- No business rule to exclude suppliers with soft-deleted semantics beyond status.
- `_computed` financial fields are placeholders (always zero) and not actual derived balances.

Security Risks:
- No direct injection path observed; query args are validated and sort fields are enum-restricted.

Financial Risks:
- Returned `_computed.totalPurchases` and `_computed.currentBalance` are always `0`, which can mislead downstream consumers.

Edge Case Failures:
- No normalization/trim on `search`; whitespace-only search can create noisy query behavior.

Concurrency Risks:
- Read endpoint; no write race in this path.

Test Coverage:
- Covered: pagination, search, tenant isolation in `test/integration/suppliers.integration.spec.ts:89`.
- Missing: unauthenticated access test, invalid query validation tests (bad `status`, `sortBy`, `limit` bounds), sort-order assertions.

Verdict:
⚠ Risky

Required Fixes:
- Replace `_computed` placeholders with real derived values or remove these fields from response contract.
- Add integration tests for auth rejection and query validation errors.

--------------------------------------------
## API: GET /api/v1/suppliers/{id}
--------------------------------------------

Route Entry:
- Controller route `@Get(':id')` in `src/suppliers/suppliers.controller.ts:56`.
- `ParseUUIDPipe` applied at controller param in `src/suppliers/suppliers.controller.ts:63`.
- Same global middleware/guards path as above.

Controller:
- `SuppliersController.findOne()` in `src/suppliers/suppliers.controller.ts:63`.

Service:
- `SuppliersService.findOne()` in `src/suppliers/suppliers.service.ts:69`.

Repository:
- Prisma `supplier.findFirst({ where: { id, tenantId }})` in `src/suppliers/suppliers.service.ts:73`.

DTO/Schema:
- Path UUID validated by Nest `ParseUUIDPipe`.

Execution Trace:
1. Request enters context/auth/tenant pipeline.
2. UUID is validated before service call.
3. Service enforces tenant context.
4. Supplier is loaded with `id + tenantId` filter.
5. 404 returned if missing; otherwise entity is returned with `_computed` placeholders.

Business Rules Observed:
- Cross-tenant read returns not-found behavior.

Missing Rules:
- No check for supplier status when fetching detail (ACTIVE/INACTIVE both returned).
- Placeholder `_computed` remains non-authoritative.

Security Risks:
- UUID parsing blocks malformed path IDs.
- Tenant isolation implemented at service query level.

Financial Risks:
- `_computed` financial fields are non-real values and can be consumed as truth by clients.

Edge Case Failures:
- None critical in this direct fetch path.

Concurrency Risks:
- None (read only).

Test Coverage:
- Covered: happy path, not-found, cross-tenant 404 in `test/integration/suppliers.integration.spec.ts:139`.
- Missing: explicit invalid UUID test and no-auth test for this route.

Verdict:
⚠ Risky

Required Fixes:
- Remove or correctly compute `_computed` financial fields.
- Add route-specific tests for invalid UUID and unauthenticated access.

--------------------------------------------
## API: GET /api/v1/suppliers/{id}/balance
--------------------------------------------

Route Entry:
- Controller route `@Get(':id/balance')` in `src/suppliers/suppliers.controller.ts:90`.
- `ParseUUIDPipe` at `src/suppliers/suppliers.controller.ts:97`.

Controller:
- `SuppliersController.getBalance()` in `src/suppliers/suppliers.controller.ts:97`.

Service:
- `SuppliersService.getBalance()` in `src/suppliers/suppliers.service.ts:122`.

Repository:
- Supplier existence check via Prisma `findFirst` at `src/suppliers/suppliers.service.ts:126`.
- Raw SQL against `ledger_entries` at `src/suppliers/suppliers.service.ts:131`.

DTO/Schema:
- Path UUID only.
- Response model documented as `SupplierBalanceResponseDto`.

Execution Trace:
1. Request passes middleware and auth/tenant guards.
2. UUID parsing runs.
3. Service verifies supplier belongs to tenant.
4. Raw SQL aggregates AP increases/decreases for tenant+supplier.
5. Bigint SQL sums are cast to JS `Number` and returned as `{ totalPurchases, totalPaid, currentBalance }`.

Business Rules Observed:
- Balance is derived from ledger entries (not stored in supplier table).
- Tenant filter is applied in aggregate query.

Missing Rules:
- No explicit `POSTED` transaction filter in query, despite canonical docs requiring posted-only derivation.
- No separation of AP decreases by source type; supplier returns and payments are merged into `totalPaid`.

Security Risks:
- SQL injection risk is low; query uses parameterized template values.

Financial Risks:
- `totalPaid` can be semantically wrong because `AP_DECREASE` includes non-payment events (e.g., supplier returns).
- Converting bigint to JS `Number` risks precision loss at large cumulative values.
- If non-posted ledger rows ever exist, this endpoint will include them.

Edge Case Failures:
- Negative balances (supplier credit) are returned but not explicitly typed/labeled; client may misinterpret.

Concurrency Risks:
- Read path only; no write race here.

Test Coverage:
- Covered: zero state, purchases, partial payment, accumulation, 404, tenant isolation in `test/integration/balance-queries.integration.spec.ts:136`.
- Missing: supplier return impact case, bigint/large-number case, invalid UUID/no-auth route tests.

Verdict:
⚠ Risky

Required Fixes:
- Join `transactions` and enforce `t.status = 'POSTED'` in balance query.
- Split returned fields into `totalPayments` and `totalReturns` (or rename `totalPaid` to `totalApDecrease`).
- Return money as string/int-safe format to avoid JS precision drift for large sums.

--------------------------------------------
## API: GET /api/v1/suppliers/{id}/open-documents
--------------------------------------------

Route Entry:
- Controller route `@Get(':id/open-documents')` in `src/suppliers/suppliers.controller.ts:101`.
- `ParseUUIDPipe` at `src/suppliers/suppliers.controller.ts:108`.

Controller:
- `SuppliersController.getOpenDocuments()` in `src/suppliers/suppliers.controller.ts:108`.

Service:
- `SuppliersService.getOpenDocuments()` in `src/suppliers/suppliers.service.ts:152`.

Repository:
- Supplier existence check via Prisma `findFirst`.
- Raw SQL reads `transactions` + `allocations` in `src/suppliers/suppliers.service.ts:161`.

DTO/Schema:
- Path UUID only.
- Swagger response type is unspecified (`@ApiOkResponse` has no schema type).

Execution Trace:
1. Auth/tenant context established via global pipeline.
2. UUID validated.
3. Service verifies supplier exists in current tenant.
4. Raw SQL selects posted PURCHASE docs and computes `outstanding = total_amount - SUM(allocations)`.
5. Fully-settled documents are excluded by `HAVING outstanding > 0`.
6. Totals and per-doc fields are converted from bigint/date to JSON response.

Business Rules Observed:
- Open documents are limited to posted PURCHASE transactions.
- Allocation-based outstanding is computed document-wise.
- Tenant isolation enforced on transactions and allocations (`tenant_id` filter on both tables).

Missing Rules:
- No `asOfDate` or `includeFullyPaid` support although implementation plan docs specify these parameters.
- No handling of supplier credits/returns at document level (only allocations reduce outstanding).
- No response DTO contract in Swagger for this endpoint.

Security Risks:
- SQL injection risk is low due parameterized query values.

Financial Risks:
- Supplier returns create `AP_DECREASE` but no allocation rows (`src/transactions/posting.service.ts:621`), so open document outstanding can diverge from supplier payable balance.
- Bigint→Number conversion may lose precision for high-volume tenants.

Edge Case Failures:
- Open-doc total can overstate net payable when supplier has unapplied credits.
- Ordering only by date can be nondeterministic for same-day documents.

Concurrency Risks:
- Read consistency depends on default isolation; concurrent posting can cause transient before/after views (acceptable, but not snapshot-consistent).

Test Coverage:
- Covered: empty, partial, full payment exclusion, 404, 401, tenant isolation in `test/integration/open-documents.integration.spec.ts:51`.
- Missing: supplier return credit scenario, large value precision scenario, invalid UUID behavior, same-day deterministic ordering.

Verdict:
⚠ Risky

Required Fixes:
- Define and implement credit/return treatment for document outstanding (allocation against source purchase, or explicit credit offset field).
- Add `asOfDate` filtering if still part of contract.
- Add explicit response DTO for Swagger and client stability.

--------------------------------------------
## API: PATCH /api/v1/suppliers/{id}
--------------------------------------------

Route Entry:
- Controller route `@Patch(':id')` in `src/suppliers/suppliers.controller.ts:67`.
- Body validated via `UpdateSupplierDto` and global validation pipe.

Controller:
- `SuppliersController.update()` in `src/suppliers/suppliers.controller.ts:75`.

Service:
- `SuppliersService.update()` in `src/suppliers/suppliers.service.ts:81`.

Repository:
- Prisma `findFirst` for tenant-scoped existence.
- Prisma `findFirst` for case-insensitive duplicate-name check.
- Prisma `update` write.

DTO/Schema:
- `UpdateSupplierDto` in `src/suppliers/dto/update-supplier.dto.ts:5`.
- UUID validated with `ParseUUIDPipe`.

Execution Trace:
1. Request passes auth/tenant pipeline.
2. Path UUID and body DTO validations run.
3. Service verifies record exists in current tenant.
4. If name changed, duplicate-name lookup is executed.
5. Supplier row is updated and returned with `_computed` placeholders.

Business Rules Observed:
- Prevents case-insensitive duplicate name within tenant at application layer.
- Cross-tenant update attempts return 404 behavior.

Missing Rules:
- No immutable-field policy once supplier has posted transactions.
- No status check to prevent editing inactive supplier metadata.
- No audit field update for who changed data and why.

Security Risks:
- Tenant isolation enforced by lookup+update flow.

Financial Risks:
- Placeholder `_computed` fields in response remain non-authoritative.

Edge Case Failures:
- Accepts empty PATCH body and returns success without meaningful change.

Concurrency Risks:
- TOCTOU race: duplicate-name check and write are non-atomic; parallel updates can bypass uniqueness because DB has no unique `(tenant_id, lower(name))` constraint.

Test Coverage:
- Covered: happy path, not-found, duplicate-name rejection in `test/integration/suppliers.integration.spec.ts:171`.
- Additional cross-tenant update covered in `test/integration/security.integration.spec.ts:74`.
- Missing: invalid UUID, validation bounds (`phone/address/notes` max length), empty-body semantics, race/concurrency duplicate test.

Verdict:
⚠ Risky

Required Fixes:
- Add DB-enforced unique index for supplier name per tenant (case-insensitive) and handle DB conflict mapping.
- Wrap duplicate-check + update into a transactional/constraint-based approach.
- Decide and enforce empty-patch behavior (reject no-op or accept explicitly).

--------------------------------------------
## API: PATCH /api/v1/suppliers/{id}/status
--------------------------------------------

Route Entry:
- Controller route `@Patch(':id/status')` in `src/suppliers/suppliers.controller.ts:79`.
- Body validated by `UpdateStatusDto`.

Controller:
- `SuppliersController.updateStatus()` in `src/suppliers/suppliers.controller.ts:86`.

Service:
- `SuppliersService.updateStatus()` in `src/suppliers/suppliers.service.ts:105`.

Repository:
- Prisma `findFirst` existence check.
- Prisma `update` status field.

DTO/Schema:
- `UpdateStatusDto` in `src/common/dto/update-status.dto.ts:4`.
- `status` allowlist: `ACTIVE|INACTIVE`; optional `reason` accepted.

Execution Trace:
1. Auth + tenant checks pass.
2. UUID and status payload validated.
3. Service verifies tenant-scoped supplier exists.
4. Status is updated and returned.

Business Rules Observed:
- Status values are constrained to two states.
- Cross-tenant status change blocked via tenant lookup.

Missing Rules:
- `reason` is accepted but ignored (not persisted/audited).
- No rule preventing inactivation with open payables/drafts.
- No actor/timestamp/status-change audit trail.

Security Risks:
- Tenant boundary respected.

Financial Risks:
- Inactivating active counterparties without open-balance checks can create operational posting failures later.

Edge Case Failures:
- Re-applying same status still writes row (idempotent effect but unnecessary write).

Concurrency Risks:
- Last-write-wins on concurrent status changes; no optimistic locking/versioning.

Test Coverage:
- Covered: valid update, invalid status in `test/integration/suppliers.integration.spec.ts:205`.
- Cross-tenant blocked in `test/integration/security.integration.spec.ts:87`.
- Missing: not-found case, ignored `reason` assertion, no-auth, invalid UUID.

Verdict:
⚠ Risky

Required Fixes:
- Persist status-change reason/audit metadata or remove `reason` from API contract.
- Add business rule checks for inactivation when unsettled obligations exist (if required by policy).
- Add missing negative-path tests.

--------------------------------------------
## API: POST /api/v1/suppliers
--------------------------------------------

Route Entry:
- Controller route `@Post()` in `src/suppliers/suppliers.controller.ts:32`.
- Auth/tenant middleware/guards apply globally.

Controller:
- `SuppliersController.create()` in `src/suppliers/suppliers.controller.ts:38`.

Service:
- `SuppliersService.create()` in `src/suppliers/suppliers.service.ts:19`.

Repository:
- Prisma duplicate check via `findFirst`.
- Prisma insert via `supplier.create`.

DTO/Schema:
- `CreateSupplierDto` in `src/suppliers/dto/create-supplier.dto.ts:5`.
- Name: trimmed + required + length 2..200.
- `phone/address/notes` optional with max lengths.

Execution Trace:
1. Auth and tenant guards enforce authenticated tenant context.
2. Body is transformed and validated.
3. Service checks tenant exists in context and reads `createdBy` from context.
4. Case-insensitive duplicate name check is executed per tenant.
5. Supplier row is inserted and returned with `_computed` placeholders.

Business Rules Observed:
- Tenant-scoped supplier creation.
- Application-level duplicate-name prevention (case-insensitive check).

Missing Rules:
- No DB-level uniqueness guarantee for supplier names.
- No status initialization flexibility beyond default `ACTIVE`.
- API docs annotate 200 in Swagger, but endpoint actually returns 201.

Security Risks:
- Auth required by global guard.
- No injection vector in ORM calls.

Financial Risks:
- Duplicate suppliers can be created under concurrent requests, fragmenting AP ledger linkage and reports.
- Placeholder `_computed` values in create response can be mistaken as real calculations.

Edge Case Failures:
- Optional text fields are not trimmed/normalized, allowing semantically duplicated content with spacing variants.

Concurrency Risks:
- High: duplicate-check + insert race (TOCTOU) because no unique DB constraint on supplier name per tenant.

Test Coverage:
- Covered: success, duplicate rejection, name validation, auth required in `test/integration/suppliers.integration.spec.ts:40`.
- Missing: race/concurrency test for duplicate creation, max-length boundary tests, whitespace normalization tests.

Verdict:
❌ Unsafe

Required Fixes:
- Add DB constraint/index for case-insensitive unique supplier name per tenant.
- Replace pre-check-only logic with constraint-first insert and conflict handling.
- Align Swagger response code annotation with actual 201 status.

