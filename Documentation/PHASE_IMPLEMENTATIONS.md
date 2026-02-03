# Phase Implementations - Detailed Walkthrough

> **Purpose**: Document exactly HOW each phase was implemented with code patterns, architectural decisions, and lessons learned. This serves as a reference for implementing future phases.

---

## Phase 1: Backend Foundation & Production Skeleton

**Status**: ✅ Complete
**Duration**: Implementation complete, tests passing
**Deliverables**: NestJS app, Auth system, Prisma, Logging, Health checks

### 1.1 What Was Built

| Component | File(s) | Purpose |
|-----------|---------|---------|
| Framework Setup | `src/main.ts`, `src/app.module.ts` | NestJS initialization with security, CORS, rate limiting |
| Authentication | `src/auth/*` | JWT register/login with refresh tokens, bcrypt hashing |
| Database | `src/prisma/*` | Prisma service, tenant scoping middleware |
| Logging | `src/common/logger.config.ts` | Winston JSON logging |
| Validation | `src/common/pipes/*` | class-validator DTOs |
| Error Handling | `src/common/filters/*` | Global HTTP exception filter |
| Health Checks | `src/health/*` | `/health` and `/health/db` endpoints |
| Testing | `src/auth/auth.service.spec.ts` | Unit tests for auth service |

### 1.2 Key Architecture Decisions

#### Decision 1: Global Exception Filter
```typescript
// src/common/filters/http-exception.filter.ts
@Catch(HttpException)
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: HttpException, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse();
    const status = exception.getStatus();

    response.status(status).json({
      statusCode: status,
      message: exception.message,
      timestamp: new Date().toISOString(),
    });
  }
}
```

**Why**: Centralized error handling prevents inconsistent error responses. All HTTP exceptions follow same format.

#### Decision 2: Validation Pipe with DTOs
```typescript
// src/auth/dto/register.dto.ts
export class RegisterDto {
  @IsString()
  @MinLength(1)
  tenantName: string;

  @IsString()
  @MinLength(1)
  fullName: string;

  @IsEmail()
  email: string;

  @IsString()
  @MinLength(8)
  password: string;
}
```

**Why**: DTOs + class-validator provide type-safe validation at API boundary. Fail fast before touching business logic.

#### Decision 3: Bcrypt Salt Rounds = 12
```typescript
// src/auth/auth.service.ts
const PASSWORD_SALT_ROUNDS = 12;
const passwordHash = await hash(dto.password, PASSWORD_SALT_ROUNDS);
```

**Why**: 12 rounds = ~250ms computation time per login. Balances security (slow enough to prevent brute force) with UX (fast enough not to frustrate users).

#### Decision 4: Tenant Scoping via Middleware
```typescript
// src/common/middleware/tenant-context.middleware.ts
@Injectable()
export class TenantContextMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    const user = req.user; // from JWT guard
    if (user) {
      cls.set('tenantId', user.tenantId);
    }
    next();
  }
}
```

**Why**: Store tenant in request-local context. Every Prisma query can access via `cls.get('tenantId')` without passing parameter through 10 function calls.

### 1.3 Prisma Schema for Phase 1

```prisma
model Tenant {
  id           String   @id @default(uuid()) @db.Uuid
  name         String
  baseCurrency String   @default("PKR")
  timezone     String   @default("Asia/Karachi")
  status       String   @default("ACTIVE")
  createdAt    DateTime @default(now()) @map("created_at")
  updatedAt    DateTime @updatedAt @map("updated_at")

  users User[]
  @@map("tenants")
}

model User {
  id           String    @id @default(uuid()) @db.Uuid
  tenantId     String    @map("tenant_id") @db.Uuid
  fullName     String    @map("full_name")
  email        String                    // GLOBAL unique
  passwordHash String    @map("password_hash")
  role         String    @default("OWNER")
  status       String    @default("ACTIVE")
  lastLoginAt  DateTime? @map("last_login_at")
  createdAt    DateTime  @default(now()) @map("created_at")
  updatedAt    DateTime  @updatedAt @map("updated_at")

  tenant       Tenant    @relation(fields: [tenantId], references: [id])

  @@unique([email])         // Global unique email across all tenants
  @@index([tenantId])       // For tenant queries
  @@map("users")
}
```

