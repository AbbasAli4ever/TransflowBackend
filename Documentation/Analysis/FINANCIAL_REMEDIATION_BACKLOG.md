# FINANCIAL REMEDIATION BACKLOG

**Author:** Principal Software Architect
**Date:** 2026-02-15
**Based on:** 20 phase audit reports (SUMMARY + TRACE) and 2 consolidated final reports
**System:** Multi-tenant accounting/ledger backend (NestJS + Prisma + PostgreSQL)

---

# SECTION 1 — Systemic Risk Categories

Nine invariant classes were identified by decomposing all audit findings into their root structural failures. Issues are grouped by the invariant they violate, not by the module or endpoint where they manifest.

---

## Category 1: Ledger Temporal Integrity

**Invariant:** Any financial query parameterized by `asOfDate` must produce results that reflect only the state of the ledger as of that date. Allocations, payments, and settlements that occurred after the queried date must not affect the output.

**Why it matters:** Historical financial snapshots are the foundation of period-end closing, audit trails, credit decisions, and regulatory reporting. If a payment made today retroactively changes what last month's aging report said, the system produces a moving target — no historical report is stable, and no two people viewing the same date will agree if they view it at different times.

**Affected modules/APIs:**
- Dashboard: `GET /api/v1/dashboard/summary` — overdue receivables/payables CTEs include future allocations
- Reports: `GET /api/v1/reports/pending-receivables` — allocation sums not bounded by `asOfDate`
- Reports: `GET /api/v1/reports/pending-payables` — same defect
- Customers: `GET /api/v1/customers/{id}/open-documents` — no `asOfDate` support; allocations unbounded
- Suppliers: `GET /api/v1/suppliers/{id}/open-documents` — no `asOfDate` support; allocations unbounded

**Failure scenario:** A finance manager generates an AP aging report as of January 31. On February 5, a supplier payment is posted. The same aging report for January 31 now shows reduced overdue. The January close is invalidated retroactively. Period-end reconciliation becomes impossible.

**Secondary failure:** `asOfDate` defaults to UTC server date via `today()`. For Pakistan-timezone tenants (UTC+5), queries between midnight and 5:00 AM local time use the wrong business day — all historical snapshots are shifted by one calendar day.

**Tertiary failure:** `@IsDateString()` accepts ISO datetime strings (e.g., `2026-02-15T00:00:00Z`). The `subtractDays()` helper appends a second time component, producing an invalid date and a 500 error. Clients that include time components will experience intermittent crashes.

**Severity:** Critical

---

## Category 2: Inventory and Posting Invariant Enforcement

**Invariant:** The posting engine must enforce that (a) stock quantities never go negative, (b) return quantities never exceed the original transaction quantity, (c) transaction posting is restricted to the same authorization level as draft creation, (d) required posting parameters cannot be omitted, and (e) zero-value financial line items are rejected.

**Why it matters:** The posting engine is the single commit point for all financial mutations. Every invariant that fails here produces immutable, irrecoverable corruption in the append-only ledger. Unlike master data bugs which can be patched, a posted transaction with negative stock or an over-return is permanent.

**Affected modules/APIs:**
- `POST /api/v1/transactions/{id}/post` — the central posting endpoint

**Sub-invariant failures identified:**

| Failure | Detail |
|---|---|
| Negative stock via supplier return | `SUPPLIER_RETURN_OUT` posting creates inventory movements without checking current stock. Only `SALE` posting checks stock. |
| Negative stock via adjustment | `ADJUSTMENT_OUT` posting creates inventory movements without checking current stock. |
| Over-return via payload duplication | Both supplier and customer return drafts validate each `sourceTransactionLineId` independently. Submitting the same source line twice in one payload bypasses the per-line returnable-quantity check. The aggregate returned quantity can exceed the original. This defect exists at both draft creation and posting time. |
| Privilege escalation on adjustments | Adjustment draft creation checks `OWNER/ADMIN` role. Adjustment posting does not. Any authenticated tenant user can post an admin-created adjustment draft. |
| Optional `returnHandling` on customer return | The API contract requires `returnHandling` (`REFUND_NOW` or `STORE_CREDIT`) at customer return posting. The implementation makes it optional. Omitting it produces ambiguous AR/credit behavior. |
| Zero-cost purchases accepted | `PurchaseLineDto.unitCost` is `@Min(0)`. Zero-cost inventory enters the system and distorts weighted-average costing. |
| Zero-price sales accepted | `SaleLineDto.unitPrice` is `@Min(0)`. Zero-price sales reduce stock with zero receivable, distorting profitability. |
| Stale entity status at posting | Payment draft creation validates account/counterparty as ACTIVE. Posting does not revalidate. If the entity is deactivated between draft and post, money moves through an inactive account. |
| Adjustment data encoding brittleness | Adjustment direction and reason are encoded as `"IN|reason"` in the free-text `description` field. A reason containing `|` corrupts the encoded structure. |

**Failure scenario:** A user creates a supplier return for 10 units, listing the same source line ID twice (5 units each). Both lines independently pass the returnable-quantity check. 10 units are returned from a purchase of 8 — stock goes negative by 2, and the supplier is credited for more than they sold.

**Severity:** Critical

---

## Category 3: Entity Uniqueness Enforcement

**Invariant:** Within a single tenant, no two master data records of the same type may share the same canonical identity (name for suppliers/customers, SKU for products, email for users). This must be enforced at the database level, not by application pre-checks.

**Why it matters:** Duplicate counterparties fragment the ledger. If two "ABC Traders" supplier records exist, purchases are split across both, and AP aging shows two half-balances instead of one full balance. Reconciliation, payment allocation, and reporting all produce incorrect results. In a concurrent environment, application-level `findFirst` → `create` patterns have a well-documented TOCTOU race window.

**Affected modules/APIs:**
- Suppliers: `POST /suppliers`, `PATCH /suppliers/{id}` — no DB unique constraint on `(tenant_id, lower(name))`
- Customers: `POST /customers`, `PATCH /customers/{id}` — same defect
- Products: `POST /products`, `PATCH /products/{id}` — SKU uniqueness is DB-enforced, but name uniqueness is not. Additionally, `POST /products` is not idempotent: retries without SKU create duplicates.
- Auth: `POST /auth/register` — `P2002` Prisma unique constraint error on concurrent duplicate email registration is unhandled, producing 500 instead of controlled 409

**Failure scenario:** During a network interruption, a client retries `POST /suppliers` with the same payload. Both requests pass the `findFirst` check concurrently. Two "ABC Traders" rows are created. Subsequent purchases are arbitrarily posted against one or the other. AP reports show two partial balances; neither matches the supplier's own accounting.

