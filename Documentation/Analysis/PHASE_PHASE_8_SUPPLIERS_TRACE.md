# PHASE TRACE REPORT

Title:
Phase 8 — Suppliers

--------------------------------------------
## API: GET /api/v1/suppliers
--------------------------------------------

Route Entry:
`main.ts` global prefix `api/v1` + global guards (`JwtAuthGuard` -> `TenantScopeGuard` -> `RolesGuard`) + global `ValidationPipe`; route handler `SuppliersController.findAll`.
Controller:
`src/suppliers/suppliers.controller.ts` -> `@Get()` `findAll(@Query() query: ListSuppliersQueryDto)`.
Service:
`src/suppliers/suppliers.service.ts` -> `findAll(query)`.
Repository:
`prisma.supplier.findMany` + `prisma.supplier.count`.
DTO/Schema:
`ListSuppliersQueryDto` + `PaginationQueryDto`; `Supplier` table in `prisma/schema.prisma`.

Execution Trace:
1. JWT is required (no `@Public`), tenant context is set from token.
2. Query params are validated/transformed (`page`, `limit`, `status`, `sortBy`, `sortOrder`).
3. Service builds tenant-scoped `where` (`tenantId`, optional `status`, optional `OR` search on `name`/`phone`).
4. Service executes parallel `findMany` + `count`, then wraps with `paginateResponse`.
5. Response returns `{ data, meta }` with raw supplier rows.

Business Rules Observed:
- Tenant isolation is enforced in query (`where.tenantId`).
- Default status filter is `ACTIVE` unless `status=ALL`.
- Sort field/order are allowlisted (`name|createdAt`, `asc|desc`).

Missing Rules:
- No explicit test for unauthorized/invalid query combinations on this endpoint.
- No explicit maximum search length control.

Security Risks:
- Low: endpoint is read-only and tenant-scoped.
- Test gap: no direct integration test for auth failure on this route.

Financial Risks:
- Low direct financial impact (master data listing only).

Edge Case Failures:
- None critical identified in execution path.

Concurrency Risks:
- None meaningful (read-only).

Test Coverage:
- Covered: pagination, search, tenant isolation (`test/integration/suppliers.integration.spec.ts`).
- Missing: explicit 401 and invalid query-value assertions for this route.

Verdict:
✅ Safe

Required Fixes:
- Add explicit auth/validation negative tests for this endpoint.

--------------------------------------------
## API: GET /api/v1/suppliers/{id}
--------------------------------------------

Route Entry:
Same global middleware/guards/pipes chain; route handler `SuppliersController.findOne`.
Controller:
`@Get(':id')` with `ParseUUIDPipe`.
Service:
`SuppliersService.findOne(id)`.
Repository:
`prisma.supplier.findFirst({ where: { id, tenantId } })`.
DTO/Schema:
Path `id` validated as UUID; `Supplier` model.

Execution Trace:
1. Auth + tenant context enforced globally.
2. `id` is validated by `ParseUUIDPipe`.
3. Service requires `tenantId` from request context.
4. Service fetches supplier by `id + tenantId`.
5. Not found -> `NotFoundException`; else raw supplier object returned.

Business Rules Observed:
- Cross-tenant access returns 404 via tenant-scoped lookup.

Missing Rules:
- None critical for read path.

Security Risks:
- Low: UUID validation + tenant scoping are present.

Financial Risks:
- None direct (read-only master data detail).

Edge Case Failures:
- None critical identified.

Concurrency Risks:
- None meaningful (read-only).

Test Coverage:
- Covered: success, 404 missing, cross-tenant 404 (`test/integration/suppliers.integration.spec.ts`).
- Missing: explicit invalid UUID and unauthenticated access test for this route.

Verdict:
✅ Safe

Required Fixes:
- Add explicit invalid UUID and 401 tests.

--------------------------------------------
## API: GET /api/v1/suppliers/{id}/balance
--------------------------------------------

