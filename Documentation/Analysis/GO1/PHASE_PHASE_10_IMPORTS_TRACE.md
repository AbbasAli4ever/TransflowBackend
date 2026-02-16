# PHASE TRACE REPORT

Title:
Phase 10 — imports

--------------------------------------------
## API: GET /api/v1/imports
--------------------------------------------

Route Entry:
- Global route prefix `api/v1` from `src/main.ts`.
- Controller route `@Controller('imports')` in `src/imports/imports.controller.ts`.
- Method: `list(@Query() query: ListImportsQueryDto)`.

Controller:
- `src/imports/imports.controller.ts` (`GET /imports` → `importsService.listBatches(query)`).

Service:
- `src/imports/imports.service.ts#listBatches`.

Repository:
- `prisma.importBatch.count({ where })`.
- `prisma.importBatch.findMany({ where, orderBy, skip, take, select })`.

DTO/Schema:
- DTO: `src/imports/dto/list-imports-query.dto.ts` (`module`, `status`, `page`, `limit`).
- Global validation: `src/common/pipes/validation.pipe.ts`.
- DB model: `ImportBatch` in `prisma/schema.prisma`.

Execution Trace:
1. Request enters middleware chain from `src/app.module.ts`: `RequestContextMiddleware` then `TenantContextMiddleware`.
2. `RequestContextMiddleware` creates request-scoped context and request ID.
3. `TenantContextMiddleware` attempts to decode bearer token and set tenant/user in context.
4. `JwtAuthGuard` enforces authentication globally.
5. `TenantScopeGuard` enforces tenant context and writes tenant/user to request context.
6. Validation pipe validates query against `ListImportsQueryDto` (enum + integer + min checks for this endpoint).
7. Controller forwards query DTO to service.
8. Service derives `tenantId` from async context (`requireTenantId`).
9. Service builds Prisma `where` with strict tenant filter and optional `module/status` filters.
10. Service executes `count` and paginated `findMany` in parallel and returns pagination metadata.

Business Rules Observed:
- Tenant isolation is enforced in DB query filter (`where.tenantId`).
- Optional filtering by `module` and `status` is implemented.
- Default pagination exists (`page=1`, `limit=20`).

Missing Rules:
- No upper bound on `limit` (can request very large pages).
- No performance guardrail for deep offsets (`skip`) on large datasets.
- No explicit sorting option validation (fixed `createdAt desc` only).

Security Risks:
- Potential denial-of-service via oversized `limit` causing large DB result sets.

Financial Risks:
- Operational visibility endpoint can degrade under load; delayed import monitoring can impact financial operations and incident response.

Edge Case Failures:
- `limit` extremely high can cause memory pressure and slow API response.

Concurrency Risks:
- Read path only; no write race in this endpoint.

Test Coverage:
- Covered: module filter (Test 23) and status filter (Test 24) in `test/integration/imports.integration.spec.ts`.
- Missing: pagination boundary tests (`limit` max, large page), auth failure tests, list tenant isolation test.

Verdict:
⚠ Risky

Required Fixes:
- Enforce max page size (for example `limit <= 100`).
- Add integration tests for pagination bounds and unauthorized access.

--------------------------------------------
## API: GET /api/v1/imports/{id}
--------------------------------------------

Route Entry:
- Global route prefix `api/v1` from `src/main.ts`.
- Controller route `@Controller('imports')` in `src/imports/imports.controller.ts`.
- Method: `detail(@Param('id', ParseUUIDPipe), @Query('page', ParseIntPipe), @Query('limit', ParseIntPipe))`.

Controller:
- `src/imports/imports.controller.ts` (`GET /imports/:id` → `importsService.getBatchDetail(id, page, limit)`).

Service:
- `src/imports/imports.service.ts#getBatchDetail`.

Repository:
- `prisma.importBatch.findFirst({ where: { id, tenantId } })`.
- `prisma.importRow.count({ where: { importBatchId, tenantId } })`.
- `prisma.importRow.findMany({ where, orderBy, skip, take, select })`.