**Design Decisions**:
- `@@unique([email])` - Global unique email (one identity per email)
- `@updatedAt` - Automatic timestamp management
- `@map` - Explicit column name mapping to snake_case (SQL convention)
- `@db.Uuid` - Explicit UUID storage type

### 1.4 Authentication Flow

```typescript
// 1. User calls POST /auth/register
export class AuthService {
  async register(dto: RegisterDto) {
    // 2. Check for existing email (case-insensitive)
    const existing = await this.prisma.user.findFirst({
      where: {
        email: { equals: dto.email.toLowerCase(), mode: 'insensitive' },
      },
    });

    if (existing) {
      throw new ConflictException('Email already exists');
    }

    // 3. Hash password
    const passwordHash = await hash(dto.password, 12);

    // 4. Create tenant + user in transaction
    const result = await this.prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({
        data: { name: dto.tenantName.trim() },
      });

      const user = await tx.user.create({
        data: {
          tenantId: tenant.id,
          fullName: dto.fullName.trim(),
          email: dto.email.toLowerCase(),
          passwordHash,
          role: 'OWNER',
        },
      });

      return { tenant, user };
    });

    // 5. Generate tokens
    const tokens = await this.generateTokens(result.user);

    // 6. Return user + tokens
    return {
      ...tokens,
      user: {
        id: result.user.id,
        tenantId: result.user.tenantId,
        // ... other fields
      },
    };
  }
}
```

**Pattern**: Transaction → Token Generation → Return Response

### 1.5 Testing Approach

```typescript
// src/auth/auth.service.spec.ts
describe('AuthService', () => {
  describe('register', () => {
    it('should throw on duplicate email', async () => {
      // Arrange
      await prisma.user.create({...});

      // Act & Assert
      await expect(authService.register({...}))
        .rejects.toThrow(ConflictException);
    });

    it('should create tenant and user', async () => {
      // Arrange
      const dto = {...};

      // Act
      const result = await authService.register(dto);

      // Assert
      expect(result.user).toBeDefined();
      expect(result.accessToken).toBeDefined();
    });
  });
});
```

**Pattern**: Arrange → Act → Assert (AAA pattern)

### 1.6 Commit Pattern (Phase 1)

```
Initial implementation: Phase 1 NestJS backend with authentication

Core implementation:
- NestJS backend with Prisma ORM and PostgreSQL integration
- Tenant-based multi-tenancy with global-unique emails
- JWT-based authentication (register, login with access/refresh tokens)
- Bcrypt password hashing (12 salt rounds)
- Request context & tenant scoping middleware
- Security: Helmet, rate limiting, CORS configuration
- Logging: Winston with structured JSON formatting
- Validation: class-validator DTOs for register/login
- Exception handling: Global HTTP exception filter
- Health checks: /health and /health/db endpoints

Schema (Phase 1):
- Tenant: id, name, baseCurrency, timezone, status, timestamps
- User: id, tenantId, fullName, email, passwordHash, role, status, lastLoginAt, timestamps

Co-Authored-By: Claude Haiku 4.5 <noreply@anthropic.com>
```

---

## Phase 2: Schema V1 + Constraints + Indexes

**Status**: ✅ Complete
**Duration**: Implementation complete, migration applied, seed data loaded
**Deliverables**: 14-table schema, all FKs, indexes, seed scripts

### 2.1 What Was Built

| Component | Tables | Purpose |
|-----------|--------|---------|
| Identity | `tenants`, `users` | Tenant isolation, user management |
| Master Data | `suppliers`, `customers`, `products`, `payment_accounts` | Business entities |
| Transactions | `transactions`, `transaction_lines` | Event records |
| Truth Tables | `inventory_movements`, `ledger_entries`, `payment_entries` | Append-only entries |
| Allocation | `allocations` | Payment settlement tracking |
| Imports | `import_batches`, `import_rows` | Excel/CSV migration |

**Total: 14 tables, 45+ indexes, 100+ relationships**

### 2.2 Schema Design Patterns

#### Pattern 1: Truth Table (Append-Only Entries)

