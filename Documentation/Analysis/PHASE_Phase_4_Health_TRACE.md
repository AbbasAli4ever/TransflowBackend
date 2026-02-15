# PHASE TRACE REPORT

Title:
Phase 4 — Health

--------------------------------------------
## API: GET /api/v1/health
--------------------------------------------

Route Entry:
- Global prefix: `app.setGlobalPrefix(apiPrefix ?? 'api/v1')` in `src/main.ts`
- Controller route: `@Controller('health')` + `@Get()` + `@Public()` in `src/health/health.controller.ts`

Controller:
- `HealthController.getHealth()` in `src/health/health.controller.ts`

Service:
- None (business logic and DB probe are in controller)

Repository:
- None (direct Prisma call from controller)

DTO/Schema:
- Request DTO: none (no params/body/query)
- Response DTO (Swagger only): `HealthResponseDto` in `src/health/dto/health-response.dto.ts`
- Error DTO (Swagger only): `ApiErrorResponse` via `@ApiServiceUnavailableResponse`

Execution Trace:
1. HTTP request enters Express/Nest pipeline; `helmet`, global `rateLimit`, and JSON body parser (`1mb`) are configured in `src/main.ts`.
2. `RequestContextMiddleware` sets or propagates `x-request-id` and initializes AsyncLocalStorage context (`src/common/middleware/request-context.middleware.ts`).
3. `TenantContextMiddleware` optionally parses Bearer JWT and sets tenant/user context if token verifies; invalid tokens are ignored for this middleware (`src/common/middleware/tenant-context.middleware.ts`).
4. Global guards run: `JwtAuthGuard` and `TenantScopeGuard` both short-circuit because `@Public()` metadata is present (`src/common/guards/jwt-auth.guard.ts`, `src/common/guards/tenant-scope.guard.ts`).
5. `HealthController.getHealth()` executes `await prisma.$queryRaw\`SELECT 1\``.
6. Success path builds response with health payload (`status`, `info`, `details`) plus hardening fields (`uptime`, `version`, `database`, `timestamp`).
7. Failure path catches any thrown error and throws `ServiceUnavailableException(...)`.
8. Global `HttpExceptionFilter` formats thrown exceptions into standard envelope (`statusCode`, `message`, `timestamp`, etc.), overriding custom body shape for 503 responses (`src/common/filters/http-exception.filter.ts`).
9. Global `LoggingInterceptor` logs method/path/status/duration/requestId/tenantId.

Business Rules Observed:
- Endpoint is intentionally public.
- Performs live database liveness probe (`SELECT 1`) on every request.
- Returns process-memory and uptime metadata.
- No tenant-specific business data is returned.

Missing Rules:
- No explicit readiness/liveness split; one endpoint is used for both concerns.
- No threshold rule for memory pressure (always reports memory status as `ok` when handler succeeds).
- No documented/implemented cache semantics for health responses.

Security Risks:
- If deployment uses provided `.env.production` as-is (`NODE_ENV=development`), this endpoint runs in development mode context and may coexist with exposed Swagger UI (`src/main.ts` condition on `NODE_ENV !== 'production'`).
- Public endpoint still performs JWT verification attempt in middleware when `Authorization` is provided; malformed token flood increases CPU overhead.

Financial Risks:
- Every health request hits the primary DB pool. Under aggressive probing or external scraping, health traffic can contend with financial posting/reporting queries and degrade system availability.
- Global rate limiting may throttle legitimate orchestrator probes when many checks share one source IP, causing false-unhealthy status and restart loops that disrupt financial operations.

Edge Case Failures:
- On DB failure, returned 503 body does not match controller-crafted `{status,error,details}` object because global exception filter rewrites it to standardized error envelope.
- Catch block labels all failures as database timeout even when failure source is not DB timeout.
- If DB is down at startup, `PrismaService.onModuleInit()` can prevent app boot entirely; endpoint cannot return structured degraded status.

