# FINAL TECHNICAL REMEDIATION REPORT — Finance System Codebase Audit
**Date:** 2026-02-15
**Audit Scope:** All 10 modules, 20 analysis files (SUMMARY + TRACE per module)
**Purpose:** Complete developer action plan — every issue, every required fix, every missing test

---

## MODULE 1 — AUTH (Phase 1)

### API: POST /api/v1/auth/register

**Required Fixes:**
- `src/auth/auth.service.ts#register`: Wrap the `user.findFirst` + `transaction.create` block in a try-catch that maps Prisma error code `P2002` to `ConflictException('Email already exists')`. The current application-level pre-check has a TOCTOU race window — if two concurrent requests pass the `findFirst` check simultaneously, one will hit the DB unique constraint and return an unhandled 500.
- Add a case-insensitive unique index at the database level: `CREATE UNIQUE INDEX ... ON users(tenant_id, lower(email))` — or use `citext` extension. Application-level `toLowerCase()` normalization alone is insufficient.
- Add registration abuse controls: tighten the rate-limit configuration to be endpoint-specific (lower limit for `/auth/register`).

**Missing Tests:**
- Parallel register requests on the same email: spawn two concurrent `POST /auth/register` calls with identical email; assert exactly one `201` and one `409` response.
- Explicit `P2002` mapping test: verify that the Prisma unique constraint error is mapped to 409, not 500.
- Registration abuse/throttling test: assert 429 behavior after threshold is hit.

---

### API: POST /api/v1/auth/login

**Required Fixes:**
- `src/auth/auth.service.ts#login`: Normalize external error responses to collapse the distinction between invalid credentials, inactive user, and inactive tenant. External callers must not be able to determine whether an account exists. Example: return `UnauthorizedException('Authentication failed')` for all negative auth outcomes, while logging the specific reason internally.
- Implement per-account/per-IP adaptive throttling and lockout/backoff. Add a failed-attempt counter in a fast store (Redis or DB) and return 429 after a threshold.
- Implement refresh token persistence: create a `refresh_tokens` table with columns `(id, user_id, tenant_id, token_hash, issued_at, expires_at, revoked_at)`. Store the hash of the refresh token at login time. Add `POST /auth/refresh` endpoint that validates the hash, checks `revoked_at IS NULL`, and issues a new access token. Add `POST /auth/logout` that sets `revoked_at` on the stored token.
- Fix the `lastLoginAt` update ordering: it currently updates before token generation. If token generation throws, the side effect still occurs. Move the update to after successful token generation.
- Trim `LoginDto.password` or add a non-whitespace-only validator so that whitespace-only passwords do not silently pass to `bcrypt.compare`.

**Missing Tests:**
- Enumeration resistance test: assert that an invalid password and an inactive-account login return the same external error shape and status code.
- Brute-force protection test: submit N+1 failed login attempts and assert 429 with backoff semantics.
- Refresh token lifecycle tests: issue, rotate, use rotated token, attempt reuse of old token (must be rejected).
- Refresh token revocation test: logout, then attempt to use the refresh token and assert rejection.

---

## MODULE 2 — CUSTOMERS (Phase 2)

### API: POST /api/v1/customers

**Required Fixes:**
- Database: Add unique index `CREATE UNIQUE INDEX ... ON customers(tenant_id, lower(name))`.
- `src/customers/customers.service.ts#create`: Remove the `findFirst` duplicate pre-check. Use a direct `customer.create()` and catch `P2002` → `ConflictException('Customer name already exists')`. This is atomic and race-safe.

**Missing Tests:**
- Concurrent duplicate creation: two parallel POSTs with the same name must yield one 201 and one 409.
- Same-name different-tenant test: assert that the same name is allowed across different tenants.
- Invalid/extra field whitelist rejection test.

---

### API: PATCH /api/v1/customers/{id}

**Required Fixes:**
- Database: Same unique index as above (covers rename as well).
- `src/customers/customers.service.ts#update`: Remove the `findFirst` duplicate-name check; catch `P2002` on update → 409.
- Add rejection of an empty PATCH body `{}` with `BadRequestException('No fields to update')`.

**Missing Tests:**
- Duplicate rename conflict integration test.
- 404 for unknown ID, 400 for invalid UUID, 401 for unauthenticated.
- Empty body rejection test.

