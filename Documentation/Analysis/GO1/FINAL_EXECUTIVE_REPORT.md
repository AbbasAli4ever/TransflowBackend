# FINAL EXECUTIVE REPORT — Finance System Codebase Audit
**Date:** 2026-02-15
**Audit Scope:** All 10 modules, 20 analysis files (SUMMARY + TRACE per module)
**Total APIs Audited:** 58 endpoints across 10 modules

---

## 1. OVERALL HEALTH SCORECARD

| Module | Phase | Verdict | Financial Risk Level |
|---|---|---|---|
| Auth | 1 | ⚠ Needs Fixes | HIGH — account takeover risk |
| Customers | 2 | ⚠ Needs Fixes | MEDIUM — duplicate AR, precision loss |
| Dashboard | 3 | ❌ **BLOCKER** | CRITICAL — point-in-time overdue wrong |
| Health | 4 | ⚠ Needs Fixes | LOW (indirect DB contention) |
| Payment Accounts | 5 | ⚠ Needs Fixes | HIGH — fake balances, unsafe inactivation |
| Products | 6 | ❌ **BLOCKER** | HIGH — duplicate catalog, negative stock |
| Reports | 7 | ❌ **BLOCKER** | CRITICAL — historical data incorrect |
| Suppliers | 8 | ⚠ Needs Fixes | HIGH — duplicate AP, misleading totals |
| Transactions | 9 | ❌ **BLOCKER** | CRITICAL — negative stock, over-return, privilege escalation |
| Imports | 10 | ❌ **BLOCKER** | CRITICAL — balance corruption, non-atomic state |

**5 modules are BLOCKERS. 5 modules need targeted fixes. No module is fully clean.**

---

## 2. CRITICAL BLOCKERS (Must fix before production)

### BLOCKER 1 — Dashboard (Phase 3): Point-in-Time Overdue is Factually Wrong

The dashboard overdue calculations for receivables and payables are **not point-in-time safe**. When a user requests `GET /api/v1/dashboard/summary?asOfDate=2025-01-01`, allocation amounts from payments made after that date are still included in the outstanding calculation. This means historical dashboard views show lower overdue amounts than actually existed on that date — a material misrepresentation of financial exposure.

Additionally:
- The five parallel sub-queries run outside a database snapshot transaction. Concurrent posting can make one response contain data from different moments in time (e.g., cash balance reflects 9:00am but receivables reflect 9:01am).
- An `asOfDate` supplied as a datetime string (e.g., `2026-02-15T00:00:00Z`) passes validation but crashes the `subtractDays()` helper with a 500 error, making the endpoint unreliable for any client that includes time components.
- `asOfDate` defaults to UTC server date, not tenant local date, producing wrong "today" snapshots for Pakistan-timezone tenants near midnight.

**Business Impact:** Finance managers viewing historical dashboards will see factually incorrect overdue/aging figures. This cannot be used for credit decisions or reporting.

---

### BLOCKER 2 — Products (Phase 6): Non-Idempotent Create + Fake Computed Fields

`POST /products` has no idempotency key support. Network retries create duplicate logical products when SKU is omitted, fragmenting stock and cost across near-identical items. `avgCost` (inventory valuation) is never set through normal API flows and stock queries can expose negative inventory states.

All product endpoints return `_computed` fields (`currentStock`, `totalPurchases`, `lastTransactionDate`) hardcoded to zero/null. Any UI consuming these fields for operational decisions is acting on fabricated data.

**Business Impact:** Duplicate catalog entries corrupt stock tracking. Any UI relying on `_computed` inventory values makes procurement and pricing decisions on zero-values.

---

### BLOCKER 3 — Reports (Phase 7): Historical Pending Reports are Inaccurate

Both `GET /reports/pending-receivables` and `GET /reports/pending-payables` have the same fundamental defect as the dashboard: allocation amounts are not bounded by `asOfDate`. A payment received in February will retroactively reduce a January aging report, making the report factually wrong for any historical query.

