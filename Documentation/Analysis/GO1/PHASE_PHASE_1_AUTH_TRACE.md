# PHASE TRACE REPORT

Title:
Phase 1 — Auth

--------------------------------------------
## API: POST /api/v1/auth/register
--------------------------------------------

Route Entry:
- Global prefix: `api/v1` from `src/main.ts`
- Resolved route: `POST /api/v1/auth/register`

Controller:
- `src/auth/auth.controller.ts`
- `@Public()` endpoint calls `AuthService.register(dto)`

Service:
- `src/auth/auth.service.ts#register`

Repository:
- No dedicated repository layer
- Direct Prisma calls via `PrismaService`

DTO/Schema:
- Request DTO: `src/auth/dto/register.dto.ts`
- Validation pipe: `src/common/pipes/validation.pipe.ts`
- DB schema: `prisma/schema.prisma` (`Tenant`, `User`, `@@unique([email])`)

Execution Trace:
1. Request enters Nest app with global middleware chain (`RequestContextMiddleware`, `TenantContextMiddleware`) from `src/app.module.ts`.
2. `RequestContextMiddleware` sets/propagates `x-request-id` using async local storage.
3. `TenantContextMiddleware` optionally parses `Authorization` bearer token and sets context if valid; token failures are swallowed.
4. Global guards run in order: `JwtAuthGuard` then `TenantScopeGuard`.
5. Because endpoint is `@Public()`, both guards short-circuit and allow request without JWT/tenant.
6. Global `ValidationPipe` applies `RegisterDto` constraints with `whitelist`, `forbidNonWhitelisted`, transform enabled.
7. `AuthController.register()` forwards sanitized DTO to `AuthService.register()`.
8. Service performs `user.findFirst` with case-insensitive email condition.
9. If existing user found, throws `ConflictException('Email already exists')`.
10. Service hashes password with bcrypt (`saltRounds=12`).
11. Service opens Prisma transaction and creates `tenant`, then creates `user` linked to that tenant.
12. Service generates access + refresh JWTs and returns tokens + user summary.
13. Interceptors run; exceptions are normalized by `HttpExceptionFilter` if thrown.

Business Rules Observed:
- Email uniqueness is checked before creation.
- Email is normalized to lowercase in DTO and service.
- Tenant and owner user are created atomically in one DB transaction.
- New user role is fixed to `OWNER`.
- Password is stored as bcrypt hash (not plaintext).

Missing Rules:
- No explicit handling for DB unique constraint race (`P2002`) on concurrent same-email registrations.
- No explicit anti-automation rule (captcha/challenge) for open registration.
- No policy gate for tenant creation abuse (domain allowlist, invitation, or registration controls).

Security Risks:
- TOCTOU duplicate-email check: app-level pre-check + DB write can race; unhandled DB unique error likely returns 500 instead of controlled 409.
- Global rate limit is coarse (IP-wide). No per-email/per-account registration abuse controls.
- No explicit audit log event for new-tenant registration (security forensics gap).

Financial Risks:
- Weak registration abuse controls can allow mass tenant creation, increasing attack surface for later financial operations.
- If duplicate-email race returns 500 unpredictably, operational handling of identity onboarding is inconsistent.

Edge Case Failures:
- Concurrent requests for same email can produce internal error path instead of deterministic business error.
- If DB contains legacy mixed-case duplicate emails (outside API path), `findFirst` behavior can become ambiguous.

Concurrency Risks:
- High: registration race window between `findFirst` and `user.create`.
- Transaction ensures tenant/user atomicity, but does not eliminate conflict race with other transactions.

Test Coverage:
- Present: happy path, default tenant fields, duplicate email (normal + case-insensitive), DTO validation cases, basic atomicity checks in `test/integration/auth.integration.spec.ts`.
- Present: unit coverage for register logic in `test/unit/auth-service.spec.ts` and `src/auth/auth.service.spec.ts`.
- Missing: concurrent registration race test, explicit DB unique-constraint error mapping test, registration abuse/throttling tests.

Verdict:
⚠ Risky

