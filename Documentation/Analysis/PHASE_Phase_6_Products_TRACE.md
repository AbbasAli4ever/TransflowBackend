# PHASE TRACE REPORT

Title:
Phase 6 - Products

--------------------------------------------
## API: GET /api/v1/products
--------------------------------------------

Route Entry:
`main.ts` sets global prefix `/api/v1` -> `AppModule` registers global middleware/guards -> `ProductsController.findAll()`.

Controller:
`src/products/products.controller.ts` -> `findAll(@Query() query: ListProductsQueryDto)`.

Service:
`src/products/products.service.ts` -> `findAll(query)`.

Repository:
`PrismaService.product.findMany()` and `PrismaService.product.count()`.

DTO/Schema:
`ListProductsQueryDto`, `PaginationQueryDto`, `Product` model (`prisma/schema.prisma`).

Execution Trace:
1. Request enters `RequestContextMiddleware` and gets/creates `x-request-id`.
2. `TenantContextMiddleware` parses bearer token and preloads async context if token is valid.
3. `JwtAuthGuard` authenticates JWT; `TenantScopeGuard` enforces `user.tenantId` and writes tenant/user into request context.
4. Global `ValidationPipe` validates/transforms query (`page`, `limit`, `search`, `status`, `category`), strips unknown fields.
5. Controller calls service `findAll`.
6. Service reads `tenantId` from context; throws `UnauthorizedException` if missing.
7. Service builds `where` with tenant filter and optional status/category/search filters.
8. Service executes parallel Prisma queries for paged rows and total count.
9. Service maps every row through `withComputed()` and returns paginated response.
10. `HttpExceptionFilter` shapes any error response; success passes through unchanged.

Business Rules Observed:
- Tenant filter is mandatory in query.
- Default status filter is `ACTIVE` unless `status=ALL`.
- Query limit max enforced at 100 via DTO inheritance.

Missing Rules:
- `_computed` fields are placeholders (`currentStock`, totals, dates all fake defaults), not derived truth.
- No explicit max length guard for `search`/`category` query payloads.
- No deterministic secondary sort key when names are equal.

Security Risks:
- No direct injection risk found; Prisma query builder and validated inputs are used.
- Authorization is coarse-grained: any authenticated tenant user can list products.

Financial Risks:
- Response includes fabricated `_computed` stock/purchase/sale metrics, which can mislead financial UI decisions.

Edge Case Failures:
- Inactive products are hidden by default unless client knows to set `status=ALL`.
- Empty result pages for out-of-range `page` values are not explicitly flagged.

Concurrency Risks:
- Read is non-transactional snapshot; concurrent writes may change page/count between calls.

Test Coverage:
- Covered in `test/integration/products.integration.spec.ts`: pagination, category filter, search, tenant isolation.
- Missing: explicit `status=ACTIVE/INACTIVE/ALL` behavior tests, invalid query parameter tests, unauthorized list test in this suite.

Verdict:
⚠ Risky

Required Fixes:
- Replace placeholder `_computed` with real derived values or remove from response.
- Add tests for status filters and query validation boundaries.
- Add explicit stable ordering (`name`, then `id`) for deterministic pagination.

--------------------------------------------
## API: GET /api/v1/products/{id}
--------------------------------------------

Route Entry:
`/api/v1/products/:id` -> `ProductsController.findOne()`.

Controller:
`src/products/products.controller.ts` -> `findOne(@Param('id', ParseUUIDPipe) id: string)`.

Service:
`src/products/products.service.ts` -> `findOne(id)`.

Repository:
`PrismaService.product.findFirst({ where: { id, tenantId } })`.

DTO/Schema:
`ParseUUIDPipe`, `Product` model.

Execution Trace:
1. Request passes request-context middleware, tenant-context middleware, JWT guard, tenant guard.
2. `ParseUUIDPipe` rejects malformed UUID before service.
3. Controller calls service.
4. Service enforces tenant context presence.
5. Service runs tenant-scoped lookup by `id`.
6. If missing, throws `NotFoundException('Product not found')`.
7. Service returns entity plus `withComputed()` placeholder object.
8. Response returns raw object; exceptions are normalized by global filter.