**Severity:** High

---

## Category 4: Monetary Precision Safety

**Invariant:** All monetary values must maintain integer precision from the database through the API response. No silent truncation, rounding, or precision loss may occur during the conversion from SQL `bigint` aggregates to the JSON response body.

**Why it matters:** PostgreSQL `bigint` supports values up to 9.2 × 10^18. JavaScript `Number` is a 64-bit float with a safe integer range of ±9,007,199,254,740,991. When a SQL `SUM()` of money exceeds this threshold, `Number(bigintValue)` silently loses the least-significant digits. For a financial system in PKR where a single transaction can be millions, cumulative tenant-wide balances in the trillions are reachable within normal business volumes over years.

**Affected modules/APIs:**
- Suppliers: `GET /suppliers/{id}/balance`
- Customers: `GET /customers/{id}/balance`, `GET /customers/{id}/open-documents`
- Payment Accounts: `GET /payment-accounts/{id}/balance`
- Products: `GET /products/{id}/stock` (stock quantities and cost values)
- Dashboard: `GET /dashboard/summary` — all 5 sub-query aggregates
- Reports: All 9 endpoints — balance reports, pending reports, statements, stock valuation

**Failure scenario:** A tenant accumulates 15 trillion PKR in cumulative purchases over 5 years. The `totalPurchases` field exceeds `Number.MAX_SAFE_INTEGER`. The API returns 15,000,000,000,001 as 15,000,000,000,000. The 1 PKR discrepancy is invisible but grows with every subsequent aggregate. Financial statements no longer balance.

**Severity:** High

---

## Category 5: Financial Truth Surfaces

**Invariant:** Every numeric field in an API response that represents a financial fact (balance, stock, total, outstanding) must be derived from the authoritative data source. Fields that cannot be computed must not be present in the response. Labels must accurately describe the quantity they represent.

**Why it matters:** Frontend applications, external integrations, and operational dashboards consume API responses as truth. A field named `currentBalance` that always returns `0` is worse than an absent field — it actively misleads. A field named `totalPaid` that includes non-payment AP decreases misrepresents the actual payment position.

**Affected modules/APIs:**

| Issue | Endpoints |
|---|---|
| `_computed` placeholder fields (all zeros/null) | All CRUD endpoints for suppliers, customers, products, payment accounts — list, detail, create, update, status |
| `totalPaid` label conflates payments and returns | `GET /suppliers/{id}/balance` — `AP_DECREASE` includes both actual payments and supplier return credits, but is labeled `totalPaid` |
| Open documents ignore return credits | `GET /suppliers/{id}/open-documents` — supplier return credits do not reduce document-level outstanding. Open-doc total can exceed actual payable balance. |
| Product stock valuation ignores returns | `GET /reports/products/{id}/stock` — `avgCost` is computed only from purchase inflows. After high-cost supplier returns, the cost pool is not adjusted, producing materially wrong stock valuation. |

**Failure scenario:** A procurement manager views the supplier detail page. The `_computed.currentBalance` field shows 0 PKR. The manager concludes the supplier is settled and places a new order. The actual balance is 500,000 PKR payable. The business now has 500,000 PKR in unmanaged liability plus a new commitment.

**Severity:** High

---

## Category 6: Authorization Boundary Enforcement

**Invariant:** API operations that carry financial risk must enforce role-based access control beyond simple authentication. Specifically: (a) posting adjustments must require the same role that created the draft, (b) sensitive financial reports must not be accessible to all authenticated users, (c) master data mutation must be restricted to appropriate roles, and (d) deactivation of entities with outstanding obligations must be prevented.

**Why it matters:** A multi-user financial system where every user has identical capabilities provides no operational segregation of duties. The ability of any user to post adjustments, view detailed financial statements, deactivate funded accounts, or create master data increases the surface for both accidental and intentional misuse.

**Affected modules/APIs:**

| Gap | Detail |
|---|---|
| Adjustment posting privilege escalation | Draft creation checks `OWNER/ADMIN`. Posting does not check. Non-admin can post admin-created drafts. |
| Reports accessible to all | All 9 report endpoints have no role check. Any authenticated tenant user can view detailed AP/AR statements. |
| Master data mutation unrestricted | All create/update/status endpoints for suppliers, customers, products, payment accounts have no role guard. |
| Deactivation without obligation check | All status-change endpoints allow INACTIVE with open balances (suppliers: open AP, customers: open AR, products: positive stock, payment accounts: non-zero balance). |
| Status reason silently discarded | All four status-change endpoints accept `reason` in the request body but do not persist it. No audit trail for deactivation rationale. |
| Auth enumeration | Login returns distinguishable errors for invalid credentials vs. inactive account vs. inactive tenant. |

**Failure scenario:** An admin creates an inventory adjustment draft to write off 100 damaged units. Before it is posted, a non-admin user (who has no authority over inventory adjustments) posts the draft. The adjustment is committed to the ledger with no access control record.

**Severity:** Critical

---

## Category 7: Import Lifecycle Atomicity

**Invariant:** The import system must guarantee that (a) state transitions are atomic and cannot be replayed, (b) only supported modules can be imported, (c) data mutations are reversible to the exact prior state, and (d) concurrent operations on the same batch produce deterministic outcomes.

**Why it matters:** Bulk data import is the highest-volume mutation path in the system. A single import batch can create hundreds of master data records. Non-atomic state transitions can leave batches in unrecoverable states. Irreversible rollback mutations corrupt the financial baseline.

**Affected modules/APIs:**
- `POST /imports` — accepts `TRANSACTIONS` module; no multer file-size limit at interceptor level; no MIME validation
- `POST /imports/{id}/map` — no validation that mapped headers exist in file; `TRANSACTIONS` module passes with zero required fields
- `POST /imports/{id}/commit` — non-atomic `PROCESSING` status set; `TRANSACTIONS` module commits with zero records created; opening balance overwritten without prior-value preservation
- `POST /imports/{id}/rollback` — opening balance reset to 0 instead of restored; dependency check outside transaction (TOCTOU); no tenant constraint in update WHERE clauses

**Failure scenarios:**

1. **Balance corruption:** User imports opening balances. Account "Cash" is set from 0 to 500,000. Later, user rolls back. "Cash" opening balance is set to 0. If the account originally had a pre-import balance of 200,000, that value is permanently lost. All historical cash reports are now wrong.