Required Fixes:
- Catch Prisma `P2002` in `register()` and map to `ConflictException` with stable message.
- Enforce case-insensitive uniqueness at DB level (e.g., `citext` or unique index on `lower(email)`).
- Add concurrency integration test: parallel register requests on same email must yield one success, one 409.
- Add registration abuse controls (stricter endpoint limiter and/or challenge mechanism).

--------------------------------------------
## API: POST /api/v1/auth/login
--------------------------------------------

Route Entry:
- Global prefix: `api/v1` from `src/main.ts`
- Resolved route: `POST /api/v1/auth/login`

Controller:
- `src/auth/auth.controller.ts`
- `@Public()` endpoint calls `AuthService.login(dto)`

Service:
- `src/auth/auth.service.ts#login`

Repository:
- No dedicated repository layer
- Direct Prisma calls via `PrismaService`

DTO/Schema:
- Request DTO: `src/auth/dto/login.dto.ts`
- Validation pipe: `src/common/pipes/validation.pipe.ts`
- DB schema: `prisma/schema.prisma` (`User`, `Tenant`)

Execution Trace:
1. Request enters middleware chain (`RequestContextMiddleware`, `TenantContextMiddleware`).
2. Request ID is set and stored in async context.
3. Optional bearer token is parsed by tenant middleware; invalid token is ignored.
4. Global guards evaluate endpoint metadata; `@Public()` bypasses JWT + tenant guards.
5. Global validation transforms and validates `LoginDto` (`email` normalized to lowercase).
6. `AuthController.login()` forwards DTO to `AuthService.login()`.
7. Service performs `user.findFirst` by case-insensitive email and includes related `tenant`.
8. If no user: throws `UnauthorizedException('Invalid credentials')`.
9. If user status not ACTIVE: throws `ForbiddenException('Account inactive')`.
10. If tenant status not ACTIVE: throws `ForbiddenException('Tenant inactive')`.
11. Password is verified with bcrypt compare.
12. If invalid password: throws `UnauthorizedException('Invalid credentials')`.
13. On success, service updates `lastLoginAt` timestamp.
14. Service generates access + refresh tokens and returns token payload plus user/tenant summary.
15. Errors are normalized by `HttpExceptionFilter`; success response is passthrough.

Business Rules Observed:
- Authentication is email+password based.
- User and tenant must both be ACTIVE.
- Last successful login timestamp is persisted.
- Tokens include `userId`, `tenantId`, `email`, `role` claims.

Missing Rules:
- No account lockout/backoff after repeated failed logins.
- No MFA/step-up requirement for sensitive financial tenancy.
- No refresh-token persistence/rotation/revocation tracking in DB.

Security Risks:
- User enumeration: different errors for invalid credentials vs inactive account/tenant reveal account existence/state.
- Brute-force resistance is weak: only generic global rate-limit middleware, no credential stuffing protections per principal.
- Refresh tokens are stateless and not revocable server-side in current auth flow.

Financial Risks:
- Compromised credentials enable direct access to tenant financial endpoints; lack of lockout/MFA increases probability of account takeover.
- Account enumeration can accelerate targeted attacks against known financial operators.

Edge Case Failures:
- `LoginDto.password` is not trimmed; whitespace-only strings pass DTO non-empty check and reach bcrypt compare.
- `lastLoginAt` update occurs before token return; if token generation fails, login side-effect still occurs.

Concurrency Risks:
- Repeated concurrent login attempts update `lastLoginAt` non-deterministically (latest writer wins) but not integrity-critical.
- No session concurrency controls (no token jti/session table), so parallel stolen-token usage cannot be centrally revoked.

Test Coverage:
- Present: valid login, invalid email/password, case-insensitive email login, inactive user, inactive tenant, `lastLoginAt` update in `test/integration/auth.integration.spec.ts`.
- Present: service-level unit tests for login branches and token generation in `test/unit/auth-service.spec.ts`.
- Missing: enumeration-safe error behavior tests, lockout/backoff tests, refresh-token revocation/rotation tests, stress/concurrency auth tests.

Verdict:
⚠ Risky

Required Fixes:
- Normalize external error response for auth failures (avoid exposing inactive status to unauthenticated clients).
- Add per-account/IP adaptive throttling and lockout/backoff controls.
- Introduce refresh-token store with rotation + revocation semantics.
- Add tests for brute-force protection, enumeration resistance, and token lifecycle controls.
