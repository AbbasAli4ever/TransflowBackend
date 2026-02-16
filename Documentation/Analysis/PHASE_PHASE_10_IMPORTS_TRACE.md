# PHASE TRACE REPORT

Title:
Phase 10 — imports

--------------------------------------------
## API: GET /api/v1/imports
--------------------------------------------

Route Entry:
- `src/main.ts`: global prefix `api/v1`
- `src/app.module.ts`: global middleware + guards (`JwtAuthGuard`, `TenantScopeGuard`, `RolesGuard`)
- `src/imports/imports.controller.ts`: `@Controller('imports')`, `@Get()`

Controller:
- `ImportsController.list(@Query() query: ListImportsQueryDto)`

Service:
- `ImportsService.listBatches(query)`

Repository:
- `prisma.importBatch.count({ where })`
- `prisma.importBatch.findMany({ where, orderBy, skip, take, select })`

DTO/Schema:
- DTO: `src/imports/dto/list-imports-query.dto.ts`
- Schema: `prisma/schema.prisma` models `ImportBatch`, enums `ImportModule`, `ImportStatus`

Execution Trace:
1. Request enters `GET /api/v1/imports`.
2. `RequestContextMiddleware` assigns requestId; `TenantContextMiddleware` optionally decodes bearer token into context.
3. `JwtAuthGuard` enforces authentication (endpoint is not `@Public`).
4. `TenantScopeGuard` enforces tenant presence and writes tenant/user context.
5. `RolesGuard` allows all authenticated roles (no `@Roles` on this endpoint).
6. ValidationPipe validates query DTO (`module`, `status`, `page`, `limit`).
7. Controller calls `importsService.listBatches(query)`.
8. Service builds tenant-scoped Prisma `where` filter and executes count + paginated find.
9. Service returns `{data,total,page,limit,totalPages}`.

Business Rules Observed:
- Tenant-scoped listing (`where.tenantId = context tenant`).
- Optional filtering by `module` and `status`.
- Pagination defaults (`page=1`, `limit=20`).

Missing Rules:
- No upper bound on `limit` (unbounded read size).
- No explicit deterministic tie-breaker in sort (`createdAt` only).

Security Risks:
- Potential read amplification/DoS via very large `limit`.

Financial Risks:
- No direct balance mutation risk; indirect operational risk if endpoint is abused for high-load enumeration.

Edge Case Failures:
- Extremely large `limit` can cause large response payloads and slow queries.

Concurrency Risks:
- Offset pagination can drift under concurrent insertions (non-repeatable pages).

Test Coverage:
- Covered: module filter and status filter (`test/integration/imports.integration.spec.ts`, Tests 23-24).
- Missing: auth 401 path, large-limit behavior, pagination stability assertions.

Verdict:
⚠ Risky

Required Fixes:
- Add `@Max(100)` (or stricter) to `ListImportsQueryDto.limit`.
- Add tie-breaker order: `{ createdAt: 'desc' }, { id: 'desc' }`.
- Add tests for unauthorized access and `limit` cap enforcement.

--------------------------------------------
## API: GET /api/v1/imports/{id}
--------------------------------------------

Route Entry:
- `src/main.ts`: global prefix `api/v1`
- `src/app.module.ts`: global middleware + guards
- `src/imports/imports.controller.ts`: `@Get(':id')`

Controller:
- `ImportsController.detail(id, page?, limit?)`

Service:
- `ImportsService.getBatchDetail(batchId, page, limit)`

Repository:
- `prisma.importBatch.findFirst({ where: { id, tenantId } })`
- `prisma.importRow.count({ where: { importBatchId, tenantId } })`
- `prisma.importRow.findMany({ where, orderBy, skip, take, select })`

DTO/Schema:
- Param pipe: `ParseUUIDPipe`
- Query pipes: `ParseIntPipe({ optional: true })` for `page`, `limit`
- Schema: `ImportBatch`, `ImportRow`

Execution Trace:
1. Request enters `GET /api/v1/imports/:id`.
2. Middleware + guards execute as above; tenant context is established.
3. `ParseUUIDPipe` validates `id`.
4. `ParseIntPipe` parses optional `page` and `limit` (no min/max constraints).
5. Controller calls `getBatchDetail(id, page, limit)`.
6. Service fetches tenant-scoped batch (`findFirst`); throws 404 if missing.
7. Service counts rows and fetches paginated rows by `rowNumber ASC`.
8. Service returns batch fields + `rows` + pagination metadata.

Business Rules Observed:
- Strict tenant isolation via `id + tenantId` filter.
- Batch detail includes row-level status/error and created record links.

Missing Rules:
- No min/max validation for `page` and `limit`.
- No explicit cap on `limit`.

