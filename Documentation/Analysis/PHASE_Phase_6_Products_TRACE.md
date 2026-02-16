# PHASE TRACE REPORT

Title:
Phase 6 — Products

--------------------------------------------
## API: GET /api/v1/products
--------------------------------------------

Route Entry:
- `main.ts` global prefix `api/v1` + `ProductsController.findAll()` route `@Get()` (`src/main.ts:27`, `src/products/products.controller.ts:44`)
- Middleware/guards on path: `RequestContextMiddleware` -> `TenantContextMiddleware` -> `JwtAuthGuard` -> `TenantScopeGuard` -> `RolesGuard` (`src/app.module.ts:47-79`)

Controller:
- `ProductsController.findAll(@Query() query: ListProductsQueryDto)` (`src/products/products.controller.ts:53`)

Service:
- `ProductsService.findAll(query)` (`src/products/products.service.ts:37`)

Repository:
- `prisma.product.findMany({ where, skip, take, orderBy })`
- `prisma.product.count({ where })` (`src/products/products.service.ts:62-70`)

DTO/Schema:
- `ListProductsQueryDto` + `PaginationQueryDto` validation (`src/products/dto/list-products-query.dto.ts:5-19`, `src/common/dto/pagination-query.dto.ts`)
- Product schema/indexes (`prisma/schema.prisma` model `Product`, index `@@index([tenantId, name])`)

Execution Trace:
1. Request enters `/api/v1/products`; JWT is required by global `JwtAuthGuard`.
2. `TenantScopeGuard` extracts `tenantId/userId/role` into async request context.
3. Validation pipe transforms query into DTO, enforcing `page`, `limit`, and `status in {ACTIVE, INACTIVE, ALL}`.
4. Service builds tenant-scoped Prisma `where` filter (optional `status`, `category`, `search` OR across name/sku/category).
5. Service runs `findMany` and `count` concurrently, then returns `{ data, meta }` via `paginateResponse`.

Business Rules Observed:
- Tenant isolation is enforced at query level (`where: { tenantId }`).
- Default list scope is `status=ACTIVE`.
- Category and text search are case-insensitive.

Missing Rules:
- No `sortBy/sortOrder` controls despite being expected in implementation plan.
- No `inStock` filter.
- No explicit upper bound on `search` length.

Security Risks:
- JWT validation trusts token payload without re-checking user/tenant status in DB (`src/auth/strategies/jwt.strategy.ts:23-25`). Suspended users with unexpired tokens retain access.

Financial Risks:
- Low direct financial risk (read-only endpoint).

Edge Case Failures:
- Pagination ordering only by `name`; equal-name rows can produce unstable page boundaries.

Concurrency Risks:
- `count` and `findMany` are not wrapped in a repeatable-read snapshot; metadata can drift under concurrent writes.

Test Coverage:
- Covered: base listing, category filter, search, tenant isolation (`test/integration/products.integration.spec.ts:96-141`).
- Missing: status filter permutations (`ACTIVE/INACTIVE/ALL`), invalid status, pagination boundary tests, unauthenticated GET test.

Verdict:
⚠ Risky

Required Fixes:
- Add DB-backed user/tenant active-state check in auth/guard flow.
- Add deterministic secondary ordering (e.g., `name`, then `id`).
- Add tests for status filters, pagination boundaries, and unauthenticated access.

--------------------------------------------
## API: GET /api/v1/products/{id}
--------------------------------------------

Route Entry:
- `ProductsController.findOne(@Param('id', ParseUUIDPipe) id)` route `@Get(':id')` (`src/products/products.controller.ts:57-66`)
- Same global middleware/guards chain from `AppModule`.

Controller:
- `ProductsController.findOne()` (`src/products/products.controller.ts:64`)

Service:
- `ProductsService.findOne(id)` (`src/products/products.service.ts:75`)

Repository:
- `prisma.product.findFirst({ where: { id, tenantId } })` (`src/products/products.service.ts:79-81`)

DTO/Schema:
- Path param validated with `ParseUUIDPipe`.
- Product table primary key `id`, tenant column `tenant_id`.