Business Rules Observed:
- Cross-tenant access returns 404 because query includes `tenantId`.
- Invalid UUID input is rejected at route layer.

Missing Rules:
- `_computed` fields are static placeholders, not truth.
- No visibility rule to hide inactive products from detail endpoint.

Security Risks:
- UUID probing still leaks existence timing only as generic 404; tenant data remains isolated.

Financial Risks:
- Consumer can read inaccurate `_computed` stock/totals and treat them as factual.

Edge Case Failures:
- None critical in route/service path beyond placeholder metric issue.

Concurrency Risks:
- Read may race with updates; no snapshot pinning beyond DB default.

Test Coverage:
- Covered in `test/integration/products.integration.spec.ts`: success path and cross-tenant 404.
- Missing: invalid UUID 400 test, unauthorized 401 test, inactive-product retrieval behavior test.

Verdict:
⚠ Risky

Required Fixes:
- Remove or correctly compute `_computed` fields on detail response.
- Add explicit tests for invalid UUID and unauthenticated access.

--------------------------------------------
## API: GET /api/v1/products/{id}/stock
--------------------------------------------

Route Entry:
`/api/v1/products/:id/stock` -> `ProductsController.getStock()`.

Controller:
`src/products/products.controller.ts` -> `getStock(@Param('id', ParseUUIDPipe) id: string)`.

Service:
`src/products/products.service.ts` -> `getStock(id)`.

Repository:
- `PrismaService.product.findFirst({ where: { id, tenantId } })`.
- `PrismaService.$queryRaw` against `inventory_movements`.

DTO/Schema:
`ParseUUIDPipe`, `ProductStockResponseDto`, `InventoryMovement` model and `MovementType` enum.

Execution Trace:
1. Request passes middleware and global guards identical to other protected routes.
2. UUID param is validated by `ParseUUIDPipe`.
3. Service verifies tenant context.
4. Service checks product existence within tenant.
5. Service executes raw SQL:
   `SUM(CASE WHEN movement_type IN ('PURCHASE_IN','CUSTOMER_RETURN_IN','ADJUSTMENT_IN') THEN quantity ELSE -quantity END)`.
6. Service converts SQL `bigint` stock to JS `number`.
7. Service returns `{ productId, productName, currentStock, avgCost }`, where `avgCost` is cached from `products.avg_cost`.

Business Rules Observed:
- Stock is derived from entry table (`inventory_movements`), not stored directly.
- Tenant isolation is enforced in both existence check and stock query.

Missing Rules:
- No protection against numeric overflow when converting `bigint` stock to JS `number`.
- No explicit filter on transaction status in query (relies on upstream invariant that only posted transactions create movements).
- Endpoint returns only current stock, no as-of date support.

Security Risks:
- Raw SQL uses parameterized tagged template; no SQL injection path found.

Financial Risks:
- Potential precision loss for large stock values due `bigint` -> `number` conversion.
- Returned `avgCost` depends on upstream posting correctness; if posting invariants fail, this API surfaces corrupted valuation.
- Posting rules in docs require stock checks before `SUPPLIER_RETURN_OUT` and `ADJUSTMENT_OUT`; posting implementation currently has gaps, so this endpoint can expose negative stock states.

Edge Case Failures:
- Extremely large movement volume can overflow JS safe integer and silently misreport stock.

Concurrency Risks:
- Read can observe rapidly changing stock during concurrent postings; no read-level locking.

Test Coverage:
- Covered in `test/integration/balance-queries.integration.spec.ts`: zero stock, purchase increase, sale decrease, 404 unknown, cross-tenant 404.
- Missing: invalid UUID 400 test, unauthorized 401 test, supplier-return/adjustment movement scenarios, large-number behavior.

Verdict:
⚠ Risky