2. **Ghost import:** User imports with `module=TRANSACTIONS`. Batch reaches `COMPLETED` with all rows marked `SUCCESS`. Zero records were created. The import dashboard shows a successful transaction import that produced nothing.

3. **Stuck batch:** Commit sets status to `PROCESSING` before the main transaction begins. If the transaction throws, the batch remains in `PROCESSING` permanently. No endpoint transitions out of `PROCESSING`. The batch is unrecoverable.

4. **Race duplication:** Two concurrent commit requests for the same batch both read `status=VALIDATED`. Both proceed. Suppliers/customers are created twice (no DB unique constraint on names). The batch shows `COMPLETED` with inflated success counts.

**Severity:** Critical

---

## Category 8: Snapshot Read Consistency

**Invariant:** Any API response that combines the results of two or more database queries to produce a single financial view must execute all queries within the same database snapshot. Concurrent writes must not produce internally contradictory results.

**Why it matters:** Financial dashboards, statements, and pending-document reports present aggregated views that span multiple data sources (ledger entries, payment entries, inventory movements, allocations, transactions). If these are queried at different moments during concurrent posting activity, the response can contain data from before and after a posting — producing inconsistent results that violate basic accounting identities.

**Affected modules/APIs:**
- Dashboard: `GET /dashboard/summary` — 5 parallel sub-queries via `Promise.all`, no read transaction
- Reports: `GET /reports/customers/{id}/statement` — opening balance + in-range entries are separate queries
- Reports: `GET /reports/suppliers/{id}/statement` — same pattern
- Reports: `GET /reports/payment-accounts/{id}/statement` — same pattern
- Reports: `GET /reports/pending-receivables` — balance query + open-document query are separate
- Reports: `GET /reports/pending-payables` — same pattern

**Failure scenario:** While the dashboard endpoint executes, a sale is posted. The `cash` sub-query reflects the pre-sale state (payment account balance not yet increased). The `receivables` sub-query reflects the post-sale state (customer AR already increased). The `recentActivity` sub-query may or may not include the sale depending on timing. The dashboard shows an internal contradiction: receivables increased but cash did not, and the daily sales total may not include the transaction that caused the receivable increase.

**Severity:** High

---

## Category 9: Authentication Hardening

**Invariant:** The authentication boundary must (a) not leak account existence or state information, (b) enforce rate limiting at the credential-verification level, (c) provide server-side session lifecycle control via refresh token persistence and revocation, and (d) handle concurrent registration races gracefully.

**Why it matters:** For a system that controls access to tenant-wide financial data and transaction authority, the authentication layer is the single perimeter. Weak authentication hardening elevates the probability of credential compromise, which in a financial system translates directly to unauthorized access to ledger data, posting authority, and balance visibility.

**Affected modules/APIs:**
- `POST /auth/login` — distinguishable errors for invalid credentials vs. inactive user vs. inactive tenant enable account enumeration. No per-account rate limiting or lockout.
- `POST /auth/register` — `P2002` Prisma error unhandled on concurrent duplicate email; returns 500.
- No `POST /auth/refresh` endpoint — refresh tokens are issued but no endpoint consumes them. No server-side revocation or rotation.
- `lastLoginAt` update occurs before token generation; if token generation fails, the side effect persists.

**Failure scenario:** An attacker enumerates valid accounts by observing that "Invalid credentials" vs. "Account inactive" are distinguishable. They identify 50 active accounts. They brute-force passwords without any lockout mechanism. A compromised account grants full access to the tenant's financial ledger, posting authority, and report data.

**Severity:** High

---

# SECTION 2 — Remediation Tasks

Tasks are organized by category. Each task is atomic, self-contained, and executable by a coding agent.

---

## Category 1: Ledger Temporal Integrity

### Task 1.1 — Bind allocation sums to `asOfDate` in dashboard overdue CTEs

- **Goal:** Dashboard receivable and payable overdue amounts must reflect only allocations from payments posted on or before `asOfDate`.
- **Scope:** `src/dashboard/dashboard.service.ts` — `queryReceivables` and `queryPayables` methods.
- **Required code changes:** In the open-document CTE, join `allocations` to their payment transaction (`allocations.payment_transaction_id → transactions.id`). Add `AND payment_transaction.transaction_date <= $asOfDate AND payment_transaction.status = 'POSTED'` to the allocation sum condition.
- **Tests to add:** Integration test: create a sale, do not pay. Query dashboard with today's `asOfDate` — document must be open. Post a payment dated tomorrow. Re-query dashboard with today's `asOfDate` — document must still show as open. Assert overdue amount is unchanged.
- **Risk of regression:** High — this changes the core financial reporting query. Running balance and summary totals may shift.
- **Estimated difficulty:** Medium
- **Dependencies:** None

### Task 1.2 — Bind allocation sums to `asOfDate` in reports pending-receivables and pending-payables

- **Goal:** Pending receivables and payables reports must reflect only allocations from payments posted on or before `asOfDate`.
- **Scope:** `src/reports/reports.service.ts` — `getPendingReceivables` and `getPendingPayables` methods, specifically SQL #2 (open documents query).
- **Required code changes:** In the open documents query, restrict allocation sum to allocations whose payment transaction `transaction_date <= $asOfDate AND status = 'POSTED'`. In SQL #1, add explicit `t.status = 'POSTED'` join for ledger entries.
- **Tests to add:** Same temporal regression test as 1.1 but through the reports endpoint. Additionally: assert `sum(openDocuments.outstanding) == customer/supplier balance` for the same `asOfDate`.
- **Risk of regression:** High — report numbers will change for any tenant with historical queries.
- **Estimated difficulty:** Medium
- **Dependencies:** None (can be done in parallel with 1.1)

### Task 1.3 — Replace `@IsDateString()` with strict date-only validation

- **Goal:** All `asOfDate`, `dateFrom`, and `dateTo` query parameters must accept only `YYYY-MM-DD` format. Datetime strings must be rejected with 400.
- **Scope:** `src/dashboard/dto/dashboard-query.dto.ts`, `src/reports/dto/balance-query.dto.ts`, `src/reports/dto/statement-query.dto.ts`, `src/reports/dto/pending-receivables-query.dto.ts`, `src/reports/dto/pending-payables-query.dto.ts`.
- **Required code changes:** Replace `@IsDateString()` with a custom validator: `@Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'Date must be in YYYY-MM-DD format' })`. Fix `subtractDays()` helper in common utilities to validate input format and throw `BadRequestException` on invalid date.
- **Tests to add:** Submit `asOfDate=2026-02-15T00:00:00Z` → assert 400. Submit `asOfDate=invalid` → 400. Submit `asOfDate=2026-02-15` → 200.
- **Risk of regression:** Low — only rejects inputs that previously caused 500 errors.
- **Estimated difficulty:** Low
- **Dependencies:** None

