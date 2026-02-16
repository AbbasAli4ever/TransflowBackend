# PHASE TRACE REPORT

Title:
Phase 7 — Reports

--------------------------------------------
## API: GET /api/v1/reports/customers/{id}/balance
--------------------------------------------

Route Entry:
- `GET /api/v1/reports/customers/:id/balance` (`src/reports/reports.controller.ts:43`)

Controller:
- `ReportsController.getCustomerBalance()` (`src/reports/reports.controller.ts:50`)

Service:
- `ReportsService.getCustomerBalance()` (`src/reports/reports.service.ts:72`)

Repository:
- `PrismaService.customer.findFirst(where: { id, tenantId })`
- `PrismaService.$queryRaw(...)` on `ledger_entries` + `transactions`

DTO/Schema:
- `BalanceQueryDto` (`src/reports/dto/balance-query.dto.ts:4`)
- `asOfDate` regex-only validation (`YYYY-MM-DD` string)
- `ParseUUIDPipe` on `id`

Execution Trace:
1. Global middleware sets request context and attempts token decode (`src/app.module.ts:78`, `src/common/middleware/*.ts`).
2. `JwtAuthGuard` authenticates JWT (`src/common/guards/jwt-auth.guard.ts:7`).
3. `TenantScopeGuard` enforces tenant in context (`src/common/guards/tenant-scope.guard.ts:23`).
4. `RolesGuard` enforces `OWNER|ADMIN` from class-level `@Roles` (`src/reports/reports.controller.ts:22`).
5. Validation pipe transforms query + rejects non-whitelisted fields (`src/common/pipes/validation.pipe.ts:21`).
6. Controller forwards `id` + query to service.
7. Service resolves `tenantId`, computes `asOfDate` from query or tenant timezone (`src/reports/reports.service.ts:73-75`, `669-673`).
8. Service verifies customer exists within tenant (`findFirst`).
9. Raw SQL aggregates `AR_INCREASE` and `AR_DECREASE` up to `asOfDate` with `t.status='POSTED'`.
10. BigInt aggregates are converted via `safeMoney` and response payload is returned.

Business Rules Observed:
- Tenant-scoped existence check before aggregation.
- Only posted transactions included in balance math.
- AR model: `balance = sales - payments - returns`.
- Balance type derived (`RECEIVABLE|CREDIT|SETTLED`).

Missing Rules:
- No strict calendar-date validation (regex allows invalid dates like `2026-13-40`).
- No explicit overflow guard after arithmetic on converted JS numbers.

Security Risks:
- Low: auth/tenant/role controls are present.
- Medium: service-layer tenant scoping is manual; no query-level auto-enforcement in Prisma layer.

Financial Risks:
- Medium: invalid but regex-matching dates can trigger DB cast/runtime failure rather than controlled 400.
- Medium: totals can exceed JS safe integer after arithmetic even if individual aggregates pass `safeMoney`.

Edge Case Failures:
- Invalid calendar dates likely surface as 500, not deterministic validation error.
- No dedicated handling for extremely large aggregate totals.

Concurrency Risks:
- Low: single aggregate query is atomic at statement level.
- Low: customer existence check and aggregate are separate reads; highly concurrent updates can produce slight temporal mismatch in metadata vs totals.

Test Coverage:
- Covered in `test/integration/reports.integration.spec.ts`:
- `asOfDate` filtering (`line 166`)
- breakdown composition (`line 200`)
- unknown customer 404 (`line 245`)
- cross-tenant 404 (`line 252`)
- asOfDate format validation (`line 840+` shared wave tests)
- Missing tests: unauthorized (401), forbidden role (403), invalid calendar date, numeric overflow.

Verdict:
⚠ Risky

Required Fixes:
- Add strict date parsing validation (calendar-valid ISO date) in DTO.
- Add overflow-safe arithmetic wrapper for post-conversion additions/subtractions.
- Add authz negative-path tests (401/403).

--------------------------------------------
## API: GET /api/v1/reports/customers/{id}/statement
--------------------------------------------

