# AGENTS.md - Finance System Implementation Guide

> **Purpose**: This document is the single source of truth for AI coding agents working on this project. It provides context, roadmap, documentation standards, and operational guidelines.

---

## Quick Reference

| Item | Location |
|------|----------|
| Current Phase | **Phase 10** (Complete) |
| Next Phase | **N/A** (Final Phase) |
| Implementation Plans | `Documentation/IMPLEMENTATION_PLAN*.md` |
| Domain Specs | `Documentation/docs/` |
| Backend Code | `backend/` |
| Database Schema | `backend/prisma/schema.prisma` |

---

## 1. Project Overview

**Finance System** is a multi-tenant accounting application for Pakistani businesses. It handles:
- Purchases & Sales with inventory tracking
- Supplier/Customer balance management (AP/AR)
- Payment accounts (Cash, Bank, JazzCash, etc.)
- Returns, allocations, and internal transfers

### Core Architecture

```
Transaction (Event) → Posting Engine → Truth Tables (Entries)
                                            ↓
                                    Derived Balances/Stock
```

**Key Invariant**: Balances are NEVER stored directly. They are always computed from append-only entry tables.

---

## 2. Implementation Phases

### Phase Status Tracker

| Phase | Name | Status | Key Deliverables |
|-------|------|--------|------------------|
| 1 | Backend Foundation | ✅ Complete | NestJS, Auth, Prisma, Health checks |
| 2 | Schema V1 + Constraints | ✅ Complete | 14 tables, FKs, indexes, seeds |
| 3 | Master Data APIs | ✅ Complete | Suppliers, Customers, Products, Accounts CRUD |
| 4 | Posting Engine Core | ✅ Complete | PURCHASE, SALE posting with entries |
| 5 | Payments + Allocations | ✅ Complete | Standalone payments, allocation system |
 | 6 | Returns + Transfers | ✅ Complete | Returns with strict rules, internal transfers | 
| 7 | Queries + Hardening | ✅ Complete | Reports, Dashboard, & Imports complete; Hardening deferred |
| 8 | [Product Variants](Documentation/progress/20260217-ProductVariants-ProgressReport.md) | ✅ Complete | Schema change for product variants and data migration |
| 9 | [Product Variants UI](Documentation/progress/20260218-ProductVariantsUI-ProgressReport.md) | ✅ Complete | Updated 12 screens to support product variants |
| 10 | [API Mapping & Gaps Remediation](Documentation/progress/20260219-APIMappingAndBackendGapsRemediation-ProgressReport.md) | ✅ Complete | Balance optimizations, statement notes, & list enrichment |
### Phase Documentation Locations

```
Documentation/
├── IMPLEMENTATION_PLAN.md           # Phases 1-3
├── IMPLEMENTATION_PLAN_PHASES_4-7.md # Phases 4-5
├── IMPLEMENTATION_PLAN_PHASES_6-7_FINAL.md # Phases 6-7
├── IMPLEMENTATION_PLAN_README.md    # Overview & navigation
└── docs/                            # Domain specifications
    ├── 01-architecture.md           # System invariants
    ├── 02-data-model.md             # Complete schema spec
    ├── 03-posting-patterns.md       # How transactions create entries
    ├── 04-api-spec.md               # REST API contracts
    └── ...
```

---

## 3. Documentation Standards

### 3.1 Pre-Implementation Documentation (Before Coding)

Before starting any phase, ensure these exist:

| Document | Purpose | Location |
|----------|---------|----------|
| Phase requirements | What to build | `IMPLEMENTATION_PLAN*.md` |
| API contracts | Request/response shapes | `docs/04-api-spec.md` |
| Schema changes | New tables/fields | `docs/02-data-model.md` |
| Test cases | Expected behavior | Phase section in impl plan |

### 3.2 During-Implementation Documentation (While Coding)

**For every significant change, document:**