### Task 1.4 — Add `dateFrom <= dateTo` validation on all statement endpoints

- **Goal:** Statement endpoints must reject inverted date ranges with 400 instead of returning logically nonsensical 200 responses.
- **Scope:** `src/reports/dto/statement-query.dto.ts`.
- **Required code changes:** Add a class-level custom validator that asserts `dateFrom <= dateTo`. Return `BadRequestException('dateFrom must be on or before dateTo')`.
- **Tests to add:** Submit `dateFrom=2026-02-15&dateTo=2026-02-01` → assert 400 with clear message.
- **Risk of regression:** None — this only rejects currently-broken inputs.
- **Estimated difficulty:** Low
- **Dependencies:** None

### Task 1.5 — Replace UTC `today()` with tenant-timezone business date

- **Goal:** All default `asOfDate` values must use the tenant's local business date, not UTC server date.
- **Scope:** `src/common/utils/date.ts` (or wherever `today()` is defined), `src/dashboard/dashboard.service.ts`, `src/reports/reports.service.ts`.
- **Required code changes:** Add a `timezone` field to the `Tenant` model (default: `'Asia/Karachi'`). Create a `getBusinessDate(tenantId)` utility that converts `new Date()` to the tenant's local date. Replace all `today()` calls in service methods.
- **Tests to add:** Mock system clock to UTC 2026-02-15T03:00:00Z (which is 2026-02-15T08:00 in PKR). Assert default `asOfDate` resolves to `2026-02-15`, not `2026-02-14`.
- **Risk of regression:** Medium — all existing report data defaults shift for non-UTC tenants.
- **Estimated difficulty:** Medium
- **Dependencies:** Requires schema migration to add `timezone` to `Tenant`.

---

## Category 2: Inventory and Posting Invariant Enforcement

### Task 2.1 — Add stock check before SUPPLIER_RETURN_OUT posting

- **Goal:** Supplier return posting must verify that current stock >= return quantity for each product before writing inventory movements.
- **Scope:** `src/transactions/posting.service.ts#postSupplierReturn`.
- **Required code changes:** Before creating `SUPPLIER_RETURN_OUT` inventory movements, query current stock via aggregate on `inventory_movements` for each product (within the Serializable transaction). If `currentStock < returnQuantity`, throw `BadRequestException` with product ID and available stock.
- **Tests to add:** Purchase 5 units. Post a supplier return for 8 units → assert 400 with `INSUFFICIENT_STOCK` error. Purchase 5, sell 3. Post supplier return for 4 → assert 400 (only 2 in stock).
- **Risk of regression:** Medium — any existing tests that assumed supplier returns always succeed will need adjustment.
- **Estimated difficulty:** Medium
- **Dependencies:** None

### Task 2.2 — Add stock check before ADJUSTMENT_OUT posting

- **Goal:** Adjustment-OUT posting must verify that current stock >= adjustment quantity for each product.
- **Scope:** `src/transactions/posting.service.ts#postAdjustment`.
- **Required code changes:** For each line where direction is `OUT`, query current stock within the Serializable transaction. If `currentStock < adjustmentQty`, throw `BadRequestException`.
- **Tests to add:** Create product with 5 stock. Post adjustment-OUT for 8 → assert 400. Post adjustment-OUT for 5 → assert success, stock = 0.
- **Risk of regression:** Low
- **Estimated difficulty:** Low
- **Dependencies:** None

### Task 2.3 — Add role check to adjustment posting

- **Goal:** Only `OWNER` and `ADMIN` roles may post adjustment drafts.
- **Scope:** `src/transactions/posting.service.ts#postAdjustment`.
- **Required code changes:** At the start of `postAdjustment`, read `getContext()?.userRole`. If role is not `OWNER` or `ADMIN`, throw `ForbiddenException('Only OWNER or ADMIN can post adjustments')`.
- **Tests to add:** Create adjustment draft as ADMIN. Attempt to post as a STAFF/VIEWER user → assert 403. Post as ADMIN → assert success.
- **Risk of regression:** None — adds a guard that did not previously exist.
- **Estimated difficulty:** Low
- **Dependencies:** None

### Task 2.4 — Aggregate duplicate source lines in return validation

- **Goal:** Both supplier and customer return draft creation and posting must aggregate quantities by `sourceTransactionLineId` before per-line validation, preventing over-return via payload duplication.
- **Scope:** `src/transactions/transactions.service.ts#createSupplierReturnDraft`, `#createCustomerReturnDraft`, `src/transactions/posting.service.ts#postSupplierReturn`, `#postCustomerReturn`.
- **Required code changes:** Before per-line validation, group request lines by `sourceTransactionLineId`. Sum their quantities. Use the summed quantity for the returnable-quantity check. Optionally: add DTO-level validation (`@ArrayUnique((item) => item.sourceTransactionLineId)`) to reject duplicates at the input layer.
- **Tests to add:** Purchase 10 units. Submit return with same source line twice (5 each). Assert 400 with "exceeds returnable quantity" or "duplicate source line" error. Same test for customer returns.
- **Risk of regression:** Low — only adds a stricter guard.
- **Estimated difficulty:** Medium
- **Dependencies:** None

### Task 2.5 — Make `returnHandling` required for customer return posting

- **Goal:** Customer return posting must require explicit `returnHandling` (`REFUND_NOW` or `STORE_CREDIT`).
- **Scope:** `src/transactions/posting.service.ts#postCustomerReturn` or `src/transactions/dto/post-transaction.dto.ts`.
- **Required code changes:** Add validation that `returnHandling` is present and is one of the allowed values when posting a `CUSTOMER_RETURN` type. Throw `BadRequestException` if absent.
- **Tests to add:** Post customer return without `returnHandling` → assert 400. Post with `REFUND_NOW` → assert success with payment entry. Post with `STORE_CREDIT` → assert success without payment entry.
- **Risk of regression:** Medium — any existing test that posts customer returns without `returnHandling` will fail.
- **Estimated difficulty:** Low
- **Dependencies:** None

### Task 2.6 — Enforce minimum unit cost/price on transaction line DTOs