Route Entry:
- `GET /api/v1/reports/customers/:id/statement` (`src/reports/reports.controller.ts:126`)

Controller:
- `ReportsController.getCustomerStatement()` (`src/reports/reports.controller.ts:134`)

Service:
- `ReportsService.getCustomerStatement()` (`src/reports/reports.service.ts:546`)

Repository:
- `PrismaService.customer.findFirst(...)`
- `PrismaService.$transaction(... RepeatableRead ...)` with two raw queries:
- opening balance query on `ledger_entries + transactions`
- in-range entries query on `ledger_entries + transactions`

DTO/Schema:
- `StatementQueryDto` (`src/reports/dto/statement-query.dto.ts:26`)
- `dateFrom`, `dateTo` regex validation + lexical `dateTo >= dateFrom`
- `ParseUUIDPipe` on `id`

Execution Trace:
1. Middleware + global guards enforce auth, tenant scope, and `OWNER|ADMIN` role.
2. Validation pipe enforces query DTO and whitelist.
3. Controller passes to service.
4. Service requires tenant context, checks customer existence in tenant.
5. In one RepeatableRead transaction, service fetches opening AR balance (`< dateFrom`) and in-range AR entries (`dateFrom..dateTo`, posted-only).
6. `buildRunningBalance()` converts debit/credit bigints and calculates per-row running totals.
7. Service returns opening/closing balances and entries list.

Business Rules Observed:
- Statement split into opening balance + in-range running ledger.
- Only posted ledger transactions included.
- Tenant isolation enforced both in existence and queries.
- Snapshot consistency via RepeatableRead across opening+entries queries.

Missing Rules:
- Date validation is format/lexical only; calendar-invalid dates not blocked pre-query.
- No deterministic tie-breaker for same-date, same-created_at ledger rows (can reorder running sequence).

Security Risks:
- Low: authz path is enforced globally and by role decorator.

Financial Risks:
- Medium: non-deterministic row ordering can alter intermediate running-balance sequence display.
- Medium: potential JS number precision issues on large cumulative balances.

Edge Case Failures:
- Invalid dates may become DB/runtime errors.
- Multiple ledger rows with same ordering keys can produce unstable entry order across executions.

Concurrency Risks:
- Low: RepeatableRead mitigates split-read skew.

Test Coverage:
- Covered:
- opening balance behavior (`line 705`)
- running balance behavior (`line 705` scenario asserts step balances)
- 404 unknown customer (`line 750`)
- inverted date range reject (`line 888`)
- Missing tests: unauthorized/forbidden, invalid calendar date, deterministic ordering under tied timestamps.

Verdict:
⚠ Risky

Required Fixes:
- Replace regex+lexical date logic with strict parsed-date validator.
- Add SQL `ORDER BY ... , le.created_at, le.id` (or equivalent stable key) for deterministic statements.
- Add high-value/overflow and role-denial tests.

--------------------------------------------
## API: GET /api/v1/reports/payment-accounts/{id}/balance
--------------------------------------------

Route Entry:
- `GET /api/v1/reports/payment-accounts/:id/balance` (`src/reports/reports.controller.ts:57`)

Controller:
- `ReportsController.getPaymentAccountBalance()` (`src/reports/reports.controller.ts:64`)

Service:
- `ReportsService.getPaymentAccountBalance()` (`src/reports/reports.service.ts:127`)

Repository:
- `PrismaService.paymentAccount.findFirst(...)`
- `PrismaService.$queryRaw(...)` on `payment_entries`

DTO/Schema:
- `BalanceQueryDto` (`src/reports/dto/balance-query.dto.ts:4`)

Execution Trace:
1. Middleware/guards/validation path executes as above.
2. Service resolves tenant and `asOfDate`.
3. Service verifies payment account exists in tenant.
4. Raw SQL aggregates `payment_entries` by `direction` up to `asOfDate`.
5. Computes `balance = openingBalance + moneyIn - moneyOut`.
6. Returns structured breakdown.

Business Rules Observed:
- Opening balance comes from account master record.
- Money-in/money-out are derived from append-only payment entries.
- Tenant filter enforced in all reads.