---

### API: PATCH /api/v1/customers/{id}/status

**Required Fixes:**
- `src/customers/customers.service.ts#updateStatus`: Before updating to INACTIVE, query open balance via the same aggregate used in `getBalance`. If outstanding > 0, throw `ConflictException('Cannot deactivate customer with outstanding balance')`.
- Persist `reason` to an audit trail: either add a `status_change_log` table or a `notes`/`auditReason` field on the customer row. Do not silently discard it.
- Add a DB CHECK constraint on `customers.status` for allowed values.

**Missing Tests:**
- Invalid status payload test (value outside ACTIVE/INACTIVE → 400).
- Unknown ID test (→ 404).
- Unauthenticated test (→ 401).
- Deactivation blocked when open balance > 0.

---

### API: GET /api/v1/customers/{id}/balance

**Required Fixes:**
- `src/customers/customers.service.ts#getBalance`: Replace `Number(bigintValue)` with a safe conversion: check `bigintValue <= BigInt(Number.MAX_SAFE_INTEGER)` and throw or return string if exceeded. Or serialize all money fields as strings in the response DTO.

**Missing Tests:**
- Large-value precision boundary test (value > `Number.MAX_SAFE_INTEGER`).
- Negative credit-balance test.
- Invalid UUID test (→ 400), unauthenticated test (→ 401).

---

### API: GET /api/v1/customers/{id}/open-documents

**Required Fixes:**
- Implement `asOfDate` and `includeFullyPaid` query parameters as specified in the implementation plan. The `asOfDate` filter must bound the allocation sums to payments made on or before that date.
- Join allocations to their payment transactions and add `payment_transaction.transaction_date <= $asOfDate` to the WHERE clause.
- Serialize money fields (`total_amount`, `paid_amount`, `outstanding`) as strings in response.

**Missing Tests:**
- Cross-tenant customer open-doc access test (tenant A customer ID used by tenant B → 404).
- Partial payment and fully-paid exclusion behavior tests.
- Invalid UUID test, unauthenticated test.

---

## MODULE 3 — DASHBOARD (Phase 3)

### API: GET /api/v1/dashboard/summary

**Required Fixes (Critical):**

1. **Point-in-time overdue fix**: In `src/dashboard/dashboard.service.ts#queryReceivables` and `#queryPayables`, the CTEs that compute open document outstanding must add an allocation date boundary. Change the allocation sum to:
   ```sql
   SUM(CASE WHEN a.payment_transaction_id IN (
     SELECT id FROM transactions WHERE transaction_date <= $asOfDate AND status = 'POSTED'
   ) THEN a.amount_applied ELSE 0 END)
   ```
   This ensures only payments posted on or before `asOfDate` reduce document outstanding.

2. **Consistent snapshot**: Wrap all 5 sub-queries in a single `prisma.$transaction(async (tx) => { ... }, { isolationLevel: 'RepeatableRead' })`. This guarantees all 5 reads see the same database snapshot.

3. **Strict date-only validation**: Change `DashboardQueryDto.asOfDate` from `@IsDateString()` to a custom validator that matches `/^\d{4}-\d{2}-\d{2}$/` only. Add explicit error if a datetime string is provided. Fix `subtractDays()` to throw a controlled error on invalid date input instead of producing a 500.

4. **Tenant timezone**: Replace `today()` (UTC) with a `getBusinessDate(tenantId)` function that uses the tenant's configured timezone to derive the local date.

5. **Bigint precision**: All aggregated money values must be returned as strings or pass through `Number.isSafeInteger()` check before coercion.

**Missing Tests:**
- 401 unauthorized request.
- `asOfDate` with datetime string format (e.g., `2026-02-15T00:00:00Z`) → 400.
- Point-in-time regression: post a payment after `asOfDate`; assert overdue amount is unchanged for that `asOfDate`.
- Supplier/customer return effect on overdue classification.
- Large-value precision boundary test.

---

## MODULE 4 — HEALTH (Phase 4)

### API: GET /api/v1/health