- **Goal:** Prevent zero-cost purchases and zero-price sales from entering the system.
- **Scope:** `src/transactions/dto/purchase-line.dto.ts`, `src/transactions/dto/sale-line.dto.ts`.
- **Required code changes:** Change `@Min(0)` to `@Min(1)` on `unitCost` and `unitPrice` fields.
- **Tests to add:** Submit purchase draft with `unitCost=0` → assert 400. Submit sale draft with `unitPrice=0` → assert 400.
- **Risk of regression:** Low — existing tests use positive values.
- **Estimated difficulty:** Low
- **Dependencies:** None

### Task 2.7 — Revalidate entity active status at posting time for payment transactions

- **Goal:** Posting of `SUPPLIER_PAYMENT` and `CUSTOMER_PAYMENT` must verify that the payment account and counterparty are still ACTIVE.
- **Scope:** `src/transactions/posting.service.ts#postSupplierPayment`, `#postCustomerPayment`.
- **Required code changes:** At the start of each handler (within the Serializable transaction), re-fetch the payment account and supplier/customer by ID. If `status !== 'ACTIVE'`, throw `BadRequestException`.
- **Tests to add:** Create supplier payment draft. Deactivate the payment account. Attempt to post → assert 400. Same for customer payment and counterparty deactivation.
- **Risk of regression:** Low
- **Estimated difficulty:** Low
- **Dependencies:** None

### Task 2.8 — Replace pipe-delimited adjustment encoding with structured data

- **Goal:** Adjustment direction and reason must be stored in structured form, not as a pipe-delimited string in the `description` field.
- **Scope:** `src/transactions/transactions.service.ts#createAdjustmentDraft`, `src/transactions/posting.service.ts#postAdjustment`, and any code that reads adjustment direction/reason.
- **Required code changes:** Two options: (a) Add `direction` and `adjustmentReason` columns to `TransactionLine` (requires migration), or (b) store as a JSON object in `description` (e.g., `{ "direction": "IN", "reason": "..." }`). All readers must be updated to use the new format.
- **Tests to add:** Create adjustment with reason containing `|` character. Assert it is stored and retrievable without corruption.
- **Risk of regression:** High — all existing adjustment data and tests use the pipe-delimited format. Migration of existing data may be needed.
- **Estimated difficulty:** High
- **Dependencies:** Schema migration if using new columns.

---

## Category 3: Entity Uniqueness Enforcement

### Task 3.1 — Add DB unique indexes for master data names

- **Goal:** Enforce case-insensitive name uniqueness per tenant for suppliers, customers, and case-insensitive SKU uniqueness for products at the database level.
- **Scope:** Prisma schema migration targeting `suppliers`, `customers`, `products` tables.
- **Required code changes:** Create migration adding: `CREATE UNIQUE INDEX suppliers_tenant_name_unique ON suppliers(tenant_id, lower(name))`, `CREATE UNIQUE INDEX customers_tenant_name_unique ON customers(tenant_id, lower(name))`. Products already have `(tenant_id, sku)` but may need a name index depending on business requirement.
- **Tests to add:** Concurrent duplicate supplier/customer/product creation: two parallel requests with same name → assert one 201, one 409.
- **Risk of regression:** Medium — if existing data has duplicates, migration will fail. Pre-migration data cleanup script may be required.
- **Estimated difficulty:** Medium
- **Dependencies:** Must run before Task 3.2.

### Task 3.2 — Replace findFirst-then-create with direct create + P2002 mapping

- **Goal:** Remove application-level TOCTOU uniqueness pre-checks. Use constraint-first insert with error mapping.
- **Scope:** `src/suppliers/suppliers.service.ts#create`, `#update`, `src/customers/customers.service.ts#create`, `#update`, `src/auth/auth.service.ts#register`.
- **Required code changes:** Remove `findFirst` duplicate name/email checks. Use direct `create()` / `update()` calls. Wrap in try-catch: `catch (e) { if (e.code === 'P2002') throw new ConflictException('...'); throw e; }`.
- **Tests to add:** For each entity: rapid sequential create with same name → assert second returns 409. For register: concurrent registration with same email → assert one 201, one 409 (not 500).
- **Risk of regression:** Low — behavior is identical in the non-race case. Race case improves from 500 → 409.
- **Estimated difficulty:** Low
- **Dependencies:** Task 3.1 (DB indexes must exist first).

---

## Category 4: Monetary Precision Safety

### Task 4.1 — Introduce safe monetary conversion utility

- **Goal:** Create a shared utility function that converts SQL `bigint` aggregates to a safe JSON-serializable form. All financial services must use this function instead of raw `Number()`.
- **Scope:** New shared utility in `src/common/utils/money.ts`. All services that call `Number(bigintValue)` on monetary aggregates.
- **Required code changes:** Create `function safeMoney(value: bigint): number` that checks `value <= BigInt(Number.MAX_SAFE_INTEGER) && value >= BigInt(-Number.MAX_SAFE_INTEGER)`. If out of range, throw `InternalServerErrorException('Monetary value exceeds safe precision range')`. Apply to every `Number(row.total_...)` call in: `suppliers.service.ts`, `customers.service.ts`, `payment-accounts.service.ts`, `products.service.ts`, `dashboard.service.ts`, `reports.service.ts`.
- **Tests to add:** Unit test: `safeMoney(BigInt('9007199254740992'))` → throws. `safeMoney(BigInt('1000000'))` → returns `1000000`.
- **Risk of regression:** None for normal values. Tenants with extreme cumulative balances will get a clear error instead of silent corruption.
- **Estimated difficulty:** Low
- **Dependencies:** None

---

## Category 5: Financial Truth Surfaces

### Task 5.1 — Remove `_computed` placeholder fields from master data responses

- **Goal:** Stop returning fabricated financial values. Either compute real values from the database or remove `_computed` from the response contract entirely.
- **Scope:** `src/suppliers/suppliers.service.ts#withComputed`, `src/customers/customers.service.ts#withComputed`, `src/products/products.service.ts#withComputed`, `src/payment-accounts/payment-accounts.service.ts#withComputed`.
- **Required code changes:** Recommended approach: remove the `_computed` block entirely from all CRUD responses. Clients should use the dedicated `/balance` and `/stock` sub-endpoints for financial data. Alternative: compute real values inline (higher performance cost per request).
- **Tests to add:** Assert that list/detail/create/update/status responses do not contain `_computed` key (or contain correct values if computed).
- **Risk of regression:** High for frontend — any UI code consuming `_computed` fields will break. Requires frontend coordination.
- **Estimated difficulty:** Low (code removal), Medium (if computing real values)
- **Dependencies:** Frontend team must be notified of the contract change.

### Task 5.2 — Rename `totalPaid` to accurate field names in supplier balance