Security Risks:
- Unbounded `limit` can expose excessive row data in one call.

Financial Risks:
- No direct mutation risk; poor pagination guards can degrade observability during critical import operations.

Edge Case Failures:
- Negative `page`/`limit` can propagate to Prisma `skip/take` and cause runtime failures.
- Very high `limit` may create memory/response pressure.

Concurrency Risks:
- Row pagination snapshots are non-transactional; total and rows may not perfectly align during concurrent status updates.

Test Coverage:
- Covered: happy path detail rows (Test 25), cross-tenant detail blocked with 404 (Test 26).
- Missing: invalid `page/limit`, large-limit caps, 401 path.

Verdict:
⚠ Risky

Required Fixes:
- Replace ad-hoc query parsing with validated DTO (`@Min(1)`, `@Max(100)`).
- Add tests for invalid pagination and oversized `limit`.

--------------------------------------------
## API: POST /api/v1/imports
--------------------------------------------

Route Entry:
- `src/imports/imports.controller.ts`: `@Post()` with `FileInterceptor('file', { memoryStorage, fileSize: 10MB })`

Controller:
- `ImportsController.upload(file, dto)`

Service:
- `ImportsService.uploadFile(file, dto)`

Repository:
- `tx.importBatch.create(...)`
- `tx.importRow.createMany(...)`

DTO/Schema:
- DTO: `CreateImportDto` (`module` restricted to `SUPPLIERS|CUSTOMERS|PRODUCTS|OPENING_BALANCES`)
- Parser services: `CsvParserService`, `XlsxParserService`
- Schema: `ImportBatch`, `ImportRow`, enum `ImportSourceType`

Execution Trace:
1. Request enters multipart `POST /api/v1/imports`.
2. Middleware + guards authenticate and set tenant context.
3. Multer interceptor buffers file in memory and enforces 10MB limit.
4. ValidationPipe validates form field body (`module`).
5. Service checks file existence, extension, MIME type, and row-count (`<=10000`).
6. Service parses CSV/XLSX into headers + row objects.
7. Service transaction creates `import_batch` (`PENDING_MAPPING`) and `import_rows` (`PENDING`).
8. Service returns batch metadata with detected columns and required fields.

Business Rules Observed:
- Supported modules are explicitly constrained by DTO.
- File type validation includes extension + MIME.
- Tenant-scoped batch/row creation.
- Initial lifecycle state set to `PENDING_MAPPING` / `PENDING`.

Missing Rules:
- No explicit duplicate-header detection in uploaded files.
- No anti-formula sanitization for spreadsheet cells.
- No explicit rate limit for import endpoint beyond global generic limiter.

Security Risks:
- `memoryStorage` means each concurrent upload consumes RAM (up to 10MB/request).
- MIME and extension checks do not guarantee benign content.

Financial Risks:
- Badly parsed headers (e.g., duplicate column names) can silently remap values and lead to incorrect downstream master data.

Edge Case Failures:
- Duplicate CSV/XLSX headers collapse values into the same object key.
- Empty files still create batches, which may lead to confusing no-op workflows.

Concurrency Risks:
- High concurrency uploads can cause memory pressure due to in-memory buffering.

Test Coverage:
- Covered: CSV/XLSX happy paths, unsupported type, size limit, invalid module, header detection (Tests 1-6 + TRANSACTIONS rejection test).
- Missing: duplicate-header handling, 10,001-row rejection, MIME spoof cases, unauthorized path.

Verdict:
⚠ Risky

Required Fixes:
- Add duplicate-header validation and reject ambiguous files.
- Add parser/content sanity checks (and optional antivirus scanning in production path).
- Add tests for row-cap breach, MIME spoofing, and 401 behavior.

--------------------------------------------
## API: POST /api/v1/imports/{id}/commit
--------------------------------------------

Route Entry:
- `src/imports/imports.controller.ts`: `@Post(':id/commit')`, `@Roles('OWNER','ADMIN')`

Controller:
- `ImportsController.commit(id, dto)`

Service:
- `ImportsService.commitImport(batchId, dto)`

Repository:
- Read: `importBatch.findFirst`, `importRow.findMany` (VALID/INVALID)
- Write (inside tx): `importBatch.updateMany` (CAS to `PROCESSING`), entity creates/updates (`supplier/customer/product/paymentAccount`), `importRow.update`, `importBatch.update` (`COMPLETED`)

DTO/Schema:
- DTO: `CommitImportDto` (`skipInvalidRows?: boolean`, default true)
- Schema: `ImportBatch`, `ImportRow`, `Supplier`, `Customer`, `Product`, `PaymentAccount`