**Required Fixes:**
- Extract health/version logic from controller into `HealthService` and `VersionService`.
- Define a single canonical 503 response shape that is compatible with what `HttpExceptionFilter` produces. Update `HealthController` to throw an exception whose `message` field produces the expected body when processed by the filter. Update Swagger `@ApiServiceUnavailableResponse` to match the actual filter output.
- Split into two endpoints: `GET /health/live` (no DB call — returns process uptime only) and `GET /health/ready` (executes `SELECT 1` and returns DB status). This prevents DB-round-trips on liveness probes.
- Cache the readiness probe result for 3–5 seconds to prevent connection pool pressure under high-frequency orchestrator probes.
- Fix deployment templates: `backend/.env.production` and `backend/.env.staging` must set `NODE_ENV=production` and `NODE_ENV=staging` respectively, not `NODE_ENV=development`.

**Missing Tests:**
- DB-down scenario: mock `PrismaService.$queryRaw` to throw; assert exact 503 response body under global exception filter.
- High-frequency probe test (concurrent liveness checks without DB calls).
- Production environment correctness: assert `NODE_ENV` is read correctly from config.

---

### API: GET /api/v1/version

**Required Fixes:**
- Introduce an explicit `APP_VERSION` environment variable and bind it to `ConfigModule`. Fallback to `package.json` version at startup, not at every request.
- Define metadata exposure policy: in production, consider omitting `gitCommit` and `buildDate` if they are considered sensitive internal metadata.

**Missing Tests:**
- Null/format assertion for `buildDate` and `gitCommit` when not set.
- Environment correctness test.

---

## MODULE 5 — PAYMENT ACCOUNTS (Phase 5)

### API: POST /api/v1/payment-accounts

**Required Fixes:**
- Add input normalization for `name`: `name.trim()` and apply a canonical case policy (e.g., title case) to prevent near-duplicates.
- Add reserved-name validation per implementation plan (e.g., reject names like 'Cash', 'Bank' if they are system-reserved).
- Add explicit bounded validation for `openingBalance`: `@IsInt() @Min(-9007199254740991) @Max(9007199254740991)`.
- Remove or correctly populate `_computed` fields from the create response.

**Missing Tests:**
- Reserved-name rejection test.
- Whitespace/case normalization test.
- Integer overflow/underflow opening balance test.

---

### API: PATCH /api/v1/payment-accounts/{id}

**Required Fixes:**
- Add `name` normalization (trim, canonical case) before DB write.
- Reject empty PATCH body with 400.

**Missing Tests:**
- Duplicate rename integration test.
- Invalid UUID test.
- Empty body rejection test.

---

### API: PATCH /api/v1/payment-accounts/{id}/status (❌ Unsafe)

**Required Fixes (Critical):**
- Before updating to INACTIVE, query `GET /payment-accounts/:id/balance` equivalent in service; if `currentBalance != 0`, throw `ConflictException('Cannot deactivate account with non-zero balance')`. This was explicitly specified in the implementation plan and is not implemented.
- Persist `reason` to an audit log. Do not accept and silently discard it.
- Add idempotent semantics: if requested status equals current status, return the existing record without a write.

**Missing Tests:**
- Inactivation with non-zero balance → 409.
- `reason` persistence verification.
- Idempotent status toggle test (ACTIVE → ACTIVE is a no-op).
- Invalid status value → 400.

---

### API: GET /api/v1/payment-accounts/{id}/balance

**Required Fixes:**
- Replace `Number(bigintValue)` with safe-range check or string serialization.
- Add defensive join to `transactions` to enforce posted-only entries (or document the invariant as an explicit assumption).

**Missing Tests:**
- Large-value precision boundary test.
- Internal-transfer two-leg reconciliation test (debit one account, credit another; assert both balance endpoints update correctly).

---

## MODULE 6 — PRODUCTS (Phase 6)

### API: POST /api/v1/products (❌ Unsafe)

**Required Fixes:**
- Add idempotency key support per the global API convention: accept `Idempotency-Key` header, store `(tenant_id, idempotency_key)` in a table or Redis, return original response on replay. This is the primary defense against duplicate product creation from network retries.
- Normalize `name` input: `name.trim()` and reject whitespace-only strings with `@MinLength(1)` after trim.
- Reject empty-string `sku`: add `@MinLength(1)` to the SKU regex validator (currently `*` allows empty string match).

**Missing Tests:**
- Retry idempotency test: same `Idempotency-Key` on two POST calls must yield same 201 response.
- Whitespace-only name rejection test.
- Empty-string SKU rejection test.