Route Entry:
Global guards/pipes + `SuppliersController.getBalance`.
Controller:
`@Get(':id/balance')` with `ParseUUIDPipe`.
Service:
`SuppliersService.getBalance(id)`.
Repository:
- `prisma.supplier.findFirst({ id, tenantId })`.
- Raw SQL aggregation on `ledger_entries` joined to `transactions`.
DTO/Schema:
Path UUID pipe; response documented via `SupplierBalanceResponseDto`.

Execution Trace:
1. Auth + tenant guard set context.
2. Service verifies supplier exists in tenant.
3. Raw SQL computes:
4. `ap_increase` (purchase obligations), `ap_payments` (`AP_DECREASE` excluding `SUPPLIER_RETURN`), `ap_returns` (`AP_DECREASE` from `SUPPLIER_RETURN`).
5. `safeMoney` converts bigint totals; response computes `currentBalance = purchases - payments - returns`.

Business Rules Observed:
- Balance is derived from append-only ledger entries.
- Tenant filter applied directly in SQL.
- Supplier returns are separated from payment decreases.

Missing Rules:
- No explicit `t.status='POSTED'` predicate in SQL (depends on invariant that only posted creates entries).
- No `asOfDate` support in this endpoint (only reports module provides point-in-time balance).

Security Risks:
- Raw SQL is parameterized; injection risk is low.

Financial Risks:
- Response contract mismatch risk: DTO documents `totalPaid`, service returns `totalPayments` and `totalReturns`.
- Potential reporting drift if non-posted ledger entries ever exist (defense-in-depth missing).

Edge Case Failures:
- Very large aggregates can throw precision error via `safeMoney` (500), with no domain-specific handling.

Concurrency Risks:
- Read query may observe rapidly changing state during concurrent posting; no snapshot consistency across separate endpoints.

Test Coverage:
- Covered: zero balance, purchases, partial payment, multi-purchase aggregation, 404, tenant isolation (`test/integration/balance-queries.integration.spec.ts`).
- Missing: supplier-return scenarios and response-contract key assertions.

Verdict:
⚠ Risky

Required Fixes:
- Align response DTO keys with actual payload (`totalPayments`, `totalReturns`) or change service output.
- Add supplier-return balance test and contract test.
- Add explicit `transactions.status='POSTED'` filter in SQL for defense-in-depth.

--------------------------------------------
## API: GET /api/v1/suppliers/{id}/open-documents
--------------------------------------------

Route Entry:
Global guards/pipes + `SuppliersController.getOpenDocuments`.
Controller:
`@Get(':id/open-documents')` with `ParseUUIDPipe`.
Service:
`SuppliersService.getOpenDocuments(id)`.
Repository:
- `prisma.supplier.findFirst({ id, tenantId })`.
- Raw SQL over `transactions` + `allocations`.
DTO/Schema:
Path UUID pipe; no dedicated response DTO enforcing shape.

Execution Trace:
1. Auth + tenant context enforced.
2. Service verifies supplier exists in tenant.
3. SQL selects posted `PURCHASE` documents for supplier, left joins allocations by `applies_to_transaction_id`.
4. Outstanding is computed as `total_amount - SUM(amount_applied)`.
5. `HAVING outstanding > 0` filters only open docs; rows are ordered by `transaction_date`.
6. Response returns supplier info, total outstanding, and per-document amounts.

Business Rules Observed:
- Open docs are computed from posted purchase totals minus allocations.
- Tenant scoping is applied in both transaction and allocation predicates.

Missing Rules:
- No handling of supplier returns/credit notes in per-document outstanding logic.
- No `asOfDate` or `includeFullyPaid` query support from earlier phase spec.
- No allocation detail in response despite historical spec showing allocation lines.

Security Risks:
- Parameterized SQL limits injection risk.
- No explicit response DTO increases contract drift risk.

Financial Risks:
- Critical: outstanding can be overstated when AP is reduced by supplier returns (returns create `AP_DECREASE` but no allocation rows), causing open-doc totals to diverge from actual payable.
- Auto-allocation/payment flows can appear inconsistent to users when credits exist.