The product stock valuation (`GET /reports/products/:id/stock`) computes `avgCost` only from purchase costs, ignoring supplier return valuation effects. After a high-cost supplier return, the reported `avgCost` and `stockValue` can be materially incorrect.

All statement endpoints (`/suppliers/:id/statement`, `/customers/:id/statement`, `/payment-accounts/:id/statement`) accept inverted date ranges (`dateFrom > dateTo`) without error, returning a logically nonsensical 200 response.

**Business Impact:** AP/AR aging reports cannot be relied upon for period-end closing, audit, or financial reconciliation. Stock valuation is unreliable after returns.

---

### BLOCKER 4 — Transactions (Phase 9): Negative Stock + Privilege Escalation

Three critical posting-engine bugs:

1. **Negative inventory is possible.** `SUPPLIER_RETURN` posting and `ADJUSTMENT_OUT` posting have no stock availability check. A user can post a return or adjustment that reduces stock below zero. Only `SALE` posting checks stock.

2. **Over-return is possible via payload duplication.** Both supplier and customer return drafts validate each line independently. If a request contains the same `sourceTransactionLineId` twice, each passes the per-line returnable-quantity check, but the total returned quantity can exceed what was originally purchased/sold.

3. **Privilege escalation on adjustment posting.** Adjustment draft creation is correctly restricted to `OWNER/ADMIN` roles. However, `POST /transactions/:id/post` has no role check for adjustment types. Any authenticated tenant user can post an admin-created adjustment draft.

**Business Impact:** Inventory can go negative through normal API usage. Users with no admin rights can commit inventory adjustments. Financial reporting on stock values becomes unreliable.

---

### BLOCKER 5 — Imports (Phase 10): Non-Atomic State + Balance Corruption

Three critical issues:

1. **Opening balance rollback corrupts account data.** When a `OPENING_BALANCES` import is rolled back, the payment account's `opening_balance` is reset to `0` rather than the value it held before the import. If the account had a pre-existing opening balance, rollback permanently destroys it.

2. **`TRANSACTIONS` module is accepted but produces no records.** The DTO accepts `module=TRANSACTIONS`, the service creates the batch, and commit marks rows as `SUCCESS` — but no transaction records are actually created. The import silently succeeds with zero effect.

3. **Non-atomic state transitions.** The commit flow sets batch status to `PROCESSING` outside the main transaction, then iterates rows. If the transaction fails midway, the batch is permanently stuck in `PROCESSING` with no automated recovery path.

**Business Impact:** Rolled-back opening balance imports silently corrupt historical cash balances. Users who imported transactions (if exposed to them) will see false confirmations of zero actual data.

---

## 3. CROSS-CUTTING ISSUES (Affect All or Most Modules)

### 3.1 Monetary Precision Loss (All Financial Endpoints)
Every endpoint that aggregates money from the database uses `bigint → JS Number` conversion without a safe-range check. JavaScript's `Number.MAX_SAFE_INTEGER` is 9,007,199,254,740,991 (approximately 9 quadrillion PKR). For high-volume tenants, cumulative balances can silently lose integer precision, producing incorrect financial figures in API responses. This affects: dashboard, all balance endpoints, all statement endpoints, pending receivables, pending payables, product stock value, and supplier/customer/payment account balance endpoints.

### 3.2 Placeholder `_computed` Fields (Suppliers, Customers, Products, Payment Accounts)
Suppliers, customers, products, and payment accounts all return a `_computed` block containing `currentBalance`, `totalPurchases`, `currentStock`, etc. — all hardcoded to zero/null. These fields are returned on every CRUD endpoint (list, detail, create, update, status). Any frontend rendering these values shows users fabricated financial figures. The only endpoints that return real computed balances are the dedicated `/balance` sub-endpoints.

### 3.3 Race-Prone Uniqueness (Suppliers, Customers, Products)
All three master-data modules use a "check-then-create" pattern (service `findFirst` followed by `create`) for name/SKU uniqueness. None of them have a database-level unique constraint on `(tenant_id, lower(name))`. Under concurrent requests (or even simple network retries), duplicate suppliers, customers, or products can be created. Duplicate counterparties split AP/AR ledger linkage and corrupt financial reports.