Execution Trace:
1. Request authenticated and tenant context injected by guards.
2. `ParseUUIDPipe` validates `id` format.
3. Service reads tenant-scoped product by `(id, tenantId)` using `findFirst`.
4. Missing record returns `NotFoundException('Product not found')`; otherwise returns row.

Business Rules Observed:
- Cross-tenant reads are blocked by tenant-scoped query.

Missing Rules:
- No status-based visibility rule (inactive products are still readable).

Security Risks:
- Same token trust risk (no DB revalidation of user/tenant status).

Financial Risks:
- Low direct financial risk (read-only master-data endpoint).

Edge Case Failures:
- None severe beyond global auth/token-state issue.

Concurrency Risks:
- Minimal (single read).

Test Coverage:
- Covered: success path and cross-tenant 404 (`test/integration/products.integration.spec.ts:144-165`, `test/integration/security.integration.spec.ts:142-150`).
- Missing: unauthenticated test and invalid UUID test.

Verdict:
⚠ Risky

Required Fixes:
- Add auth-state revalidation for inactive users/tenants.
- Add integration tests for invalid UUID and unauthenticated access.

--------------------------------------------
## API: GET /api/v1/products/{id}/stock
--------------------------------------------

Route Entry:
- `ProductsController.getStock(@Param('id', ParseUUIDPipe) id)` route `@Get(':id/stock')` (`src/products/products.controller.ts:93-102`)
- Same global middleware/guards chain.

Controller:
- `ProductsController.getStock()` (`src/products/products.controller.ts:100`)

Service:
- `ProductsService.getStock(id)` (`src/products/products.service.ts:150`)

Repository:
- `prisma.product.findFirst({ where: { id, tenantId } })`
- Raw SQL aggregate on `inventory_movements` via `$queryRaw` (`src/products/products.service.ts:154-166`)

DTO/Schema:
- `ParseUUIDPipe` for `id`.
- Stock derived from `inventory_movements` (`MovementType` enum) and product `avg_cost` (`prisma/schema.prisma` Product + InventoryMovement).

Execution Trace:
1. Guards authenticate and attach tenant context.
2. UUID path param is validated.
3. Service verifies product existence for tenant.
4. Service computes current stock from `inventory_movements` with signed CASE expression.
5. `safeMoney` converts bigint aggregate to JS number with precision guard.
6. Response returns `{ productId, productName, currentStock, avgCost }`.

Business Rules Observed:
- Stock is derived from append-only movement table, not stored as mutable balance.
- Tenant-scoped stock query.

Missing Rules:
- No `asOfDate` filter support (current stock only).
- No explicit handling for newly introduced movement types; CASE defaults unknown types to negative branch.

Security Risks:
- Same token trust risk (inactive/suspended users with valid JWT can read stock).

Financial Risks:
- Stock correctness depends on CASE mapping staying in sync with `MovementType`; future enum additions can silently misstate stock.
- DB schema lacks composite tenant+entity FKs (defense-in-depth gap noted in tenant-isolation tests), so direct DB writes can poison stock aggregates.

Edge Case Failures:
- If stock aggregate exceeds safe JS integer range, endpoint throws 500 (`safeMoney`), no graceful domain error.

Concurrency Risks:
- Product existence check and stock aggregate are separate reads; concurrent posting can produce transient read skew.

Test Coverage:
- Covered: zero/new product, purchase effect, sale effect, unknown product 404, tenant isolation (`test/integration/balance-queries.integration.spec.ts:50-131`).
- Missing: invalid UUID, unauthenticated access, movement-type completeness, overflow behavior.

Verdict:
⚠ Risky

Required Fixes:
- Add regression tests tying every `MovementType` to stock sign behavior.
- Add optional `asOfDate` support or document current-only semantics explicitly in API contract.
- Add auth-state revalidation and invalid UUID/unauthenticated tests.

--------------------------------------------
## API: PATCH /api/v1/products/{id}
--------------------------------------------

Route Entry:
- `ProductsController.update(@Param('id', ParseUUIDPipe) id, @Body() dto)` route `@Patch(':id')` (`src/products/products.controller.ts:68-79`)
- Protected by `@Roles('OWNER', 'ADMIN')` + global guards.