---

### API: PATCH /api/v1/products/{id}

**Required Fixes:**
- Reject empty PATCH body `{}` with 400.
- Normalize and trim `name` and `sku` inputs; reject blank values.
- Duplicate SKU conflict integration test: PATCH to an existing SKU in same tenant must return 409.

---

### API: PATCH /api/v1/products/{id}/status

**Required Fixes:**
- Persist status change `reason` in an audit structure or remove from DTO.
- Add business rule check before inactivation: if product has `currentStock > 0`, throw `ConflictException` (or require explicit force flag from admin).

**Missing Tests:**
- Invalid status payload → 400.
- Stock-dependent deactivation guard test.

---

### API: GET /api/v1/products/{id}/stock

**Required Fixes:**
- Replace `Number(bigint)` with safe string representation for `currentStock`.
- Add explicit `AND t.status = 'POSTED'` in the `inventory_movements` aggregate query (join through `transaction_lines → transactions`).

**Missing Tests:**
- Invalid UUID → 400, unauthenticated → 401.
- Supplier-return movement type effect on stock count.
- Adjustment movement type scenarios.
- Large-number precision test.

---

## MODULE 7 — REPORTS (Phase 7)

### API: GET /api/v1/reports/pending-payables (❌ Unsafe)
### API: GET /api/v1/reports/pending-receivables (❌ Unsafe)

**Required Fixes (Critical):**
- In SQL #2 (open documents query), restrict allocation amounts to those where the payment's transaction date is `<= $asOfDate`:
  ```sql
  SUM(CASE
    WHEN alloc.payment_transaction_id IN (
      SELECT id FROM transactions
      WHERE transaction_date <= $asOfDate AND status = 'POSTED'
    ) THEN alloc.amount_applied
    ELSE 0
  END) as paid_amount
  ```
- In SQL #1 (balance query), add explicit posted-only filter by joining `ledger_entries` to `transactions` with `t.status = 'POSTED'`.
- Wrap SQL #1 and SQL #2 in a single read transaction with `RepeatableRead` isolation.

**Missing Tests:**
- **Critical regression test**: Create a sale/purchase. Do NOT pay. Set `asOfDate` to today. Query pending report — document must be open. Now post a payment with tomorrow's date. Re-query with original `asOfDate` — document must STILL be open (payment is after `asOfDate`).
- Tenant isolation cross-access test.
- Invalid query input tests (invalid date format, invalid UUID for `customerId/supplierId`).
- Unauthorized → 401 test.
- Balance/document consistency assertion: `sum(openDocuments.outstanding)` must equal the customer/supplier balance for the same `asOfDate`.

---

### API: GET /api/v1/reports/customers/{id}/statement
### API: GET /api/v1/reports/suppliers/{id}/statement
### API: GET /api/v1/reports/payment-accounts/{id}/statement

**Required Fixes:**
- Add custom DTO validator: `@ValidateIf(o => o.dateFrom && o.dateTo) @IsDateRange()` that asserts `dateFrom <= dateTo`. Return 400 if inverted.
- Run both sub-queries (opening balance + in-range entries) inside a single `prisma.$transaction` with `RepeatableRead` isolation level to ensure consistent snapshot.
- Add optional `limit` and `page` parameters to cap response size for large date windows.

**Missing Tests:**
- Inverted date range (`dateFrom > dateTo`) → 400.
- Unauthorized → 401.
- Cross-tenant access via ID → 404.
- Opening + in-range consistency under concurrent posting.

---

### API: GET /api/v1/reports/products/{id}/stock (❌ Unsafe)

**Required Fixes:**
- Rework `avgCost` computation to account for supplier returns. Current formula: `total_purchase_cost / total_purchase_qty` only considers purchase inflows. After a supplier return, the purchased items are reduced but the cost basis remains stale. Correct approach: use perpetual weighted-average costing that adjusts the cost pool when supplier returns occur (`cost_pool -= returned_qty * last_avg_cost`).
- Add `AND t.status = 'POSTED'` constraint in the inventory movements aggregate query.
- Add validation against negative stock readouts in the service layer.

