# COMPREHENSIVE BACKEND IMPLEMENTATION PLAN
## Finance System - Detailed Phase-by-Phase Roadmap

**Document Version:** 1.0
**Created:** 2026-02-02
**Status:** Planning Phase
**Methodology:** Iterative phase-based delivery with strict validation gates

---

## TABLE OF CONTENTS

1. [Overview & Ground Rules](#overview--ground-rules)
2. [Phase Workflow Template](#phase-workflow-template)
3. [Phase 1: Backend Foundation & Production Skeleton](#phase-1-backend-foundation--production-skeleton)
4. [Phase 2: Schema V1 + Constraints + Indexes](#phase-2-schema-v1--constraints--indexes)
5. [Phase 3: Master Data APIs](#phase-3-master-data-apis)
6. [Phase 4: Posting Engine Core](#phase-4-posting-engine-core)
7. [Phase 5: Standalone Payments + Allocations](#phase-5-standalone-payments--allocations)
8. [Phase 6: Returns + Adjustments + Internal Transfer](#phase-6-returns--adjustments--internal-transfer)
9. [Phase 7: Canonical Queries + Dashboards + Import + Hardening](#phase-7-canonical-queries--dashboards--import--hardening)
10. [Cross-Phase Concerns](#cross-phase-concerns)
11. [Validation Gates & Acceptance Criteria](#validation-gates--acceptance-criteria)

---

## OVERVIEW & GROUND RULES

### System Invariants (Non-Negotiable)

These rules are **ABSOLUTE** and must be enforced at every layer:

#### 1. Truth Model (Accounting Engine)
- **Event → Entries Only**: Every business action creates a Transaction (event) and posts entries (inventory/ledger/payment). No other code path can change balances.
- **Append-Only Entries**: `ledger_entries`, `payment_entries`, and `inventory_movements` are append-only. Posted entries are NEVER edited in-place.
- **Balances are Derived**: Supplier/Customer/Payment balances are computed from entries (snapshots/caches allowed only if fully rebuildable).
- **Atomic Posting**: Posting runs inside a single DB transaction — all entries created or none.
- **Idempotency**: All write endpoints are idempotent using an idempotency key per tenant.

#### 2. Transaction Lifecycle
- **Explicit States**: Draft → Posted → (Voided in V1.1)
- **No Hard Deletes for Posted**: Drafts can be deleted, Posted cannot be deleted
- **Stable Document Numbering**: Every posted transaction has an immutable `document_number`, unique per tenant+type+series

#### 3. Inventory Integrity
- **Inventory Changes Only Via Movements**: No direct stock manipulation
- **No Negative Stock (Default)**: System blocks any posting that would create negative stock unless explicitly enabled
- **Concurrency-Safe Stock Posting**: Must use row locks or optimistic versioning
- **Cost Basis Captured at Receipt**: Stock-in lines store cost details at time of purchase

#### 4. Payment Accounts
- **Payment Methods are Real Accounts**: Cash, JazzCash, Bank have balances derived from `payment_entries`
- **No Floating Money**: Every payment must identify the account used
- **Internal Transfer is Always Two-Leg**: from_account (negative) + to_account (positive)

#### 5. Settlement Allocation
- **Payments Must Be Allocatable**: Every supplier/customer payment can be allocated to open documents
- **Unapplied Amounts Become Credit**: Customer credit or supplier credit
- **Allocation is Explicit**: Via `allocations` join table
- **Manual Allocation (V1)**: User selects which documents to settle

#### 6. Referential Integrity
- **No Orphans Ever**: Every entry references the transaction event
- **Returns Must Reference Origin**: Customer/supplier returns reference original sale/purchase line
- **Mandatory Audit Trail**: created_by, created_at, source, notes

#### 7. Currency & Money Storage
- **Single Currency (V1)**: All transactions use tenant's base currency (PKR)
- **Money Stored as Integers**: Integer rupees (no floats)
- **Rounding Rules Defined**: For discounts, prorated returns, allocation remainders

#### 8. Tenant Isolation
- **Tenant Scoping**: Every record has `tenant_id`, enforced at query-level
- **Zero Cross-Tenant Leakage**: Middleware must enforce tenant context

### Critical Edge Cases to Handle

Throughout all phases, explicitly handle:

1. **Concurrency Conflicts**
   - Two users posting sales for same product simultaneously
   - Stock check must be atomic and serializable
   - Use database row-level locks or optimistic locking with version numbers

2. **Partial Operations**
   - Network timeout during posting
   - Server crash mid-transaction
   - Use database transactions + idempotency keys

3. **Data Validation Boundaries**
   - Positive amounts/quantities at DB level (CHECK constraints)
   - Logical validations at application level
   - User input sanitization at API gateway

4. **Return Constraints**
   - Cannot return more than originally purchased/sold
   - Must track cumulative returns per original line
   - Maintain referential integrity via source_transaction_line_id

5. **Allocation Constraints**
   - Total allocated to payment ≤ payment amount
   - Total allocated to document ≤ document total
   - Handle rounding errors (extra rupee placement)

6. **Number Gaps**
   - Document numbers may have gaps (deleted drafts, failed posts)
   - Gaps are acceptable, duplicates are NOT

7. **Timezone Handling**
   - Store all timestamps in UTC
   - Convert to tenant timezone for display only
   - transaction_date is business date (date type)
   - posted_at is system timestamp (timestamptz)

---

## PHASE WORKFLOW TEMPLATE

**For EVERY phase, produce these artifacts:**

### 1. Phase Plan Document
- Scope definition (what's included, what's explicitly excluded)
- Endpoints list with request/response contracts
- Database changes (migrations needed)
- Invariants to enforce
- Acceptance criteria
- Edge cases to handle

### 2. Implementation Checklist
- [ ] Schema migrations written
- [ ] Service layer implementation
- [ ] API endpoints with validation
- [ ] Error handling
- [ ] Logging/observability
- [ ] Unit tests written
- [ ] Integration tests written
- [ ] Invariant tests written

### 3. Documentation Updates
- [ ] Notion PRD updated
- [ ] Schema documentation updated
- [ ] Posting patterns documented
- [ ] Canonical queries verified
- [ ] API docs generated

### 4. Test Execution Report
- [ ] All unit tests passing
- [ ] All integration tests passing
- [ ] All invariant tests passing
- [ ] Performance benchmarks met
- [ ] Concurrency tests passing

### 5. Deployment Checklist
- [ ] Environment variables configured
- [ ] Database migrations applied (staging)
- [ ] Health checks passing
- [ ] Smoke tests passing
- [ ] Rollback plan prepared

### Gate Criteria
- **If all criteria met** → Proceed to next phase
- **If any criteria failed** → Fix issues and repeat validation

---

## PHASE 1: BACKEND FOUNDATION & PRODUCTION SKELETON

### Objective
Create a production-ready backend skeleton that can run in production before adding business logic. Prove that infrastructure, auth, and tenant scoping work correctly.

### Scope

#### Included in Phase 1
1. NestJS application structure with proper module organization
2. Prisma ORM setup with PostgreSQL connection
3. Authentication system (email + password)
4. Tenant scoping middleware
5. Global error handling
6. Request validation pipeline
7. Structured logging
8. Health check endpoints
9. API security baseline
10. Environment configuration management
11. Database connection pooling
12. CORS configuration
13. Rate limiting

#### Explicitly Excluded from Phase 1
- Any business transaction logic
- Master data beyond basic user/tenant setup
- Payment processing
- Inventory tracking
- Any posting logic

### Detailed Requirements

#### 1.1 Project Structure

```
backend/
├── src/
│   ├── main.ts                          # Application entry point
│   ├── app.module.ts                    # Root module
│   ├── config/                          # Configuration management
│   │   ├── config.module.ts
│   │   ├── database.config.ts
│   │   ├── auth.config.ts
│   │   └── app.config.ts
│   ├── common/                          # Shared utilities
│   │   ├── decorators/                  # Custom decorators
│   │   │   ├── tenant.decorator.ts      # @Tenant() decorator
│   │   │   └── public.decorator.ts      # @Public() decorator
│   │   ├── filters/                     # Exception filters
│   │   │   └── http-exception.filter.ts
│   │   ├── guards/                      # Auth guards
│   │   │   ├── jwt-auth.guard.ts
│   │   │   └── tenant-scope.guard.ts
│   │   ├── interceptors/                # Request/response interceptors
│   │   │   ├── logging.interceptor.ts
│   │   │   └── transform.interceptor.ts
│   │   ├── middleware/                  # Custom middleware
│   │   │   └── tenant-context.middleware.ts
│   │   └── pipes/                       # Validation pipes
│   │       └── validation.pipe.ts
│   ├── auth/                            # Authentication module
│   │   ├── auth.module.ts
│   │   ├── auth.controller.ts
│   │   ├── auth.service.ts
│   │   ├── strategies/
│   │   │   └── jwt.strategy.ts
│   │   └── dto/
│   │       ├── register.dto.ts
│   │       └── login.dto.ts
│   ├── health/                          # Health check module
│   │   ├── health.module.ts
│   │   └── health.controller.ts
│   └── prisma/                          # Prisma service
│       ├── prisma.module.ts
│       └── prisma.service.ts
├── prisma/
│   ├── schema.prisma                    # Prisma schema
│   └── migrations/                      # Migration files
├── test/                                # Test files
│   ├── unit/
│   ├── integration/
│   └── e2e/
├── .env.example                         # Environment template
├── .env.development                     # Dev environment
├── .env.staging                         # Staging environment
├── .env.production                      # Production environment
├── package.json
├── tsconfig.json
└── nest-cli.json
```

#### 1.2 Environment Configuration

**Required Environment Variables:**

```bash
# Database
DATABASE_URL="postgresql://user:password@host:5432/dbname"
DATABASE_POOL_MIN=2
DATABASE_POOL_MAX=10

# Application
NODE_ENV=development|staging|production
PORT=3000
API_PREFIX=api/v1

# JWT Authentication
JWT_SECRET=<strong-secret-minimum-32-characters>
JWT_EXPIRATION=24h
JWT_REFRESH_SECRET=<different-strong-secret>
JWT_REFRESH_EXPIRATION=7d

# CORS
CORS_ORIGIN=http://localhost:3000,https://yourdomain.com

# Rate Limiting
RATE_LIMIT_WINDOW_MS=900000  # 15 minutes
RATE_LIMIT_MAX_REQUESTS=100

# Logging
LOG_LEVEL=debug|info|warn|error
LOG_FORMAT=json|pretty

# Timezone
DEFAULT_TIMEZONE=Asia/Karachi
```

**Configuration Validation:**
- All required env vars must be validated at startup
- Fail fast if any required variable is missing
- Use class-validator for config DTOs

#### 1.3 Database Setup (Minimal Schema for Phase 1)

**Tables Created in Phase 1:**

```prisma
// prisma/schema.prisma

generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model Tenant {
  id            String   @id @default(uuid()) @db.Uuid
  name          String
  baseCurrency  String   @default("PKR") @map("base_currency")
  timezone      String   @default("Asia/Karachi")
  status        String   @default("ACTIVE")
  createdAt     DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt     DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  users User[]

  @@map("tenants")
}

model User {
  id           String    @id @default(uuid()) @db.Uuid
  tenantId     String    @map("tenant_id") @db.Uuid
  fullName     String    @map("full_name")
  email        String
  passwordHash String    @map("password_hash")
  role         String    @default("OWNER")
  status       String    @default("ACTIVE")
  lastLoginAt  DateTime? @map("last_login_at") @db.Timestamptz(6)
  createdAt    DateTime  @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt    DateTime  @updatedAt @map("updated_at") @db.Timestamptz(6)

  tenant Tenant @relation(fields: [tenantId], references: [id], onDelete: Restrict)

  @@unique([tenantId, email])
  @@index([tenantId])
  @@map("users")
}
```

**Migration Checklist:**
- [ ] Create initial migration: `npx prisma migrate dev --name init`
- [ ] Test migration on clean database
- [ ] Test rollback capability
- [ ] Document migration in migration.md

#### 1.4 Authentication System

**POST /api/v1/auth/register**

Request:
```json
{
  "tenantName": "My Business",
  "fullName": "John Doe",
  "email": "john@example.com",
  "password": "SecurePass123!"
}
```

**Validations:**
- tenantName: required, min 2 chars, max 100 chars
- fullName: required, min 2 chars, max 100 chars
- email: required, valid email format, lowercase
- password: required, min 8 chars, must contain uppercase, lowercase, number

**Edge Cases:**
- Email already exists: Return 409 Conflict
- Weak password: Return 400 with specific error
- Database connection failure: Return 503 Service Unavailable

**Process:**
1. Validate input DTO
2. Check if email exists (case-insensitive)
3. Hash password using bcrypt (cost factor: 12)
4. Create tenant record within transaction
5. Create user record within same transaction
6. Commit transaction
7. Generate JWT tokens (access + refresh)
8. Return tokens + user info (exclude password)

**Response (Success 201):**
```json
{
  "accessToken": "eyJhbGc...",
  "refreshToken": "eyJhbGc...",
  "user": {
    "id": "uuid",
    "tenantId": "uuid",
    "fullName": "John Doe",
    "email": "john@example.com",
    "role": "OWNER"
  }
}
```

**Error Responses:**
- 400: Validation error (with field-specific messages)
- 409: Email already exists
- 500: Internal server error
- 503: Database unavailable

---

**POST /api/v1/auth/login**

Request:
```json
{
  "email": "john@example.com",
  "password": "SecurePass123!"
}
```

**Validations:**
- email: required, valid email format
- password: required

**Edge Cases:**
- User not found: Return 401 (don't reveal if email exists)
- Wrong password: Return 401 (same message as user not found)
- Account inactive: Return 403 Forbidden
- Too many failed attempts: Implement rate limiting

**Process:**
1. Validate input
2. Find user by email (case-insensitive)
3. If not found: Return 401
4. Compare password hash
5. If mismatch: Return 401
6. Check user status (must be ACTIVE)
7. Check tenant status (must be ACTIVE)
8. Update lastLoginAt
9. Generate JWT tokens
10. Return tokens + user info

**Response (Success 200):**
```json
{
  "accessToken": "eyJhbGc...",
  "refreshToken": "eyJhbGc...",
  "user": {
    "id": "uuid",
    "tenantId": "uuid",
    "fullName": "John Doe",
    "email": "john@example.com",
    "role": "OWNER",
    "tenant": {
      "id": "uuid",
      "name": "My Business",
      "baseCurrency": "PKR",
      "timezone": "Asia/Karachi"
    }
  }
}
```

#### 1.5 Tenant Scoping Middleware

**Purpose:** Every authenticated request must have tenant context

**Implementation Requirements:**

1. **JWT Payload Must Include:**
   ```typescript
   {
     userId: string;
     tenantId: string;
     email: string;
     role: string;
     iat: number;
     exp: number;
   }
   ```

2. **Middleware Execution Order:**
   - CORS middleware
   - Logging middleware
   - JWT authentication guard
   - Tenant context middleware (extracts tenantId from JWT)
   - Route handlers

3. **Tenant Context Storage:**
   - Use AsyncLocalStorage or cls-hooked
   - Store: { tenantId, userId, userEmail, userRole }
   - Accessible throughout request lifecycle

4. **Prisma Query Extension:**
   ```typescript
   // Extend Prisma client to auto-inject tenantId
   prisma.$use(async (params, next) => {
     const tenantId = getTenantContext();

     if (params.model && shouldScopeTenant(params.model)) {
       if (params.action === 'findMany' || params.action === 'findFirst') {
         params.args.where = { ...params.args.where, tenantId };
       }
       if (params.action === 'create') {
         params.args.data = { ...params.args.data, tenantId };
       }
       // ... other actions
     }

     return next(params);
   });
   ```

5. **Tenant Isolation Tests:**
   - Create 2 tenants with test data
   - Attempt to query Tenant A's data using Tenant B's token
   - Verify: Returns 0 results (not 403, just empty)
   - Verify: Attempt to update Tenant A's data with Tenant B's token fails

#### 1.6 Global Error Handling

**Error Classification:**

1. **Client Errors (4xx)**
   - 400 Bad Request: Validation failures
   - 401 Unauthorized: Missing or invalid token
   - 403 Forbidden: Valid token but insufficient permissions
   - 404 Not Found: Resource doesn't exist
   - 409 Conflict: Duplicate key, constraint violation
   - 422 Unprocessable Entity: Business logic validation failure

2. **Server Errors (5xx)**
   - 500 Internal Server Error: Uncaught exceptions
   - 503 Service Unavailable: Database connection failure

**Error Response Format:**

```json
{
  "statusCode": 400,
  "message": "Validation failed",
  "errors": [
    {
      "field": "email",
      "message": "Email must be a valid email address"
    },
    {
      "field": "password",
      "message": "Password must be at least 8 characters"
    }
  ],
  "timestamp": "2026-02-02T10:30:00.000Z",
  "path": "/api/v1/auth/register",
  "requestId": "uuid"
}
```

**Implementation:**
- Custom HttpException filter
- Log all 5xx errors with full stack trace
- Log 4xx errors at info level (no stack trace)
- Sanitize error messages in production (no DB details)
- Include requestId for tracing

#### 1.7 Request Validation Pipeline

**Validation Strategy:**

1. **DTO Validation (class-validator)**
   ```typescript
   export class RegisterDto {
     @IsNotEmpty()
     @Length(2, 100)
     tenantName: string;

     @IsNotEmpty()
     @Length(2, 100)
     fullName: string;

     @IsEmail()
     @Transform(({ value }) => value.toLowerCase())
     email: string;

     @IsStrongPassword({
       minLength: 8,
       minLowercase: 1,
       minUppercase: 1,
       minNumbers: 1,
     })
     password: string;
   }
   ```

2. **Global Validation Pipe:**
   ```typescript
   app.useGlobalPipes(
     new ValidationPipe({
       whitelist: true,          // Strip unknown properties
       forbidNonWhitelisted: true, // Throw if unknown properties
       transform: true,          // Auto-transform to DTO class
       transformOptions: {
         enableImplicitConversion: true,
       },
     })
   );
   ```

3. **Custom Validators:**
   - @IsTenantCurrency() - Validates currency is PKR
   - @IsPositiveAmount() - Validates amount > 0
   - @IsValidDate() - Validates date format and range

#### 1.8 Structured Logging

**Logging Requirements:**

1. **Log Format (JSON in production):**
   ```json
   {
     "timestamp": "2026-02-02T10:30:00.000Z",
     "level": "info",
     "message": "User logged in",
     "context": "AuthService",
     "tenantId": "uuid",
     "userId": "uuid",
     "requestId": "uuid",
     "method": "POST",
     "path": "/api/v1/auth/login",
     "duration": 120,
     "statusCode": 200
   }
   ```

2. **What to Log:**
   - All API requests (method, path, duration, status)
   - Authentication events (login, logout, token refresh)
   - Database queries (in development only)
   - Business events (transaction posted, payment received)
   - Errors with full context
   - Performance metrics (slow queries > 1s)

3. **What NOT to Log:**
   - Passwords (even hashed)
   - Full JWT tokens
   - Sensitive customer data (unless encrypted)
   - Raw SQL with potential PII

4. **Log Levels:**
   - error: Errors requiring attention
   - warn: Unusual but handled situations
   - info: Important business events
   - debug: Detailed debugging info (dev only)

#### 1.9 Health Check Endpoints

**GET /health**

Response (Success 200):
```json
{
  "status": "ok",
  "info": {
    "database": {
      "status": "up",
      "responseTime": "5ms"
    },
    "memory": {
      "status": "ok",
      "heapUsed": "120MB",
      "heapTotal": "256MB"
    }
  },
  "error": {},
  "details": {
    "database": {
      "status": "up",
      "responseTime": "5ms"
    },
    "memory": {
      "status": "ok",
      "heapUsed": "120MB",
      "heapTotal": "256MB"
    }
  }
}
```

Response (Error 503):
```json
{
  "status": "error",
  "info": {},
  "error": {
    "database": {
      "status": "down",
      "message": "Connection timeout"
    }
  },
  "details": {
    "database": {
      "status": "down",
      "message": "Connection timeout"
    }
  }
}
```

**GET /version**

Response:
```json
{
  "version": "1.0.0",
  "environment": "production",
  "nodeVersion": "20.x.x",
  "buildDate": "2026-02-02T10:00:00.000Z",
  "gitCommit": "abc123"
}
```

#### 1.10 API Security Baseline

**Security Measures:**

1. **Helmet.js Integration**
   - Content Security Policy
   - X-Frame-Options: DENY
   - X-Content-Type-Options: nosniff
   - Strict-Transport-Security (HTTPS only in production)

2. **CORS Configuration**
   ```typescript
   app.enableCors({
     origin: process.env.CORS_ORIGIN.split(','),
     credentials: true,
     methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
     allowedHeaders: ['Content-Type', 'Authorization'],
   });
   ```

3. **Rate Limiting**
   - Global: 100 requests per 15 minutes per IP
   - Auth endpoints: 5 requests per 15 minutes per IP
   - Use Redis for distributed rate limiting (production)

4. **Input Sanitization**
   - Trim all string inputs
   - Prevent SQL injection (Prisma handles this)
   - Prevent XSS (sanitize HTML if accepting any)

5. **Password Security**
   - Bcrypt hash with cost factor 12
   - Never log passwords
   - Enforce strong password policy
   - Implement password reset flow (Phase 2)

### Deliverables - Phase 1

#### Code Artifacts
- [ ] NestJS project initialized with proper structure
- [ ] Prisma schema with Tenant and User models
- [ ] Initial migration created and tested
- [ ] Auth module (register, login) implemented
- [ ] JWT strategy configured
- [ ] Tenant scoping middleware implemented
- [ ] Global error filter implemented
- [ ] Logging interceptor implemented
- [ ] Health check endpoints implemented
- [ ] Environment configuration validated

#### Documentation
- [ ] API documentation (Swagger/OpenAPI)
- [ ] Environment setup guide
- [ ] Local development instructions
- [ ] Migration guide
- [ ] Security baseline documented

#### Tests - Phase 1

**Unit Tests:**
```typescript
describe('AuthService', () => {
  it('should hash password correctly', async () => {
    const password = 'Test123!';
    const hash = await authService.hashPassword(password);
    expect(hash).not.toBe(password);
    expect(await bcrypt.compare(password, hash)).toBe(true);
  });

  it('should validate strong password', () => {
    expect(isStrongPassword('Test123!')).toBe(true);
    expect(isStrongPassword('weak')).toBe(false);
  });

  it('should generate valid JWT', () => {
    const payload = { userId: 'uuid', tenantId: 'uuid' };
    const token = authService.generateAccessToken(payload);
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    expect(decoded.userId).toBe(payload.userId);
  });
});
```

**Integration Tests:**
```typescript
describe('POST /auth/register', () => {
  it('should create tenant and user', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({
        tenantName: 'Test Business',
        fullName: 'Test User',
        email: 'test@example.com',
        password: 'Test123!',
      })
      .expect(201);

    expect(response.body).toHaveProperty('accessToken');
    expect(response.body.user.email).toBe('test@example.com');

    // Verify in database
    const user = await prisma.user.findUnique({
      where: { id: response.body.user.id },
      include: { tenant: true },
    });
    expect(user).toBeDefined();
    expect(user.tenant.name).toBe('Test Business');
  });

  it('should reject duplicate email', async () => {
    // Create first user
    await createTestUser('test@example.com');

    // Attempt duplicate
    await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({
        tenantName: 'Test Business 2',
        fullName: 'Test User 2',
        email: 'test@example.com',
        password: 'Test123!',
      })
      .expect(409);
  });
});
```

**Invariant Tests (Tenant Isolation):**
```typescript
describe('Tenant Isolation', () => {
  it('should prevent cross-tenant data access', async () => {
    // Create two tenants with users
    const tenant1 = await createTestTenant('Tenant 1');
    const tenant2 = await createTestTenant('Tenant 2');

    const user1 = await createTestUser('user1@t1.com', tenant1.id);
    const user2 = await createTestUser('user2@t2.com', tenant2.id);

    // Login as user1
    const { accessToken: token1 } = await loginUser(user1.email);

    // Create data for tenant1 (once we have other endpoints in later phases)
    // For Phase 1, just verify user query isolation

    // Login as user2
    const { accessToken: token2 } = await loginUser(user2.email);

    // Verify user2 cannot see user1's tenant data
    // This will be expanded in later phases
  });
});
```

### Acceptance Criteria - Phase 1

**Must Pass:**
- [ ] Application starts without errors
- [ ] Health check returns 200 OK
- [ ] Database connection successful
- [ ] Can register new user + tenant
- [ ] Can login with valid credentials
- [ ] Cannot login with invalid credentials
- [ ] JWT tokens generated correctly
- [ ] JWT tokens validated correctly
- [ ] Tenant context extracted from JWT
- [ ] All requests have tenantId in context
- [ ] Global error handler catches all exceptions
- [ ] Validation pipe rejects invalid DTOs
- [ ] Logging outputs structured JSON (production)
- [ ] All unit tests passing
- [ ] All integration tests passing
- [ ] No security vulnerabilities (npm audit)
- [ ] Environment variables validated at startup

**Performance Benchmarks:**
- [ ] Health check responds in < 100ms
- [ ] Login responds in < 500ms (includes password hash comparison)
- [ ] Register responds in < 1000ms (includes password hashing)

---

## PHASE 2: SCHEMA V1 + CONSTRAINTS + INDEXES

### Objective
Implement the complete database schema with all integrity constraints, indexes, and validation rules. This phase is about building the data foundation that enforces business rules at the database level.

### Scope

#### Included in Phase 2
1. All 14 tables from data model specification
2. All foreign key constraints
3. All uniqueness constraints
4. All check constraints
5. All indexes for performance
6. Seed scripts for development
7. Migration testing and rollback procedures
8. Database-level type enums
9. Constraint validation tests

#### Explicitly Excluded from Phase 2
- API endpoints for business transactions
- Business logic services
- Posting engine implementation
- User interface

### Detailed Schema Implementation

#### 2.1 Complete Prisma Schema

Create comprehensive schema with all models:

```prisma
// This is a detailed specification, NOT the actual code
// Each model must include:
// - All fields with correct types
// - All relationships with proper onDelete behavior
// - All unique constraints
// - All indexes
// - Proper naming with @map annotations

model Tenant {
  // Fields as specified in Notion Step 2.8
  // Relations to all child tables
}

model User {
  // Fields as specified
  // Relation to Tenant with onDelete: Restrict
  // Unique constraint on (tenantId, email)
  // Index on tenantId
}

model Supplier {
  // Fields as specified
  // status: ACTIVE, INACTIVE
  // Index on (tenantId, name)
}

model Customer {
  // Similar to Supplier
}

model Product {
  // Fields including avgCost (cached weighted average)
  // Unique constraint on (tenantId, sku) where sku IS NOT NULL
  // Index on (tenantId, name)
}

model PaymentAccount {
  // Types: CASH, BANK, WALLET, CARD
  // Unique constraint on (tenantId, name)
  // openingBalance field for migration support
}

model Transaction {
  // Complex model with multiple optional fields
  // Different fields required for different types
  // Unique constraints on document_number and idempotency_key
  // CHECK constraints to be enforced at application level:
  //   - paid_now >= 0
  //   - subtotal >= 0
  //   - total_amount >= 0
  //   - from_payment_account_id != to_payment_account_id (for transfers)
}

model TransactionLine {
  // Links to Transaction and Product
  // source_transaction_line_id for returns
  // CHECK constraints:
  //   - quantity > 0
  //   - unit_price >= 0
  //   - unit_cost >= 0
  //   - line_total >= 0
}

model InventoryMovement {
  // Links to Transaction, TransactionLine, Product
  // movement_type enum
  // CHECK constraint: quantity > 0
  // Index on (tenantId, productId, transactionDate)
}

model LedgerEntry {
  // Links to Transaction
  // Optional links to Supplier OR Customer (not both)
  // entry_type enum: AP_INCREASE, AP_DECREASE, AR_INCREASE, AR_DECREASE
  // CHECK constraint: amount > 0
  // CHECK constraint: entry_type matches party type
  // Indexes on (tenantId, supplierId, transactionDate)
  // Indexes on (tenantId, customerId, transactionDate)
}

model PaymentEntry {
  // Links to Transaction and PaymentAccount
  // Optional links to Supplier OR Customer
  // entry_type: MONEY_IN, MONEY_OUT, TRANSFER
  // direction: IN, OUT
  // transfer_group_id for linking transfer pairs
  // CHECK constraint: amount > 0
  // Index on (tenantId, paymentAccountId, transactionDate)
  // Index on (tenantId, transferGroupId)
}

model Allocation {
  // Links payment transaction to document transaction
  // amount_applied must be > 0
  // Indexes on both foreign keys
}

model ImportBatch {
  // For Excel migration functionality
  // status: PROCESSING, COMPLETED, FAILED
  // Tracks success/failure counts
}

model ImportRow {
  // Individual rows from import batches
  // Stores raw_data_json
  // Links to created records
}
```

#### 2.2 Constraint Implementation Strategy

**Level 1: Database Constraints (Enforce Now)**
- NOT NULL constraints
- Foreign keys with appropriate onDelete behavior
- Unique constraints
- CHECK constraints for simple validations:
  - Money amounts >= 0
  - Quantities > 0
  - from != to for transfers

**Level 2: Application Constraints (Implement in Services)**
- Transaction type-specific field requirements
- Return quantity validation (cannot exceed original)
- Allocation sum validation
- Stock availability checks
- Document number uniqueness per series

**Level 3: Triggers (Optional, V1.1)**
- Prevent updates to posted transactions
- Auto-update timestamps
- Audit trail triggers

#### 2.3 Index Strategy

**Query Pattern Analysis:**

Based on canonical queries (Notion 2.7), create indexes for:

1. **Supplier Balance Query**
   ```sql
   -- Query: SELECT SUM(amount) FROM ledger_entries
   -- WHERE tenant_id = ? AND supplier_id = ? AND entry_type IN (...)

   CREATE INDEX idx_ledger_entries_supplier
   ON ledger_entries(tenant_id, supplier_id, transaction_date);
   ```

2. **Customer Balance Query**
   ```sql
   CREATE INDEX idx_ledger_entries_customer
   ON ledger_entries(tenant_id, customer_id, transaction_date);
   ```

3. **Payment Account Balance Query**
   ```sql
   CREATE INDEX idx_payment_entries_account
   ON payment_entries(tenant_id, payment_account_id, transaction_date);
   ```

4. **Product Stock Query**
   ```sql
   CREATE INDEX idx_inventory_movements_product
   ON inventory_movements(tenant_id, product_id, transaction_date);
   ```

5. **Transaction Lookups**
   ```sql
   CREATE INDEX idx_transactions_tenant_date
   ON transactions(tenant_id, transaction_date DESC);

   CREATE INDEX idx_transactions_tenant_type_status
   ON transactions(tenant_id, type, status);

   CREATE INDEX idx_transactions_document_number
   ON transactions(tenant_id, type, series, document_number)
   WHERE document_number IS NOT NULL;
   ```

6. **Allocation Queries**
   ```sql
   CREATE INDEX idx_allocations_payment
   ON allocations(tenant_id, payment_transaction_id);

   CREATE INDEX idx_allocations_document
   ON allocations(tenant_id, applies_to_transaction_id);
   ```

#### 2.4 Enum Types

Define enums in Prisma for type safety:

```prisma
enum TransactionType {
  PURCHASE
  SALE
  SUPPLIER_PAYMENT
  CUSTOMER_PAYMENT
  SUPPLIER_RETURN
  CUSTOMER_RETURN
  INTERNAL_TRANSFER
  // ADJUSTMENT - Exclude from V1, add in V1.1
}

enum TransactionStatus {
  DRAFT
  POSTED
  // VOIDED - Exclude from V1, add in V1.1
}

enum MovementType {
  PURCHASE_IN
  SALE_OUT
  SUPPLIER_RETURN_OUT
  CUSTOMER_RETURN_IN
  ADJUSTMENT_IN
  ADJUSTMENT_OUT
}

enum LedgerEntryType {
  AP_INCREASE
  AP_DECREASE
  AR_INCREASE
  AR_DECREASE
}

enum PaymentEntryType {
  MONEY_IN
  MONEY_OUT
  TRANSFER
}

enum PaymentDirection {
  IN
  OUT
}

enum PaymentAccountType {
  CASH
  BANK
  WALLET
  CARD
}

enum DeliveryType {
  STORE_PICKUP
  HOME_DELIVERY
}
```

#### 2.5 Migration Execution Plan

**Migration Steps:**

1. **Create Migration**
   ```bash
   npx prisma migrate dev --name add_complete_schema
   ```

2. **Review Generated SQL**
   - Verify all tables created
   - Verify all constraints added
   - Verify all indexes created
   - Check for any performance issues

3. **Test on Clean Database**
   ```bash
   # Drop database
   dropdb finance_system_test
   # Create database
   createdb finance_system_test
   # Run migrations
   npx prisma migrate deploy
   # Verify schema
   npx prisma db pull
   ```

4. **Test Rollback**
   - Document how to rollback this migration
   - Test rollback on test database
   - Verify data integrity after rollback/re-apply

#### 2.6 Seed Script for Development

Create comprehensive seed data:

```typescript
// prisma/seed.ts

async function seed() {
  // 1. Create test tenant
  const tenant = await prisma.tenant.create({
    data: {
      name: 'Test Wholesale Business',
      baseCurrency: 'PKR',
      timezone: 'Asia/Karachi',
    },
  });

  // 2. Create test user
  const user = await prisma.user.create({
    data: {
      tenantId: tenant.id,
      fullName: 'Test Owner',
      email: 'owner@test.com',
      passwordHash: await bcrypt.hash('Test123!', 12),
      role: 'OWNER',
    },
  });

  // 3. Create suppliers
  const suppliers = await Promise.all([
    prisma.supplier.create({
      data: {
        tenantId: tenant.id,
        name: 'ABC Textiles',
        phone: '+92-300-1234567',
        address: 'Karachi, Pakistan',
        createdBy: user.id,
      },
    }),
    prisma.supplier.create({
      data: {
        tenantId: tenant.id,
        name: 'XYZ Fabrics',
        phone: '+92-300-7654321',
        address: 'Lahore, Pakistan',
        createdBy: user.id,
      },
    }),
  ]);

  // 4. Create customers
  const customers = await Promise.all([
    prisma.customer.create({
      data: {
        tenantId: tenant.id,
        name: 'Retail Shop A',
        phone: '+92-321-1111111',
        address: 'Shop 1, Main Road',
        createdBy: user.id,
      },
    }),
    prisma.customer.create({
      data: {
        tenantId: tenant.id,
        name: 'Retail Shop B',
        phone: '+92-321-2222222',
        address: 'Shop 2, Market Street',
        createdBy: user.id,
      },
    }),
  ]);

  // 5. Create products
  const products = await Promise.all([
    prisma.product.create({
      data: {
        tenantId: tenant.id,
        name: 'Men Suit - Black',
        sku: 'SUIT-BLK-001',
        category: 'Suits',
        unit: 'piece',
        avgCost: 0, // Will be updated on first purchase
        createdBy: user.id,
      },
    }),
    prisma.product.create({
      data: {
        tenantId: tenant.id,
        name: 'Men Suit - Navy',
        sku: 'SUIT-NAV-001',
        category: 'Suits',
        unit: 'piece',
        avgCost: 0,
        createdBy: user.id,
      },
    }),
    prisma.product.create({
      data: {
        tenantId: tenant.id,
        name: 'Shirt - White',
        sku: 'SHRT-WHT-001',
        category: 'Shirts',
        unit: 'piece',
        avgCost: 0,
        createdBy: user.id,
      },
    }),
  ]);

  // 6. Create payment accounts
  const paymentAccounts = await Promise.all([
    prisma.paymentAccount.create({
      data: {
        tenantId: tenant.id,
        name: 'Cash',
        type: 'CASH',
        openingBalance: 0,
        createdBy: user.id,
      },
    }),
    prisma.paymentAccount.create({
      data: {
        tenantId: tenant.id,
        name: 'HBL Bank',
        type: 'BANK',
        openingBalance: 0,
        createdBy: user.id,
      },
    }),
    prisma.paymentAccount.create({
      data: {
        tenantId: tenant.id,
        name: 'JazzCash',
        type: 'WALLET',
        openingBalance: 0,
        createdBy: user.id,
      },
    }),
  ]);

  console.log('Seed completed successfully');
  console.log({ tenant, user, suppliers, customers, products, paymentAccounts });
}
```

#### 2.7 Constraint Validation Tests

**Database Constraint Tests:**

```typescript
describe('Database Constraints', () => {
  describe('Tenant Isolation', () => {
    it('should enforce tenantId on all tables', async () => {
      const tenant1 = await createTestTenant('Tenant 1');
      const tenant2 = await createTestTenant('Tenant 2');

      const supplier1 = await prisma.supplier.create({
        data: {
          tenantId: tenant1.id,
          name: 'Supplier 1',
        },
      });

      // Query with wrong tenant should return nothing
      const result = await prisma.supplier.findMany({
        where: {
          tenantId: tenant2.id,
          id: supplier1.id,
        },
      });

      expect(result).toHaveLength(0);
    });
  });

  describe('Foreign Key Constraints', () => {
    it('should prevent orphan transaction_lines', async () => {
      await expect(
        prisma.transactionLine.create({
          data: {
            tenantId: 'invalid-tenant-id',
            transactionId: 'invalid-transaction-id',
            productId: 'invalid-product-id',
            quantity: 1,
            unitPrice: 100,
          },
        })
      ).rejects.toThrow(/foreign key constraint/i);
    });

    it('should cascade delete transaction_lines when transaction is deleted', async () => {
      const transaction = await createTestTransaction();
      const line = await createTestTransactionLine(transaction.id);

      await prisma.transaction.delete({
        where: { id: transaction.id },
      });

      const lineExists = await prisma.transactionLine.findUnique({
        where: { id: line.id },
      });

      expect(lineExists).toBeNull();
    });
  });

  describe('Unique Constraints', () => {
    it('should enforce unique document numbers per tenant+type+series', async () => {
      const tenant = await createTestTenant();

      await prisma.transaction.create({
        data: {
          tenantId: tenant.id,
          type: 'PURCHASE',
          status: 'POSTED',
          series: '2026',
          documentNumber: 'PUR-2026-0001',
          transactionDate: new Date(),
          totalAmount: 1000,
        },
      });

      // Attempt duplicate
      await expect(
        prisma.transaction.create({
          data: {
            tenantId: tenant.id,
            type: 'PURCHASE',
            status: 'POSTED',
            series: '2026',
            documentNumber: 'PUR-2026-0001', // Duplicate
            transactionDate: new Date(),
            totalAmount: 2000,
          },
        })
      ).rejects.toThrow(/unique constraint/i);
    });

    it('should enforce unique SKU per tenant', async () => {
      const tenant = await createTestTenant();

      await prisma.product.create({
        data: {
          tenantId: tenant.id,
          name: 'Product 1',
          sku: 'SKU-001',
        },
      });

      await expect(
        prisma.product.create({
          data: {
            tenantId: tenant.id,
            name: 'Product 2',
            sku: 'SKU-001', // Duplicate
          },
        })
      ).rejects.toThrow(/unique constraint/i);
    });

    it('should allow same SKU across different tenants', async () => {
      const tenant1 = await createTestTenant('Tenant 1');
      const tenant2 = await createTestTenant('Tenant 2');

      await prisma.product.create({
        data: {
          tenantId: tenant1.id,
          name: 'Product 1',
          sku: 'SKU-001',
        },
      });

      // Should succeed
      await prisma.product.create({
        data: {
          tenantId: tenant2.id,
          name: 'Product 2',
          sku: 'SKU-001', // Same SKU, different tenant
        },
      });
    });

    it('should enforce unique email per tenant', async () => {
      const tenant = await createTestTenant();

      await prisma.user.create({
        data: {
          tenantId: tenant.id,
          fullName: 'User 1',
          email: 'user@example.com',
          passwordHash: 'hash',
        },
      });

      await expect(
        prisma.user.create({
          data: {
            tenantId: tenant.id,
            fullName: 'User 2',
            email: 'user@example.com', // Duplicate
            passwordHash: 'hash',
          },
        })
      ).rejects.toThrow(/unique constraint/i);
    });
  });

  describe('Check Constraints (Application Level)', () => {
    it('should reject negative quantities', async () => {
      // This will be enforced at application level via DTO validation
      // Database CHECK constraint is optional

      const dto = new CreateTransactionLineDto();
      dto.quantity = -1;
      dto.unitPrice = 100;

      const errors = await validate(dto);
      expect(errors).toContainEqual(
        expect.objectContaining({
          property: 'quantity',
          constraints: expect.objectContaining({
            min: expect.any(String),
          }),
        })
      );
    });

    it('should reject negative amounts', async () => {
      const dto = new CreateTransactionDto();
      dto.totalAmount = -1000;

      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
    });

    it('should enforce from != to for transfers', async () => {
      const account = await createTestPaymentAccount();

      await expect(
        createTransaction({
          type: 'INTERNAL_TRANSFER',
          fromPaymentAccountId: account.id,
          toPaymentAccountId: account.id, // Same account
          totalAmount: 1000,
        })
      ).rejects.toThrow(/same account/i);
    });
  });

  describe('Index Performance', () => {
    it('should use index for supplier balance query', async () => {
      // Create test data
      const tenant = await createTestTenant();
      const supplier = await createTestSupplier(tenant.id);

      // Insert 10000 ledger entries
      await insertManyLedgerEntries(tenant.id, supplier.id, 10000);

      // Run query with EXPLAIN ANALYZE
      const startTime = Date.now();
      const balance = await calculateSupplierBalance(tenant.id, supplier.id);
      const duration = Date.now() - startTime;

      // Should complete in < 100ms even with 10k rows
      expect(duration).toBeLessThan(100);

      // Verify query plan uses index
      const queryPlan = await prisma.$queryRaw`
        EXPLAIN SELECT SUM(amount) FROM ledger_entries
        WHERE tenant_id = ${tenant.id} AND supplier_id = ${supplier.id}
      `;

      expect(queryPlan).toContain('Index Scan');
    });
  });
});
```

### Deliverables - Phase 2

#### Code Artifacts
- [ ] Complete Prisma schema with all 14 models
- [ ] All enums defined
- [ ] All relationships configured
- [ ] All constraints implemented
- [ ] All indexes created
- [ ] Migration files generated
- [ ] Seed script completed
- [ ] Schema documentation updated

#### Documentation
- [ ] Entity Relationship Diagram (ERD) generated
- [ ] Data dictionary updated
- [ ] Constraint documentation
- [ ] Index strategy document
- [ ] Migration rollback procedures

#### Tests
- [ ] All constraint tests passing
- [ ] Foreign key tests passing
- [ ] Unique constraint tests passing
- [ ] Index performance tests passing
- [ ] Seed script runs successfully
- [ ] Migration applies cleanly on fresh database
- [ ] Rollback works correctly

### Acceptance Criteria - Phase 2

**Must Pass:**
- [ ] All 14 tables created successfully
- [ ] All foreign keys enforce referential integrity
- [ ] All unique constraints prevent duplicates
- [ ] All indexes created and used by queries
- [ ] Seed script creates complete test dataset
- [ ] Migration can be applied and rolled back
- [ ] No N+1 query problems in seed script
- [ ] Schema matches Notion specification exactly
- [ ] All enum values match specification
- [ ] Constraint tests all passing

**Performance Benchmarks:**
- [ ] Supplier balance query < 100ms with 10k entries
- [ ] Customer balance query < 100ms with 10k entries
- [ ] Stock query < 50ms with 10k movements
- [ ] Seed script completes in < 5 seconds

---

## PHASE 3: MASTER DATA APIs (Supplier, Customer, Product, Payment Account)

### Objective
Build CRUD endpoints for master data entities that will be used in transactions. These are the foundational entities that must exist before any business transactions can be created.

### Scope

#### Included in Phase 3
1. Supplier CRUD endpoints
2. Customer CRUD endpoints
3. Product CRUD endpoints
4. Payment Account CRUD endpoints
5. Validation rules for each entity
6. Soft delete functionality (status = INACTIVE)
7. List endpoints with filtering, sorting, pagination
8. Tenant scoping on all operations
9. Audit trail (created_by, created_at, updated_at)

#### Explicitly Excluded from Phase 3
- Transaction processing
- Posting engine
- Balance calculations
- Payment processing
- Stock movements
- Reports and dashboards

### Detailed API Specifications

#### 3.1 Supplier Management

**POST /api/v1/suppliers**

Request:
```json
{
  "name": "ABC Textiles",
  "phone": "+92-300-1234567",
  "address": "123 Main Street, Karachi",
  "notes": "Preferred supplier for formal wear"
}
```

**Validations:**
- name: required, min 2 chars, max 200 chars, trimmed
- phone: optional, valid phone format (Pakistan), max 20 chars
- address: optional, max 500 chars
- notes: optional, max 1000 chars
- Duplicate name check: Warn if similar name exists (fuzzy match)

**Edge Cases:**
- Name with special characters: Allow (e.g., "M/S ABC & Co.")
- Name case sensitivity: Store as-is, search case-insensitive
- Empty phone/address: Allowed (not all suppliers have this info)
- Very long notes: Truncate at 1000 chars with validation error

**Process:**
1. Validate DTO
2. Check tenant context exists
3. Trim all string fields
4. Check for duplicate name (exact match, case-insensitive)
   - If exact match: Return 409 Conflict
   - If similar match: Return 200 with warning in response
5. Create supplier record with tenantId and createdBy
6. Log event: "Supplier created"
7. Return created supplier

Response (201):
```json
{
  "id": "uuid",
  "tenantId": "uuid",
  "name": "ABC Textiles",
  "phone": "+92-300-1234567",
  "address": "123 Main Street, Karachi",
  "notes": "Preferred supplier for formal wear",
  "status": "ACTIVE",
  "createdBy": "uuid",
  "createdAt": "2026-02-02T10:30:00.000Z",
  "updatedAt": "2026-02-02T10:30:00.000Z"
}
```

---

**GET /api/v1/suppliers**

Query Parameters:
- page: number (default: 1)
- limit: number (default: 20, max: 100)
- search: string (searches in name, phone)
- status: ACTIVE | INACTIVE | ALL (default: ACTIVE)
- sortBy: name | createdAt (default: name)
- sortOrder: asc | desc (default: asc)

Response (200):
```json
{
  "data": [
    {
      "id": "uuid",
      "name": "ABC Textiles",
      "phone": "+92-300-1234567",
      "address": "123 Main Street, Karachi",
      "status": "ACTIVE",
      "createdAt": "2026-02-02T10:30:00.000Z"
    }
  ],
  "meta": {
    "page": 1,
    "limit": 20,
    "total": 45,
    "totalPages": 3
  }
}
```

**Implementation Details:**
- Use Prisma pagination: skip = (page - 1) * limit
- Search implementation: WHERE name ILIKE '%search%' OR phone ILIKE '%search%'
- Always filter by tenantId (from context)
- Default sort: name ASC
- Include total count for pagination

---

**GET /api/v1/suppliers/:id**

Response (200):
```json
{
  "id": "uuid",
  "tenantId": "uuid",
  "name": "ABC Textiles",
  "phone": "+92-300-1234567",
  "address": "123 Main Street, Karachi",
  "notes": "Preferred supplier for formal wear",
  "status": "ACTIVE",
  "createdBy": "uuid",
  "createdAt": "2026-02-02T10:30:00.000Z",
  "updatedAt": "2026-02-02T10:30:00.000Z",
  "_computed": {
    "totalPurchases": 0,
    "currentBalance": 0,
    "lastPurchaseDate": null
  }
}
```

**Edge Cases:**
- Supplier not found: Return 404
- Supplier belongs to different tenant: Return 404 (not 403, don't reveal existence)
- Computed fields show 0 in Phase 3 (actual calculation in Phase 4+)

---

**PATCH /api/v1/suppliers/:id**

Request:
```json
{
  "name": "ABC Textiles Ltd.",
  "phone": "+92-300-7654321",
  "address": "456 New Address, Karachi",
  "notes": "Updated notes"
}
```

**Validations:**
- All fields optional (partial update)
- Same validation rules as POST
- Cannot update tenantId, id, createdBy, createdAt

**Edge Cases:**
- No fields provided: Return 400
- Update to duplicate name: Return 409
- Supplier not found: Return 404
- Supplier belongs to different tenant: Return 404

Response (200): Returns updated supplier object

---

**PATCH /api/v1/suppliers/:id/status**

Request:
```json
{
  "status": "INACTIVE",
  "reason": "No longer working with this supplier"
}
```

**Validations:**
- status: required, must be ACTIVE or INACTIVE
- reason: required if status = INACTIVE, max 500 chars

**Edge Cases:**
- Supplier has pending transactions: Return 409 with message
- Supplier has outstanding balance: Warn in response but allow
- Already has requested status: Return 200 (idempotent)

Response (200):
```json
{
  "id": "uuid",
  "status": "INACTIVE",
  "updatedAt": "2026-02-02T11:00:00.000Z"
}
```

**Note:** Soft delete only. Never hard delete suppliers due to audit trail requirements.

---

#### 3.2 Customer Management

**APIs identical structure to Suppliers:**

- POST /api/v1/customers
- GET /api/v1/customers
- GET /api/v1/customers/:id
- PATCH /api/v1/customers/:id
- PATCH /api/v1/customers/:id/status

**Additional Validations for Customers:**
- Some businesses require customer phone for home delivery
- Consider adding email field (optional)
- Consider adding customer type: RETAIL, WHOLESALE (for future pricing)

**Edge Cases specific to Customers:**
- Walk-in customer: Create default "Cash Customer" on tenant creation
- Duplicate customer detection: More important than suppliers (same person, multiple entries)
- Customer with pending orders: Warn if trying to inactivate

---

#### 3.3 Product Management

**POST /api/v1/products**

Request:
```json
{
  "name": "Men Suit - Black",
  "sku": "SUIT-BLK-001",
  "category": "Suits",
  "unit": "piece"
}
```

**Validations:**
- name: required, min 2 chars, max 200 chars
- sku: optional, max 50 chars, uppercase, alphanumeric + dash/underscore
- category: optional, max 100 chars
- unit: optional, max 20 chars, default "piece"
- Unique SKU per tenant (if provided)

**Edge Cases:**
- SKU not provided: Generate auto-SKU or leave null (business decision)
- SKU case sensitivity: Always uppercase
- Special characters in SKU: Allow only A-Z, 0-9, dash, underscore
- Duplicate name but different SKU: Allowed (color variants)
- avgCost: Set to 0 initially, will be updated on first purchase

**Process:**
1. Validate DTO
2. If SKU provided: Convert to uppercase, validate format
3. Check SKU uniqueness within tenant
4. Create product with avgCost = 0
5. Log event
6. Return created product

Response (201):
```json
{
  "id": "uuid",
  "tenantId": "uuid",
  "name": "Men Suit - Black",
  "sku": "SUIT-BLK-001",
  "category": "Suits",
  "unit": "piece",
  "avgCost": 0,
  "status": "ACTIVE",
  "createdBy": "uuid",
  "createdAt": "2026-02-02T10:30:00.000Z",
  "updatedAt": "2026-02-02T10:30:00.000Z"
}
```

---

**GET /api/v1/products**

Query Parameters:
- page, limit, search, status, sortBy, sortOrder (same as suppliers)
- category: filter by category
- inStock: boolean (show only products with stock > 0) - Phase 4+

Response (200):
```json
{
  "data": [
    {
      "id": "uuid",
      "name": "Men Suit - Black",
      "sku": "SUIT-BLK-001",
      "category": "Suits",
      "unit": "piece",
      "avgCost": 0,
      "status": "ACTIVE",
      "_computed": {
        "currentStock": 0
      }
    }
  ],
  "meta": {
    "page": 1,
    "limit": 20,
    "total": 120,
    "totalPages": 6
  }
}
```

---

**GET /api/v1/products/:id**

Response (200):
```json
{
  "id": "uuid",
  "tenantId": "uuid",
  "name": "Men Suit - Black",
  "sku": "SUIT-BLK-001",
  "category": "Suits",
  "unit": "piece",
  "avgCost": 0,
  "status": "ACTIVE",
  "createdBy": "uuid",
  "createdAt": "2026-02-02T10:30:00.000Z",
  "updatedAt": "2026-02-02T10:30:00.000Z",
  "_computed": {
    "currentStock": 0,
    "totalPurchased": 0,
    "totalSold": 0,
    "lastPurchaseDate": null,
    "lastSaleDate": null
  }
}
```

---

**PATCH /api/v1/products/:id**

Request:
```json
{
  "name": "Men Suit - Black Premium",
  "category": "Premium Suits",
  "unit": "piece"
}
```

**Validations:**
- Same as POST, all fields optional
- Cannot update: id, tenantId, avgCost (computed), createdBy, createdAt
- SKU update: Only allow if no transactions exist for this product (Phase 4+)

**Edge Cases:**
- Update SKU: Check if product has transaction history
  - If yes: Return 409 "Cannot update SKU for product with transactions"
  - If no: Allow update
- avgCost update: Not allowed via API, only via posting engine

---

**PATCH /api/v1/products/:id/status**

Similar to suppliers, with additional check:
- Product with current stock > 0: Warn but allow inactivation

---

#### 3.4 Payment Account Management

**POST /api/v1/payment-accounts**

Request:
```json
{
  "name": "HBL Main Branch",
  "type": "BANK",
  "openingBalance": 0
}
```

**Validations:**
- name: required, min 2 chars, max 100 chars, unique per tenant
- type: required, enum: CASH, BANK, WALLET, CARD
- openingBalance: optional, integer, default 0

**Edge Cases:**
- Duplicate name: Return 409 (exact match within tenant)
- openingBalance < 0: Allowed (account may be overdrawn)
- Multiple accounts same type: Allowed (multiple banks)
- Reserved names: Prevent "Cash", "Bank" etc as exact matches (use "Cash - Main" instead)

**Process:**
1. Validate DTO
2. Check name uniqueness within tenant
3. Create account with openingBalance
4. Log event
5. Return created account

Response (201):
```json
{
  "id": "uuid",
  "tenantId": "uuid",
  "name": "HBL Main Branch",
  "type": "BANK",
  "openingBalance": 0,
  "status": "ACTIVE",
  "createdBy": "uuid",
  "createdAt": "2026-02-02T10:30:00.000Z",
  "updatedAt": "2026-02-02T10:30:00.000Z"
}
```

---

**GET /api/v1/payment-accounts**

Query Parameters:
- type: CASH | BANK | WALLET | CARD (filter)
- status: ACTIVE | INACTIVE | ALL

Response (200):
```json
{
  "data": [
    {
      "id": "uuid",
      "name": "HBL Main Branch",
      "type": "BANK",
      "status": "ACTIVE",
      "_computed": {
        "currentBalance": 0
      }
    }
  ],
  "meta": {
    "total": 5
  }
}
```

**Note:** Usually no pagination needed (small number of accounts)

---

**GET /api/v1/payment-accounts/:id**

Response (200):
```json
{
  "id": "uuid",
  "tenantId": "uuid",
  "name": "HBL Main Branch",
  "type": "BANK",
  "openingBalance": 0,
  "status": "ACTIVE",
  "createdBy": "uuid",
  "createdAt": "2026-02-02T10:30:00.000Z",
  "updatedAt": "2026-02-02T10:30:00.000Z",
  "_computed": {
    "currentBalance": 0,
    "totalIn": 0,
    "totalOut": 0,
    "lastTransactionDate": null
  }
}
```

---

**PATCH /api/v1/payment-accounts/:id**

Request:
```json
{
  "name": "HBL Main Branch - Updated"
}
```

**Validations:**
- name: optional, same rules as POST
- type: Cannot be updated (affects entry semantics)
- openingBalance: Cannot be updated via this endpoint (use adjustment in Phase 6)

**Edge Cases:**
- Name update to duplicate: Return 409
- Account has transactions: Allow name update but log warning

---

**PATCH /api/v1/payment-accounts/:id/status**

**Additional Checks:**
- Account has non-zero balance: Return 409 "Cannot inactivate account with balance"
- Account is only account of type: Warn but allow

---

### Service Layer Architecture

**Common Service Pattern for All Master Data:**

```typescript
// Example: SupplierService

@Injectable()
export class SupplierService {
  constructor(
    private prisma: PrismaService,
    private logger: LoggerService,
  ) {}

  async create(tenantId: string, userId: string, dto: CreateSupplierDto): Promise<Supplier> {
    // 1. Check for duplicates
    const existing = await this.findByName(tenantId, dto.name);
    if (existing) {
      throw new ConflictException('Supplier with this name already exists');
    }

    // 2. Create record
    const supplier = await this.prisma.supplier.create({
      data: {
        tenantId,
        createdBy: userId,
        name: dto.name.trim(),
        phone: dto.phone?.trim(),
        address: dto.address?.trim(),
        notes: dto.notes?.trim(),
      },
    });

    // 3. Log event
    this.logger.info('Supplier created', {
      tenantId,
      userId,
      supplierId: supplier.id,
      supplierName: supplier.name,
    });

    return supplier;
  }

  async findAll(tenantId: string, query: ListSuppliersQuery): Promise<PaginatedResult<Supplier>> {
    const { page = 1, limit = 20, search, status = 'ACTIVE', sortBy = 'name', sortOrder = 'asc' } = query;

    const where: Prisma.SupplierWhereInput = {
      tenantId,
      ...(status !== 'ALL' && { status }),
      ...(search && {
        OR: [
          { name: { contains: search, mode: 'insensitive' } },
          { phone: { contains: search, mode: 'insensitive' } },
        ],
      }),
    };

    const [data, total] = await Promise.all([
      this.prisma.supplier.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { [sortBy]: sortOrder },
      }),
      this.prisma.supplier.count({ where }),
    ]);

    return {
      data,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async findOne(tenantId: string, id: string): Promise<Supplier> {
    const supplier = await this.prisma.supplier.findFirst({
      where: { id, tenantId },
    });

    if (!supplier) {
      throw new NotFoundException('Supplier not found');
    }

    return supplier;
  }

  async update(tenantId: string, userId: string, id: string, dto: UpdateSupplierDto): Promise<Supplier> {
    // 1. Find existing
    await this.findOne(tenantId, id);

    // 2. Check name conflict if name is being updated
    if (dto.name) {
      const existing = await this.findByName(tenantId, dto.name);
      if (existing && existing.id !== id) {
        throw new ConflictException('Supplier with this name already exists');
      }
    }

    // 3. Update
    const supplier = await this.prisma.supplier.update({
      where: { id },
      data: {
        ...(dto.name && { name: dto.name.trim() }),
        ...(dto.phone && { phone: dto.phone.trim() }),
        ...(dto.address && { address: dto.address.trim() }),
        ...(dto.notes && { notes: dto.notes.trim() }),
        updatedAt: new Date(),
      },
    });

    // 4. Log event
    this.logger.info('Supplier updated', {
      tenantId,
      userId,
      supplierId: id,
    });

    return supplier;
  }

  async updateStatus(tenantId: string, userId: string, id: string, status: string, reason?: string): Promise<Supplier> {
    // 1. Find existing
    await this.findOne(tenantId, id);

    // 2. Check constraints (in later phases)
    // - Check for pending transactions
    // - Check for outstanding balance

    // 3. Update status
    const supplier = await this.prisma.supplier.update({
      where: { id },
      data: {
        status,
        notes: reason ? `${supplier.notes || ''}\n\nStatus changed to ${status}: ${reason}`.trim() : supplier.notes,
        updatedAt: new Date(),
      },
    });

    // 4. Log event
    this.logger.info('Supplier status updated', {
      tenantId,
      userId,
      supplierId: id,
      newStatus: status,
      reason,
    });

    return supplier;
  }

  private async findByName(tenantId: string, name: string): Promise<Supplier | null> {
    return this.prisma.supplier.findFirst({
      where: {
        tenantId,
        name: {
          equals: name,
          mode: 'insensitive',
        },
      },
    });
  }
}
```

### Testing Strategy - Phase 3

#### Unit Tests

```typescript
describe('SupplierService', () => {
  let service: SupplierService;
  let prisma: PrismaService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        SupplierService,
        {
          provide: PrismaService,
          useValue: {
            supplier: {
              create: jest.fn(),
              findMany: jest.fn(),
              findFirst: jest.fn(),
              update: jest.fn(),
              count: jest.fn(),
            },
          },
        },
      ],
    }).compile();

    service = module.get<SupplierService>(SupplierService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  describe('create', () => {
    it('should create supplier successfully', async () => {
      const dto = {
        name: 'Test Supplier',
        phone: '+92-300-1234567',
      };

      const mockSupplier = {
        id: 'uuid',
        tenantId: 'tenant-uuid',
        ...dto,
        createdAt: new Date(),
      };

      jest.spyOn(prisma.supplier, 'findFirst').mockResolvedValue(null);
      jest.spyOn(prisma.supplier, 'create').mockResolvedValue(mockSupplier);

      const result = await service.create('tenant-uuid', 'user-uuid', dto);

      expect(result).toEqual(mockSupplier);
      expect(prisma.supplier.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          tenantId: 'tenant-uuid',
          name: dto.name,
        }),
      });
    });

    it('should throw ConflictException for duplicate name', async () => {
      const dto = { name: 'Duplicate Supplier' };

      jest.spyOn(prisma.supplier, 'findFirst').mockResolvedValue({
        id: 'existing-uuid',
        name: 'Duplicate Supplier',
      } as any);

      await expect(
        service.create('tenant-uuid', 'user-uuid', dto)
      ).rejects.toThrow(ConflictException);
    });

    it('should trim whitespace from inputs', async () => {
      const dto = {
        name: '  Test Supplier  ',
        phone: '  +92-300-1234567  ',
      };

      jest.spyOn(prisma.supplier, 'findFirst').mockResolvedValue(null);
      jest.spyOn(prisma.supplier, 'create').mockResolvedValue({} as any);

      await service.create('tenant-uuid', 'user-uuid', dto);

      expect(prisma.supplier.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          name: 'Test Supplier',
          phone: '+92-300-1234567',
        }),
      });
    });
  });

  describe('findAll', () => {
    it('should return paginated results', async () => {
      const mockSuppliers = [
        { id: '1', name: 'Supplier 1' },
        { id: '2', name: 'Supplier 2' },
      ];

      jest.spyOn(prisma.supplier, 'findMany').mockResolvedValue(mockSuppliers as any);
      jest.spyOn(prisma.supplier, 'count').mockResolvedValue(50);

      const result = await service.findAll('tenant-uuid', {
        page: 1,
        limit: 20,
      });

      expect(result.data).toEqual(mockSuppliers);
      expect(result.meta).toEqual({
        page: 1,
        limit: 20,
        total: 50,
        totalPages: 3,
      });
    });

    it('should filter by search term', async () => {
      jest.spyOn(prisma.supplier, 'findMany').mockResolvedValue([]);
      jest.spyOn(prisma.supplier, 'count').mockResolvedValue(0);

      await service.findAll('tenant-uuid', {
        search: 'ABC',
      });

      expect(prisma.supplier.findMany).toHaveBeenCalledWith({
        where: expect.objectContaining({
          OR: expect.arrayContaining([
            { name: { contains: 'ABC', mode: 'insensitive' } },
            { phone: { contains: 'ABC', mode: 'insensitive' } },
          ]),
        }),
        skip: expect.any(Number),
        take: expect.any(Number),
        orderBy: expect.any(Object),
      });
    });

    it('should filter by status', async () => {
      jest.spyOn(prisma.supplier, 'findMany').mockResolvedValue([]);
      jest.spyOn(prisma.supplier, 'count').mockResolvedValue(0);

      await service.findAll('tenant-uuid', {
        status: 'INACTIVE',
      });

      expect(prisma.supplier.findMany).toHaveBeenCalledWith({
        where: expect.objectContaining({
          status: 'INACTIVE',
        }),
        skip: expect.any(Number),
        take: expect.any(Number),
        orderBy: expect.any(Object),
      });
    });
  });
});
```

#### Integration Tests

```typescript
describe('Supplier API (Integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let authToken: string;
  let tenantId: string;

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    prisma = app.get<PrismaService>(PrismaService);

    // Create test tenant and user
    const { token, tenant } = await createTestTenantAndUser(app);
    authToken = token;
    tenantId = tenant.id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  beforeEach(async () => {
    // Clean up suppliers for this tenant
    await prisma.supplier.deleteMany({
      where: { tenantId },
    });
  });

  describe('POST /api/v1/suppliers', () => {
    it('should create supplier successfully', async () => {
      const dto = {
        name: 'Test Supplier',
        phone: '+92-300-1234567',
        address: 'Test Address',
        notes: 'Test Notes',
      };

      const response = await request(app.getHttpServer())
        .post('/api/v1/suppliers')
        .set('Authorization', `Bearer ${authToken}`)
        .send(dto)
        .expect(201);

      expect(response.body).toMatchObject({
        id: expect.any(String),
        tenantId,
        ...dto,
        status: 'ACTIVE',
      });

      // Verify in database
      const supplier = await prisma.supplier.findUnique({
        where: { id: response.body.id },
      });
      expect(supplier).toBeDefined();
      expect(supplier.name).toBe(dto.name);
    });

    it('should reject duplicate supplier name', async () => {
      const dto = { name: 'Duplicate Supplier' };

      // Create first supplier
      await request(app.getHttpServer())
        .post('/api/v1/suppliers')
        .set('Authorization', `Bearer ${authToken}`)
        .send(dto)
        .expect(201);

      // Attempt duplicate
      const response = await request(app.getHttpServer())
        .post('/api/v1/suppliers')
        .set('Authorization', `Bearer ${authToken}`)
        .send(dto)
        .expect(409);

      expect(response.body.message).toContain('already exists');
    });

    it('should reject invalid data', async () => {
      const dto = {
        name: 'A', // Too short
        phone: 'invalid-phone',
      };

      const response = await request(app.getHttpServer())
        .post('/api/v1/suppliers')
        .set('Authorization', `Bearer ${authToken}`)
        .send(dto)
        .expect(400);

      expect(response.body.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            field: 'name',
          }),
        ])
      );
    });

    it('should require authentication', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/suppliers')
        .send({ name: 'Test' })
        .expect(401);
    });
  });

  describe('GET /api/v1/suppliers', () => {
    beforeEach(async () => {
      // Create test suppliers
      await prisma.supplier.createMany({
        data: [
          { tenantId, name: 'Supplier A', status: 'ACTIVE' },
          { tenantId, name: 'Supplier B', status: 'ACTIVE' },
          { tenantId, name: 'Supplier C', status: 'INACTIVE' },
        ],
      });
    });

    it('should return paginated suppliers', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/suppliers')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.data).toHaveLength(2); // Only ACTIVE by default
      expect(response.body.meta).toMatchObject({
        page: 1,
        total: 2,
      });
    });

    it('should filter by search term', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/suppliers?search=Supplier A')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0].name).toBe('Supplier A');
    });

    it('should include inactive suppliers when requested', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/suppliers?status=ALL')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.data).toHaveLength(3);
    });

    it('should sort by name', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/suppliers?sortBy=name&sortOrder=asc')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.data[0].name).toBe('Supplier A');
      expect(response.body.data[1].name).toBe('Supplier B');
    });
  });

  describe('Tenant Isolation', () => {
    it('should not return suppliers from other tenants', async () => {
      // Create another tenant
      const { token: token2, tenant: tenant2 } = await createTestTenantAndUser(app);

      // Create supplier for tenant1
      await prisma.supplier.create({
        data: { tenantId, name: 'Tenant 1 Supplier' },
      });

      // Create supplier for tenant2
      await prisma.supplier.create({
        data: { tenantId: tenant2.id, name: 'Tenant 2 Supplier' },
      });

      // Query as tenant1
      const response1 = await request(app.getHttpServer())
        .get('/api/v1/suppliers')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response1.body.data).toHaveLength(1);
      expect(response1.body.data[0].name).toBe('Tenant 1 Supplier');

      // Query as tenant2
      const response2 = await request(app.getHttpServer())
        .get('/api/v1/suppliers')
        .set('Authorization', `Bearer ${token2}`)
        .expect(200);

      expect(response2.body.data).toHaveLength(1);
      expect(response2.body.data[0].name).toBe('Tenant 2 Supplier');
    });
  });
});
```

### Deliverables - Phase 3

#### Code Artifacts
- [ ] Supplier module (controller, service, DTOs)
- [ ] Customer module (controller, service, DTOs)
- [ ] Product module (controller, service, DTOs)
- [ ] Payment Account module (controller, service, DTOs)
- [ ] All validation DTOs with class-validator decorators
- [ ] Swagger/OpenAPI annotations on all endpoints
- [ ] Pagination utility helpers
- [ ] Tenant scoping verified on all operations

#### Documentation
- [ ] API documentation generated (Swagger UI)
- [ ] Postman collection for all endpoints
- [ ] Master data setup guide
- [ ] Validation rules documented
- [ ] Error code reference

#### Tests
- [ ] Unit tests for all service methods
- [ ] Integration tests for all API endpoints
- [ ] Tenant isolation tests
- [ ] Duplicate prevention tests
- [ ] Validation tests
- [ ] Edge case tests

### Acceptance Criteria - Phase 3

**Must Pass:**
- [ ] Can create, read, update all master data entities
- [ ] Can list with pagination, filtering, sorting
- [ ] Can search by name/phone
- [ ] Can activate/inactivate entities
- [ ] Duplicate detection works correctly
- [ ] All validations enforce rules
- [ ] Tenant isolation prevents cross-tenant access
- [ ] All timestamps populated correctly
- [ ] All audit fields (createdBy) populated
- [ ] All error responses follow standard format
- [ ] API documentation is accurate
- [ ] All unit tests passing (>80% coverage)
- [ ] All integration tests passing
- [ ] No N+1 query issues
- [ ] Postman collection works for manual testing

**Performance Benchmarks:**
- [ ] List endpoint < 200ms for 1000 records
- [ ] Create endpoint < 100ms
- [ ] Search endpoint < 300ms

---

## Estimated Document Length Note

This plan is extensive and covers all 7 phases in extreme detail. The complete document would be approximately 15,000-20,000 lines when fully expanded to include:

- Phase 4: Posting Engine Core (PURCHASE + SALE flows with all edge cases)
- Phase 5: Standalone Payments + Allocations (settlement logic)
- Phase 6: Returns + Adjustments + Internal Transfer
- Phase 7: Canonical Queries + Dashboards + Import Pipeline + Hardening
- Cross-Phase Concerns
- Validation Gates
- Appendices

Would you like me to:
1. Continue with Phase 4-7 in a second document?
2. Create separate detailed documents for each remaining phase?
3. Focus on a specific phase you'd like to see in complete detail?
