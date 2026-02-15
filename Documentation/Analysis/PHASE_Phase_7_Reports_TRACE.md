# PHASE TRACE REPORT

Title:
Phase 7 — Reports

## API: GET /api/v1/reports/customers/{id}/balance

Route Entry:
`src/reports/reports.controller.ts` -> `getCustomerBalance()`

Controller:
`ReportsController.getCustomerBalance(@Param('id', ParseUUIDPipe), @Query() BalanceQueryDto)`

Service:
`ReportsService.getCustomerBalance(id, query)`

Repository:
`PrismaService.customer.findFirst()` + `PrismaService.$queryRaw()` on `ledger_entries` joined with `transactions`

DTO/Schema:
`src/reports/dto/balance-query.dto.ts` (`asOfDate?: IsDateString`)  
`customers`, `ledger_entries`, `transactions` in `prisma/schema.prisma`

Execution Trace:
1. Request enters global middleware chain: `RequestContextMiddleware` sets `requestId`; `TenantContextMiddleware` attempts JWT decode and context seed.
2. Global guards run: `JwtAuthGuard` authenticates JWT, `TenantScopeGuard` enforces `tenantId` presence and sets request context.
3. Route match to `GET reports/customers/:id/balance`; `ParseUUIDPipe` validates path id.
4. Global validation pipe validates query (`BalanceQueryDto`) and strips unknown fields.
5. Service reads tenant from async context (`requireTenantId()`), defaults `asOfDate` via `today()` if omitted.
6. Service loads customer with tenant-scoped lookup (`findFirst({ id, tenantId })`); missing -> `404`.
7. Raw SQL aggregates AR ledger by entry type up to `asOfDate`, joined to `transactions` with `t.status = 'POSTED'`.
8. Bigint aggregates are cast to JS `Number`, balance computed and returned.

Business Rules Observed:
- Tenant isolation is explicitly enforced in entity lookup and raw SQL filters.
- Only posted transactions are counted (`t.status = 'POSTED'`).
- Balance classification implemented (`RECEIVABLE` / `CREDIT` / `SETTLED`).
- Point-in-time filtering supported via `asOfDate`.

Missing Rules:
- No explicit date policy based on tenant timezone; default date uses server UTC.
- No role/permission check beyond authenticated tenant membership.
- No guardrail for extremely large aggregates before bigint->number conversion.

Security Risks:
- Any authenticated tenant user can access full financial balances; no RBAC check.

Financial Risks:
- Precision loss risk from `bigint -> Number` conversion for large historical totals.
- UTC default date can shift point-in-time snapshots around tenant day boundaries.

Edge Case Failures:
- Very large values can exceed safe integer precision silently.
- Future-dated transactions are included if `asOfDate` omitted and UTC date rolls ahead of tenant-local day.

Concurrency Risks:
- Read uses multiple statements (entity check + aggregate) without snapshot transaction; possible non-repeatable read under concurrent posting.

Test Coverage:
- Covered: zero-balance baseline, as-of filtering, breakdown correctness, unknown id `404`, cross-tenant `404`.
- Missing: invalid query/date format `400`, unauthorized `401`, precision limits, UTC/day-boundary behavior.

Verdict:
⚠ Risky

Required Fixes:
- Keep monetary aggregates as `bigint`/string in API or enforce safe-range checks before `Number`.
- Derive default business date using tenant timezone, not server UTC.
- Add RBAC enforcement for report visibility.
- Add validation/auth/timezone precision tests.

## API: GET /api/v1/reports/customers/{id}/statement

Route Entry:
`src/reports/reports.controller.ts` -> `getCustomerStatement()`

Controller:
`ReportsController.getCustomerStatement(@Param('id', ParseUUIDPipe), @Query() StatementQueryDto)`

Service:
`ReportsService.getCustomerStatement(id, query)`

Repository:
`PrismaService.customer.findFirst()` + two `PrismaService.$queryRaw()` queries on `ledger_entries` + `transactions`

DTO/Schema:
`src/reports/dto/statement-query.dto.ts` (`dateFrom`, `dateTo` as `IsDateString`)  
`customers`, `ledger_entries`, `transactions`

Execution Trace:
1. Middleware + guards execute as above (request context + JWT + tenant scope).
2. Controller validates UUID path and statement query DTO.
3. Service enforces tenant context via `requireTenantId()`.
4. Service verifies customer exists for tenant (`findFirst`), else `404`.
5. Query A computes opening balance (`transaction_date < dateFrom`, posted only).
6. Query B loads in-range ledger rows (`dateFrom <= transaction_date <= dateTo`, posted only), ordered by date and creation.
7. Service computes running balance line-by-line (`debit - credit`) using `buildRunningBalance`.
8. Service returns opening/closing balances and statement entries.

