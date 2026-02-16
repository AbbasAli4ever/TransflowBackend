# PHASE TRACE REPORT

Title:
Phase 3 — Dashboard

--------------------------------------------
## API: GET /api/v1/dashboard/summary
--------------------------------------------

Route Entry:
- `src/main.ts`: global prefix `api/v1`.
- `src/dashboard/dashboard.controller.ts`: `@Controller('dashboard')` + `@Get('summary')` => `GET /api/v1/dashboard/summary`.

Controller:
- `src/dashboard/dashboard.controller.ts`
- Method: `getSummary(@Query() query: DashboardQueryDto)`.
- No route-level guard annotation; route is protected by global guards in `AppModule`.

Service:
- `src/dashboard/dashboard.service.ts`
- Method: `getSummary(query)`.
- Reads tenant context, resolves `asOfDate`, computes `overdueThreshold`, executes 5 aggregate sub-queries in one `RepeatableRead` transaction, maps SQL rows to response DTO shape.

Repository:
- No separate repository class.
- Direct data access via `PrismaService` + `tx.$queryRaw` in:
- `queryCash`
- `queryInventory`
- `queryReceivables`
- `queryPayables`
- `queryRecentActivity`

DTO/Schema:
- Query DTO: `src/dashboard/dto/dashboard-query.dto.ts`
- Validation: `asOfDate` optional + regex `^\d{4}-\d{2}-\d{2}$`.
- DB schema references in `prisma/schema.prisma`:
- `tenants.timezone`
- `payment_accounts`, `payment_entries`
- `products`, `inventory_movements`
- `ledger_entries`, `allocations`, `transactions`

Execution Trace:
1. HTTP request hits global middleware chain (`RequestContextMiddleware`, `TenantContextMiddleware`) from `src/app.module.ts`.
2. `RequestContextMiddleware` sets `x-request-id` and initializes async local storage context.
3. `TenantContextMiddleware` attempts JWT verification and pre-populates tenant/user context if Bearer token is valid.
4. Global `JwtAuthGuard` validates JWT (`src/common/guards/jwt-auth.guard.ts` + `src/auth/strategies/jwt.strategy.ts`).
5. Global `TenantScopeGuard` requires `request.user.tenantId`, then writes tenant/user into request context.
6. Global `RolesGuard` allows access because route has no `@Roles(...)` constraint.
7. Global validation pipe validates query DTO (`src/common/pipes/validation.pipe.ts`).
8. Controller forwards validated query to `DashboardService.getSummary()`.
9. Service enforces tenant presence via `requireTenantId()` and resolves `asOfDate` from query or tenant business date (`getBusinessDate`).
10. Service computes overdue threshold (`asOfDate - 30 days`) and runs all five aggregate SQL queries in one `RepeatableRead` transaction.
11. Bigint money values are converted through `safeMoney()` and response object is assembled.
12. Response is returned directly (no response envelope transform); errors are normalized by `HttpExceptionFilter`.

Business Rules Observed:
- Tenant-scoped reads are enforced in every dashboard SQL query (`tenant_id = ...`).
- Dashboard is read-only and uses derived balances from entry/event tables (not stored balance snapshots).
- `asOfDate` supports point-in-time reads; default uses tenant timezone from `tenants.timezone`.
- Overdue threshold is fixed at 30 days.
- All five sections run inside one `RepeatableRead` snapshot to avoid cross-query temporal drift.
- Monetary bigint aggregates are guarded by `safeMoney` to prevent silent JS precision loss.

Missing Rules:
- No semantic calendar-date validation for `asOfDate` (format-only regex; invalid dates like `2026-02-31` are not rejected at DTO layer).
- No explicit rule for handling inactive/deleted users with still-valid JWTs on read endpoints.
- No explicit rule clarifying whether overdue is invoice-level or full party-level exposure once any overdue doc exists.

Security Risks:
- `JwtStrategy.validate()` returns token payload without checking current user/tenant status in DB (`src/auth/strategies/jwt.strategy.ts`). Disabled/deleted users with unexpired tokens can still access dashboard.
- No route-specific authorization test coverage for unauthenticated/invalid token requests in `test/integration/dashboard.integration.spec.ts`.

Financial Risks:
- Overdue amount/count are party-level, not document-level. If one invoice is overdue and another is current, entire party balance is treated overdue (`queryReceivables`/`queryPayables` join `overdue_*` then sum full balance). This can overstate aging exposure.
- `cash.totalBalance` is summed in JS after per-account conversion; aggregate overflow protection is not applied to the final sum.

Edge Case Failures:
- `asOfDate` invalid calendar values (example: `2026-02-31`) can pass DTO regex and fail later in SQL date casting, resulting in 500-class behavior instead of deterministic 400 validation error.
- If tenant timezone in DB is invalid IANA value, `Intl.DateTimeFormat` can throw at runtime and fail request.

Concurrency Risks:
- Read consistency risk is largely mitigated by single `RepeatableRead` transaction.
- Remaining risk: none critical in this endpoint’s current query orchestration.

Test Coverage:
- Existing integration coverage (`test/integration/dashboard.integration.spec.ts`) includes:
- Empty tenant snapshot.
- Cash/inventory/receivables/payables/recent activity calculations.
- Tenant isolation behavior.
- `asOfDate` format checks for datetime string and random invalid string.
- Future-dated payment temporal integrity regression for receivables overdue.
- Coverage gaps:
- No unauthorized/invalid-token test for this endpoint.
- No invalid calendar-date test (`YYYY-MM-DD` but impossible date).
- No precision overflow test path for `safeMoney` failure propagation at dashboard level.
- No mixed-aging scenario asserting document-level overdue semantics.

Verdict:
⚠ Risky

Required Fixes:
- Replace regex-only `asOfDate` validation with strict semantic date validator; reject impossible dates with 400.
- In JWT validation flow, load user and tenant state and reject inactive/deleted principals.
- Define and implement overdue semantics explicitly (document-level aging recommended); align SQL + tests to that contract.
- Add aggregate safe-range guard for computed JS totals (for example `cash.totalBalance`).
- Add integration tests for: 401 unauthorized/invalid token, impossible calendar dates, mixed overdue/current documents.

--------------------------------------------
