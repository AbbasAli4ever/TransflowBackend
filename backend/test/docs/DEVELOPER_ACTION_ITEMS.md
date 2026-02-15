# DEVELOPER ACTION ITEMS - Test Fixes Required

**Status:** 27 tests failing, 37 tests passing (58%)  
**Goal:** Get to 100% passing tests + add missing test coverage

---

## 🔴 CRITICAL FIXES (Do These First)

### 1. Fix API Routing - 404 Errors (Blocks 21 tests)
**Files to check:**
- `src/app.module.ts`
- `src/main.ts`
- `src/auth/auth.module.ts`

**Problem:**
```
expected 201 "Created", got 404 "Not Found"
POST /api/v1/auth/register → 404
POST /api/v1/auth/login → 404
```

**What to investigate:**
- [ ] Is AuthController registered in AppModule?
- [ ] Is global prefix `api/v1` applied correctly?
- [ ] Does test bootstrap the app correctly?
- [ ] Are routes registered in test vs dev mode?

**Test files affected:**
- `test/integration/auth.integration.spec.ts` (21 tests)

---

### 2. Fix Test Factory Foreign Key Issues (Blocks 6+ tests)
**File to fix:**
- `test/helpers/test-factories.ts`

**Problem:**
```
Foreign key constraint violated: users_tenant_id_fkey
```

**What to fix:**
- [ ] Ensure `createTenantWithUser()` creates tenant FIRST
- [ ] Ensure tenant exists before creating users
- [ ] Add database constraint checks
- [ ] Fix execution order in test setup

**Test files affected:**
- `test/integration/tenant-isolation.spec.ts` (multiple tests)

---

### 3. Fix Database Cleanup
**File to check:**
- `test/helpers/test-database.ts`

**What to investigate:**
- [ ] Is `cleanDatabase()` executing?
- [ ] Are all tables being truncated?
- [ ] Is truncate cascade working?
- [ ] Are there permission issues?

**Test files affected:**
- All integration tests (test pollution)

---

## 🟡 MISSING TEST FILES (Create These)

### High Priority

#### 4. Create `test/unit/jwt.strategy.spec.ts`
**What to test:**
- [ ] Token validation
- [ ] Payload extraction
- [ ] User lookup from token
- [ ] Expired token handling
- [ ] Invalid signature detection
- [ ] Malformed token handling

**Estimated:** 10-15 tests

---

#### 5. Create `test/unit/prisma.service.spec.ts`
**What to test:**
- [ ] Database connection lifecycle
- [ ] OnModuleInit hook
- [ ] OnModuleDestroy hook
- [ ] Connection pooling
- [ ] Error handling
- [ ] Soft delete functionality

**Estimated:** 8-12 tests

---

#### 6. Create `test/unit/jwt-auth.guard.spec.ts`
**What to test:**
- [ ] Guard activation
- [ ] Token extraction from headers
- [ ] Public route bypass
- [ ] Protected route enforcement
- [ ] Invalid token rejection
- [ ] Missing token handling

**Estimated:** 6-10 tests

---

### Medium Priority

#### 7. Create `test/unit/http-exception.filter.spec.ts`
**What to test:**
- [ ] HTTP exception handling
- [ ] Custom error formatting
- [ ] Stack trace inclusion (dev vs prod)
- [ ] Error logging
- [ ] Status code mapping

**Estimated:** 5-8 tests

---

#### 8. Create `test/unit/request-context.spec.ts`
**What to test:**
- [ ] Context storage (AsyncLocalStorage)
- [ ] Tenant ID propagation
- [ ] User ID propagation
- [ ] Context cleanup
- [ ] Concurrent request isolation
- [ ] Memory leak prevention

**Estimated:** 8-12 tests

---

#### 9. Create `test/unit/env.validation.spec.ts`
**What to test:**
- [ ] Environment variable validation
- [ ] Required field checking
- [ ] Type validation
- [ ] Default values
- [ ] Invalid config detection

**Estimated:** 10-15 tests

---

## 📊 EXPAND EXISTING TESTS

### 10. Expand `test/unit/auth-service.spec.ts`
**Add these missing cases:**
- [ ] Token expiration validation
- [ ] Refresh token rotation
- [ ] Password hashing strength
- [ ] Email validation edge cases (unicode, special chars)
- [ ] Password validation edge cases
- [ ] Transaction rollback scenarios

**Estimated:** +10 tests

---

### 11. Expand `test/unit/tenant-scope-guard.spec.ts`
**Add these missing cases:**
- [ ] JWT token validation
- [ ] Token expiration handling
- [ ] Malformed token handling
- [ ] Token tampering detection
- [ ] Multiple tenant membership scenarios