Business Rules Observed:
- Posted-only rule applied in both SQL queries.
- Tenant isolation applied in all SQL conditions.
- Opening + in-range entries model is implemented correctly for standard ranges.

Missing Rules:
- No validation that `dateFrom <= dateTo`.
- No pagination/limit for statement rows.
- No explicit timezone normalization per tenant.

Security Risks:
- No per-role authorization for detailed financial statements.

Financial Risks:
- `bigint -> Number` conversions can lose precision.
- Invalid date range (from > to) yields misleading but successful response.

Edge Case Failures:
- `dateFrom > dateTo` returns `200` with logically invalid snapshot.
- Large statement windows can return huge payloads and stress memory.

Concurrency Risks:
- Opening and entry queries run as separate statements (Promise.all) without snapshot isolation; concurrent posts can produce inconsistent opening/entries pair.

Test Coverage:
- Covered: opening balance logic, running balance progression, empty-range behavior, unknown id `404`.
- Missing: invalid date order, `401`, cross-tenant access test, large-window limits.

Verdict:
⚠ Risky

Required Fixes:
- Add DTO-level custom validator enforcing `dateFrom <= dateTo`.
- Run multi-query statement reads in a read-only transaction with consistent snapshot.
- Add optional pagination for entries.
- Add tests for invalid range, auth, and tenant isolation.

## API: GET /api/v1/reports/payment-accounts/{id}/balance

Route Entry:
`src/reports/reports.controller.ts` -> `getPaymentAccountBalance()`

Controller:
`ReportsController.getPaymentAccountBalance(@Param('id', ParseUUIDPipe), @Query() BalanceQueryDto)`

Service:
`ReportsService.getPaymentAccountBalance(id, query)`

Repository:
`PrismaService.paymentAccount.findFirst()` + raw SQL over `payment_entries`

DTO/Schema:
`BalanceQueryDto`  
`payment_accounts`, `payment_entries`

Execution Trace:
1. Middleware + guards set request and tenant context.
2. Controller validates UUID and query DTO.
3. Service requires tenant id and chooses `asOfDate`.
4. Tenant-scoped payment account lookup (`findFirst`), else `404`.
5. Raw SQL aggregates IN/OUT payment entries up to `asOfDate`.
6. Service computes `balance = openingBalance + moneyIn - moneyOut`.
7. Returns balance plus movement breakdown.

Business Rules Observed:
- Tenant-scoped entity existence check.
- Point-in-time filter on `payment_entries.transaction_date`.
- Opening balance included from master record.

Missing Rules:
- Aggregate query does not join `transactions` to enforce posted-only semantics explicitly.
- No account status check (inactive account still reportable without explicit policy).
- No timezone-aware default date.

Security Risks:
- No RBAC granularity for cash/bank balance visibility.

Financial Risks:
- `bigint -> Number` conversion precision risk.
- Implicit trust that every `payment_entry` belongs to valid posted business state.

Edge Case Failures:
- Large aggregates may overflow safe integer precision.

Concurrency Risks:
- Entity lookup and aggregate are separate statements; concurrent writes can cause read skew.

Test Coverage:
- Covered: opening-balance inclusion, as-of filtering, unknown id `404`.
- Missing: tenant isolation for this endpoint, unauthorized `401`, invalid query `400`, precision stress tests.

Verdict:
⚠ Risky

Required Fixes:
- Join `transactions` and enforce `t.status = 'POSTED'` in aggregate query.
- Use safe monetary representation (`bigint`/string) in response.
- Add tenant isolation and auth coverage for this route.

## API: GET /api/v1/reports/payment-accounts/{id}/statement

Route Entry:
`src/reports/reports.controller.ts` -> `getPaymentAccountStatement()`

Controller:
`ReportsController.getPaymentAccountStatement(@Param('id', ParseUUIDPipe), @Query() StatementQueryDto)`

Service:
`ReportsService.getPaymentAccountStatement(id, query)`

Repository:
`PrismaService.paymentAccount.findFirst()` + two raw SQL queries on `payment_entries` (second joined with `transactions`)

DTO/Schema:
`StatementQueryDto`  
`payment_accounts`, `payment_entries`, `transactions`

Execution Trace:
1. Middleware + global guards authenticate and set tenant context.
2. Controller enforces UUID and validates `dateFrom/dateTo`.
3. Service tenant check via `requireTenantId`.
4. Service validates account existence by tenant (`findFirst`) else `404`.
5. Query A computes historical net movement before `dateFrom`.
6. Query B loads in-range payment entries with document/type metadata.
7. Opening balance computed from `account.openingBalance + historicalBalance`; running balance computed row-wise.
8. Statement object returned.