Controller:
- `ProductsController.update()` (`src/products/products.controller.ts:77`)

Service:
- `ProductsService.update(id, dto)` (`src/products/products.service.ts:87`)

Repository:
- `prisma.product.findFirst({ where: { id, tenantId } })`
- `prisma.product.update({ where: { id, tenantId }, data: dto })` (`src/products/products.service.ts:91-100`)

DTO/Schema:
- `UpdateProductDto` (`name/sku/category/unit` optional) (`src/products/dto/update-product.dto.ts:5-35`)
- Global validation pipe `whitelist + forbidNonWhitelisted`.

Execution Trace:
1. Guards enforce JWT + tenant scope + role (`OWNER/ADMIN`).
2. UUID path validation and DTO validation run.
3. Service checks existence under `(id, tenantId)`.
4. Service writes partial update through Prisma; maps `P2002` to 409 for SKU conflicts.
5. Returns updated product row.

Business Rules Observed:
- `avgCost` cannot be patched through DTO whitelist.
- Tenant isolation and role restriction enforced.
- SKU collision returns 409.

Missing Rules:
- No rule preventing SKU mutation after transaction history exists (implementation plan expected this).
- No change-audit log for master-data edits.
- No optimistic concurrency control/version check.

Security Risks:
- Token payload is trusted without checking current user/tenant status in DB.
- Role protection is present, but no endpoint-specific integration tests prove 403 behavior.

Financial Risks:
- SKU changes on transacted products can break external reconciliation/audit mapping workflows.

Edge Case Failures:
- `name: null` passes `@IsOptional()` and reaches DB where `name` is non-nullable, causing unhandled Prisma error -> 500 instead of 400.
- Race between pre-check and update can surface `P2025` and bubble as 500.

Concurrency Risks:
- Lost-update risk: concurrent PATCH requests overwrite each other (last write wins).

Test Coverage:
- Covered: happy path update, forbidden `avgCost` field, cross-tenant 404 (`test/integration/products.integration.spec.ts:168-191`, `test/integration/security.integration.spec.ts:152-163`).
- Missing: duplicate SKU on update, null-name 500 regression, role 403, unauthenticated access, SKU-with-history rejection.

Verdict:
❌ Unsafe

Required Fixes:
- Reject `null` explicitly for `name` (and other non-null fields) at DTO layer.
- Add business rule: block SKU change if product has transaction history.
- Add optimistic concurrency strategy (version or `updatedAt` precondition).
- Add full authorization and negative-path integration tests.

--------------------------------------------
## API: PATCH /api/v1/products/{id}/status
--------------------------------------------

Route Entry:
- `ProductsController.updateStatus(@Param('id', ParseUUIDPipe) id, @Body() dto)` route `@Patch(':id/status')` (`src/products/products.controller.ts:81-91`)
- Protected by `@Roles('OWNER', 'ADMIN')` + global guards.

Controller:
- `ProductsController.updateStatus()` (`src/products/products.controller.ts:89`)

Service:
- `ProductsService.updateStatus(id, dto)` (`src/products/products.service.ts:108`)

Repository:
- `prisma.product.findFirst({ where: { id, tenantId } })`
- `$queryRaw` stock aggregate from `inventory_movements` for deactivation guard
- `$transaction([product.update, statusChangeLog.create])` (`src/products/products.service.ts:112-145`)

DTO/Schema:
- `UpdateStatusDto` (`status in ACTIVE/INACTIVE`, optional `reason`) (`src/common/dto/update-status.dto.ts:4-12`)
- `status_change_logs` table (`prisma/schema.prisma` model `StatusChangeLog`).

Execution Trace:
1. Guards enforce authentication, tenant context, and owner/admin role.
2. Path UUID and body status enum validated.
3. Service checks product exists in tenant.
4. If target status is `INACTIVE`, service computes current stock and blocks if `stock > 0`.
5. Service executes transaction to update product status and append status-change log.
6. Returns updated product.

Business Rules Observed:
- Deactivation is blocked when current stock is positive.
- Status change is auditable via append-only `status_change_logs` insert.