```markdown
## [Feature/Change Name]

### What Changed
- File: `path/to/file.ts`
- Change: [description]

### Why
[Business reason or technical requirement]

### Assumptions Made
1. [assumption]
2. [assumption]

### Tests Added
- [ ] Unit test: `file.spec.ts`
- [ ] Integration test: `file.e2e-spec.ts`

### Edge Cases Handled
- [edge case 1]
- [edge case 2]
```

### 3.3 Post-Implementation Documentation (After Coding)

After completing a phase, update:

| Document | Update Required |
|----------|-----------------|
| `AGENTS.md` | Phase status tracker |
| `CHANGELOG.md` | Version + changes |
| `docs/14-decision-log.md` | Any decisions made |
| Phase section | Mark deliverables complete |

### 3.4 Commit Message Standards

```
<type>(<scope>): <description>

[optional body]

[optional footer]
Co-Authored-By: Claude <Model> <noreply@anthropic.com>
```

**Types**: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`

**Examples**:
```
feat(auth): implement JWT refresh token rotation
fix(posting): prevent negative stock on concurrent sales
docs(schema): update user email uniqueness constraint
```

---

## 4. Agent Operational Guidelines

### 4.1 Before Starting Any Task

```
CHECKLIST:
□ Read relevant IMPLEMENTATION_PLAN section
□ Read relevant docs/ specification
□ Check current schema in prisma/schema.prisma
□ Identify which files will be modified
□ Surface assumptions BEFORE coding
```

### 4.2 Task Boundaries

| ✅ Always Do | ⚠️ Ask First | 🚫 Never Do |
|-------------|-------------|------------|
| Run tests before commits | Schema changes | Skip tests |
| Follow existing patterns | Add new dependencies | Modify .env with secrets |
| Update related docs | Refactor outside scope | Delete posted transaction logic |
| Use TypeScript strict mode | Change API contracts | Violate system invariants |

### 4.3 System Invariants (Non-Negotiable)

These rules are ABSOLUTE. Violating any of these is a critical failure:

1. **Event → Entries Only**: Every balance change goes through posting engine
2. **Append-Only Entries**: Never edit `ledger_entries`, `payment_entries`, `inventory_movements`
3. **Balances Are Derived**: Compute from entries, never store directly
4. **Atomic Posting**: Single transaction, all or nothing
5. **Idempotency**: Same request = same result
6. **Posted Is Immutable**: Cannot edit/delete posted transactions
7. **No Negative Stock**: Block by default
8. **Tenant Isolation**: Every query filters by `tenant_id`
9. **Money As Integers**: PKR stored as integers, no floats
10. **Referential Integrity**: Every entry references its transaction

### 4.4 When Confused or Blocked

```
STOP. Do not guess.

1. State the specific confusion
2. Reference conflicting sources (if any)
3. Present options with tradeoffs
4. Wait for human resolution

Example:
"I see two different approaches in the docs:
- 02-data-model.md says X
- IMPLEMENTATION_PLAN.md says Y

Which takes precedence? The implications are:
- If X: [consequences]
- If Y: [consequences]"
```

---

## 5. Context Management

### 5.1 Essential Context Files

Always read these before major work:

```
Priority 1 (Always):
├── AGENTS.md                 # This file - operational guide
├── .claude/CLAUDE.md         # Agent behavior rules
└── backend/prisma/schema.prisma  # Current schema

Priority 2 (Per-Task):
├── Documentation/PHASE_IMPLEMENTATIONS.md  # How past phases were built
├── Documentation/IMPLEMENTATION_PLAN*.md   # Phase details
└── Documentation/docs/[relevant].md        # Domain specs