Business Rules Observed:
- Tenant scoping in both queries.
- Opening + range statement semantics implemented.

Missing Rules:
- No validation that `dateFrom <= dateTo`.
- Query A and B do not enforce transaction status explicitly.
- No pagination on statement entries.

Security Risks:
- No role-based restriction for account-level cashflow statements.

Financial Risks:
- Precision loss from bigint-to-number conversions.
- Potential inclusion of entries tied to non-posted transactions if data integrity drifts.

Edge Case Failures:
- Invalid date range accepted with `200`.
- Large windows can return unbounded rows.

Concurrency Risks:
- Two-query statement built without snapshot transaction; can return inconsistent opening/entry composition during concurrent posting.

Test Coverage:
- Covered: opening balance from pre-range entries + account opening, running balance in-range, unknown id `404`.
- Missing: invalid date order, tenant isolation, unauthorized `401`, status-integrity scenarios.

Verdict:
⚠ Risky

Required Fixes:
- Enforce `dateFrom <= dateTo`.
- Add posted-status filtering (via `transactions` join) in both historical and range queries.
- Add snapshot-consistent read transaction and pagination options.

## API: GET /api/v1/reports/pending-payables

Route Entry:
`src/reports/reports.controller.ts` -> `getPendingPayables()`

Controller:
`ReportsController.getPendingPayables(@Query() PendingPayablesQueryDto)`

Service:
`ReportsService.getPendingPayables(query)`

Repository:
Two raw SQL queries:  
1) `ledger_entries` + `suppliers` for AP balances  
2) `transactions` + `allocations` for open purchase documents

DTO/Schema:
`src/reports/dto/pending-payables-query.dto.ts` (`asOfDate?`, `supplierId?`, `minAmount?`)  
`ledger_entries`, `transactions`, `allocations`, `suppliers`

Execution Trace:
1. Middleware and guards authenticate request and set tenant context.
2. Query DTO validated (`asOfDate` date-string, `supplierId` UUID, `minAmount` int >= 0).
3. Service reads tenant and defaults `asOfDate`.
4. SQL #1 computes supplier AP balances from ledger entries up to `asOfDate`, optional supplier filter, threshold by `minAmount`.
5. If no balances > threshold, returns empty summary.
6. SQL #2 fetches open posted PURCHASE docs for matched suppliers; outstanding = `total_amount - SUM(allocations.amount_applied)`.
7. Results grouped per supplier, days past due derived from `asOfDate - transactionDate`.
8. Response returns totals + suppliers + open documents.

Business Rules Observed:
- Tenant filter applied in both SQL queries.
- Positive outstanding thresholding implemented.
- Open document list avoids N+1 by single IN-query.

Missing Rules:
- Critical: allocation amounts are not time-bounded by `asOfDate`.
- SQL #1 does not explicitly join `transactions` for posted-only enforcement.
- No supplier existence check when `supplierId` is provided (returns empty instead of explicit not-found behavior).

Security Risks:
- No role-level authorization for AP aging/payables visibility.

Financial Risks:
- **As-of integrity break**: future allocations (payments after `asOfDate`) still reduce `openDocuments.outstanding`, producing incorrect historical aging.
- Potential mismatch: supplier `balance` (from ledger as-of) can disagree with summed `openDocuments` (allocation not as-of bounded).
- Bigint-to-number precision risk on large sums.

Edge Case Failures:
- A supplier can appear with positive balance but empty `openDocuments` due to future allocations being counted.
- Historical aging metrics (`daysPastDue`) become misleading when outstanding was incorrectly netted by post-as-of settlements.

Concurrency Risks:
- Multi-statement report built without snapshot transaction; SQL #1 and SQL #2 can observe different database moments.

Test Coverage:
- Covered: includes only positive AP suppliers, supplierId filter.
- Missing: as-of allocation boundary case, cross-tenant leakage checks, invalid query inputs, unauthorized `401`, data consistency assertion between totals and documents.

Verdict:
❌ Unsafe

Required Fixes:
- In SQL #2, include allocation amounts only when allocation’s payment transaction date is `<= asOfDate` (join `allocations.payment_transaction_id -> transactions`).
- Optionally compute balances and open docs from one canonical query model to prevent drift.
- Enforce posted-only semantics explicitly in SQL #1.
- Add regression test: payment posted after as-of must not reduce historical outstanding.

## API: GET /api/v1/reports/pending-receivables