Required Fixes:
- Return stock as string for bigint safety or enforce bounded stock values.
- Add status-aware query guard or assert posted-only movement invariant defensively.
- Add movement-type regression tests including returns and adjustments.

--------------------------------------------
## API: PATCH /api/v1/products/{id}
--------------------------------------------

Route Entry:
`/api/v1/products/:id` -> `ProductsController.update()`.

Controller:
`src/products/products.controller.ts` -> `update(@Param('id', ParseUUIDPipe) id, @Body() dto: UpdateProductDto)`.

Service:
`src/products/products.service.ts` -> `update(id, dto)`.

Repository:
- `PrismaService.product.findFirst({ where: { id, tenantId } })`.
- `PrismaService.product.update({ where: { id, tenantId }, data: dto })`.

DTO/Schema:
`UpdateProductDto`, `ParseUUIDPipe`, `Product` model unique key `(tenant_id, sku)`.

Execution Trace:
1. Request passes middleware/guards and UUID validation.
2. Body is validated by global pipe with whitelist/forbidNonWhitelisted.
3. Controller calls service with `id` and DTO.
4. Service enforces tenant context.
5. Service pre-checks existence with tenant-scoped `findFirst`.
6. Service applies Prisma `update` using tenant-constrained unique filter and DTO data.
7. `P2002` unique violation maps to HTTP 409 SKU conflict.
8. Service returns updated product with placeholder `_computed`.

Business Rules Observed:
- Tenant-scoped update only.
- `avgCost` cannot be patched because DTO excludes it and whitelist rejects unknown fields.
- Duplicate `(tenantId, sku)` blocked by DB unique constraint.

Missing Rules:
- No optimistic concurrency/version check (last-write-wins).
- Empty PATCH payload is allowed (no-op update).
- Input normalization gaps: whitespace-only names pass; empty SKU string is allowed by regex (`*`) and optional semantics.
- No explicit audit reason for master-data changes.

Security Risks:
- Any authenticated tenant user can mutate product master data; no role-based restriction.

Financial Risks:
- Product identity fields can change without versioning, impacting historical readability/audit trails.
- Empty-string SKU behavior can create avoidable uniqueness conflicts and catalog quality issues.

Edge Case Failures:
- PATCH with `{}` succeeds unexpectedly as silent no-op.
- SKU with accidental empty string can behave differently from null SKU.

Concurrency Risks:
- TOCTOU pattern (`findFirst` then `update`) and no compare-and-set semantics can cause lost updates.

Test Coverage:
- Covered in `test/integration/products.integration.spec.ts`: field updates, avgCost immutability.
- Covered in `test/integration/security.integration.spec.ts`: cross-tenant update blocked.
- Missing: duplicate SKU integration conflict test for PATCH, whitespace/empty SKU validation tests, no-op PATCH semantics test, concurrent update test.

Verdict:
⚠ Risky

Required Fixes:
- Enforce at least one mutable field in PATCH body.
- Trim and normalize string inputs; reject blank `name` and blank `sku`.
- Add optimistic locking (`updatedAt` precondition or version column) for write safety.
- Add role policy for who can mutate product master data.

--------------------------------------------
## API: PATCH /api/v1/products/{id}/status
--------------------------------------------

Route Entry:
`/api/v1/products/:id/status` -> `ProductsController.updateStatus()`.

Controller:
`src/products/products.controller.ts` -> `updateStatus(@Param('id', ParseUUIDPipe) id, @Body() dto: UpdateStatusDto)`.

Service:
`src/products/products.service.ts` -> `updateStatus(id, dto)`.

Repository:
- `PrismaService.product.findFirst({ where: { id, tenantId } })`.
- `PrismaService.product.update({ where: { id, tenantId }, data: { status: dto.status } })`.

DTO/Schema:
`UpdateStatusDto`, `ParseUUIDPipe`, `Product.status`.

Execution Trace:
1. Request passes middleware/guards, UUID validation, and DTO status enum validation.
2. Service enforces tenant context.
3. Service verifies product exists in tenant scope.
4. Service updates status only (`ACTIVE` or `INACTIVE`).
5. Service returns updated product plus placeholder `_computed`.