```prisma
model InventoryMovement {
  id                String       @id @default(uuid())
  tenantId          String       @map("tenant_id")
  transactionId     String       @map("transaction_id")     // Links to event
  transactionLineId String?      @map("transaction_line_id") // Links to line
  productId         String       @map("product_id")
  movementType      MovementType // PURCHASE_IN, SALE_OUT, etc.
  quantity          Int          // Quantity moved
  unitCostAtTime    Int          @map("unit_cost_at_time")  // Cost snapshot
  transactionDate   DateTime     @map("transaction_date")   // Business date
  createdBy         String?      @map("created_by")
  createdAt         DateTime     @default(now()) @map("created_at")
  updatedAt         DateTime     @updatedAt @map("updated_at")

  // Relations
  transaction       Transaction      @relation(fields: [transactionId], references: [id])

  @@index([tenantId, productId, transactionDate])
  @@map("inventory_movements")
}
```

**Why Append-Only**:
- Never edit entries after creation
- Immutable audit trail
- Safe concurrent posting (no locks on historical data)
- Can recalculate stock = sum(in movements) - sum(out movements)

#### Pattern 2: Polymorphic Transaction (One Table, Many Types)

```prisma
model Transaction {
  id              String            @id @default(uuid())
  tenantId        String            @map("tenant_id")
  type            TransactionType   // PURCHASE, SALE, PAYMENT, RETURN, etc.
  status          TransactionStatus // DRAFT, POSTED, VOIDED

  // Shared fields
  transactionDate DateTime          @map("transaction_date")
  postedAt        DateTime?         @map("posted_at")

  // Party links (which apply depends on type)
  supplierId      String?           @map("supplier_id")  // For PURCHASE, PAYMENT
  customerId      String?           @map("customer_id")  // For SALE, PAYMENT

  // Totals
  subtotal        Int               @default(0)
  discountTotal   Int               @default(0)
  deliveryFee     Int               @default(0)
  totalAmount     Int               @default(0)
  paidNow         Int               @default(0)

  // Delivery (SALE only)
  deliveryType    DeliveryType?     @map("delivery_type")
  deliveryAddress String?           @map("delivery_address")

  // Internal transfer (INTERNAL_TRANSFER only)
  fromPaymentAccountId String?      @map("from_payment_account_id")
  toPaymentAccountId   String?      @map("to_payment_account_id")

  // Void fields
  voidReason      String?           @map("void_reason")
  voidedAt        DateTime?         @map("voided_at")
  voidedBy        String?           @map("voided_by")

  // Idempotency
  idempotencyKey  String?           @map("idempotency_key")

  createdAt       DateTime          @default(now()) @map("created_at")
  updatedAt       DateTime          @updatedAt @map("updated_at")

  @@unique([tenantId, type, series, documentNumber])
  @@unique([tenantId, idempotencyKey])
  @@index([tenantId, transactionDate])
  @@index([tenantId, type, status])
}
```

**Why Polymorphic**:
- Single source of truth for all transaction types
- Type field determines validation rules
- All entries point back to one transaction table
- Easier to query across types

#### Pattern 3: Audit Trail Fields

```prisma
model Supplier {
  id        String   @id @default(uuid())
  tenantId  String   @map("tenant_id")
  name      String
  status    String   @default("ACTIVE")

  // AUDIT FIELDS
  createdBy String?  @map("created_by")  // User who created
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  // FK to user
  createdByUser User? @relation(fields: [createdBy], references: [id], onDelete: SetNull)

  @@map("suppliers")
}
```

**Why SetNull on createdBy**:
- If user is deleted, preserve business record (supplier still exists)
- Audit trail survives (createdBy becomes NULL, but record persists)
- Alternative (onDelete: Restrict) would prevent user deletion if they created records

#### Pattern 4: Tenant Isolation Index

```prisma
model Product {
  id       String @id
  tenantId String @map("tenant_id")
  name     String
  sku      String?

  @@unique([tenantId, sku])  // SKU unique PER TENANT
  @@index([tenantId, name])  // Query by tenant + name
  @@map("products")
}
```

**Why (tenantId, ...) indexes**:
- Every query filters by tenantId first
- Index helps database find relevant records fast
- Prevents accidental cross-tenant queries

### 2.3 Foreign Key Strategy

| Relationship | onDelete Rule | Why |
|-------------|--------------|-----|
| Transaction → Tenant | `Restrict` | Prevent deleting tenant with transactions |
| Transaction → Supplier | `Restrict` | Keep transaction history intact |
| Supplier → createdByUser | `SetNull` | Delete user, preserve supplier |
| TransactionLine → Transaction | `Restrict` | Lines must belong to transaction |