Execution Trace:
1. Request enters `POST /api/v1/imports/:id/commit`.
2. Middleware + guards run; `RolesGuard` enforces `OWNER|ADMIN`.
3. Param UUID and body DTO validation/transformation execute.
4. Service fetches tenant-scoped batch; requires status `VALIDATED`.
5. Service fetches VALID rows and INVALID-row count; may abort if `skipInvalidRows=false` and invalid rows exist.
6. In transaction, service CAS-updates batch `VALIDATED -> PROCESSING`; conflict if already claimed.
7. For each VALID row, service creates/updates domain record by module and updates row to `SUCCESS` or `FAILED`.
8. Service finalizes batch to `COMPLETED` with counts and returns commit summary.

Business Rules Observed:
- Role restriction (`OWNER|ADMIN`).
- Explicit lifecycle precondition (`VALIDATED` only).
- CAS transition prevents duplicate successful commits on same batch.
- Duplicate prevention checks for supplier/customer names and product SKU before create.

Missing Rules:
- No guard preventing `OPENING_BALANCES` overwrite when account already has payment history.
- No endpoint idempotency key despite platform-wide “POST safe to retry” expectation.
- No case-insensitive account lookup in commit for opening balances (validator is case-insensitive, commit lookup is case-sensitive).

Security Risks:
- Detailed internal error strings can be persisted to `errorMessage` from caught exceptions.

Financial Risks:
- Critical: `OPENING_BALANCES` directly overwrites `payment_accounts.opening_balance`; this can retroactively distort all account-balance reports when historical payment entries already exist.
- Response/batch count semantics differ (`failedRows` response excludes INVALID skipped rows), increasing reconciliation confusion.

Edge Case Failures:
- Mapping may validate `accountName` case-insensitively, but commit can still fail row due to case-sensitive lookup.
- Very large valid batches process row-by-row in one transaction; long-running transaction risk.

Concurrency Risks:
- CAS protects same-batch double commit, but cross-batch concurrent commits creating same supplier/customer/SKU can still hit DB unique races and abort transaction unexpectedly.
- Transaction isolation level is default (not explicitly `Serializable`) for commit.

Test Coverage:
- Covered: supplier/customer/product commit happy paths, skip/abort invalid behavior, status precondition, duplicate-name handling, createdRecord links, concurrent same-batch commit conflict.
- Missing: role-based 403 checks, tenant-isolation checks for commit endpoint, opening-balance commit when payment history exists, case-insensitive `accountName` behavior.

Verdict:
❌ Unsafe

Required Fixes:
- For `OPENING_BALANCES`, block overwrite if target account has payment history (`payment_entries` exists) or move to reversible posting-entry model.
- Use case-insensitive account lookup in commit (match validator semantics).
- Add deterministic retry semantics (idempotency key or durable commit token).
- Add explicit concurrency/unique-violation handling path and corresponding tests.

--------------------------------------------
## API: POST /api/v1/imports/{id}/map
--------------------------------------------

Route Entry:
- `src/imports/imports.controller.ts`: `@Post(':id/map')`

Controller:
- `ImportsController.mapColumns(id, dto)`

Service:
- `ImportsService.mapColumns(batchId, dto)`

Repository:
- `importBatch.findFirst`
- `importRow.findMany`
- In tx: `importBatch.updateMany` (CAS `PENDING_MAPPING -> VALIDATED`), per-row `importRow.update`
- Validator dependency: `paymentAccount.findMany` for OPENING_BALANCES checks

DTO/Schema:
- DTO: `ColumnMappingDto` (`columnMappings` as object)
- Validation rules: `RowValidatorService` + `REQUIRED_FIELDS`
- Schema: `ImportBatch`, `ImportRow`, `PaymentAccount`

Execution Trace:
1. Request enters `POST /api/v1/imports/:id/map`.
2. Middleware + guards authenticate and scope tenant (no role restriction).
3. UUID and body object validation run.
4. Service verifies batch existence and status `PENDING_MAPPING`.
5. Service ensures all required system fields are present in mapping keys.
6. Service loads rows, remaps raw data to system fields, validates each row by module rules.
7. In transaction, service CAS-updates batch to `VALIDATED`; then updates each row to `VALID`/`INVALID` with error details.
8. Service returns summary (`validRows`, `invalidRows`, preview, errors).

Business Rules Observed:
- Required field mapping enforced before validation.
- Module-specific row validation rules applied.
- Atomic state claim (`PENDING_MAPPING -> VALIDATED`) prevents concurrent remap success.

Missing Rules:
- No verification that mapped header values actually exist in detected file headers.
- No strict schema for `columnMappings` values (non-string values not rejected explicitly).
- No role restriction on mapping operation (any authenticated role can mutate import state).