Route Entry:
`src/reports/reports.controller.ts` -> `getPendingReceivables()`

Controller:
`ReportsController.getPendingReceivables(@Query() PendingReceivablesQueryDto)`

Service:
`ReportsService.getPendingReceivables(query)`

Repository:
Two raw SQL queries:  
1) `ledger_entries` + `customers` for AR balances  
2) `transactions` + `allocations` for open sale documents

DTO/Schema:
`src/reports/dto/pending-receivables-query.dto.ts` (`asOfDate?`, `customerId?`, `minAmount?`)  
`ledger_entries`, `transactions`, `allocations`, `customers`

Execution Trace:
1. Middleware/guards enforce authenticated tenant context.
2. Query DTO validated by global validation pipe.
3. Service resolves tenant and `asOfDate`.
4. SQL #1 computes customer AR balances up to `asOfDate`; optional customer filter and `minAmount` threshold.
5. Early return for zero-result case.
6. SQL #2 fetches open posted SALE docs for customers from SQL #1 and computes outstanding from allocations.
7. Service groups documents by customer and computes `daysPastDue`.
8. Returns aggregate totals and customer detail.

Business Rules Observed:
- Tenant scoping in raw SQL.
- Threshold and customer filters supported.
- Open-document retrieval avoids N+1 query pattern.

Missing Rules:
- Critical: allocation sums are not restricted to allocations effective by `asOfDate`.
- SQL #1 does not explicitly enforce posted-only via transaction join.
- No explicit customer existence behavior for `customerId` filter.

Security Risks:
- No report-level role authorization.

Financial Risks:
- **As-of historical receivable can be wrong at document level** because future allocations are applied retroactively in SQL #2.
- Total receivable and document-level outstanding can diverge materially.
- Precision risk from bigint->number conversion.

Edge Case Failures:
- Customer may show positive balance with no open docs due to future payment allocations.
- Aging buckets become unreliable for backdated analysis.

Concurrency Risks:
- SQL #1 and SQL #2 are executed separately without consistent snapshot; concurrent postings can produce mixed-time output.

Test Coverage:
- Covered: positive-balance inclusion, `minAmount` filter, `customerId` filter, open-document outstanding/daysPastDue basic scenario.
- Missing: future-allocation as-of scenario (critical), tenant isolation test, invalid query validation tests, unauthorized `401`.

Verdict:
❌ Unsafe

Required Fixes:
- Bind allocation contribution to payment transaction date `<= asOfDate`.
- Add explicit posted-status enforcement in balance query.
- Add invariant test ensuring `sum(openDocuments.outstanding)` aligns with customer balance as-of.

## API: GET /api/v1/reports/products/{id}/stock

Route Entry:
`src/reports/reports.controller.ts` -> `getProductStock()`

Controller:
`ReportsController.getProductStock(@Param('id', ParseUUIDPipe), @Query() BalanceQueryDto)`

Service:
`ReportsService.getProductStock(id, query)`

Repository:
`PrismaService.product.findFirst()` + raw SQL over `inventory_movements`

DTO/Schema:
`BalanceQueryDto`  
`products`, `inventory_movements`

Execution Trace:
1. Middleware and guards enforce JWT + tenant context.
2. Controller validates product UUID and query DTO.
3. Service requires tenant id; defaults `asOfDate`.
4. Service verifies product exists under tenant.
5. Raw SQL aggregates movement quantities by movement type and purchase-cost totals.
6. Service computes `netStock`, `avgCost = round(totalPurchaseCost / totalPurchaseQty)`, `stockValue = netStock * avgCost`.
7. Returns stock snapshot and movement breakdown.

Business Rules Observed:
- Tenant-scoped product existence check.
- Point-in-time stock movement aggregation by movement type.
- Includes returns and adjustments in stock quantity.

Missing Rules:
- Costing formula ignores supplier-return valuation effects and non-purchase inflow valuation.
- No explicit posted-status enforcement via transaction join.
- No validation against negative stock readouts (if invariant drift exists).

Security Risks:
- No role-level protection for inventory valuation data.

Financial Risks:
- **Valuation risk**: `avgCost` derived only from purchase totals can materially misstate value after supplier returns and certain adjustment patterns.
- Precision/overflow risk from bigint->number and arithmetic done in JS number.

Edge Case Failures:
- If purchases are returned disproportionately (high-cost line returns), reported `avgCost` and `stockValue` can be substantially wrong.
- Stock can be non-zero with `avgCost=0` (e.g., adjustment-in only), yielding misleading valuation.

Concurrency Risks:
- Product lookup and aggregate query are separate statements; possible read skew during concurrent postings.

