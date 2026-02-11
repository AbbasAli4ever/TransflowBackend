# Test Suite Documentation

## Overview

This test suite provides comprehensive coverage for Phase 1 of the Finance System backend, focusing on:

1. **Unit Tests** - Individual component testing (services, guards, utilities)
2. **Integration Tests** - API endpoint testing with database
3. **Tenant Isolation Tests** - Critical security validation (MOST IMPORTANT)

## Test Structure

```
test/
├── helpers/                    # Test utilities and factories
│   ├── test-database.ts       # Database setup/teardown
│   ├── test-factories.ts      # Data factory functions
│   └── test-utils.ts          # Common test utilities
├── unit/                      # Unit tests (no database)
│   ├── auth-service.spec.ts
│   └── tenant-scope-guard.spec.ts
├── integration/               # Integration tests (with database)
│   ├── auth.integration.spec.ts
│   ├── health.integration.spec.ts
│   └── tenant-isolation.spec.ts  ⚠️ CRITICAL SECURITY TESTS
└── jest-e2e.json             # E2E test configuration
```

## Running Tests

### Prerequisites

1. **Test Database Setup**
   ```bash
   # Create test database
   createdb finance_test
   
   # Or using Docker
   docker run --name postgres-test -e POSTGRES_PASSWORD=postgres -p 5432:5432 -d postgres:15
   ```

2. **Environment Configuration**
   ```bash
   # Copy test environment file
   cp .env.test .env.test.local  # if you need custom settings
   
   # Ensure DATABASE_URL_TEST points to your test database
   ```

3. **Run Migrations**
   ```bash
   # Apply schema to test database
   DATABASE_URL=$DATABASE_URL_TEST npx prisma migrate deploy
   ```

### Test Commands

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run unit tests only
npm test -- test/unit

# Run integration tests only
npm test -- test/integration

# Run tenant isolation tests (critical!)
npm test -- test/integration/tenant-isolation.spec.ts

# Run specific test file
npm test -- test/integration/auth.integration.spec.ts

# Run with coverage
npm test -- --coverage

# Run in debug mode
node --inspect-brk node_modules/.bin/jest --runInBand
```

## Test Categories

### Unit Tests

**Purpose**: Test individual functions and classes in isolation

**Characteristics**:
- No database connection required
- Fast execution (< 50ms per test)
- Heavy use of mocks and stubs
- Test business logic and validation

**Example**:
```typescript
describe('AuthService (Unit)', () => {
  it('should hash password correctly', async () => {
    // Mock all dependencies
    // Test pure logic
  });
});
```

### Integration Tests

**Purpose**: Test API endpoints with real database

**Characteristics**:
- Real database connection
- Test HTTP requests/responses
- Verify database state changes
- Test validation and error handling

**Example**:
```typescript
describe('POST /api/v1/auth/register', () => {
  it('should create tenant and user', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send(validData)
      .expect(201);
    
    // Verify response AND database
  });
});
```

### Tenant Isolation Tests ⚠️ **CRITICAL**

**Purpose**: Verify multi-tenant security model

**Characteristics**:
- Tests the MOST IMPORTANT security feature
- Ensures no data leakage between tenants
- Verifies database constraints
- Validates tenant scoping

**Why Critical**:
- Single failure = SECURITY VULNERABILITY
- Protects customer data privacy
- Ensures regulatory compliance
- Foundation for all future features

**Example**:
```typescript
it('CRITICAL: should never return users from different tenant', async () => {
  // Create two tenants
  // Verify complete data isolation
  // No cross-tenant access possible
});
```

## Test Data Management

### Factories

Use factory functions from `test-factories.ts`:

```typescript
import { createTenantWithUser, createTestSupplier } from '../helpers/test-factories';

// Create tenant with owner
const { tenant, user } = await createTenantWithUser(prisma, {
  tenantName: 'Test Business',
  userName: 'John Doe',
});

// Create supplier
const supplier = await createTestSupplier(prisma, tenant.id, user.id);
```

### Database Cleanup

```typescript
import { cleanDatabase } from '../helpers/test-database';