Security Risks:
- Overly permissive `columnMappings` structure can enable malformed payloads and ambiguous mapping behavior.

Financial Risks:
- Incorrect mappings can silently produce invalid/empty transformed values and reduce data quality before commit.

Edge Case Failures:
- Duplicate mappings or unknown target fields are not explicitly rejected.
- Header name normalization (case/whitespace) is not standardized.

Concurrency Risks:
- CAS handles state transition race, but row set is fetched outside transaction; large batches can be stale if external DB mutation occurs.

Test Coverage:
- Covered: missing required mappings, wrong status rejection, row-level error reporting, status transition.
- Missing: invalid mapping shapes, unknown header keys, tenant-isolation tests for map endpoint, role/401 tests.

Verdict:
⚠ Risky

Required Fixes:
- Validate `columnMappings` as `Record<allowedSystemField, existingHeaderName>`.
- Reject mappings to non-existent source headers.
- Add authz decision for whether STAFF is allowed to map.
- Add negative tests for malformed mapping payloads and cross-tenant map access.

--------------------------------------------
## API: POST /api/v1/imports/{id}/rollback
--------------------------------------------

Route Entry:
- `src/imports/imports.controller.ts`: `@Post(':id/rollback')`, `@Roles('OWNER','ADMIN')`

Controller:
- `ImportsController.rollback(id)`

Service:
- `ImportsService.rollbackImport(batchId)`

Repository:
- Read: `importBatch.findFirst`, `importRow.findMany` (SUCCESS rows)
- In serializable tx: dependency counts (`transaction`, `transactionLine`, `paymentEntry`), entity updates (`supplier/customer/product/paymentAccount`), `importRow.update`, `importBatch.update`

DTO/Schema:
- Param: UUID via `ParseUUIDPipe`
- Schema: `ImportBatch`, `ImportRow`, `Supplier`, `Customer`, `Product`, `PaymentAccount`, `Transaction`, `TransactionLine`, `PaymentEntry`

Execution Trace:
1. Request enters `POST /api/v1/imports/:id/rollback`.
2. Middleware + guards execute; `RolesGuard` enforces `OWNER|ADMIN`.
3. UUID validation runs.
4. Service loads tenant batch and enforces status `COMPLETED`.
5. Service preloads SUCCESS rows with `createdRecordId`.
6. Service opens `Serializable` transaction.
7. Inside tx, service checks each created record for dependencies; any dependency triggers 409.
8. Service applies rollback mutations:
   - supplier/customer/product -> `status=INACTIVE`
   - payment account -> restore `openingBalance` from `rawDataJson.previousOpeningBalance` (current logic restores only once per account)
   - import rows -> `status=VALID`, clear created record links
9. Service sets batch status `ROLLED_BACK` and returns summary.

Business Rules Observed:
- Role restriction (`OWNER|ADMIN`).
- Status precondition (`COMPLETED` only).
- Dependency checks block rollback if records are already referenced.
- Batch-level rollback done in one DB transaction with serializable isolation.

Missing Rules:
- No robust restoration logic for repeated `OPENING_BALANCES` rows targeting the same account in one batch.
- No explicit idempotent replay behavior for rollback endpoint.

Security Risks:
- Rollback endpoint mutates many records; no dedicated rate/throttling policy beyond global defaults.

Financial Risks:
- Critical defect: duplicate `OPENING_BALANCES` rows for the same account can restore the wrong baseline.
  - Commit stores per-row `previousOpeningBalance` sequentially.
  - Rollback processes rows in reverse and restores only first encountered per account.
  - This can restore intermediate balance (not true pre-import value), corrupting cash baseline.

Edge Case Failures:
- Multi-row same-account rollback baseline corruption (described above).
- Endpoint returns `rolledBackCount` count of processed rows, not count of unique records mutated.

Concurrency Risks:
- Dependency checks are transactional (good), but `successRows` are prefetched before transaction; stale row-set risk is low but still non-zero if external DB writes occur.

Test Coverage:
- Covered: happy rollback, dependency conflict for supplier path, wrong-status rejection, batch status update, single-row opening balance restore.
- Missing: multi-row same-account opening-balance rollback, customer/product/payment-account dependency conflicts, role-based 403, tenant-isolation for rollback, 401 path.

Verdict:
❌ Unsafe

Required Fixes:
- Fix opening-balance restoration algorithm for repeated account rows (restore true pre-import value deterministically).
- Add regression test: same account appears multiple times in one OPENING_BALANCES batch.
- Add endpoint authz/isolation tests (403/401/cross-tenant).
- Clarify and enforce rollback idempotency contract.