- **Goal:** The supplier balance response must correctly label AP decrease components.
- **Scope:** `src/suppliers/suppliers.service.ts#getBalance`.
- **Required code changes:** Split the current `totalPaid` field into `totalPayments` (AP_DECREASE where `t.type != 'SUPPLIER_RETURN'`) and `totalReturns` (AP_DECREASE where `t.type = 'SUPPLIER_RETURN'`). Update the SQL query to compute both independently.
- **Tests to add:** Create supplier with purchases and a supplier return. Assert `totalPayments` excludes the return and `totalReturns` includes only the return.
- **Risk of regression:** Medium — frontend consuming `totalPaid` must adapt to new field names.
- **Estimated difficulty:** Low
- **Dependencies:** Frontend coordination for field rename.

### Task 5.3 — Rework product stock valuation to account for supplier returns

- **Goal:** `avgCost` must reflect the correct weighted-average cost after supplier returns.
- **Scope:** `src/reports/reports.service.ts#getProductStock`.
- **Required code changes:** Adjust valuation formula. When a supplier return occurs, the cost pool must decrease by `returned_qty * avg_cost_at_return_time`. The simplest correct approach: compute `avg_cost = (total_purchase_cost - total_return_cost) / (total_purchase_qty - total_return_qty)`. If denominator is zero, `avgCost = 0`.
- **Tests to add:** Purchase 10 at 100 each. Return 8 at (inferred) 100 each. Assert `avgCost = 100`, `stockValue = 200`, `netStock = 2`. Adjustment-IN only scenario: assert `avgCost = 0`, `stockValue = 0`.
- **Risk of regression:** Medium — valuation numbers will change for any tenant with supplier returns.
- **Estimated difficulty:** Medium
- **Dependencies:** None

---

## Category 6: Authorization Boundary Enforcement

### Task 6.1 — Add role guard for adjustment posting

- **Goal:** Only OWNER/ADMIN can post adjustment transactions.
- **Scope:** See Task 2.3. (Same task — listed here for categorization completeness.)
- **Dependencies:** None

### Task 6.2 — Add business guards for entity deactivation

- **Goal:** Prevent deactivation of entities with outstanding obligations.
- **Scope:** `src/suppliers/suppliers.service.ts#updateStatus`, `src/customers/customers.service.ts#updateStatus`, `src/products/products.service.ts#updateStatus`, `src/payment-accounts/payment-accounts.service.ts#updateStatus`.
- **Required code changes:** Before setting status to INACTIVE: (a) suppliers — check AP balance > 0 → 409; (b) customers — check AR balance > 0 → 409; (c) products — check current stock > 0 → 409; (d) payment accounts — check current balance != 0 → 409.
- **Tests to add:** For each entity type: create entity with outstanding obligation. Attempt deactivation → assert 409 with clear message. Settle all obligations. Attempt deactivation → assert success.
- **Risk of regression:** Medium — any test that deactivates entities without settling first will fail.
- **Estimated difficulty:** Medium
- **Dependencies:** None

### Task 6.3 — Persist status change reason in audit trail

- **Goal:** All status change endpoints must persist the `reason` field, the acting user ID, and the timestamp.
- **Scope:** Schema migration to create `status_change_logs` table. All four `updateStatus` service methods.
- **Required code changes:** Create table `status_change_logs(id, entity_type, entity_id, tenant_id, actor_user_id, previous_status, new_status, reason, changed_at)`. Write a log entry in every `updateStatus` call.
- **Tests to add:** Change status with reason. Query logs (or inspect DB directly). Assert log entry contains correct entity, actor, previous/new status, and reason.
- **Risk of regression:** None — additive change.
- **Estimated difficulty:** Medium
- **Dependencies:** Schema migration.

### Task 6.4 — Implement RBAC guard for sensitive endpoints

- **Goal:** Restrict report access, master data mutation, and import commit/rollback to authorized roles.
- **Scope:** New `RolesGuard` + `@Roles()` decorator. Applied to: all `/reports/**` endpoints, all master data create/update/status endpoints, `POST /imports/{id}/commit`, `POST /imports/{id}/rollback`.
- **Required code changes:** Create `src/common/guards/roles.guard.ts` with `@Roles(UserRole.OWNER, UserRole.ADMIN)` decorator support. Apply to targeted controllers/methods.
- **Tests to add:** For each protected endpoint: request as STAFF role → assert 403. Request as ADMIN → assert success.
- **Risk of regression:** Medium — all existing integration tests may use a role that no longer has access. Test JWT generation may need role parameterization.
- **Estimated difficulty:** Medium
- **Dependencies:** None

---

## Category 7: Import Lifecycle Atomicity

### Task 7.1 — Reject TRANSACTIONS module at DTO level

- **Goal:** Prevent import batches with `module=TRANSACTIONS` from being created.
- **Scope:** `src/imports/dto/create-import.dto.ts`.
- **Required code changes:** Change `@IsEnum(ImportModule)` to a custom validator that accepts only `['SUPPLIERS', 'CUSTOMERS', 'PRODUCTS', 'OPENING_BALANCES']`. Alternatively, remove `TRANSACTIONS` from the `ImportModule` enum if it is not used anywhere else.
- **Tests to add:** Upload with `module=TRANSACTIONS` → assert 400.
- **Risk of regression:** None — this was never a functional path.
- **Estimated difficulty:** Low
- **Dependencies:** None

### Task 7.2 — Make import state transitions atomic (compare-and-swap)

- **Goal:** Commit and map operations must atomically check-and-set batch status within the database transaction.
- **Scope:** `src/imports/imports.service.ts#commitImport`, `#mapColumns`.
- **Required code changes:** Replace pre-read-then-update pattern with atomic `updateMany({ where: { id, tenantId, status: 'VALIDATED' }, data: { status: 'PROCESSING' } })`. Check affected count. If 0, throw `ConflictException('Batch already consumed or not in expected state')`. Same pattern for map: `where: { status: 'PENDING_MAPPING' }`.
- **Tests to add:** Concurrent commit: two parallel requests on same batch → assert one succeeds, one 409. Same for concurrent map requests.
- **Risk of regression:** Low — behavior is identical for single-user flows.
- **Estimated difficulty:** Medium
- **Dependencies:** None

### Task 7.3 — Preserve and restore original opening balance on rollback