DTO/Schema:
- Param validation: `ParseUUIDPipe`.
- Query parsing: `ParseIntPipe` in controller (not DTO-based min/max).
- DB models: `ImportBatch`, `ImportRow`.

Execution Trace:
1. Request enters request/tenant middleware chain.
2. Request context is initialized and tenant/user metadata is attached.
3. `JwtAuthGuard` enforces bearer authentication.
4. `TenantScopeGuard` enforces tenant context and writes to async local storage.
5. `ParseUUIDPipe` validates import batch ID format.
6. `ParseIntPipe` parses optional `page`/`limit` query params.
7. Controller calls service method with parsed values.
8. Service resolves tenant ID from request context.
9. Service fetches batch with `(id, tenantId)`; returns 404 if absent.
10. Service fetches row count and paginated rows, returns combined payload with `rowsPagination`.

Business Rules Observed:
- Strict tenant-scoped batch lookup.
- Row-level details include validation/commit status and error fields.

Missing Rules:
- No `Min(1)`/max cap for `page` and `limit` in this endpoint.
- No response shape redaction policy for potentially sensitive raw import row data.

Security Risks:
- Large/invalid pagination values may trigger heavy queries or Prisma errors.

Financial Risks:
- Insufficient pagination controls can degrade operational diagnostics during active import windows.

Edge Case Failures:
- Negative or zero `page`/`limit` can produce invalid `skip/take` behavior.

Concurrency Risks:
- Read path only; no direct write race.

Test Coverage:
- Covered: detail returns rows (Test 25), tenant isolation on detail (Test 26).
- Missing: invalid/negative pagination tests, unauthorized access tests.

Verdict:
⚠ Risky

Required Fixes:
- Replace ad hoc `ParseIntPipe` with DTO validation (`Min(1)`, max cap).
- Add tests for pagination bounds and malformed query values.

--------------------------------------------
## API: POST /api/v1/imports
--------------------------------------------

Route Entry:
- Global route prefix `api/v1` from `src/main.ts`.
- Controller route `@Controller('imports')`.
- Method: `upload(@UploadedFile() file, @Body() dto)` with `FileInterceptor('file', { storage: memoryStorage() })`.

Controller:
- `src/imports/imports.controller.ts#upload`.

Service:
- `src/imports/imports.service.ts#uploadFile`.

Repository:
- Transactional writes:
  - `tx.importBatch.create`
  - `tx.importRow.createMany`

DTO/Schema:
- DTO: `src/imports/dto/create-import.dto.ts` (`@IsEnum(ImportModule)`).
- Parsers: `CsvParserService`, `XlsxParserService`.
- DB models: `ImportBatch`, `ImportRow`.

Execution Trace:
1. Request passes request-context and tenant-context middleware.
2. JWT + tenant guards enforce authentication and tenant scope.
3. Multer `FileInterceptor` reads entire file into memory (`memoryStorage`).
4. Validation pipe validates `module` enum via `CreateImportDto`.
5. Controller calls `uploadFile(file, dto)`.
6. Service checks tenant/user context, file presence, file size, and extension.
7. Service parses file (CSV/XLSX) into headers + rows.
8. Service enforces `MAX_ROWS` limit.
9. Service writes import batch and initial import rows in one DB transaction with `PENDING_MAPPING`/`PENDING` status.
10. Service returns batch metadata, detected columns, and required fields.

Business Rules Observed:
- File extension validation (`.csv/.xlsx/.xls`).
- Max row limit (10,000) and max file size (10MB, checked in service).
- Batch and row creation is atomic in one transaction.

Missing Rules:
- Required MIME validation is not implemented despite `ALLOWED_MIMETYPES` constant.
- Multer upload limit is not configured (`limits.fileSize`) so oversized files are buffered first.
- `CreateImportDto` accepts full `ImportModule` enum including `TRANSACTIONS`, while endpoint spec allows only 4 modules.
- No idempotency for write endpoint despite API convention.