Missing Rules:
- `reason` is optional even for deactivation (policy/audit weakness).
- No idempotent no-op handling when status is unchanged.
- No DB foreign keys on `status_change_logs` to tenant/user/product entities for integrity hardening.

Security Risks:
- Global token trust issue (no live user/tenant status revalidation).
- No explicit role/403 integration tests for this endpoint.

Financial Risks:
- Deactivation guard is vulnerable to race: stock is checked before status update without locking; concurrent inbound movement can violate intended invariant.

Edge Case Failures:
- Pre-check/update race can surface unhandled Prisma errors (e.g., record changed between reads) -> 500.

Concurrency Risks:
- TOCTOU race between stock read and status write.
- No lock on `inventory_movements`/`product` during deactivation check.

Test Coverage:
- Covered: happy-path status update, cross-tenant 404 (`test/integration/products.integration.spec.ts:194-205`, `test/integration/security.integration.spec.ts:165-176`).
- Missing: positive-stock deactivation rejection, status log persistence assertions, same-status idempotency, role 403, unauthenticated access.

Verdict:
❌ Unsafe

Required Fixes:
- Perform stock check and status update in a serialized transaction with explicit lock strategy.
- Make deactivation reason mandatory (or enforce policy-level equivalent).
- Add DB-level FKs for `status_change_logs` where feasible.
- Add concurrency and audit-log integration tests.

--------------------------------------------
## API: POST /api/v1/products
--------------------------------------------

Route Entry:
- `ProductsController.create(@Body() dto)` route `@Post()` (`src/products/products.controller.ts:33-42`)
- Protected by `@Roles('OWNER', 'ADMIN')` + global guards.

Controller:
- `ProductsController.create()` (`src/products/products.controller.ts:40`)

Service:
- `ProductsService.create(dto)` (`src/products/products.service.ts:21`)

Repository:
- `prisma.product.create({ data: { tenantId, createdBy, ...dto } })` (`src/products/products.service.ts:27-29`)

DTO/Schema:
- `CreateProductDto` with SKU uppercase transform + regex (`src/products/dto/create-product.dto.ts:5-35`)
- DB uniqueness: `products_tenant_id_sku_key` + `products_tenant_sku_ci_unique` functional index (`prisma/migrations/20260215100000_add_uniqueness_indexes/migration.sql`).

Execution Trace:
1. Guards enforce JWT, tenant scope, and owner/admin role.
2. Validation pipe enforces DTO constraints and strips unknown fields.
3. Service requires `tenantId` from request context.
4. Service writes new product row with tenant/user linkage.
5. Prisma unique violation `P2002` is mapped to HTTP 409.
6. Created row is returned.

Business Rules Observed:
- SKU canonicalization to uppercase at DTO layer.
- Tenant-scoped product creation.
- Duplicate SKU conflict handling via DB uniqueness.

Missing Rules:
- No idempotency key support for create retries.
- No trim/normalization for `name/category/unit`.
- No explicit rejection of empty-string SKU (`""` passes regex and can create surprising uniqueness behavior).

Security Risks:
- JWT payload is trusted without checking current DB user/tenant state.

Financial Risks:
- Low direct financial impact; endpoint creates master data only.

Edge Case Failures:
- Empty string SKU accepted due regex `*` and optional semantics.
- Swagger contract drift: decorator uses `@ApiOkResponse` while real status is 201.

Concurrency Risks:
- Duplicate creates are only controlled by DB uniqueness; non-SKU duplicates can be created by retried requests.

Test Coverage:
- Covered: no-SKU create, SKU uppercase, duplicate SKU 409, invalid SKU, missing name, unauthenticated, case-insensitive duplicate (`test/integration/products.integration.spec.ts:40-93`, `:210-224`).
- Missing: role 403, empty-string SKU behavior, null/blank normalization cases, idempotent retry behavior.

Verdict:
⚠ Risky

Required Fixes:
- Add explicit `@IsNotEmpty()` for optional string fields when present (especially SKU).
- Add role/403 tests and edge-case tests for empty/blank payload values.
- Align Swagger response code annotations with actual HTTP status.