Test Coverage:
- Covered: as-of movement filtering, movement-type breakdown, stockValue formula consistency, unknown id `404`.
- Missing: supplier-return valuation edge case, cross-tenant access test for this endpoint, negative/zero-cost edge cases, unauthorized `401`.

Verdict:
❌ Unsafe

Required Fixes:
- Rework valuation: compute inventory value with cost-aware movement ledger, or derive from validated perpetual weighted-average state transitions.
- Add explicit posted-transaction constraint.
- Add targeted tests for supplier-return cost distortion and adjustment-only stock.

## API: GET /api/v1/reports/suppliers/{id}/balance

Route Entry:
`src/reports/reports.controller.ts` -> `getSupplierBalance()`

Controller:
`ReportsController.getSupplierBalance(@Param('id', ParseUUIDPipe), @Query() BalanceQueryDto)`

Service:
`ReportsService.getSupplierBalance(id, query)`

Repository:
`PrismaService.supplier.findFirst()` + raw SQL on `ledger_entries` joined `transactions`

DTO/Schema:
`BalanceQueryDto`  
`suppliers`, `ledger_entries`, `transactions`

Execution Trace:
1. Middleware/guards authenticate and attach tenant context.
2. Controller validates UUID + query DTO.
3. Service requires tenant and derives `asOfDate`.
4. Tenant-scoped supplier existence check (`findFirst`) else `404`.
5. SQL aggregates AP increases/decreases, splitting return-related decreases by transaction type.
6. Service computes payable/credit/settled classification.
7. Returns supplier balance and breakdown.

Business Rules Observed:
- Posted-only transactions enforced in SQL.
- Transaction-type split for AP decreases (payments vs supplier returns).
- Tenant scoping enforced in both lookup and aggregation.

Missing Rules:
- No role-level authorization.
- No safe-range handling for bigint conversions.
- UTC-based default date ignores tenant timezone.

Security Risks:
- Broad report access to any authenticated tenant user.

Financial Risks:
- Precision loss for large cumulative sums.
- Day-boundary drift due UTC default as-of date.

Edge Case Failures:
- Extremely large balances can silently lose integer precision.

Concurrency Risks:
- Lookup + aggregate not wrapped in consistent snapshot.

Test Coverage:
- Covered: zero baseline, as-of filtering, purchase/payment/return split, unknown id, tenant isolation `404`.
- Missing: invalid query format, unauthorized `401`, high-volume precision tests.

Verdict:
⚠ Risky

Required Fixes:
- Preserve bigint fidelity in response.
- Use tenant-timezone default date.
- Add RBAC and security tests for report endpoints.

## API: GET /api/v1/reports/suppliers/{id}/statement

Route Entry:
`src/reports/reports.controller.ts` -> `getSupplierStatement()`

Controller:
`ReportsController.getSupplierStatement(@Param('id', ParseUUIDPipe), @Query() StatementQueryDto)`

Service:
`ReportsService.getSupplierStatement(id, query)`

Repository:
`PrismaService.supplier.findFirst()` + two raw SQL queries over `ledger_entries` joined `transactions`

DTO/Schema:
`StatementQueryDto`  
`suppliers`, `ledger_entries`, `transactions`

Execution Trace:
1. Middleware + guards enforce auth and tenant scope.
2. Controller validates supplier UUID and statement query.
3. Service checks tenant context and supplier existence.
4. SQL #1 computes opening AP balance before `dateFrom`.
5. SQL #2 fetches in-range AP ledger lines, categorized as debit/credit.
6. `buildRunningBalance` computes running totals.
7. Service returns statement object.

Business Rules Observed:
- Posted-only entries enforced.
- Tenant filtering present everywhere.
- Running balance chronology ordered by transaction date + creation time.

Missing Rules:
- No `dateFrom <= dateTo` validation.
- No pagination controls for potentially long statements.

Security Risks:
- No RBAC on supplier statement access.

Financial Risks:
- Bigint-to-number precision risk in opening and line amounts.

Edge Case Failures:
- Inverted date range accepted without error.
- Large history periods may create oversized response payloads.

Concurrency Risks:
- Opening and in-range queries not snapshot-locked; concurrent postings can create temporal inconsistency.

Test Coverage:
- Covered: opening-balance correctness, running-balance correctness, empty-range behavior, unknown id.
- Missing: cross-tenant test for this endpoint, invalid range test, unauthorized `401`.

Verdict:
⚠ Risky

Required Fixes:
- Add date-order validator and pagination.
- Execute related reads in consistent snapshot transaction.
- Add auth/tenant/validation regression tests.