- **Goal:** Opening balance import rollback must restore the exact prior value, not reset to 0.
- **Scope:** `src/imports/imports.service.ts#commitImport` (store prior value), `#rollbackImport` (restore prior value).
- **Required code changes:** In `commitImport`, before overwriting `payment_accounts.opening_balance`, read the current value and store it in the `ImportRow` record (e.g., in `rawDataJson.previousOpeningBalance`). In `rollbackImport`, read the stored prior value and restore it.
- **Tests to add:** Create payment account with opening balance 200,000. Import new opening balance 500,000. Rollback. Assert opening balance is 200,000 (not 0).
- **Risk of regression:** None — additive safeguard.
- **Estimated difficulty:** Medium
- **Dependencies:** None

### Task 7.4 — Move rollback dependency check inside transaction

- **Goal:** Eliminate TOCTOU race between dependency check and rollback execution.
- **Scope:** `src/imports/imports.service.ts#rollbackImport`.
- **Required code changes:** Move all dependency checks (`transaction.count`, `transactionLine.count`, `paymentEntry.count`) inside the `prisma.$transaction()` block. Use Serializable isolation. Add `tenantId` to all `where` clauses within the transaction.
- **Tests to add:** Concurrent rollback vs transaction creation: start rollback, concurrently create a transaction for an imported entity → assert one of: rollback succeeds and transaction creation fails (serialization conflict), or rollback fails with 409 (dependency detected).
- **Risk of regression:** Low
- **Estimated difficulty:** Medium
- **Dependencies:** None

### Task 7.5 — Add multer file-size limit and MIME validation to upload

- **Goal:** Prevent memory exhaustion from oversized uploads and content-type spoofing.
- **Scope:** `src/imports/imports.controller.ts` (FileInterceptor configuration).
- **Required code changes:** Add `limits: { fileSize: 10 * 1024 * 1024 }` to the multer configuration. Add MIME type validation in the service: check `file.mimetype` matches expected MIME types for the file extension.
- **Tests to add:** Upload a file > 10MB → assert 413 or 400. Upload a non-CSV file with `.csv` extension → assert 400.
- **Risk of regression:** None
- **Estimated difficulty:** Low
- **Dependencies:** None

---

## Category 8: Snapshot Read Consistency

### Task 8.1 — Wrap multi-query financial reads in RepeatableRead transactions

- **Goal:** All financial endpoints that execute two or more queries for a single response must do so within a RepeatableRead transaction.
- **Scope:** `src/dashboard/dashboard.service.ts#getSummary`, `src/reports/reports.service.ts#getCustomerStatement`, `#getSupplierStatement`, `#getPaymentAccountStatement`, `#getPendingReceivables`, `#getPendingPayables`.
- **Required code changes:** Wrap each method's query logic in `this.prisma.$transaction(async (tx) => { ... }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead })`. Replace all `this.prisma.$queryRaw` calls within these methods with `tx.$queryRaw`. For dashboard, move all 5 sub-queries inside the transaction.
- **Tests to add:** Difficult to test snapshot consistency directly in integration tests. Recommended: add a comment documenting the invariant and add a unit test verifying the service uses a transaction wrapper.
- **Risk of regression:** Low — read behavior is identical under no concurrency. Under concurrency, behavior improves.
- **Estimated difficulty:** Medium
- **Dependencies:** None

---

## Category 9: Authentication Hardening

### Task 9.1 — Normalize login error responses

- **Goal:** All login failures must return the same external error response regardless of the specific cause.
- **Scope:** `src/auth/auth.service.ts#login`.
- **Required code changes:** Replace distinct `ForbiddenException('Account inactive')`, `ForbiddenException('Tenant inactive')`, and `UnauthorizedException('Invalid credentials')` with a single `UnauthorizedException('Authentication failed')` for all negative outcomes. Log the specific reason internally at info/debug level.
- **Tests to add:** Submit login with invalid email → assert 401 with message "Authentication failed". Submit login with correct email, wrong password → assert identical response. Submit login with inactive user → assert identical response.
- **Risk of regression:** Medium — frontend may rely on specific error messages for UX branching. Coordinate messaging change.
- **Estimated difficulty:** Low
- **Dependencies:** Frontend notification of error response change.

### Task 9.2 — Implement refresh token persistence and revocation

- **Goal:** Refresh tokens must be stored server-side with revocation support.
- **Scope:** Schema migration for `refresh_tokens` table. `src/auth/auth.service.ts`. New `POST /auth/refresh` and `POST /auth/logout` endpoints.
- **Required code changes:** Create `refresh_tokens(id, user_id, tenant_id, token_hash, issued_at, expires_at, revoked_at)`. On login: hash refresh token, store row. `POST /auth/refresh`: validate hash, check not revoked, issue new access token + optionally rotate refresh token. `POST /auth/logout`: set `revoked_at`.
- **Tests to add:** Full lifecycle: login → receive tokens → refresh → receive new access token → logout → attempt refresh → assert 401.
- **Risk of regression:** Low — additive feature.
- **Estimated difficulty:** High
- **Dependencies:** Schema migration. Frontend must update token refresh flow.

### Task 9.3 — Handle P2002 on concurrent registration

- **Goal:** Concurrent duplicate email registrations must return 409, not 500.
- **Scope:** See Task 3.2 (covers auth register). Listed here for completeness.
- **Dependencies:** Task 3.1

---

# SECTION 3 — Execution Order

The remediation must be sequenced to maximize financial correctness gains early and avoid dependency conflicts.

## Wave 1 — Posting Engine Integrity (Must be first)

**Tasks:** 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7

**Rationale:** The posting engine is the single commit point for all financial mutations. Bugs here produce irrecoverable ledger corruption. Every posting that occurs before these fixes is a potential source of permanent bad data. All other categories address how data is read or protected — this category addresses what gets written.

**Parallelism:** All 7 tasks are independent and can execute concurrently.

## Wave 2 — Temporal Integrity (Immediately after Wave 1)

**Tasks:** 1.1, 1.2, 1.3, 1.4

**Rationale:** With posting invariants fixed, the next priority is ensuring that all financial queries produce historically accurate results. Without this, no report, dashboard, or aging analysis can be trusted.

**Parallelism:** Tasks 1.1 and 1.2 can run in parallel. Tasks 1.3 and 1.4 can run in parallel. No cross-dependencies.

## Wave 3 — Uniqueness + Import Safety (After Wave 1)

**Tasks:** 3.1, 3.2, 7.1, 7.2, 7.3, 7.4, 7.5

**Rationale:** Entity uniqueness must be DB-enforced before any more master data is created via API or import. Import atomicity fixes prevent balance corruption during bulk operations. These can run in parallel with Wave 2.

**Parallelism:** 3.1 must precede 3.2. All Category 7 tasks are independent of each other and of Category 3.

## Wave 4 — Read Consistency + Precision (After Wave 2)