Security Risks:
- Memory DoS risk: `memoryStorage` without multer file-size limit can exhaust process memory before service checks run.
- Extension-only type checks allow spoofed content type payloads.

Financial Risks:
- Allowing `module=TRANSACTIONS` creates batches for unsupported workflow, enabling false-success downstream commits.
- Import intake instability under large payloads can block operational financial data ingestion.

Edge Case Failures:
- Empty files produce empty batch with `PENDING_MAPPING` and no rows, potentially leading to meaningless lifecycle states.
- Invalid XLS parsing can throw parser errors; returns 400 but without structured import-level diagnostics.

Concurrency Risks:
- Batch creation itself is transactional; no major race in this endpoint.

Test Coverage:
- Covered: CSV upload (Test 1), XLSX upload (Test 2), unsupported type (Test 3), >10MB logical check (Test 4), invalid module (Test 5), header detection (Test 6).
- Missing: module `TRANSACTIONS` rejection test, MIME spoofing test, upload memory-limit enforcement test, unauthorized/tenant isolation for upload.

Verdict:
❌ Unsafe

Required Fixes:
- Enforce multer `limits: { fileSize: 10 * 1024 * 1024 }` at interceptor level.
- Enforce extension + MIME validation.
- Restrict `CreateImportDto.module` to supported subset (`SUPPLIERS|CUSTOMERS|PRODUCTS|OPENING_BALANCES`).
- Add idempotency strategy for upload writes.

--------------------------------------------
## API: POST /api/v1/imports/{id}/commit
--------------------------------------------

Route Entry:
- Global route prefix `api/v1` from `src/main.ts`.
- Controller route `@Controller('imports')`.
- Method: `commit(@Param('id'), @Body() dto)`.

Controller:
- `src/imports/imports.controller.ts#commit`.

Service:
- `src/imports/imports.service.ts#commitImport`.

Repository:
- Reads: `importBatch.findFirst`, `importRow.findMany` (VALID/INVALID).
- Status update: `importBatch.update({ status: 'PROCESSING' })`.
- Transactional writes per row into `supplier/customer/product/paymentAccount` and `importRow.update`.
- Final `importBatch.update({ status: 'COMPLETED', successRows, failedRows })`.

DTO/Schema:
- DTO: `src/imports/dto/commit-import.dto.ts` (`skipInvalidRows?: boolean`, default true).
- DB models: `ImportBatch`, `ImportRow`, `Supplier`, `Customer`, `Product`, `PaymentAccount`.

Execution Trace:
1. Request passes middleware and global guards (auth + tenant).
2. UUID param is validated by `ParseUUIDPipe`.
3. Body is validated/transformed via `CommitImportDto`.
4. Service enforces batch existence under tenant and requires `status=VALIDATED`.
5. Service loads valid rows and invalid rows.
6. If `skipInvalidRows=false` and invalid rows exist, returns 400.
7. Service sets batch status to `PROCESSING` outside main transaction.
8. Service iterates valid rows in a Prisma transaction; per module it creates or updates target records.
9. Row is marked `SUCCESS` or `FAILED` with reason; counters are updated.
10. Batch is marked `COMPLETED`; API returns summary.

Business Rules Observed:
- Commit requires `VALIDATED` status.
- `skipInvalidRows` enforcement exists.
- Duplicate handling implemented for supplier/customer names and product SKU.
- Opening balance import updates existing payment account by name.

Missing Rules:
- No idempotency key/header handling for commit endpoint.
- No conditional state transition (`VALIDATED -> PROCESSING`) in one atomic statement.
- Unsupported `TRANSACTIONS` module is not blocked; rows become `SUCCESS` with no record created.
- No financial-period or “no prior entries” safeguards before overwriting `openingBalance`.
- No reconciliation check after commit (expected created count vs row states).

Security Risks:
- Non-idempotent POST allows accidental replay and duplicate master record creation.
- Race between concurrent commits on same batch can create duplicates (especially suppliers/customers).