Edge Case Failures:
- Overstated open docs after returns/credits.
- Frontend can display unpaid purchase while net supplier balance is settled/credit.

Concurrency Risks:
- Concurrent allocations/postings can shift outstanding during read; expected eventually consistent reads.

Test Coverage:
- Covered: empty, single open purchase, partial payment, fully paid excluded, 404, 401, tenant isolation (`test/integration/open-documents.integration.spec.ts`).
- Missing: supplier-return/credit-note interaction, multi-document ordering determinism, invalid UUID case.

Verdict:
❌ Unsafe

Required Fixes:
- Incorporate supplier-return effects into open-document outstanding (or explicitly model/apply credit-note allocations).
- Add tests proving consistency between `GET /suppliers/:id/balance` and `GET /suppliers/:id/open-documents` under returns.
- Add a strict response DTO and contract tests.

--------------------------------------------
## API: PATCH /api/v1/suppliers/{id}
--------------------------------------------

Route Entry:
Global guards + roles (`@Roles('OWNER','ADMIN')`) + validation pipe.
Controller:
`@Patch(':id')` -> `SuppliersController.update(id, dto)`.
Service:
`SuppliersService.update(id, dto)`.
Repository:
- `prisma.supplier.findFirst({ id, tenantId })`.
- `prisma.supplier.update({ where: { id, tenantId }, data: dto })`.
DTO/Schema:
`UpdateSupplierDto` (optional name/phone/address/notes with validators).

Execution Trace:
1. Auth + tenant context enforced.
2. RolesGuard checks role from request context.
3. Path UUID and body DTO validated.
4. Service verifies supplier exists in tenant.
5. Update executes with tenant-scoped where and partial DTO.
6. `P2002` unique conflict maps to 409; success returns updated supplier row.

Business Rules Observed:
- Only `OWNER/ADMIN` can update.
- Tenant scoping is enforced before update.
- Duplicate name conflict handled via DB constraint mapping.

Missing Rules:
- No block on updating inactive suppliers or suppliers linked to posted history (policy-dependent).
- No optimistic concurrency/version check.

Security Risks:
- Role enforcement exists, but no supplier-specific 403 test coverage.

Financial Risks:
- Moderate: metadata edits can alter operational identifiers used by staff, though not ledger math directly.

Edge Case Failures:
- Race window between `findFirst` and `update`; deletion/state change can produce uncaught Prisma errors (possible 500).

Concurrency Risks:
- Last-write-wins behavior; no conflict detection for concurrent edits.

Test Coverage:
- Covered: success, not found, duplicate conflict (`test/integration/suppliers.integration.spec.ts`).
- Covered separately: cross-tenant update blocked (`test/integration/security.integration.spec.ts`).
- Missing: role 403, invalid UUID, no-op/empty payload behavior, concurrent update behavior.

Verdict:
⚠ Risky

Required Fixes:
- Add role/validation/concurrency regression tests.
- Catch Prisma `P2025` and map to 404 for race-safe behavior.
- Consider optimistic concurrency (`updatedAt`/version) for admin updates.

--------------------------------------------
## API: PATCH /api/v1/suppliers/{id}/status
--------------------------------------------

Route Entry:
Global guards + roles + validation pipe.
Controller:
`@Patch(':id/status')` -> `SuppliersController.updateStatus(id, dto)`.
Service:
`SuppliersService.updateStatus(id, dto)`.
Repository:
- `prisma.supplier.findFirst`.
- Raw SQL payable balance check.
- Transaction: `prisma.supplier.update` + `prisma.statusChangeLog.create`.
DTO/Schema:
`UpdateStatusDto` (`status` in `ACTIVE|INACTIVE`, optional `reason`).