**Missing Tests:**
- Supplier-return cost distortion: purchase 10 units at 100 PKR each; return 8 units; assert `avgCost` and `stockValue` reflect 2 units at correct cost.
- Adjustment-IN only (no purchases) stock state: assert `avgCost = 0`, `stockValue = 0`, `currentStock = adjusted quantity`.
- Cross-tenant access → 404, unauthorized → 401.

---

### API: GET /api/v1/reports/payment-accounts/{id}/balance

**Required Fixes:**
- Add explicit `t.status = 'POSTED'` join in the `payment_entries` aggregate query.
- Safe integer serialization for money fields.

---

### API: GET /api/v1/reports/suppliers/{id}/balance / customers/{id}/balance

**Required Fixes:**
- Safe integer serialization for money fields.
- Use tenant timezone for default `asOfDate`.
- Add RBAC for report endpoint access.

---

## MODULE 8 — SUPPLIERS (Phase 8)

### API: POST /api/v1/suppliers (❌ Unsafe)

**Required Fixes:**
- Database: Add unique index `CREATE UNIQUE INDEX ... ON suppliers(tenant_id, lower(name))`.
- `src/suppliers/suppliers.service.ts#create`: Replace the `findFirst` duplicate pre-check with a direct `create()` + `P2002` → 409 mapping.
- Fix Swagger annotation on `POST /suppliers` controller from `@ApiCreatedResponse({ status: 200 })` to `@ApiCreatedResponse({ status: 201 })`.

**Missing Tests:**
- Race/concurrency test for duplicate creation.
- Max-length boundary tests for `phone`, `address`, `notes`.

---

### API: PATCH /api/v1/suppliers/{id}

**Required Fixes:**
- Use same DB unique constraint + `P2002` catch pattern for rename.
- Reject empty PATCH body.

**Missing Tests:**
- Invalid UUID, validation bounds, empty body, concurrency duplicate rename.

---

### API: PATCH /api/v1/suppliers/{id}/status

**Required Fixes:**
- Persist `reason` or remove from DTO.
- Add open-payables check before inactivation (mirror the payment account guard).
- Add idempotent short-circuit: if current status == requested status, return without write.

**Missing Tests:**
- Not-found → 404, ignored reason assertion, no-auth → 401, invalid UUID → 400.

---

### API: GET /api/v1/suppliers/{id}/balance

**Required Fixes:**
- Add `AND t.status = 'POSTED'` to the ledger aggregate query via `JOIN transactions`.
- Rename `totalPaid` to `totalApDecrease` (or split into `totalPayments` and `totalReturns`) to correctly represent that `AP_DECREASE` includes both payments and supplier returns. The current label is factually wrong.
- Safe integer serialization.

**Missing Tests:**
- Supplier return impact test: create a supplier return; assert `totalReturns` (or separated field) increases, `totalPayments` unchanged.
- Invalid UUID → 400, no-auth → 401.

---

### API: GET /api/v1/suppliers/{id}/open-documents

**Required Fixes:**
- Define and implement the treatment for supplier return credits at the document level. Two options: (a) allocate supplier return credits against purchase documents (requires an allocation record for returns), or (b) add a `creditAdjustment` field that subtracts supplier return AP_DECREASE amounts from total outstanding. Currently, a supplier who has received a credit via return will still show the full original outstanding.
- Implement `asOfDate` query parameter as documented in the implementation plan.
- Add explicit Swagger response DTO (`@ApiOkResponse({ type: ... })`).

**Missing Tests:**
- Supplier return credit effect test: post a supplier return; assert open-document outstanding decreases accordingly.
- Large-value precision test.
- Invalid UUID test, same-day ordering determinism test.

---

## MODULE 9 — TRANSACTIONS (Phase 9)

### API: POST /api/v1/transactions/{id}/post (❌ Unsafe — multiple critical fixes)

**Required Fixes:**

1. **Stock check for SUPPLIER_RETURN_OUT** (`src/transactions/posting.service.ts#postSupplierReturn`):
   Before writing `SUPPLIER_RETURN_OUT` inventory movements, query current stock via `inventory_movements` aggregate. If `currentStock < sum(returnQuantities)`, throw `BadRequestException('Insufficient stock for supplier return')`.