```prisma
// RESTRICT: Cannot delete parent if child exists
transaction       Transaction         @relation(fields: [transactionId], references: [id], onDelete: Restrict)

// SET NULL: Delete parent, child gets NULL foreign key
createdByUser     User?               @relation(fields: [createdBy], references: [id], onDelete: SetNull)
```

### 2.4 Enums for Type Safety

```typescript
// In schema.prisma
enum TransactionType {
  PURCHASE
  SALE
  SUPPLIER_PAYMENT
  CUSTOMER_PAYMENT
  SUPPLIER_RETURN
  CUSTOMER_RETURN
  INTERNAL_TRANSFER
  ADJUSTMENT
}

enum TransactionStatus {
  DRAFT
  POSTED
  VOIDED
}

enum MovementType {
  PURCHASE_IN
  SALE_OUT
  SUPPLIER_RETURN_OUT
  CUSTOMER_RETURN_IN
  ADJUSTMENT_IN
  ADJUSTMENT_OUT
}
```

**Why Enums**:
- Database enforces allowed values
- Prisma generates TypeScript types
- IDE autocomplete for valid values
- Prevents typos (PURCHACE → compile error)

### 2.5 Seed Script Pattern

```typescript
// backend/prisma/seed.ts
import { PrismaClient } from '@prisma/client';
import { hash } from 'bcrypt';

const prisma = new PrismaClient();

async function seed() {
  // 1. Create tenant
  const tenant = await prisma.tenant.create({
    data: {
      name: 'Test Wholesale Business',
      baseCurrency: 'PKR',
      timezone: 'Asia/Karachi',
    },
  });

  // 2. Create user (owner)
  const user = await prisma.user.create({
    data: {
      tenantId: tenant.id,
      fullName: 'Test Owner',
      email: 'owner@test.com',
      passwordHash: await hash('Test123!', 12),
      role: 'OWNER',
    },
  });

  // 3. Create suppliers (parallel)
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
    // ... more suppliers
  ]);

  // 4. Create customers
  const customers = await Promise.all([
    prisma.customer.create({...}),
    // ...
  ]);

  // 5. Create products
  const products = await Promise.all([
    prisma.product.create({...}),
    // ...
  ]);

  // 6. Create payment accounts
  const paymentAccounts = await Promise.all([
    prisma.paymentAccount.create({...}),
    // ...
  ]);

  console.log('Seed completed:', {
    tenantId: tenant.id,
    userId: user.id,
    supplierCount: suppliers.length,
    customerCount: customers.length,
    productCount: products.length,
    paymentAccountCount: paymentAccounts.length,
  });
}

seed()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
```

**Pattern**:
1. Wrap in async function
2. Create hierarchy (tenant → users → master data)
3. Use Promise.all for parallel inserts
4. Always disconnect when done

### 2.6 Migration Pattern

```bash
# Applied migrations:
npx prisma migrate dev --name add_complete_schema

# Output:
# ✓ Created migration: prisma/migrations/20260203105501_add_complete_schema/
# ✓ Applied migration: 20260203105501_add_complete_schema
```

**Generated Migration SQL** (auto-generated by Prisma):
- Creates 14 tables
- Adds all foreign key constraints
- Creates indexes for performance
- Sets default values

**To inspect generated SQL**:
```bash
cat backend/prisma/migrations/20260203105501_add_complete_schema/migration.sql
```

### 2.7 Potential Concerns & Solutions

#### Concern 1: Database CHECK Constraints

**Issue**: Prisma schema doesn't support CHECK constraints natively.

```sql
-- Would need manual SQL migration:
ALTER TABLE transactions ADD CONSTRAINT check_amounts_non_negative
  CHECK (subtotal >= 0 AND total_amount >= 0 AND discount_total >= 0);
```

**Solution Options**:
1. ✅ (Recommended) Application-level validation via DTOs + business logic
2. Add raw SQL migration if DB-level enforcement required
3. Combine both for defense-in-depth

#### Concern 2: Large Schema Complexity

**Issue**: 14 tables, 45+ indexes, 100+ relationships = harder to understand.

**Solution**:
1. Read `Documentation/docs/02-data-model.md` first
2. Study ERD diagram (if available)
3. Review this document for patterns
4. Ask when confused

#### Concern 3: Seed Data Freshness

**Issue**: Seed data gets outdated, confuses developers.

**Solution**:
1. Keep seed data simple and generic
2. Add comments in seed.ts explaining what each record is for
3. Update seed when schema changes
4. Don't over-seed (keep it minimal)