**Tasks:** 4.1, 8.1

**Rationale:** With correct temporal queries and correct postings, the remaining data quality gap is precision and snapshot consistency. These are lower risk but still material.

**Parallelism:** Both tasks are fully independent.

## Wave 5 — Truth Surfaces + Authorization (After Wave 3)

**Tasks:** 5.1, 5.2, 5.3, 6.1 (=2.3), 6.2, 6.3, 6.4

**Rationale:** These require stable underlying data to be meaningful. No point fixing labels on a report that produces wrong numbers. Authorization changes are lower blast radius than data correctness changes.

**Parallelism:** All tasks in this wave are independent.

## Wave 6 — Auth Hardening + Timezone (Last)

**Tasks:** 9.1, 9.2, 9.3 (=3.2 for auth), 1.5, 2.8

**Rationale:** Auth hardening is critical for production but does not affect data correctness of existing operations. Timezone changes affect default date behavior and should be applied after all temporal queries are correct. Adjustment encoding refactor (2.8) is highest difficulty and lowest urgency — can be deferred.

**Parallelism:** 9.1 and 9.2 can run in parallel. 1.5 is independent. 2.8 is independent.

---

# SECTION 4 — Invariant Guarantees After Remediation

Upon completion of all remediation tasks, the system will guarantee the following properties:

### Temporal Accuracy
Any financial query parameterized by `asOfDate` will produce results reflecting only the ledger state as of that date. Payments, allocations, and settlements that occur after the queried date will not affect the output. Default dates will be derived from the tenant's configured timezone.

### Inventory Non-Negativity
Stock quantities will never go below zero through any posting path — including supplier returns, adjustment-OUT, and sales. The Serializable posting transaction will enforce this invariant atomically.

### Return Quantity Bounds
Return quantities will never exceed the original transaction quantity, even when duplicate source line references are submitted in a single request. Validation will aggregate by source line before checking limits.

### Entity Uniqueness
No two suppliers, customers, or products within the same tenant will share the same canonical name (case-insensitive). This will be enforced at the database level. Application-level uniqueness checks will be replaced by constraint-first insert patterns.

### Monetary Precision
All monetary values in API responses will be accurate to the integer level within the range of PostgreSQL `bigint`. Values that exceed JavaScript's safe integer range will produce a deterministic error rather than silent corruption.

### Financial Truthfulness
API responses will not contain fabricated financial values. `_computed` placeholder fields will either be removed or replaced with correctly derived values. Financial labels will accurately describe the quantities they represent.

### Role Segregation
Adjustment posting will require OWNER/ADMIN authorization. Deactivation of entities with outstanding obligations will be blocked. Sensitive financial reports will be role-gated.

### Import Reversibility
Import rollback will restore all affected records to their exact pre-import state, including opening balances. State transitions will be atomic and non-replayable. Only supported modules will be importable.

### Snapshot Consistency
Multi-query financial views (dashboards, statements, pending reports) will execute within a single database snapshot, eliminating internally contradictory results during concurrent posting.

### Authentication Security
Login error responses will be uniform regardless of failure cause. Refresh tokens will be server-side revocable. Concurrent registration conflicts will be handled gracefully.

---

# SECTION 5 — Risk if Not Fixed

### Category 1 — Ledger Temporal Integrity
**If not fixed:** Every historical financial report is unreliable. AP/AR aging reports change retroactively as payments are posted. Period-end closing becomes impossible because the numbers for a closed period continue to shift. External auditors will not accept financial statements produced by this system. Customers with overdue balances may be incorrectly classified as current, leading to uncontrolled credit exposure.

### Category 2 — Inventory and Posting Invariants
**If not fixed:** Stock records can go negative through normal API usage. An operator can return more product to a supplier than was ever purchased. A non-admin user can commit inventory adjustments. These are irrecoverable — posted transactions are immutable. Every negative-stock state, every over-return, and every unauthorized adjustment is permanent ledger corruption that cannot be unwound without manual database intervention. The longer the system runs without these fixes, the larger the population of corrupt records.

### Category 3 — Entity Uniqueness
**If not fixed:** Duplicate supplier or customer records will accumulate over time, accelerated by network retries and concurrent usage. Each duplicate splits the AP/AR ledger. Aging reports will show two half-balances instead of one full balance. Payment allocations will be posted against the wrong duplicate. Reconciliation with external counterparties will fail. Data cleanup requires manual identification and merging of duplicates — a process that is operationally expensive and error-prone.

### Category 4 — Monetary Precision
**If not fixed:** At current volumes, this risk is latent. As tenant data grows over years, cumulative balances will approach and exceed the JavaScript safe integer boundary. When this occurs, financial aggregates will silently lose precision. The system will return incorrect balances, incorrect report totals, and incorrect dashboard figures — with no error, no log entry, and no visible indication that the data is wrong.

### Category 5 — Financial Truth Surfaces
**If not fixed:** Any frontend consuming `_computed` fields will display zero balances for entities that actually have activity. Operations staff will make decisions based on fabricated data. The `totalPaid` mislabeling will cause suppliers to appear more settled than they are. Inventory valuation will be materially wrong after any supplier return, affecting margin calculations and procurement decisions.

### Category 6 — Authorization Boundaries
**If not fixed:** Any authenticated user can post adjustment transactions created by administrators, bypassing the intended approval workflow. Any user can deactivate payment accounts with funds, blocking settlement operations. Any user can view detailed financial statements intended for management. The system provides no segregation of duties — a baseline requirement for financial controls.

### Category 7 — Import Lifecycle Atomicity
**If not fixed:** A single opening balance rollback can permanently corrupt the cash position baseline. Batches can become stuck in `PROCESSING` with no recovery path. `TRANSACTIONS` module imports will silently succeed with zero records. Concurrent commits will create duplicate master data. The import system is the primary bulk data path — any corruption here is multiplicative.

### Category 8 — Snapshot Read Consistency
**If not fixed:** During peak posting activity, dashboards and reports will occasionally produce internally contradictory results. A dashboard may show cash balance from before a sale and receivables from after — the numbers will not add up. Statement opening balances may not connect to in-range entries. These inconsistencies will be intermittent and difficult to reproduce, eroding trust in the system's financial output.

### Category 9 — Authentication Hardening
**If not fixed:** Account enumeration is possible. There is no brute-force protection. A compromised credential grants full unrestricted access to the tenant's entire financial ledger, posting authority, and report data. Refresh tokens cannot be revoked server-side — a stolen token remains valid until its expiration. For a system managing real financial operations, this is an unacceptable perimeter weakness.