beforeEach(async () => {
  await cleanDatabase(); // Clean slate for each test
});
```

## Writing New Tests

### Best Practices

1. **Arrange-Act-Assert Pattern**
   ```typescript
   it('should do something', async () => {
     // Arrange: Set up test data
     const user = await createTestUser();
     
     // Act: Perform action
     const result = await service.doSomething(user);
     
     // Assert: Verify outcome
     expect(result).toBe(expected);
   });
   ```

2. **Test One Thing Per Test**
   ```typescript
   // Good
   it('should reject invalid email', () => { ... });
   it('should reject weak password', () => { ... });
   
   // Bad
   it('should validate input', () => {
     // Tests email AND password AND name
   });
   ```

3. **Use Descriptive Names**
   ```typescript
   // Good
   it('should throw UnauthorizedException when password is incorrect', () => {});
   
   // Bad
   it('should fail', () => {});
   ```

4. **Test Edge Cases**
   ```typescript
   it('should handle null values');
   it('should handle empty strings');
   it('should handle very long inputs');
   it('should handle concurrent requests');
   ```

5. **Always Clean Up**
   ```typescript
   afterEach(async () => {
     await cleanDatabase();
   });
   
   afterAll(async () => {
     await disconnectDatabase();
     await app.close();
   });
   ```

## Coverage Goals

### Phase 1 Minimum Coverage

- **Unit Tests**: 80% code coverage
- **Integration Tests**: All API endpoints covered
- **Tenant Isolation**: 100% coverage (non-negotiable)

### Critical Paths (Must Have 100%)

1. Authentication (register, login)
2. Tenant scoping middleware
3. JWT validation
4. Tenant isolation queries
5. Error handling

## Continuous Integration

### Pre-commit Checks

```bash
# Run before committing
npm test
npm run test:coverage
```

### CI/CD Pipeline

```yaml
# .github/workflows/test.yml
test:
  runs-on: ubuntu-latest
  services:
    postgres:
      image: postgres:15
      env:
        POSTGRES_PASSWORD: postgres
      options: >-
        --health-cmd pg_isready
        --health-interval 10s
  steps:
    - run: npm test
    - run: npm run test:coverage
```

## Debugging Tests

### Debug Single Test

```bash
# VS Code: Add breakpoint, press F5

# Or use Node inspector
node --inspect-brk node_modules/.bin/jest --runInBand test/unit/auth-service.spec.ts
```

### Common Issues

1. **Database connection errors**
   - Check DATABASE_URL_TEST is set
   - Verify test database exists
   - Run migrations on test DB

2. **Tests fail randomly**
   - Ensure proper cleanup in `afterEach`
   - Check for race conditions
   - Use `--runInBand` to run serially

3. **Slow tests**
   - Check for missing database indexes
   - Reduce test data size
   - Mock external dependencies

## Performance Benchmarks

### Acceptable Ranges

- Unit tests: < 50ms per test
- Integration tests: < 500ms per test
- Full suite: < 30 seconds
- Tenant isolation tests: < 2 seconds total

### Monitoring

```bash
# Run with timing info
npm test -- --verbose

# Identify slow tests
npm test -- --detectOpenHandles
```

## Maintenance

### When to Update Tests

1. **Adding new endpoints** → Add integration tests
2. **Changing business logic** → Update unit tests
3. **Modifying auth** → Update auth tests + tenant isolation
4. **Schema changes** → Update factory functions
5. **New tenant-scoped models** → Add tenant isolation tests

### Test Debt

If you skip tests temporarily:

```typescript
it.skip('TODO: test concurrent stock updates', () => {
  // Tracked in: JIRA-123
});
```

## Security Testing Checklist

Before deploying Phase 1, verify:

- [ ] All tenant isolation tests pass
- [ ] No cross-tenant data access possible
- [ ] JWT validation works correctly
- [ ] Password hashing is strong (bcrypt cost >= 12)
- [ ] All sensitive data excluded from responses
- [ ] Rate limiting works
- [ ] CORS configured correctly
- [ ] No SQL injection vulnerabilities
- [ ] No XSS vulnerabilities
- [ ] Error messages don't leak sensitive info

## Help & Support

**Failed Tests?**
1. Read the error message carefully
2. Check test database state
3. Verify environment variables
4. Review recent code changes
5. Ask team for help with context

**Need New Test Utilities?**
- Add to `test-factories.ts` for data creation
- Add to `test-utils.ts` for common assertions
- Add to `test-database.ts` for DB operations