Financial Risks:
- `OPENING_BALANCES` commit overwrites `payment_accounts.opening_balance` directly, potentially distorting all historical account balances.
- Direct opening-balance mutation bypasses posting engine/event-entry controls.
- Response mismatch risk: batch stores `failedRows = failed + invalid`, but API response `failedRows` returns only runtime failed rows.

Edge Case Failures:
- If transaction fails after status set to `PROCESSING`, batch can remain stuck in `PROCESSING` with no recovery path.
- Supplier/customer duplicate prevention is app-level (`findFirst` + create) without DB unique constraint on name, so concurrency can bypass it.

Concurrency Risks:
- High: check-then-act race on batch status and duplicate detection logic.
- No serializable isolation/idempotent tokenization in commit flow.

Test Coverage:
- Covered: valid commit for suppliers/customers/products (Tests 11-13), skip invalid rows behavior (Tests 14-15), status precondition (Test 16), duplicate supplier handling (Test 17), row linkage (Test 18), opening balance happy path (Test 27).
- Missing: concurrent commit race tests, idempotent replay tests, `TRANSACTIONS` module rejection test, processing-stuck recovery tests, opening-balance with existing payment entries tests, unauthorized tests.

Verdict:
❌ Unsafe

Required Fixes:
- Add strict idempotency for commit.
- Make state transition atomic (`where: { id, tenantId, status: 'VALIDATED' }`).
- Reject unsupported module values at DTO and service boundaries.
- Protect opening balance updates (allow only initialization window or accounts without entries) and audit old/new values.
- Harmonize `failedRows` semantics between response and persisted batch.

--------------------------------------------
## API: POST /api/v1/imports/{id}/map
--------------------------------------------

Route Entry:
- Global route prefix `api/v1` from `src/main.ts`.
- Controller route `@Controller('imports')`.
- Method: `mapColumns(@Param('id'), @Body() dto)`.

Controller:
- `src/imports/imports.controller.ts#mapColumns`.

Service:
- `src/imports/imports.service.ts#mapColumns`.

Repository:
- `importBatch.findFirst` by tenant.
- `importRow.findMany` all rows for batch.
- Per-row `importRow.update` in transaction.
- `importBatch.update({ status: 'VALIDATED' })`.

DTO/Schema:
- DTO: `src/imports/dto/column-mapping.dto.ts` (`columnMappings: Record<string, string>` only `@IsObject`).
- Validation logic: `RowValidatorService`.
- DB models: `ImportBatch`, `ImportRow`.

Execution Trace:
1. Request passes middleware and global guards.
2. UUID param validation runs.
3. Body validation confirms `columnMappings` is an object.
4. Service checks batch exists in tenant and status is `PENDING_MAPPING`.
5. Service verifies all required target fields are present in mapping keys.
6. Service loads all rows and transforms row JSON by mapping headers -> system fields.
7. Service validates rows via `RowValidatorService` (module-specific checks).
8. Service updates each row `rawDataJson`, `status`, and optional `errorMessage` in transaction.
9. Service updates batch to `VALIDATED`.
10. Service returns counts, errors, and preview.

Business Rules Observed:
- Required fields must be mapped before validation.
- Module-specific row validation rules are applied.
- Batch must be in `PENDING_MAPPING` before mapping.

Missing Rules:
- No strict validation for `columnMappings` keys/values (unknown fields and non-string values accepted).
- No check that mapped source headers actually exist in uploaded file header set.
- Raw source data is overwritten with mapped data, reducing audit traceability.
- No prevention of mapping unsupported module (`TRANSACTIONS` passes with zero required fields).

Security Risks:
- Weak mapping schema validation allows malformed payloads and silent data coercion.

Financial Risks:
- Inadequate mapping validation can silently map wrong columns and produce financially incorrect master data.
- Accepting `TRANSACTIONS` module creates false “validated” batches that do not represent real importable workflows.

Edge Case Failures:
- Mapping to non-existent header fills required fields with `''`, causing mass invalid rows without clear mapping-level failure.
- Large batches are updated row-by-row; response can include very large error arrays with no cap.