2. **Stock check for ADJUSTMENT_OUT** (`src/transactions/posting.service.ts#postAdjustment`):
   Before writing `ADJUSTMENT_OUT` movements, query current stock for each product. If `currentStock < adjustmentOutQty`, throw `BadRequestException('Insufficient stock for adjustment')`.

3. **Role check for adjustment posting** (`src/transactions/posting.service.ts#postAdjustment`):
   Add role guard: `const role = getContext()?.userRole; if (!['OWNER', 'ADMIN'].includes(role)) throw new ForbiddenException(...)`. Mirror the check already present in `createAdjustmentDraft`.

4. **Make `returnHandling` required for customer returns** (`src/transactions/posting.service.ts#postCustomerReturn`):
   Add a DTO-level `@IsNotEmpty()` or service-level guard: if `postDto.returnHandling` is undefined or null, throw `BadRequestException('returnHandling is required for customer returns')`.

5. **Aggregate duplicate source lines** (both `createSupplierReturnDraft`, `createCustomerReturnDraft`, and their post-time validators):
   Before per-line validation, group the request lines by `sourceTransactionLineId` and sum quantities. Then validate the summed quantity against the returnable quantity for each source line. Also add DTO-level uniqueness: `@ArrayUnique((item) => item.sourceTransactionLineId)` or equivalent service-level check.

6. **Revalidate entity status at posting time** for `SUPPLIER_PAYMENT`, `CUSTOMER_PAYMENT`:
   At the start of the posting handler for payment types, re-fetch the `paymentAccount` and supplier/customer by ID and verify they are still `ACTIVE`. If not, throw `BadRequestException('Payment account or counterparty is no longer active')`.

**Missing Tests:**
- Supplier return with `currentStock < returnQty` → 400 with appropriate error.
- Adjustment-OUT with `currentStock < adjustmentQty` → 400.
- Non-admin posting of an adjustment draft → 403.
- Duplicate `sourceTransactionLineId` in same return payload → 409 or 400.
- Customer return posting without `returnHandling` → 400.
- Post payment against inactive payment account → 400.
- Post payment against inactive supplier/customer → 400.

---

### API: POST /api/v1/transactions/supplier-returns/draft (❌ Unsafe)
### API: POST /api/v1/transactions/customer-returns/draft (❌ Unsafe)

**Required Fixes:**
- Aggregate quantities by `sourceTransactionLineId` before validation as described above.
- Add `@ArrayUnique()` decorator on `lines` array at DTO level.

---

### API: POST /api/v1/transactions/purchases/draft

**Required Fixes:**
- Change `PurchaseLineDto.unitCost` from `@Min(0)` to `@Min(1)`. Zero-cost purchases distort inventory valuation and should not be permitted unless explicitly authorized.

**Missing Tests:**
- `unitCost = 0` rejection test → 400.

---

### API: POST /api/v1/transactions/sales/draft

**Required Fixes:**
- Change `SaleLineDto.unitPrice` from `@Min(0)` to `@Min(1)`.

**Missing Tests:**
- `unitPrice = 0` rejection test → 400.

---

### API: GET /api/v1/transactions/allocations

**Required Fixes:**
- Inherit `PaginationQueryDto` or add explicit `@Max(100)` to the `limit` field of `ListAllocationsQueryDto` to prevent resource exhaustion via unbounded page size.
- Add mutual-exclusivity validation for `purchaseId` and `saleId` (cannot filter both simultaneously) and `supplierId` and `customerId`.
- Document that `createdAt` (not business date) is used for the `dateFrom/dateTo` filter.

---

### API: GET /api/v1/transactions (list)

**Required Fixes:**
- Add custom DTO validator: `dateFrom <= dateTo`. Return 400 if inverted or invalid.

---

### API: POST /api/v1/transactions/adjustments/draft

**Required Fixes:**
- Store `direction` and `reason` in explicit structured columns or a JSON field, not encoded as `"IN|reason text"` in the free-text `description` field. The `|` delimiter is not escaped and any reason text containing `|` will break parsing.

---

## MODULE 10 — IMPORTS (Phase 10)

### API: POST /api/v1/imports (❌ Unsafe)