**Estimated:** +5 tests

---

### 12. Expand `test/integration/auth.integration.spec.ts`
**Add these missing cases:**
- [ ] JWT token refresh flow
- [ ] Token revocation
- [ ] Logout functionality
- [ ] Rate limiting on login attempts
- [ ] Concurrent registration with same email
- [ ] SQL injection prevention

**Estimated:** +10 tests

---

### 13. Expand `test/integration/tenant-isolation.spec.ts`
**Add these missing cases:**
- [ ] Tenant deletion cascading
- [ ] Orphaned data prevention
- [ ] Cross-tenant query attempt detection
- [ ] Performance with 100+ tenants
- [ ] Tenant migration scenarios

**Estimated:** +8 tests

---

## 🔒 SECURITY TESTS (Add These)

### 14. Create `test/security/auth-attacks.spec.ts`
**What to test:**
- [ ] Brute force attack prevention
- [ ] Session hijacking prevention
- [ ] JWT token tampering
- [ ] Replay attack prevention
- [ ] SQL injection attempts
- [ ] XSS prevention

**Estimated:** 10-15 tests

---

### 15. Create `test/security/tenant-attacks.spec.ts`
**What to test:**
- [ ] Direct object reference attacks
- [ ] Tenant enumeration prevention
- [ ] Cross-tenant data access attempts
- [ ] Privilege escalation attempts

**Estimated:** 8-12 tests

---

## ⚡ PERFORMANCE TESTS (Add These)

### 16. Create `test/performance/load.spec.ts`
**What to test:**
- [ ] 100+ concurrent requests
- [ ] Database connection pool exhaustion
- [ ] Large dataset pagination
- [ ] Query performance benchmarks
- [ ] Memory usage under load

**Estimated:** 5-8 tests

---

## 📋 INFRASTRUCTURE IMPROVEMENTS

### 17. Add Code Coverage Thresholds
**File to update:** `jest.config.js`

```javascript
module.exports = {
  // ... existing config
  coverageThreshold: {
    global: {
      branches: 80,
      functions: 80,
      lines: 80,
      statements: 80
    }
  }
};
```

---

### 18. Add CI/CD Pipeline
**File to create:** `.github/workflows/test.yml`

**What to include:**
- [ ] Run tests on PR
- [ ] Run tests on push to main
- [ ] Upload coverage reports
- [ ] Fail on test failures
- [ ] Fail on coverage drop

---

## 📊 SUMMARY CHECKLIST

### Critical Path (Must Do)
- [ ] Fix 404 routing errors (Item 1)
- [ ] Fix foreign key violations (Item 2)
- [ ] Fix database cleanup (Item 3)
- [ ] Create jwt.strategy.spec.ts (Item 4)
- [ ] Create prisma.service.spec.ts (Item 5)
- [ ] Create jwt-auth.guard.spec.ts (Item 6)

### Important (Should Do)
- [ ] Create http-exception.filter.spec.ts (Item 7)
- [ ] Create request-context.spec.ts (Item 8)
- [ ] Expand auth-service.spec.ts (Item 10)
- [ ] Expand tenant-scope-guard.spec.ts (Item 11)

### Nice to Have (Could Do)
- [ ] Create env.validation.spec.ts (Item 9)
- [ ] Expand integration tests (Items 12-13)
- [ ] Add security tests (Items 14-15)
- [ ] Add performance tests (Item 16)
- [ ] Add coverage thresholds (Item 17)
- [ ] Add CI/CD pipeline (Item 18)

---

## 🎯 SUCCESS CRITERIA

**Minimum Acceptable:**
- ✅ 100% of existing tests passing (64/64)
- ✅ 80%+ code coverage
- ✅ Core services tested (Prisma, JWT, Guards)

**Ideal:**
- ✅ 100+ total tests
- ✅ 90%+ code coverage
- ✅ Security tests passing
- ✅ Performance benchmarks established
- ✅ CI/CD pipeline running

---

## 📞 HELP NEEDED?

**If stuck on routing issues (Item 1):**
- Check how NestJS bootstraps in test vs dev
- Look for global middleware/interceptor differences
- Compare working dev server vs test setup

**If stuck on database issues (Items 2-3):**
- Check database user permissions
- Verify CASCADE DELETE constraints
- Test cleanDatabase() in isolation

**If stuck on anything else:**
- Check the main test report: `QA_COMPREHENSIVE_TEST_REPORT.md`
- Review existing passing tests for patterns
- Ask QA engineer for clarification

---

**Current Status:** 37/64 passing (58%)  
**Target Status:** 100+/100+ passing (100%)  
**Estimated Effort:** 36-64 hours (4-8 days)

**Good luck! 🚀**