Concurrency Risks:
- Concurrent map requests can race on status and row updates; no compare-and-swap update on batch status.

Test Coverage:
- Covered: required-field mapping enforcement (Test 7), status precondition (Test 8), row validation/errors (Test 9), status transition (Test 10).
- Missing: malformed `columnMappings` payload tests, unknown header mapping tests, concurrency tests, `TRANSACTIONS` module path tests, tenant-isolation test for map.

Verdict:
⚠ Risky

Required Fixes:
- Add strict DTO validation for mapping keys and string values.
- Validate mapping values against detected header list from upload.
- Preserve original raw row payload in separate field for auditability.
- Add atomic status transition guard and concurrency tests.

--------------------------------------------
## API: POST /api/v1/imports/{id}/rollback
--------------------------------------------

Route Entry:
- Global route prefix `api/v1` from `src/main.ts`.
- Controller route `@Controller('imports')`.
- Method: `rollback(@Param('id'))`.

Controller:
- `src/imports/imports.controller.ts#rollback`.

Service:
- `src/imports/imports.service.ts#rollbackImport`.

Repository:
- `importBatch.findFirst` (tenant+id).
- `importRow.findMany` for successful rows.
- Dependency checks via `transaction.count`, `transactionLine.count`, `paymentEntry.count`.
- Transactional updates to target records, import rows, and batch status.

DTO/Schema:
- UUID param validation via `ParseUUIDPipe`.
- DB models: `ImportBatch`, `ImportRow`, `Supplier`, `Customer`, `Product`, `PaymentAccount`.

Execution Trace:
1. Request passes middleware and global guards.
2. UUID param is validated.
3. Service verifies batch exists in tenant and is `COMPLETED`.
4. Service loads successful rows with created record IDs.
5. Service performs dependency checks (outside transaction) per record type.
6. If any dependency exists, service throws `ConflictException`.
7. Service starts DB transaction and reverts created records:
8. Supplier/customer/product are soft-disabled (`status=INACTIVE`); payment account balance forced to `0`.
9. Import rows are reset to `VALID` and created-record links cleared.
10. Batch status is set to `ROLLED_BACK`, summary is returned.

Business Rules Observed:
- Rollback allowed only from `COMPLETED` state.
- Dependency blocking exists (`409`) before rollback actions.
- Rollback updates batch and row statuses to reversible state markers.

Missing Rules:
- No restoration of original payment account opening balance for `OPENING_BALANCES` imports (it is hard-reset to 0).
- Dependency check and rollback mutation are not performed atomically (TOCTOU gap).
- No idempotency/replay handling.
- No tenant constraint in update `where` clauses (relies on trusted prefetch context).

Security Risks:
- Replayable rollback endpoint can be retried without idempotent response semantics.

Financial Risks:
- Critical: opening balance rollback can corrupt balances by setting to `0` instead of prior value.
- If account had legitimate pre-import opening balance, rollback destroys that baseline.
- Non-atomic dependency check can allow race where dependencies appear after check.

Edge Case Failures:
- Rollback of imported opening balances on active accounts with historical usage has ambiguous and potentially irreversible outcomes.
- “All-or-nothing” intent is weakened by check-before-transaction window.

Concurrency Risks:
- High: check-then-act race between dependency checks and rollback writes.

Test Coverage:
- Covered: happy rollback (Test 19), dependency conflict 409 for supplier transactions (Test 20), status precondition (Test 21), batch state update (Test 22).
- Missing: rollback for CUSTOMER/PRODUCT/PAYMENT_ACCOUNT dependency paths, opening-balance restore correctness tests, concurrent rollback vs transaction creation race tests, tenant-isolation tests for rollback.

Verdict:
❌ Unsafe

Required Fixes:
- Store pre-change values for reversible updates (especially opening balances) and restore exact prior values.
- Move dependency checks inside rollback transaction (or use locks/serializable isolation).
- Add idempotency/replay-safe semantics.
- Add endpoint tests for all record-type dependency branches and race conditions.