### 3.4 Status Change Without Business Guards (Suppliers, Customers, Products, Payment Accounts)
All four modules accept a `PATCH /:id/status` endpoint that can set records to INACTIVE. None of them check for outstanding obligations before allowing deactivation:
- A supplier with open payables can be deactivated, hiding the liability.
- A customer with outstanding receivables can be deactivated, hiding the asset.
- A product with positive stock can be deactivated, making inventory inaccessible.
- A payment account with a non-zero balance can be deactivated, blocking settlement flows.
Additionally, the `reason` field is accepted in all status-change requests but silently discarded — never persisted to an audit trail.

### 3.5 No Role-Based Access Control (All Modules)
No module implements role-based access control beyond authentication. Any authenticated tenant user can:
- Read full financial statements and reports
- Create/modify supplier, customer, product, and payment account records
- Post adjustment transactions (should be admin-only)
- Deactivate payment accounts

### 3.6 Missing Auth Hardening (Auth Module)
The login endpoint returns distinguishable errors for "invalid credentials" vs "inactive account" — enabling account enumeration. There is no rate limiting per account or IP for authentication attempts, no account lockout after failed logins, and no server-side refresh token revocation. For a financial system, this represents an elevated account takeover risk.

### 3.7 No Snapshot Consistency for Multi-Query Reports (Dashboard, Reports)
Reports that execute multiple database queries (dashboard's 5 parallel sub-queries, statement endpoint's opening+range pair, pending reports' balance+document pair) run outside a database snapshot transaction. Concurrent postings can cause the same response to contain data from different points in time, producing internally inconsistent financial snapshots.

### 3.8 UTC Date vs Tenant Timezone (Dashboard, Reports)
All `asOfDate` defaults use the server's UTC date via `today()`. For tenants in Pakistan (UTC+5), a query made between midnight and 5:00 AM local time will use yesterday's UTC date, producing a report for the wrong business day. This affects dashboard summaries and all report endpoints.

---

## 4. MODULE-BY-MODULE VERDICT SUMMARY

### Phase 1 — Auth: ⚠ Needs Fixes
- Registration does not handle the `P2002` Prisma unique constraint error — concurrent registrations with the same email can return a 500 instead of a 409.
- Login leaks account state (inactive user vs inactive tenant vs bad credentials are distinguishable).
- No server-side refresh token revocation or rotation.
- No account lockout or brute-force protection.

### Phase 2 — Customers: ⚠ Needs Fixes
- No DB unique constraint on `(tenant_id, lower(name))` — duplicate customers possible under concurrency.
- `bigint → Number` conversion in balance and open-documents endpoints.
- `GET /customers/:id/open-documents` missing documented `asOfDate`/`includeFullyPaid` query params.
- Status changes not guarded by open-balance checks; `reason` discarded silently.

### Phase 3 — Dashboard: ❌ Blocker (see above)

### Phase 4 — Health: ⚠ Needs Fixes
- `/health` endpoint's 503 response shape is rewritten by the global exception filter — the documented error body is never what clients actually receive on database failures.
- Every health probe executes a `SELECT 1` against the primary database; high-frequency probes can contend with financial queries.
- Production `.env` templates set `NODE_ENV=development`, which enables Swagger UI in production.
- No split between liveness (no DB call) and readiness (DB-aware) probes.

### Phase 5 — Payment Accounts: ⚠ Needs Fixes
- `PATCH /:id/status` can inactivate accounts with non-zero balances — explicitly flagged as a required guard in the implementation plan but not implemented.
- `_computed` financial fields on list/detail/create/update/status are all zeros.
- `bigint → Number` conversion in balance endpoint.
- `reason` on status change is accepted and discarded.
- No reserved-name validation (`Cash`, `Bank`) as documented in implementation plan.

### Phase 6 — Products: ❌ Blocker (see above)

### Phase 7 — Reports: ❌ Blocker (see above)

### Phase 8 — Suppliers: ⚠ Needs Fixes
- No DB unique constraint on supplier name — race-prone duplicate creation.
- `GET /suppliers/:id/balance` field named `totalPaid` actually includes supplier returns — semantically wrong label that misrepresents financial data.
- `GET /suppliers/:id/open-documents` does not account for supplier return credits; outstanding totals diverge from actual payable balance.
- No `asOfDate` support on open-documents despite implementation plan specification.
- `POST /suppliers` Swagger annotates 200 but endpoint returns 201.

### Phase 9 — Transactions: ❌ Blocker (see above)

### Phase 10 — Imports: ❌ Blocker (see above)

---

## 5. PRIORITY REMEDIATION ROADMAP

### Priority 1 — Fix Before Any Financial Data Is Trusted (Critical)
1. **Dashboard**: Add `asOfDate` boundary to allocation sums in overdue CTE; wrap 5 queries in repeatable-read transaction; strict date-only validation.
2. **Reports**: Bind allocation amounts to `asOfDate` in pending-receivables and pending-payables; add `dateFrom <= dateTo` validation on all statement endpoints.
3. **Transactions/Posting**: Add stock check before `SUPPLIER_RETURN_OUT` and `ADJUSTMENT_OUT`; add role guard to `postAdjustment`; aggregate duplicate source line quantities; make `returnHandling` required.
4. **Imports/Commit**: Store original `opening_balance` before overwrite and restore it on rollback; reject `TRANSACTIONS` module; make state transition atomic.

### Priority 2 — Fix Before Production Launch (High)
5. **All Master Data**: Add DB unique indexes for `(tenant_id, lower(name))` on suppliers, customers, products; handle `P2002` → 409.
6. **Monetary Precision**: Return all money aggregates as strings or enforce `Number.isSafeInteger()` checks at the API boundary.
7. **`_computed` Fields**: Either populate real values from the database or remove from response contract entirely.
8. **Payment Account Status**: Enforce cannot-inactivate-with-nonzero-balance rule.
9. **Auth Hardening**: Normalize error responses; add per-account rate limiting; implement refresh token persistence and revocation.

### Priority 3 — Fix Before Scale (Medium)
10. **RBAC**: Add role-based access control to reports, statements, adjustment posting, and master-data mutation endpoints.
11. **Status Change Audit**: Persist `reason` + actor + timestamp for all status change operations.
12. **Statement Pagination**: Add `limit` cap to statement responses; add snapshot-consistent read transaction.
13. **Health Endpoint**: Split liveness/readiness; add probe result caching; align 503 response with global exception filter shape.
14. **Tenant Timezone**: Replace UTC `today()` with tenant-local business date for all `asOfDate` defaults.

---

## 6. TEST COVERAGE GAPS

The following high-risk scenarios are completely absent from the test suite:
- Concurrent duplicate entity creation (suppliers, customers, products)
- Supplier return posting when current stock < return quantity
- Adjustment-OUT posting when current stock < adjustment quantity
- Non-admin posting of an adjustment draft
- Duplicate `sourceTransactionLineId` in a single return draft payload
- Dashboard/reports `asOfDate` with future-dated allocations (temporal integrity test)
- Opening balance import rollback (should restore prior value, not zero)
- `TRANSACTIONS` module import (should be rejected, currently silently no-ops)
- All endpoints missing 401 unauthorized tests
- Bigint precision boundary tests for large monetary values

---

## 7. SUMMARY COUNTS

| Severity | Count |
|---|---|
| ❌ Blocker modules | 5 |
| ⚠ Needs Fixes modules | 5 |
| ✅ Safe modules | 0 |
| Critical financial integrity risks | 8 |
| Security vulnerabilities | 6 |
| Missing test scenarios | 40+ |
| Endpoints with `_computed` placeholder data | 20+ |
| Endpoints missing precision-safe money handling | 15+ |
| Race conditions (TOCTOU) without DB constraint | 4 |