**Required Fixes:**
- Add multer file-size limit at the interceptor level: `FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } })`. The current service-level check happens after the file is already fully buffered in memory.
- Add MIME type validation alongside extension validation using `file.mimetype`. Reject files whose MIME type doesn't match the claimed extension.
- Restrict `CreateImportDto.module` enum to `['SUPPLIERS', 'CUSTOMERS', 'PRODUCTS', 'OPENING_BALANCES']` only, removing `TRANSACTIONS` from the accepted values.

**Missing Tests:**
- `module=TRANSACTIONS` upload → 400 (bad request, not a supported module).
- MIME spoofing: upload a non-CSV file with `.csv` extension → 400.
- Upload with `module=SUPPLIERS` while unauthenticated → 401.
- Tenant isolation: tenant A cannot see tenant B's batches.

---

### API: POST /api/v1/imports/{id}/commit (❌ Unsafe)

**Required Fixes (Critical):**

1. **Atomic state transition**: Replace:
   ```
   importBatch.update({ status: 'PROCESSING' })  // outside transaction
   ```
   With an atomic compare-and-swap inside the main transaction:
   ```
   tx.importBatch.updateMany({
     where: { id, tenantId, status: 'VALIDATED' },
     data: { status: 'PROCESSING' }
   })
   // check affected count == 1; if 0, batch was already consumed → return 409
   ```

2. **Opening balance protection (Critical)**: Before overwriting `payment_accounts.opening_balance`, check if the account already has any `payment_entries` rows. If entries exist, reject the opening balance import with a `ConflictException('Cannot overwrite opening balance: account already has payment history')`. Store the original `opening_balance` value in the `ImportRow.rawDataJson` or a dedicated field before overwriting, so rollback can restore it precisely.

3. **Reject `TRANSACTIONS` module**: Add a service-level guard that throws `BadRequestException` if `batch.module === 'TRANSACTIONS'`.

4. **`failedRows` field consistency**: Align the semantics of `batch.failedRows` (stored value = runtime failures + skipped invalid rows) with the API response `failedRows` (currently = only runtime failures). Choose one definition and apply it consistently.

**Missing Tests:**
- Concurrent commit race: two concurrent commit requests on same batch — assert only one succeeds and the other returns 409.
- Idempotent replay: POST commit twice — assert second call returns an appropriate response (not a duplicate commit).
- `TRANSACTIONS` module batch commit → 400.
- `PROCESSING`-stuck batch recovery path.
- Opening balance with existing payment entries → 409 conflict.
- `failedRows` count assertion: verify the number matches the actual failed rows.
- Unauthorized → 401.

---

### API: POST /api/v1/imports/{id}/rollback (❌ Unsafe)

**Required Fixes (Critical):**

1. **Restore original opening balance**: Before commit overwrites `opening_balance`, store the old value. On rollback, restore the stored value, not a hardcoded `0`. Proposed approach: add `previousOpeningBalance` field to `ImportRow.rawDataJson` for `OPENING_BALANCES` rows.

2. **Move dependency check inside transaction**:
   ```
   tx = prisma.$transaction(async (tx) => {
     const deps = await tx.transaction.count(...);
     if (deps > 0) throw new ConflictException(...);
     // perform rollback writes
   }, { isolationLevel: 'Serializable' })
   ```
   The current pattern (check outside, write inside) has a TOCTOU race where a transaction could be created between the check and the rollback.

3. **Add `tenantId` to all update `where` clauses** inside the rollback transaction to prevent cross-tenant mutations if context ever drifts.

**Missing Tests:**
- `OPENING_BALANCES` rollback: import opening balance, roll back, assert `payment_account.opening_balance` is restored to its pre-import value (not zero).
- `CUSTOMERS` dependency conflict test: import a customer, create a transaction for that customer, attempt rollback → 409.
- `PRODUCTS` dependency conflict test: import a product, create a purchase using it, attempt rollback → 409.
- `PAYMENT_ACCOUNT` dependency conflict test: import opening balance, post a transaction that creates payment entries for that account, rollback → 409.
- Concurrent rollback vs transaction creation race test.
- Tenant isolation test for rollback.

---

### API: POST /api/v1/imports/{id}/map