Business Rules Observed:
- Status values constrained to `ACTIVE`/`INACTIVE`.
- Cross-tenant status mutation blocked via tenant filter.

Missing Rules:
- `reason` field in `UpdateStatusDto` is accepted but ignored/persisted nowhere.
- No rule preventing deactivation when product has positive stock or active operational dependency.
- No role-based control for status changes.

Security Risks:
- Broad mutation permission for all authenticated tenant users.

Financial Risks:
- Product can be inactivated without stock/disposition validation, creating operational and reconciliation risk.

Edge Case Failures:
- No explicit behavior for idempotent repeat status updates (works implicitly but untested).

Concurrency Risks:
- Last-write-wins status races; no optimistic locking.

Test Coverage:
- Covered in `test/integration/products.integration.spec.ts`: happy path status update.
- Covered in `test/integration/security.integration.spec.ts`: cross-tenant status change blocked.
- Missing: invalid status payload test, ignored `reason` behavior test, stock-dependent deactivation rule tests, concurrent status update test.

Verdict:
⚠ Risky

Required Fixes:
- Persist status change reason in audit log or remove it from DTO.
- Add business rule checks before inactivation (for example, block when stock > 0 unless explicit override).
- Restrict status changes to privileged roles.

--------------------------------------------
## API: POST /api/v1/products
--------------------------------------------

Route Entry:
`/api/v1/products` -> `ProductsController.create()`.

Controller:
`src/products/products.controller.ts` -> `create(@Body() dto: CreateProductDto)`.

Service:
`src/products/products.service.ts` -> `create(dto)`.

Repository:
`PrismaService.product.create({ data: { tenantId, createdBy, ...dto } })`.

DTO/Schema:
`CreateProductDto`, `Product` model unique `(tenant_id, sku)`.

Execution Trace:
1. Request passes middleware/guards and validation pipe.
2. DTO validation enforces `name` length and SKU pattern; `sku` is uppercased by transformer.
3. Service enforces tenant context and reads `createdBy`.
4. Service writes new row with tenant/user attribution.
5. Prisma unique conflict (`P2002`) is translated to 409 SKU conflict.
6. Service returns created entity with placeholder `_computed`.

Business Rules Observed:
- Tenant scoping on creation is enforced from auth context.
- SKU uniqueness is enforced per tenant at DB level.
- Monetary field `avgCost` is not client-settable in create DTO.

Missing Rules:
- No idempotency key handling for create; retries can create duplicate products when SKU is omitted.
- `name` is not trimmed; whitespace-only names can pass length/non-empty checks.
- `sku` allows empty string due regex and optional semantics.
- No role-based restriction for creating products.

Security Risks:
- Authenticated user in tenant can create master data without role gate.

Financial Risks:
- Non-idempotent create can duplicate catalog items under retry/network failures, fragmenting stock/cost flows across near-identical products.
- Weak normalization (blank-like names/SKU edge cases) increases master-data corruption risk with downstream accounting impact.

Edge Case Failures:
- Empty string SKU accepted; behaves differently than null and can trigger avoidable uniqueness collisions.
- Replayed request without SKU can create multiple logical duplicates.

Concurrency Risks:
- Concurrent same-SKU creates rely on DB unique constraint; one fails (good), but client retry semantics remain non-idempotent without request keying.

Test Coverage:
- Covered in `test/integration/products.integration.spec.ts`: create without SKU, uppercase SKU transform, duplicate SKU 409, invalid SKU 400, missing name 400, unauthenticated 401.
- Missing: whitespace-name rejection test, empty-string SKU rejection test, idempotent retry behavior test, role-based authorization test.

Verdict:
❌ Unsafe

Required Fixes:
- Implement idempotency for create (header key persisted per tenant+route+payload hash) or enforce client-provided deterministic natural key.
- Normalize and trim `name`/`sku`; reject blank values.
- Add role-based access control for product creation.
- Add regression tests for retry duplication and blank-input cases.