Missing Rules:
- Query does not join `transactions` to enforce `status='POSTED'`.
- No strict calendar-date validation.
- No overflow protection on final arithmetic.

Security Risks:
- Low for direct endpoint authorization.

Financial Risks:
- High: inclusion of any non-posted/corrupt payment entries would misstate cash.
- Medium: arithmetic may exceed safe numeric range after conversion.

Edge Case Failures:
- Invalid calendar date can fail at DB cast layer.
- Potential mismatch if historical data integrity is compromised.

Concurrency Risks:
- Low: single aggregate query.

Test Coverage:
- Covered:
- includes opening balance (`line 266`)
- asOfDate filtering (`line 281`)
- unknown account 404 (`line 315`)
- Missing tests: tenant isolation for this endpoint, unauthorized/forbidden, invalid calendar date, corruption/non-posted entry exclusion.

Verdict:
⚠ Risky

Required Fixes:
- Join `payment_entries` to `transactions` and filter `t.status='POSTED'`.
- Add strict parsed-date validation and overflow-safe final arithmetic checks.
- Add tests for role/tenant/auth negative paths and data-integrity contamination scenarios.

--------------------------------------------
## API: GET /api/v1/reports/payment-accounts/{id}/statement
--------------------------------------------

Route Entry:
- `GET /api/v1/reports/payment-accounts/:id/statement` (`src/reports/reports.controller.ts:141`)

Controller:
- `ReportsController.getPaymentAccountStatement()` (`src/reports/reports.controller.ts:149`)

Service:
- `ReportsService.getPaymentAccountStatement()` (`src/reports/reports.service.ts:606`)

Repository:
- `PrismaService.paymentAccount.findFirst(...)`
- `PrismaService.$transaction(... RepeatableRead ...)` with two raw queries on `payment_entries` and joined `transactions` for in-range rows

DTO/Schema:
- `StatementQueryDto` (`src/reports/dto/statement-query.dto.ts:26`)

Execution Trace:
1. Global middleware/guards/validation.
2. Service validates tenant context and account existence.
3. RepeatableRead transaction reads:
- historical net (`SUM(IN)-SUM(OUT)`) before `dateFrom`
- in-range money-in/money-out rows ordered by `transaction_date, created_at`
4. Opening balance computed as `account.openingBalance + historicalBalance`.
5. Running balance built in application layer.
6. Response returned with opening/closing and entry rows.

Business Rules Observed:
- Running cash statement built from payment entries.
- Opening computed from account opening + historical movement.
- Snapshot consistency for historical/in-range pair.

Missing Rules:
- Neither historical nor in-range query enforces `transactions.status='POSTED'`.
- Date validation not calendar-strict.
- Stable ordering not guaranteed for exact timestamp ties.

Security Risks:
- Low authz risk at endpoint level.

Financial Risks:
- High: unposted/corrupt payment entries can pollute statement balances.
- Medium: running arithmetic can exceed safe JS numeric precision.

Edge Case Failures:
- Invalid date strings (calendar-invalid) may throw DB errors.
- Tie-order instability for simultaneous entry timestamps may change row sequence.

Concurrency Risks:
- Low: RepeatableRead covers split reads.

Test Coverage:
- Covered:
- opening includes pre-range movement (`line 761`)
- running balance (`line 787`)
- unknown account 404 (`line 829`)
- inverted date range reject (`line 896`)
- Missing tests: unauthorized/forbidden, invalid calendar dates, posted-status contamination, tie-order determinism.

Verdict:
⚠ Risky

Required Fixes:
- Enforce posted transaction status in payment-account statement SQL.
- Add deterministic sort key (`pe.id`) after timestamp columns.
- Strengthen date validation and add precision guards.

--------------------------------------------
## API: GET /api/v1/reports/pending-payables
--------------------------------------------

Route Entry:
- `GET /api/v1/reports/pending-payables` (`src/reports/reports.controller.ts:98`)

Controller:
- `ReportsController.getPendingPayables()` (`src/reports/reports.controller.ts:105`)

Service:
- `ReportsService.getPendingPayables()` (`src/reports/reports.service.ts:370`)