Concurrency Risks:
- No mutable shared state in handler itself.
- Indirect concurrency risk: N concurrent probes => N DB round-trips (`SELECT 1`) and potential connection pool pressure.

Test Coverage:
- `test/integration/health.integration.spec.ts` covers success payload shape, public access, and performance targets.
- `test/integration/hardening.integration.spec.ts` covers `uptime/version/database/timestamp` presence and response time.
- Missing tests: DB-down behavior (503 contract), exception-filter interaction, rate-limit interaction, malformed Authorization header behavior, high-concurrency probe impact.

Verdict:
⚠ Risky

Required Fixes:
- Move health logic into a dedicated service and define a single canonical 503 contract; align controller + filter + API docs to same shape.
- Add dedicated readiness endpoint (DB-aware) and lightweight liveness endpoint (no DB call).
- Protect DB from probe storms: cache probe result briefly (e.g., 1-5s) or enforce internal probe source controls.
- Add tests for DB-failure path and verify exact error response body under global exception filter.
- Correct deployment env templates so production/staging set `NODE_ENV` correctly.

--------------------------------------------
## API: GET /api/v1/version
--------------------------------------------

Route Entry:
- Global prefix: `app.setGlobalPrefix(apiPrefix ?? 'api/v1')` in `src/main.ts`
- Controller route: `@Controller()` + `@Get('version')` + `@Public()` in `src/health/version.controller.ts`

Controller:
- `VersionController.getVersion()` in `src/health/version.controller.ts`

Service:
- None (response built directly in controller)

Repository:
- None (no DB interaction)

DTO/Schema:
- Request DTO: none
- Response DTO (Swagger only): `VersionResponseDto` in `src/health/dto/version-response.dto.ts`

Execution Trace:
1. Request enters global middleware stack (helmet/rate-limit/body parser in `main.ts`, then request/tenant context middleware from `AppModule`).
2. `RequestContextMiddleware` sets request id; `TenantContextMiddleware` optionally verifies Bearer token and enriches context.
3. Global guards detect `@Public()` and bypass JWT and tenant enforcement.
4. `VersionController.getVersion()` returns object from config/process env:
   - `version` from `config.get('app.version') ?? '1.0.0'`
   - `environment` from `config.get('app.nodeEnv') ?? 'development'`
   - `nodeVersion` from `process.version`
   - `buildDate`, `gitCommit` from env vars
5. Response flows through interceptors unchanged (`TransformInterceptor` is pass-through), then request log is emitted.

Business Rules Observed:
- Endpoint is intentionally public and read-only.
- No financial state read/write.
- Intended to expose build/runtime metadata.

Missing Rules:
- No strict source-of-truth for app version; `app.version` is not defined in `app.config.ts`, so fallback is typically used.
- No validation of `BUILD_DATE`/`GIT_COMMIT` format.
- No explicit policy on metadata exposure per environment.

Security Risks:
- Discloses runtime metadata (`nodeVersion`, env, commit/build markers) to unauthenticated callers.
- If production env is mis-set to development, endpoint exposes misleading environment state and may indicate broader hardening drift.

Financial Risks:
- Direct financial integrity risk is low (read-only, no financial data).
- Indirect operational risk exists if exposed environment metadata helps targeted attacks that impact uptime.

Edge Case Failures:
- Endpoint can return stale/static `version` due fallback and missing config key.
- `buildDate`/`gitCommit` can be `null`, reducing release traceability during incident response.

Concurrency Risks:
- No shared mutable data access; negligible endpoint-level race risk.

Test Coverage:
- `test/integration/health.integration.spec.ts` validates basic keys and response time.
- Missing tests: unauthenticated-with-invalid-token behavior, metadata null/format assertions, production/staging environment correctness.

Verdict:
⚠ Risky

Required Fixes:
- Introduce explicit app version config source (env var or package version binding) and validate at startup.
- Define and enforce metadata exposure policy (e.g., omit commit/build fields for public internet deployments if required).
- Add integration tests covering environment correctness and optional-field behavior.
