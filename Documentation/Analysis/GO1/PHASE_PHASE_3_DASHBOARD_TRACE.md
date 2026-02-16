# PHASE TRACE REPORT

Title:
Phase 3 — Dashboard

--------------------------------------------
## API: GET /api/v1/dashboard/summary
--------------------------------------------

Route Entry:
- Global prefix `api/v1` is set in `src/main.ts`.
- Controller route is `@Controller('dashboard')` + `@Get('summary')` in `src/dashboard/dashboard.controller.ts`.
- Effective route is `GET /api/v1/dashboard/summary`.

Controller:
- File: `src/dashboard/dashboard.controller.ts`
- Method: `getSummary(@Query() query: DashboardQueryDto)`
- Forwards request directly to `DashboardService.getSummary(query)`.

Service:
- File: `src/dashboard/dashboard.service.ts`
- Method: `getSummary(query)`
- Reads tenant context, resolves `asOfDate`, computes overdue threshold, then executes 5 aggregate queries in parallel.

Repository:
- No dedicated repository layer.
- Direct raw SQL via `PrismaService.$queryRaw` in `DashboardService`.

DTO/Schema:
- DTO: `src/dashboard/dto/dashboard-query.dto.ts`
  - `asOfDate?: string`
  - `@IsOptional()` + `@IsDateString()`
- Validation: global `ValidationPipe` in `src/main.ts` (`whitelist`, `forbidNonWhitelisted`, transform enabled).
- Relevant schema: `prisma/schema.prisma`
  - `payment_accounts`, `payment_entries`, `inventory_movements`, `ledger_entries`, `transactions`, `allocations`.

Execution Trace:
1. Request enters middleware chain from `AppModule.configure`: `RequestContextMiddleware` then `TenantContextMiddleware` (`src/app.module.ts`).
2. `RequestContextMiddleware` initializes AsyncLocalStorage context and request ID (`src/common/middleware/request-context.middleware.ts`).
3. `TenantContextMiddleware` opportunistically decodes bearer JWT and sets context if token parses (`src/common/middleware/tenant-context.middleware.ts`).
4. Global guards execute: `JwtAuthGuard` authenticates non-public routes, then `TenantScopeGuard` enforces tenant context and writes tenant/user into AsyncLocalStorage (`src/common/guards/jwt-auth.guard.ts`, `src/common/guards/tenant-scope.guard.ts`).
5. Global validation pipe applies `DashboardQueryDto` and validates query params.
6. Controller invokes `dashboardService.getSummary(query)`.
7. Service calls `requireTenantId()` from request context; missing tenant throws `UnauthorizedException`.
8. Service sets `asOfDate = query.asOfDate ?? today()` and `overdueThreshold = subtractDays(asOfDate, 30)`.
9. Service runs in parallel:
   - `queryCash`: opening balance +/- payment entries (`direction IN/OUT`) filtered by tenant + `transaction_date <= asOfDate`.
   - `queryInventory`: stock movement aggregation for active products and computed stock value.
   - `queryReceivables`: AR balances from ledger entries + overdue customer detection from SALE docs and allocations.
   - `queryPayables`: AP balances from ledger entries + overdue supplier detection from PURCHASE docs and allocations.
   - `queryRecentActivity`: sums posted transaction totals on `transaction_date = asOfDate`.
10. Service converts bigint aggregates to JS `Number`, computes `cash.totalBalance`, and returns JSON payload.

Business Rules Observed:
- JWT + tenant scope are enforced globally for this route.
- All SQL queries include tenant filtering (`tenant_id = ...`) for isolation.
- `asOfDate` defaults to current date when omitted.
- Summary is derived from append-only truth tables (`payment_entries`, `inventory_movements`, `ledger_entries`) plus posted transactions.
- Overdue threshold is fixed to 30 days.
- Inventory section only counts products where `status = 'ACTIVE'`.

Missing Rules:
- Point-in-time overdue logic does not enforce point-in-time allocations: allocation sums are not filtered by allocation/payment date.
- Overdue open-document logic does not account for non-allocation AP/AR decreases (e.g., returns) when determining document outstanding.
- `asOfDate` format is documented as `YYYY-MM-DD`, but DTO accepts full ISO datetime strings that break date arithmetic helper.
- No requirement enforcement for tenant timezone when defaulting `asOfDate` (uses UTC date only).
- No explicit read-consistency rule (single snapshot) across 5 aggregate subqueries.

Security Risks:
- Any authenticated tenant user role can access full tenant-wide financial snapshot; no endpoint-level role restriction.
- Validation accepts datetime strings; malformed but validator-accepted format can trigger runtime error path (500), creating reliability/availability risk.
- Positive: raw SQL uses parameter binding (`$queryRaw` template literals), reducing SQL injection risk.

Financial Risks:
- **Critical point-in-time error**: overdue calculations in `queryReceivables/queryPayables` aggregate `allocations` without as-of filtering. Payments posted after `asOfDate` can reduce historical overdue incorrectly.
- **Aging classification drift**: overdue document detection uses `transactions.total_amount - allocations`, while true balances use ledger entries; returns/other AR/AP decreases can cause mismatch between overdue flags and real exposure.
- Bigint-to-`Number` conversion for monetary aggregates can lose precision at high volumes.
- Inventory avg-cost in SQL uses integer division semantics; possible truncation bias relative to rounded costing expectations.

Edge Case Failures:
- `asOfDate=2026-02-15T00:00:00.000Z` passes `@IsDateString()`, but `subtractDays()` appends `T00:00:00Z` again, producing invalid date and likely 500.
- Default `today()` uses UTC date, which can shift business date for Pakistan timezone tenants near day boundaries.
- Overdue amount/count semantics are customer/supplier-level and can overstate overdue exposure when only part of balance is actually aged.

Concurrency Risks:
- Five independent aggregate queries run via `Promise.all` outside a read transaction; concurrent postings can yield internally inconsistent sections in one response.
- No explicit repeatable-read/snapshot isolation for dashboard read path.

Test Coverage:
- Existing coverage (`test/integration/dashboard.integration.spec.ts`):
  - Empty tenant all zeros.
  - Cash balances per account.
  - Inventory value/product/low stock behavior.
  - Receivables and payables positive balances and basic overdue path.
  - Recent activity aggregation.
  - `asOfDate` filtering.
  - Tenant isolation.
- Missing coverage:
  - Unauthorized request (401) and invalid token behavior for dashboard route.
  - Invalid `asOfDate` format and datetime-string failure mode.
  - Point-in-time correctness where allocations/payments exist after `asOfDate`.
  - Overdue correctness with supplier/customer returns affecting AR/AP.
  - Cross-query consistency under concurrent posting.
  - Large-value precision/overflow behavior.

Verdict:
❌ Unsafe

Required Fixes:
- Rework overdue CTEs to be point-in-time correct:
  - Join allocations to payment transactions and include only payments with `payment_transaction.transaction_date <= asOfDate`.
- Align overdue outstanding computation with ledger truth (or explicitly model and apply returns/credits to document aging logic).
- Replace `@IsDateString()` with strict date-only validation (`YYYY-MM-DD`) and harden `subtractDays()` to reject invalid date values safely.
- Use tenant timezone when defaulting `asOfDate`.
- Execute all dashboard aggregates in one read transaction with consistent snapshot (repeatable read) or materialized point-in-time read model.
- Avoid unsafe bigint-to-number coercion for money totals (return strings or checked-safe integer conversion).
- Add adversarial integration tests for all missing scenarios above.