Repository:
- RepeatableRead transaction:
- Balance query on `ledger_entries + suppliers`
- Open-doc query on `transactions + allocations + payment transactions`

DTO/Schema:
- `PendingPayablesQueryDto` (`src/reports/dto/pending-payables-query.dto.ts:5`)
- `asOfDate` regex, `supplierId` UUID, `minAmount` int >=0

Execution Trace:
1. Global middleware/guards/validation.
2. Service resolves tenant + asOf date.
3. Builds optional `supplierId` SQL fragment.
4. In one RepeatableRead tx, computes supplier AP balances from ledger entries (query 1).
5. For suppliers returned by query 1, computes open purchase documents as `total - allocated_posted_payments` (query 2).
6. Groups documents per supplier, derives oldest invoice and `daysPastDue`, totals payables.
7. Returns aggregate payload.

Business Rules Observed:
- Positive AP balances only (`HAVING ... > minAmount`).
- Open documents only when outstanding > 0.
- Payment allocations are time-bounded by `payment_t.transaction_date <= asOfDate` and posted-only.
- Two-query snapshot consistency via RepeatableRead.

Missing Rules:
- Balance query does not join `transactions` to enforce posted status.
- Document outstanding logic ignores supplier-return credits (AP decreases not tied through allocations).
- Date format validation is regex-only.

Security Risks:
- Low direct authz risk.

Financial Risks:
- High: report can show `balance` and summed open document outstanding that diverge when supplier returns/credits exist.
- Medium: non-posted/corrupt ledger rows can influence supplier inclusion and balances.

Edge Case Failures:
- Supplier with credits from returns can appear with lower balance but overstated open documents.
- Invalid calendar date may bubble into DB errors.

Concurrency Risks:
- Low: two-query skew mitigated with RepeatableRead.

Test Coverage:
- Covered:
- positive-balance inclusion (`line 564`)
- supplier filter (`line 594`)
- future-dated payment temporal integrity (`line 998`)
- asOfDate datetime reject (`line 863`)
- Missing tests: minAmount boundary semantics, unauthorized/forbidden, supplier-return credit impact on open docs, invalid calendar date.

Verdict:
❌ Unsafe

Required Fixes:
- Add `JOIN transactions t ... AND t.status='POSTED'` to balance query source rows.
- Rework open-document outstanding model to account for return/credit-note effects (or explicitly expose unapplied credits and reconcile totals).
- Add reconciliation invariant test: `sum(openDocuments.outstanding)` must align with reported balance policy.

--------------------------------------------
## API: GET /api/v1/reports/pending-receivables
--------------------------------------------

Route Entry:
- `GET /api/v1/reports/pending-receivables` (`src/reports/reports.controller.ts:87`)

Controller:
- `ReportsController.getPendingReceivables()` (`src/reports/reports.controller.ts:94`)

Service:
- `ReportsService.getPendingReceivables()` (`src/reports/reports.service.ts:252`)

Repository:
- RepeatableRead transaction:
- Balance query on `ledger_entries + customers`
- Open-doc query on `transactions + allocations + payment transactions`

DTO/Schema:
- `PendingReceivablesQueryDto` (`src/reports/dto/pending-receivables-query.dto.ts:5`)

Execution Trace:
1. Global middleware/guards/validation.
2. Service resolves tenant and effective `asOfDate`.
3. Optional customer filter fragment added.
4. Query 1 computes AR net balances (`AR_INCREASE - AR_DECREASE`) per customer.
5. Query 2 fetches open SALE docs and outstanding by allocations tied to posted payments in scope.
6. Service groups docs per customer and computes aging fields.
7. Returns tenant totals and per-customer open documents.

Business Rules Observed:
- Only positive receivables are returned.
- Open documents require positive outstanding.
- Time-sliced allocation logic excludes future-dated posted payments.
- RepeatableRead ensures consistency between customer list and docs.

Missing Rules:
- Query 1 does not enforce source transaction posted status.
- Document outstanding does not account for customer-return credits.
- Date validation is regex-only, not strict-date parsing.