Priority 3 (Reference):
├── backend/src/[module]/*.ts  # Existing implementations
└── Documentation/docs/14-decision-log.md  # Past decisions
```

### 5.2 Context Preservation Between Sessions

At the end of each significant session, update:

```markdown
## Session Summary - [Date]

### Work Completed
- [item 1]
- [item 2]

### Current State
- Phase: [X]
- Last file modified: [path]
- Tests passing: [yes/no]

### Next Steps
1. [step]
2. [step]

### Open Questions
- [question needing resolution]
```

### 5.3 Subagent Usage

For complex explorations, spawn subagents to:
- Investigate unfamiliar code areas
- Research implementation approaches
- Validate assumptions against codebase
- Run targeted tests

This preserves main context while gathering information.

---

## 6. Technology Stack

### Backend

| Technology | Version | Purpose |
|------------|---------|---------|
| NestJS | 11.x | Framework |
| Prisma | 6.x | ORM |
| PostgreSQL | 14+ | Database |
| TypeScript | 5.x | Language |
| Jest | 30.x | Testing |
| Winston | 3.x | Logging |

### Commands

```bash
# Development
cd backend && npm run start:dev

# Testing
cd backend && npm test              # Unit tests
cd backend && npm run test:e2e      # E2E tests

# Database
cd backend && npx prisma migrate dev    # Apply migrations
cd backend && npx prisma generate       # Generate client
cd backend && npx prisma studio         # Visual editor

# Build
cd backend && npm run build
```

---

## 7. Current Implementation Status

### Phase 1: Complete ✅

**Delivered**:
- [x] NestJS application structure
- [x] JWT authentication (register, login, refresh tokens)
- [x] Prisma setup with Tenant/User models
- [x] Global exception filter
- [x] Validation pipes (class-validator)
- [x] Logging (Winston, JSON format)
- [x] Health endpoints (/health, /health/db)
- [x] Request context middleware
- [x] Tenant scoping middleware
- [x] Rate limiting + Helmet security
- [x] CORS configuration
- [x] Unit tests for auth service

**Files Created**:
```
backend/
├── src/
│   ├── app.module.ts
│   ├── main.ts
│   ├── auth/           # Authentication module
│   ├── common/         # Shared utilities
│   ├── config/         # Configuration
│   ├── health/         # Health checks
│   └── prisma/         # Database service
├── prisma/
│   └── schema.prisma   # Tenant + User models
└── test/
```

### Phase 2: Complete ✅

**Delivered**:
- [x] Complete schema (all 14 tables: Tenant, User, Supplier, Customer, Product, PaymentAccount, Transaction, TransactionLine, InventoryMovement, LedgerEntry, PaymentEntry, Allocation, ImportBatch, ImportRow)
- [x] All foreign keys and constraints defined in `prisma/schema.prisma`
- [x] All necessary indexes for performance defined in `prisma/schema.prisma`
- [x] Initial seed script (`prisma/seed.ts`) created
- [x] One comprehensive migration (`20260203105501_add_complete_schema`) applied

**Files Involved**:
```
backend/
├── prisma/
│   ├── schema.prisma # All 14 tables, FKs, indexes
│   ├── seed.ts       # Initial data seeding
│   └── migrations/   # Migration files
```

### Phase 3: Complete ✅

**Delivered**:
- [x] **4 NestJS Modules for Master Data APIs**: Suppliers, Customers, Products, Payment Accounts
- [x] **20 API Endpoints Implemented**: 5 CRUD-like operations per module (create, list+search, get one, update fields, update status)
- [x] **Shared Utilities**: `PaginationQueryDto`, `UpdateStatusDto`, `paginate.ts` for consistent API design
- [x] **Tenant Scoping**: All API operations are tenant-scoped, cross-tenant access returns 404
- [x] **Validation**: Robust DTO-based validation in place for all endpoints
- [x] **_computed Fields**: Placeholder computed fields integrated into responses for future functionality
- [x] **Comprehensive Testing**: Dedicated unit and integration tests for all 4 modules (161/161 tests passing across the suite)

**Files Created/Modified**:
```
backend/
├── src/
│   ├── app.module.ts                   # Modules registered
│   ├── common/
│   │   ├── dto/
│   │   │   ├── pagination-query.dto.ts
│   │   │   └── update-status.dto.ts
│   │   └── utils/
│   │       └── paginate.ts
│   ├── customers/                      # New module
│   │   ├── dto/...
│   │   ├── customers.controller.ts
│   │   ├── customers.module.ts
│   │   └── customers.service.ts
│   ├── payment-accounts/               # New module
│   │   ├── dto/...
│   │   ├── payment-accounts.controller.ts
│   │   ├── payment-accounts.module.ts
│   │   └── payment-accounts.service.ts
│   ├── products/                       # New module
│   │   ├── dto/...
│   │   ├── products.controller.ts
│   │   ├── products.module.ts
│   │   └── products.service.ts
│   └── suppliers/                      # New module
│       ├── dto/...
│       ├── suppliers.controller.ts
│       ├── suppliers.module.ts
│       └── suppliers.service.ts
└── test/
    ├── integration/
    │   ├── customers.integration.spec.ts
    │   ├── payment-accounts.integration.spec.ts
    │   ├── products.integration.spec.ts
    │   └── suppliers.integration.spec.ts
    └── unit/
        ├── customers.service.spec.ts
        ├── payment-accounts.service.spec.ts
        ├── products.service.spec.ts
        └── suppliers.service.spec.ts
```

### Phase 4: Complete ✅

**Delivered**:
- [x] **Core Posting Engine:** Implemented logic for atomic and idempotent posting of `PURCHASE` and `SALE` transactions.
- [x] **New `Transactions` Module:** Contains `transactions.controller.ts`, `transactions.service.ts` for draft management and read operations, and `posting.service.ts` for all core posting logic.
- [x] **Transaction DTOs:** Implemented DTOs for purchase/sale lines, draft creation, transaction posting, and listing queries.
- [x] **Balance & Stock Endpoints:** Extended `Products`, `Suppliers`, `Customers`, and `PaymentAccounts` modules with new endpoints for real-time stock and balance calculations using raw SQL queries.
- [x] **Comprehensive Testing:** Added numerous unit and integration tests covering draft creation, purchase/sale posting, idempotency, concurrency, validation, and all new balance/stock query endpoints. Total tests: 247 passing.
- [x] **Idempotency & Concurrency Control:** Posting logic uses `Serializable` transactions and `idempotencyKey` to ensure data integrity under concurrent operations.

### Phase 5: Complete ✅

**Delivered**:
- [x] **Payment & Allocation Logic:** Implemented the core logic for applying customer and supplier payments to open invoices.
- [x] **New API Endpoints:** Created endpoints for creating payment drafts (`/customer-payments/draft`, `/supplier-payments/draft`), listing allocations, and fetching open documents for suppliers/customers.
- [x] **Auto-Allocation:** The posting service can now automatically allocate payments to the oldest invoices if not specified manually.
- [x] **New Tests:** Added 44 new integration tests to cover all payment and allocation functionality.

### Phase 6: Complete ✅

**Delivered**:
- [x] **New Transaction Types:** Implemented four major new transaction types: `SUPPLIER_RETURN`, `CUSTOMER_RETURN`, `INTERNAL_TRANSFER`, and `ADJUSTMENT`.
- [x] **New API Endpoints:** Added new DTOs and controller methods for creating drafts of all new transaction types.
- [x] **Core Posting Logic:** The `PostingService` was updated to handle the posting of all four new types, including return validation and refund processing.
- [x] **Extensive Testing:** Added 46 new integration tests to validate the new functionality, bringing the total to 341 passing tests.

### Phase 7: Complete ✅

**Delivered (Verified)**:
- [x] **Phase 7a (Reports Module):** Implemented 9 new analytical endpoints for balances, stock, pending receivables/payables, and statements.
- [x] **Phase 7b (Dashboard Module):** Implemented the `GET /dashboard/summary` endpoint providing a tenant-wide financial snapshot.
- [x] **Phase 7c (Import System):** Implemented 6 new endpoints for the full data import lifecycle (Upload, Map, Commit, Rollback, List, Detail) supporting CSV/XLSX.
- [x] **Phase 7d (Production Hardening):**
  - [x] Containerization assets (`Dockerfile`, `docker-compose.yml`, `.dockerignore`)
  - [x] CI/CD configuration (`.github/workflows/ci.yml`)
  - [x] Backup & restore scripts (`scripts/backup-db.sh`, `scripts/restore-db.sh`)
  - [x] Final `deployment-guide.md`
- [x] **Hardening (Partial from previous):** Graceful shutdown enabled, global request size limit added, and health check enhanced with version/uptime/DB status.
- [x] **Documentation:** `import-guide.md` created and `04-api-spec.md` updated with all new endpoints.


---

## 8. Decision Log (Quick Reference)

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-02-03 | Global unique email | One identity per email across system |
| 2026-02-03 | `created_by` onDelete: SetNull | Preserve audit data when users deleted |
| 2026-02-02 | Prisma v6 | Schema compatibility |
| 2026-02-02 | NestJS 11 | Latest stable with good TypeScript support |

For full decision log, see `Documentation/docs/14-decision-log.md`

---

## 9. Testing Requirements

### Per-Phase Testing

| Test Type | When | Coverage Target |
|-----------|------|-----------------|
| Unit Tests | Every service method | 80%+ |
| Integration Tests | Every API endpoint | All happy + error paths |
| Invariant Tests | Core business logic | 100% of invariants |
| Concurrency Tests | Posting engine | Race conditions covered |

### Test Commands

```bash
# Run all tests
npm test

# Run with coverage
npm test -- --coverage

# Run specific test file
npm test -- auth.service.spec.ts

# Run E2E tests
npm run test:e2e
```

### Test Naming Convention

```typescript
describe('AuthService', () => {
  describe('register', () => {
    it('should create tenant and user on valid input', async () => {});
    it('should throw ConflictException on duplicate email', async () => {});
    it('should hash password with bcrypt', async () => {});
  });
});
```

---

## 10. Validation Gates

Before moving to the next phase, ALL must be true:

```
PHASE COMPLETION CHECKLIST:
□ All deliverables implemented
□ All tests passing (npm test)
□ No TypeScript errors (npm run build)
□ Documentation updated
□ Code reviewed
□ Commit made with proper message
□ AGENTS.md status updated
```

**If any criterion fails**: Fix before proceeding. Do NOT move to next phase.

---

## 11. Troubleshooting

### Common Issues

| Issue | Solution |
|-------|----------|
| Prisma client not found | Run `npx prisma generate` |
| Migration fails | Check `DATABASE_URL` in `.env` |
| Tests timeout | Check database connection |
| Import errors | Verify tsconfig paths |

### Debug Commands

```bash
# Check Prisma schema validity
npx prisma validate

# View generated SQL
npx prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma

# Check for TypeScript errors
npx tsc --noEmit
```

---

## 12. References

### Internal Documentation
- [Implementation Plan Overview](Documentation/IMPLEMENTATION_PLAN_README.md)
- [Architecture & Invariants](Documentation/docs/01-architecture.md)
- [Data Model](Documentation/docs/02-data-model.md)
- [API Specification](Documentation/docs/04-api-spec.md)

### Internal Walkthroughs
- [PHASE_IMPLEMENTATIONS.md](Documentation/PHASE_IMPLEMENTATIONS.md) - How each phase was implemented with code examples

### External Resources
- [NestJS Documentation](https://docs.nestjs.com)
- [Prisma Documentation](https://www.prisma.io/docs)
- [Jest Documentation](https://jestjs.io/docs)

---

## 13. Changelog

### 2026-02-03 (Updated)
- Created PHASE_IMPLEMENTATIONS.md - detailed walkthrough of how Phase 1 & 2 were built
- Added code examples and architectural patterns used
- Documented testing approach and commit patterns
- Cross-referenced in Priority 2 context files

### 2026-02-03 (Initial)
- Created AGENTS.md with comprehensive implementation guide
- Documented Phase 1 completion status
- Established documentation standards
- Added agent operational guidelines

---

**Last Updated**: 2026-02-11
**Maintainer**: Human + AI Collaboration
**Status**: Active - Phase 7 Complete