**Required Fixes:**
- Tighten `ColumnMappingDto`: validate that `columnMappings` keys are non-empty strings and values are non-empty strings. Currently `@IsObject()` only verifies the top-level type.
- Validate that the mapped source header values (the DTO values) exist in the batch's stored `detectedColumns` list. If a mapping references a header that doesn't exist in the file, return a 400 with the specific invalid header name.
- Preserve original row data in a separate `originalDataJson` field before overwriting `rawDataJson` with mapped values, to support auditability.
- Add atomic status transition guard (compare-and-swap on `PENDING_MAPPING` → `VALIDATED`).

**Missing Tests:**
- Mapping with a non-existent header value → 400.
- Malformed `columnMappings` (numeric values, empty keys) → 400.
- `TRANSACTIONS` module path with mapping → assert appropriate error or rejection.
- Tenant isolation: tenant A cannot map tenant B's batch.
- Unauthorized → 401.

---

### API: GET /api/v1/imports and GET /api/v1/imports/{id}

**Required Fixes:**
- `GET /imports`: Add `@Max(100)` to `limit` in `ListImportsQueryDto`.
- `GET /imports/:id`: Replace `@Query('page', ParseIntPipe)` and `@Query('limit', ParseIntPipe)` with a DTO that includes `@Min(1)` and `@Max(100)` validations. Raw `ParseIntPipe` does not enforce minimum or maximum.

**Missing Tests:**
- `GET /imports` with `limit=1000` → should be capped at 100.
- `GET /imports/:id` with `page=0` or `limit=-1` → 400.
- `GET /imports` while unauthenticated → 401.
- `GET /imports` tenant isolation: tenant A cannot see tenant B's batches.

---

## CROSS-CUTTING TECHNICAL REQUIREMENTS

### Monetary Precision — All Financial Endpoints
Every service that calls `Number(bigIntValue)` on a database aggregate must be updated. Two acceptable strategies:
1. **String serialization**: return money fields as `string` in JSON. Frontend parses as `BigInt` or `Decimal.js`. Least-path-of-resistance.
2. **Safe-range guard**: `if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new InternalServerErrorException(...)`. Fails fast rather than silently losing precision.

Files to update: `src/suppliers/suppliers.service.ts`, `src/customers/customers.service.ts`, `src/payment-accounts/payment-accounts.service.ts`, `src/products/products.service.ts`, `src/dashboard/dashboard.service.ts`, `src/reports/reports.service.ts`.

---

### RBAC — All Mutation and Sensitive Read Endpoints
Add a `@Roles(UserRole.OWNER, UserRole.ADMIN)` decorator and corresponding guard for:
- All master data creation/update/status endpoints (suppliers, customers, products, payment accounts)
- `POST /transactions/:id/post` when `transaction.type === 'ADJUSTMENT'`
- All report endpoints (`/reports/**`) — at minimum require `OWNER` or `MANAGER` role
- `POST /imports/:id/commit` and `POST /imports/:id/rollback`

---

### Missing Authentication Tests — All Modules
Add `401 Unauthorized` test for every endpoint that is not `@Public()`. The following modules are missing these tests: Customers (GET list, GET by ID, PATCH, PATCH status), Products (GET list, GET by ID, PATCH, PATCH status), Payment Accounts (GET list, GET by ID, PATCH, PATCH status, GET balance), Suppliers (GET list, GET by ID, PATCH, PATCH status, GET balance, GET open-documents), Reports (all 9 endpoints), Dashboard (summary endpoint), Imports (all 6 endpoints).

---

### Audit Trail — Status Change Endpoints
Implement a shared `AuditLogService` or add a `status_change_logs` table with columns `(id, entity_type, entity_id, tenant_id, actor_user_id, previous_status, new_status, reason, changed_at)`. All `PATCH /:id/status` endpoints (suppliers, customers, products, payment accounts) must write to this table. The current pattern of accepting `reason` and silently discarding it creates a compliance gap for financial audit requirements.

---

### Snapshot Isolation — Multi-Query Financial Reports
All service methods that execute two or more queries to produce a single financial snapshot must be wrapped in:
```typescript
await this.prisma.$transaction(async (tx) => {
  // all reads here
}, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
```
Affected methods: `DashboardService#getSummary` (5 queries), `ReportsService#getCustomerStatement` (2 queries), `ReportsService#getSupplierStatement` (2 queries), `ReportsService#getPaymentAccountStatement` (2 queries), `ReportsService#getPendingReceivables` (2 queries), `ReportsService#getPendingPayables` (2 queries).