Security Risks:
- Low direct authz risk.

Financial Risks:
- High: receivable balance and document-level outstanding can diverge materially when returns/credits exist.
- Medium: stray/unposted ledger entries can alter customer inclusion and balances.

Edge Case Failures:
- Credits from returns reduce customer balance but do not reduce per-document outstanding.
- Invalid calendar date can throw DB-layer errors.

Concurrency Risks:
- Low: snapshot isolation is used correctly for split reads.

Test Coverage:
- Covered:
- inclusion/exclusion by balance (`line 425`)
- `minAmount` filter (`line 464`)
- `customerId` filter (`line 493`)
- open doc fields and aging (`line 522`)
- future-dated payment temporal behavior (`line 915`)
- asOfDate datetime reject (`line 856`)
- Missing tests: unauthorized/forbidden, return-credit impact, invalid calendar date, consistency invariant between balances and open docs.

Verdict:
❌ Unsafe

Required Fixes:
- Enforce posted-status provenance in balance query.
- Add credit-note/return-aware reconciliation in document outstanding model.
- Add invariant tests for receivable total vs document totals under returns/credits.

--------------------------------------------
## API: GET /api/v1/reports/products/{id}/stock
--------------------------------------------

Route Entry:
- `GET /api/v1/reports/products/:id/stock` (`src/reports/reports.controller.ts:71`)

Controller:
- `ReportsController.getProductStock()` (`src/reports/reports.controller.ts:78`)

Service:
- `ReportsService.getProductStock()` (`src/reports/reports.service.ts:175`)

Repository:
- `PrismaService.product.findFirst(...)`
- `PrismaService.$queryRaw(...)` on `inventory_movements`

DTO/Schema:
- `BalanceQueryDto` (`src/reports/dto/balance-query.dto.ts:4`)

Execution Trace:
1. Global middleware/guards/validation.
2. Service resolves tenant and `asOfDate`.
3. Product existence check in-tenant.
4. Raw SQL aggregates movement quantities and limited cost pools.
5. `netStock` and computed `avgCost` derive in code.
6. Returns current stock, avg cost, stock value, and movement breakdown.

Business Rules Observed:
- Stock quantity derives from movement ledger only.
- Tenant and date bounded query.
- All movement types included in quantity math.

Missing Rules:
- Cost model excludes `CUSTOMER_RETURN_IN` and adjustments from valuation pool while including them in quantity.
- No explicit filter tying movement rows to posted transactions.
- Date validation is regex-only.

Security Risks:
- Low direct authz risk.

Financial Risks:
- High: valuation can be materially wrong (e.g., stock from customer returns/adjustments with zero or distorted avgCost).
- Medium: JS numeric overflow risk in `stockValue = netStock * avgCost`.

Edge Case Failures:
- Product with only return/adjustment stock can produce zero/incorrect avgCost.
- Invalid calendar date may fail at DB layer.

Concurrency Risks:
- Low: single aggregate query.

Test Coverage:
- Covered:
- asOfDate filter (`line 326`)
- movement-type quantity breakdown (`line 354`)
- stockValue formula identity (`line 397`)
- 404 unknown product (`line 414`)
- Missing tests: valuation correctness with customer returns and adjustments, invalid calendar dates, unauthorized/forbidden.

Verdict:
❌ Unsafe

Required Fixes:
- Redesign valuation logic to align cost pool with all stock-in/out semantics or compute from authoritative per-product cost policy.
- Optionally use product cost snapshots instead of ad-hoc aggregate derivation.
- Add tests covering return-heavy and adjustment-heavy valuation scenarios.

--------------------------------------------
## API: GET /api/v1/reports/suppliers/{id}/balance
--------------------------------------------

Route Entry:
- `GET /api/v1/reports/suppliers/:id/balance` (`src/reports/reports.controller.ts:29`)

Controller:
- `ReportsController.getSupplierBalance()` (`src/reports/reports.controller.ts:36`)

Service:
- `ReportsService.getSupplierBalance()` (`src/reports/reports.service.ts:17`)

