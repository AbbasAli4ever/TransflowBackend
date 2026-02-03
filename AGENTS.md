# AGENTS.md - Finance System Implementation Guide

> **Purpose**: This document is the single source of truth for AI coding agents working on this project. It provides context, roadmap, documentation standards, and operational guidelines.

---

## Quick Reference

| Item | Location |
|------|----------|
| Current Phase | **Phase 1** (Complete) |
| Next Phase | **Phase 2**: Schema V1 + Constraints |
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
| 2 | Schema V1 + Constraints | ⏳ Next | 14 tables, FKs, indexes, seeds |
| 3 | Master Data APIs | 📋 Planned | Suppliers, Customers, Products, Accounts CRUD |
| 4 | Posting Engine Core | 📋 Planned | PURCHASE, SALE posting with entries |
| 5 | Payments + Allocations | 📋 Planned | Standalone payments, allocation system |
| 6 | Returns + Transfers | 📋 Planned | Returns with strict rules, internal transfers |
| 7 | Queries + Hardening | 📋 Planned | Dashboards, imports, production prep |

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
├── Documentation/IMPLEMENTATION_PLAN*.md  # Phase details
└── Documentation/docs/[relevant].md       # Domain specs

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

### Phase 2: Next Up ⏳

**To Deliver**:
- [ ] Complete schema (14 tables)
- [ ] All foreign keys and constraints
- [ ] All indexes for performance
- [ ] Seed scripts for testing
- [ ] Migration tested and documented

**Key Decisions Already Made**:
- Email is globally unique (not per-tenant)
- `created_by` FKs use `onDelete: SetNull`
- Money stored as integers (PKR)
- Weighted average costing for V1

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

### External Resources
- [NestJS Documentation](https://docs.nestjs.com)
- [Prisma Documentation](https://www.prisma.io/docs)
- [Jest Documentation](https://jestjs.io/docs)

---

## 13. Changelog

### 2026-02-03
- Created AGENTS.md with comprehensive implementation guide
- Documented Phase 1 completion status
- Established documentation standards
- Added agent operational guidelines

---

**Last Updated**: 2026-02-03
**Maintainer**: Human + AI Collaboration
**Status**: Active - Phase 2 Pending
