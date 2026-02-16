# PHASE TRACE REPORT

Title:
Phase 1 — Auth

--------------------------------------------
## API: POST /api/v1/auth/register
--------------------------------------------

Route Entry:
- `src/main.ts`: global prefix `api/v1`, JSON body limit `1mb`, Helmet, global rate limit.
- `src/app.module.ts`: `RequestContextMiddleware` and `TenantContextMiddleware` run for all routes; global guards are registered.
- `src/common/guards/jwt-auth.guard.ts` + `src/common/guards/tenant-scope.guard.ts`: bypassed because endpoint is `@Public()`.
Controller:
- `src/auth/auth.controller.ts` → `register(@Body() dto: RegisterDto)`.
Service:
- `src/auth/auth.service.ts` → `register(dto)`.
Repository:
- Direct Prisma access (no repository abstraction): `tx.tenant.create`, `tx.user.create`, `refreshToken.create`.
DTO/Schema:
- DTO: `src/auth/dto/register.dto.ts`.
- Tables: `tenants`, `users`, `refresh_tokens` (`prisma/schema.prisma`).

Execution Trace:
1. Request enters Express/Nest pipeline; request context is initialized and request id header is set.
2. Validation pipe applies `RegisterDto` rules (`tenantName`, `fullName`, `email`, `password`) with `whitelist` + `forbidNonWhitelisted`.
3. Controller forwards DTO to `AuthService.register`.
4. Service hashes password with bcrypt (12 rounds).
5. Service runs Prisma transaction callback: create tenant first, create owner user second with normalized email and role `OWNER`.
6. Unique constraint conflict (`P2002`) is mapped to HTTP 409 `Email already exists`.
7. After DB transaction commits, service generates JWT access/refresh tokens, hashes refresh token with SHA-256, stores token record, returns tokens + user summary.

Business Rules Observed:
- Owner user is created atomically with new tenant in one DB transaction.
- New user role is forced to `OWNER`.
- Email is normalized to lowercase before persistence.
- Password policy requires strong password via `IsStrongPassword`.
- Duplicate email is blocked by unique DB constraint.

Missing Rules:
- No idempotency-key enforcement for registration despite API spec saying all write endpoints require it.
- No anti-automation controls specific to registration (captcha/challenge/risk scoring).
- No explicit transactional guarantee that token persistence succeeds together with tenant/user creation.
- No max password length bound.

Security Risks:
- Email enumeration: API returns explicit `Email already exists` on registration conflict.
- DTO `@Transform(({ value }) => value?.trim())` pattern can throw on non-string payloads (`trim` not a function), risking 500 instead of clean 400.
- Coarse global rate limit is present, but no endpoint/account-aware registration abuse controls.

Financial Risks:
- Registration abuse can create high volume of tenants/users, increasing attack surface on financial data.
- Enumeration can help targeted credential attacks against known emails in a finance system.

Edge Case Failures:
- Non-string `tenantName`/`fullName`/`email` can crash transform path.
- If refresh-token persistence fails after tenant/user commit, request fails but account remains created (partial post-commit failure path).

Concurrency Risks:
- Same-email concurrent registration is mostly safe due DB unique constraint + transaction rollback semantics.
- No explicit stress-tested handling for high-concurrency signup bursts.

Test Coverage:
- Integration: strong happy/error coverage for register (`test/integration/auth.integration.spec.ts`, register block).
- Unit: register duplicate + trimming + success paths covered in both `src/auth/auth.service.spec.ts` and `test/unit/auth-service.spec.ts`.
- Missing tests: malformed non-string transform behavior, refresh-token persistence failure after successful user creation, registration concurrency flood tests, idempotency behavior.

Verdict:
⚠ Risky

Required Fixes:
- Harden DTO transforms to type-safe form, e.g. guard with `typeof value === 'string'` before trimming.
- Return generic registration failure messaging (or delayed verification flow) to reduce email enumeration.
- Make register fully atomic with token persistence (single transaction or compensating cleanup on post-commit failure).
- Add registration abuse controls (per-IP + per-email throttling/challenge).
- Align implementation/contracts on idempotency expectations for write endpoints.