Repository:
- `PrismaService.supplier.findFirst(...)`
- `PrismaService.$queryRaw(...)` on `ledger_entries + transactions`

DTO/Schema:
- `BalanceQueryDto` + `ParseUUIDPipe`

Execution Trace:
1. Middleware/context, auth guard, tenant guard, roles guard.
2. DTO validation and UUID parsing.
3. Tenant-scoped supplier lookup.
4. Aggregate query computes purchases/payments/returns from AP ledger rows with posted transaction filter.
5. Converts bigints and computes payable/credit status.
6. Returns breakdown and net balance.

Business Rules Observed:
- Posted-only AP ledger inclusion.
- Separate treatment of supplier returns (`AP_DECREASE` where `t.type='SUPPLIER_RETURN'`).
- Tenant isolation and 404-on-cross-tenant via scoped lookup.

Missing Rules:
- Date validation is not calendar-strict.
- No post-arithmetic safe-range checks.

Security Risks:
- Low: proper auth/tenant/role enforcement path exists.

Financial Risks:
- Medium: invalid date handling may fail as 500.
- Medium: cumulative arithmetic can exceed safe range.

Edge Case Failures:
- Invalid calendar dates may not return clean validation error.

Concurrency Risks:
- Low: one aggregate query.

Test Coverage:
- Covered:
- zero-balance no transaction (`line 56`)
- asOfDate filtering (`line 70`)
- breakdown split (`line 103`)
- unknown supplier 404 (`line 145`)
- tenant isolation 404 (`line 152`)
- asOfDate format tests in wave section (`line 840+`)
- Missing tests: unauthorized/forbidden, invalid calendar dates, overflow handling.

Verdict:
⚠ Risky

Required Fixes:
- Replace regex date validation with strict date parser.
- Add safe arithmetic guards beyond initial bigint conversion.
- Add explicit authz negative tests.

--------------------------------------------
## API: GET /api/v1/reports/suppliers/{id}/statement
--------------------------------------------

Route Entry:
- `GET /api/v1/reports/suppliers/:id/statement` (`src/reports/reports.controller.ts:111`)

Controller:
- `ReportsController.getSupplierStatement()` (`src/reports/reports.controller.ts:119`)

Service:
- `ReportsService.getSupplierStatement()` (`src/reports/reports.service.ts:486`)

Repository:
- `PrismaService.supplier.findFirst(...)`
- RepeatableRead transaction with opening + entry raw queries

DTO/Schema:
- `StatementQueryDto` (`src/reports/dto/statement-query.dto.ts:26`)

Execution Trace:
1. Global middleware/guards/validation.
2. Service gets tenantId and validates supplier existence.
3. RepeatableRead transaction computes opening AP balance before `dateFrom` and in-range entries between `dateFrom` and `dateTo` for posted txns.
4. Running balance built in service.
5. Closing balance derived from last entry or opening value.
6. Response returned.

Business Rules Observed:
- Opening balance and movement rows are AP-based.
- Posted-only filtering exists for both opening and range entries.
- Running balance progression is explicit and auditable.

Missing Rules:
- Date validation not strict calendar parsing.
- Ordering lacks immutable tie-breaker at ledger-row granularity.

Security Risks:
- Low: endpoint is protected by JWT + tenant + role checks.

Financial Risks:
- Medium: statement row order can become non-deterministic for same-date/same-created_at collisions.
- Medium: numeric precision risk on very large running totals.

Edge Case Failures:
- Invalid dates can fail at SQL cast.
- Potential unstable row ordering in heavy batch posting windows.

Concurrency Risks:
- Low: RepeatableRead used correctly.

Test Coverage:
- Covered:
- opening balance (`line 621`)
- running balance (`line 642`)
- empty-range behavior (`line 674`)
- 404 unknown supplier (`line 694`)
- date-range validation (`line 872`, `880`, `904`)
- Missing tests: unauthorized/forbidden, invalid calendar date values, row-order determinism on equal timestamps.

Verdict:
⚠ Risky

Required Fixes:
- Add strict calendar date validator.
- Add stable tie-break ordering including ledger entry identity.
- Add authz negative-path and deterministic-order tests.