### 2.8 Commit Pattern (Phase 2)

```
feat(schema): implement Phase 2 complete data model with migrations

Schema includes:
- 14 tables covering identity, master data, transactions, entries, allocations
- 8 transaction types (PURCHASE, SALE, PAYMENT, RETURN, TRANSFER, etc.)
- Truth tables: inventory_movements, ledger_entries, payment_entries (append-only)
- Enums: TransactionType, MovementType, LedgerEntryType, PaymentEntryType
- Indexes: All recommended indexes for query performance
- Foreign keys: All relationships with appropriate onDelete rules
- Audit fields: createdBy (SetNull), createdAt, updatedAt on all tables
- Constraints: Unique (tenantId, sku), (tenantId, email), (tenantId, type, series, document_number)

Database:
- PostgreSQL 14+ with UUID extensions
- Timestamptz for all timestamps (UTC storage)
- JSONB for raw_data_json in import_rows

Seed data:
- Test tenant, owner user, sample suppliers, customers, products, payment accounts
- Loaded via prisma/seed.ts with bcrypt hashing

Testing:
- Schema validation with npx prisma validate
- Migration tested against finance_system_dev database

Co-Authored-By: Claude Haiku 4.5 <noreply@anthropic.com>
```

---

## Key Patterns Established

### Pattern: Request → DTO Validation → Service Logic → Repository
```typescript
@Controller('auth')
export class AuthController {
  @Post('register')
  async register(@Body() dto: RegisterDto) {  // 1. DTO Validation
    return this.authService.register(dto);     // 2. Service Logic
  }
}
```

### Pattern: Error → Centralized Filter → Consistent Response
```typescript
// Any error thrown in service gets caught by filter
throw new ConflictException('Email exists');

// Filter formats as JSON
{
  "statusCode": 409,
  "message": "Email exists",
  "timestamp": "2026-02-03T..."
}
```

### Pattern: Transaction for Data Consistency
```typescript
const result = await this.prisma.$transaction(async (tx) => {
  // All-or-nothing: if anything fails, everything rolls back
  const tenant = await tx.tenant.create({...});
  const user = await tx.user.create({...});
  return { tenant, user };
});
```

---

## What to Do When Implementing Phase 3

### Pre-Implementation Checklist
```
□ Read AGENTS.md (this section: Phase Implementations)
□ Read IMPLEMENTATION_PLAN.md Phase 3 section
□ Read Documentation/docs/04-api-spec.md for endpoint contracts
□ Review Phase 2 schema to understand relationships
□ Check test examples from Phase 1
```

### Code Structure Pattern to Follow
```
src/[module]/
├── [module].controller.ts      # HTTP endpoints
├── [module].service.ts         # Business logic
├── [module].module.ts          # DI wiring
├── dto/
│   ├── create-[entity].dto.ts
│   ├── update-[entity].dto.ts
│   └── [entity].response.dto.ts
├── [module].service.spec.ts    # Unit tests
└── [module].e2e-spec.ts        # Integration tests
```

### Testing Pattern to Follow
```typescript
describe('[Module]Service', () => {
  let service: [Module]Service;
  let prisma: PrismaService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({...}).compile();
    service = module.get([Module]Service);
    prisma = module.get(PrismaService);
  });

  describe('[method]', () => {
    it('should [expected behavior]', async () => {
      // Arrange
      const input = {...};

      // Act
      const result = await service.[method](input);

      // Assert
      expect(result).toBeDefined();
    });
  });
});
```

---

## Lessons Learned

1. **Tenant Isolation is Critical**: Every query must filter by tenantId. Easy to miss. Use middleware.

2. **Seed Data Saves Time**: A good seed script reduces manual testing setup. Invest in seed quality.

3. **Transaction Safety**: Use Prisma's `$transaction` for multi-step operations. Prevents partial updates.

4. **Type Safety Wins**: Enums, DTOs, and TypeScript strict mode catch bugs at compile time.

5. **Test Early, Test Often**: Phase 1 tests pass cleanly. Phase 2 should continue this.

6. **Documentation During Implementation**: Don't wait until the end. Update AGENTS.md and docs as you code.

---

**Last Updated**: 2026-02-03
**Next Phase**: Phase 3 (Master Data APIs)
**Reference**: AGENTS.md § 3-8