Execution Trace:
1. Auth + tenant + role checks run.
2. UUID and status body validated.
3. Service loads supplier by `id + tenantId`.
4. If deactivating, SQL computes net AP (`AP_INCREASE - AP_DECREASE`); positive balance blocks with 400.
5. Transaction updates supplier status and appends audit log row.
6. Updated supplier is returned.

Business Rules Observed:
- Deactivation blocked when supplier has positive outstanding payable.
- Status changes are audit-logged.
- Update is tenant-scoped.

Missing Rules:
- No lock/serialization around balance-check + status update boundary.
- No explicit guard against posting new PURCHASE from existing drafts after deactivation (cross-module gap).
- No validation of status-transition idempotence (ACTIVE->ACTIVE still logs change).

Security Risks:
- No direct test proving role-based 403 for this endpoint.

Financial Risks:
- High: deactivation safeguard can be bypassed operationally because purchase posting path does not revalidate supplier active status, allowing AP creation after deactivation from older drafts.
- Audit log can record stale `previousStatus` under concurrent updates.

Edge Case Failures:
- Missing test for "cannot deactivate with outstanding AP".
- Potential log noise/inconsistency on repeated same-status requests.

Concurrency Risks:
- TOCTOU between payable check and update.
- Concurrent status changes can produce inaccurate audit trail.

Test Coverage:
- Covered: happy path and invalid status (`test/integration/suppliers.integration.spec.ts`), cross-tenant block (`test/integration/security.integration.spec.ts`).
- Missing: outstanding-payable rejection, role 403, status log integrity, concurrent status updates.

Verdict:
❌ Unsafe

Required Fixes:
- Revalidate supplier `ACTIVE` at PURCHASE posting time (draft->post) to close deactivation bypass.
- Perform deactivation check and status update in a serializable transaction or lock supplier row.
- Add integration tests for outstanding-AP block and role 403.
- Add assertions/tests for `status_change_logs` correctness.

--------------------------------------------
## API: POST /api/v1/suppliers
--------------------------------------------

Route Entry:
Global guards + roles + validation pipe.
Controller:
`@Post()` -> `SuppliersController.create(dto)`.
Service:
`SuppliersService.create(dto)`.
Repository:
`prisma.supplier.create({ data: { tenantId, createdBy, ...dto } })`.
DTO/Schema:
`CreateSupplierDto`; supplier uniqueness relies on DB unique functional index migration.

Execution Trace:
1. Auth, tenant, and role checks execute.
2. Body validated (`name` required, trimmed, length constraints; optional fields validated).
3. Service reads tenant/user context.
4. Prisma create inserts supplier row (status defaults to ACTIVE at DB model).
5. `P2002` conflicts map to 409.

Business Rules Observed:
- Only `OWNER/ADMIN` can create suppliers.
- Tenant scoping and audit `createdBy` are populated from context.
- Duplicate names are blocked by DB uniqueness path.

Missing Rules:
- No explicit idempotency handling on create endpoint.
- No field normalization for `phone/address/notes` (trim/sanitization policy not enforced).

Security Risks:
- Role check exists but no explicit 403 integration test for this endpoint.

Financial Risks:
- Indirect: duplicate/dirty master records can impact downstream postings and reporting.
- Constraint dependence risk: functional unique index exists in SQL migration but is not represented in Prisma schema model.

Edge Case Failures:
- If deployments skip the uniqueness migration, duplicate names can slip through (service has no pre-check fallback).

Concurrency Risks:
- Concurrent duplicate creates are safely collapsed by DB unique index (`201 + 409` observed in tests).

Test Coverage:
- Covered: create success, duplicate (case-insensitive), validation errors, unauthenticated request, concurrent duplicate handling (`test/integration/suppliers.integration.spec.ts`).
- Missing: role 403, max-length boundary tests, migration-missing behavior.

Verdict:
⚠ Risky

Required Fixes:
- Add role-based 403 tests for non-admin roles.
- Reflect functional uniqueness in Prisma schema strategy/documentation to prevent drift.
- Decide and enforce idempotency policy for master-data create endpoints.