--------------------------------------------
## API: POST /api/v1/auth/login
--------------------------------------------

Route Entry:
- `src/main.ts`: global prefix, JSON limit, Helmet, global rate limit.
- `src/app.module.ts`: request/tenant middleware + global guards/interceptors/filter registered.
- `src/common/guards/jwt-auth.guard.ts` + `src/common/guards/tenant-scope.guard.ts`: bypassed due `@Public()`.
Controller:
- `src/auth/auth.controller.ts` → `login(@Body() dto: LoginDto)`.
Service:
- `src/auth/auth.service.ts` → `login(dto)`.
Repository:
- Direct Prisma access: `user.findFirst(include tenant)`, `$transaction([user.update, refreshToken.create])`.
DTO/Schema:
- DTO: `src/auth/dto/login.dto.ts`.
- Tables: `users`, `tenants`, `refresh_tokens`.

Execution Trace:
1. Request enters middleware chain; request context and optional tenant context are prepared.
2. Validation pipe applies `LoginDto` rules (`email`, `password`) and strips/blocks unknown fields.
3. Controller calls `AuthService.login`.
4. Service fetches user by case-insensitive email (`findFirst`, includes tenant).
5. Service rejects if user missing, user inactive, or tenant inactive (all mapped to generic 401 message).
6. Service compares password using bcrypt.
7. Service generates access + refresh tokens.
8. Service stores side effects in Prisma transaction array: update `lastLoginAt`, insert hashed refresh token row.
9. Service returns tokens + user profile + tenant summary.

Business Rules Observed:
- Authentication failure returns generic message (`Authentication failed`) to reduce direct user enumeration.
- Both user and tenant must be `ACTIVE`.
- Email lookup is case-insensitive.
- Successful login updates `lastLoginAt` and creates a refresh token record.

Missing Rules:
- No account lockout/backoff after repeated failed logins.
- No MFA or step-up authentication path for financial operations.
- No explicit cap/rotation policy on active refresh tokens per user/session.
- No guarantee at DB level of case-insensitive email uniqueness while login query is case-insensitive.

Security Risks:
- DTO transform for email uses `value?.trim().toLowerCase()` and can throw on non-string values.
- Potential ambiguous authentication target if mixed-case duplicate emails ever exist (DB unique is case-sensitive, login is case-insensitive + `findFirst`).
- No endpoint-specific brute-force mitigation beyond global rate limit.
- Debug logging includes attempted email/user identifiers on auth failures.

Financial Risks:
- Credential compromise yields direct tenant-level access to accounting data and operations.
- Lack of stronger anti-bruteforce controls increases risk of unauthorized access in a finance backend.

Edge Case Failures:
- Non-string email payload can produce transform exception path.
- Whitespace-only password passes `IsNotEmpty()` and reaches bcrypt compare.
- Repeated successful logins can grow refresh token table without lifecycle control.

Concurrency Risks:
- Concurrent logins for same user are allowed and create multiple active refresh tokens; no session concurrency guard.
- `lastLoginAt` is last-write-wins under concurrency (acceptable but not audit-precise to request granularity).

Test Coverage:
- Integration: login success, invalid credentials, case-insensitive email, inactive user, inactive tenant, and `lastLoginAt` update covered.
- Unit: success/failure/status checks and token generation covered in both auth service unit suites.
- Missing tests: brute-force/rate-limit efficacy for login, malformed non-string transform behavior, concurrent login/session explosion behavior, case-insensitive duplicate-email ambiguity scenario.

Verdict:
⚠ Risky

Required Fixes:
- Replace unsafe DTO transforms with type-checked sanitizers.
- Enforce case-insensitive uniqueness for user email at DB level (`lower(email)` unique index or CITEXT).
- Add login hardening: per-account throttling, lockout/backoff, optional MFA hooks.
- Introduce refresh-token lifecycle policy (max active tokens per user/device + cleanup/rotation strategy).
- Reduce sensitive debug logging on auth failures in production profiles.

--------------------------------------------
