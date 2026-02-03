# Finance System - Copilot Instructions

## Documentation Structure

**ALWAYS start here**: `Documentation/docs/` is the single source of truth. The Notion export is legacy/reference only.

Required reading before making changes:
- `Documentation/docs/00-overview.md` - Scope, glossary, reading paths
- `Documentation/docs/01-architecture.md` - System invariants (non-negotiable)
- `Documentation/docs/02-data-model.md` - Full schema and canonical queries
- `Documentation/docs/03-posting-patterns.md` - Event-to-entries posting rules
- `Documentation/docs/16-tech-stack.md` - Implementation stack

## Build, Test, and Development

### Backend (NestJS + Prisma)

```bash
# Install dependencies
cd backend && npm install

# Development
npm run start:dev         # Watch mode

# Build
npm run build

# Testing
npm test                  # All tests
npm run test:watch        # Watch mode
npm run test:e2e          # End-to-end tests
```

## Architecture Overview

Finance System is **event-sourced at the business level**:

```
Business Event (Transaction) → Posting → Immutable Entries → Derived Balances
```

### Core Truth Model

1. **Event → Entries only**: Every business action creates a Transaction (event) and posts entries (inventory/ledger/payment). No other code path modifies balances.
2. **Append-only entries**: `ledger_entries`, `payment_entries`, `inventory_movements` are never edited in-place.
3. **Balances are derived**: All balances computed from entries (caches allowed only if rebuildable).
4. **Atomic posting**: All posting happens in a single DB transaction.
5. **Idempotency**: All write endpoints use idempotency keys per tenant.

### Transaction Lifecycle

- **Draft** → **Posted** → (Voided in V1.1)
- Drafts can be deleted
- Posted transactions cannot be deleted (void only)
- Every posted transaction has an immutable `document_number`

## Key Conventions

### Money and Quantities

- **Money stored as integers** (PKR, no floats)
- **Quantities are integers** (whole units only)
- Single-currency tenant in V1 (PKR)

### Database Conventions

Every table has:
- `id (uuid)`
- `tenant_id (uuid)`
- `created_at`, `updated_at`
- Optional: `created_by (uuid)`, `source`, `notes`

### Inventory Rules

- **No negative stock** (default, unless explicitly enabled by tenant)
- **Concurrency-safe posting**: Use row locks/optimistic versioning to prevent race conditions
- **Cost method**: Weighted Average (V1), FIFO later
- **Cost basis captured at receipt**: Purchase lines store unit cost, qty, supplier, date

### Payment Accounts

- **Payment methods are real accounts**: Cash, JazzCash, Bank, Card have balances derived from `payment_entries`
- **No floating money**: Every payment identifies the payment account used and what it settles
- **Internal transfers are two-leg**: from_account (negative) + to_account (positive)

### Transaction Types

```
PURCHASE, SALE, SUPPLIER_PAYMENT, CUSTOMER_PAYMENT,
SUPPLIER_RETURN, CUSTOMER_RETURN, INTERNAL_TRANSFER, ADJUSTMENT
```

### Movement Types

```
PURCHASE_IN, SALE_OUT, SUPPLIER_RETURN_OUT,
CUSTOMER_RETURN_IN, ADJUSTMENT_IN, ADJUSTMENT_OUT
```

## Critical Behaviors (From Senior Engineer Workflow)

### Assumption Surfacing

Before implementing non-trivial features, explicitly state assumptions:

```
ASSUMPTIONS I'M MAKING:
1. [assumption]
2. [assumption]
→ Correct me now or I'll proceed with these.
```

### Confusion Management

When encountering inconsistencies:
1. STOP. Do not guess.
2. Name the specific confusion.
3. Present the tradeoff or ask the clarifying question.
4. Wait for resolution.

Example: "I see X in file A but Y in file B. Which takes precedence?"

### Simplicity Enforcement

- Resist overcomplication
- Prefer boring, obvious solutions
- Before finishing: Can this be done in fewer lines?
- Would a senior dev say "why didn't you just..."?

### Scope Discipline

Touch only what you're asked to touch. Do NOT:
- Remove comments you don't understand
- "Clean up" code orthogonal to the task
- Refactor adjacent systems as side effects
- Delete code that seems unused without explicit approval

### Dead Code Hygiene

After refactoring:
- Identify unreachable code
- List it explicitly
- Ask: "Should I remove these now-unused elements: [list]?"

## Testing Philosophy

Financial systems are **test-first** because bugs corrupt balances permanently.

### Required Test Coverage

1. **Unit Tests**: Posting calculations, allocation logic, totals, weighted average cost
2. **Integration Tests**: API endpoints + database writes
3. **Invariant Tests**: Balances == sum of entries, no edits to posted data
4. **Concurrency Tests**: No negative stock under concurrent sales

### Core Test Scenarios

- S1: Purchase → Sale → Stock Check
- S2: Partial Payment → Full Payment → Balance Zero
- S3: Concurrent Sales (only one succeeds if stock insufficient)
- S4: Return Cannot Exceed Original Quantity
- S5: Idempotency (duplicate requests don't double-post)

## Backend Structure (NestJS)

```
src/
├── main.ts
├── app.module.ts
├── config/           # Configuration modules
├── common/           # Shared utilities
│   ├── middleware/   # Request context, tenant context
│   ├── decorators/   # @Tenant, @Public
│   └── guards/       # JWT auth, tenant scope
├── auth/             # Authentication module
├── health/           # Health checks
└── prisma/           # Prisma service
```

### Tenant Scoping

- Every request must have `tenant_id` in context
- Use `@Tenant()` decorator to access tenant in controllers
- Guards enforce tenant scope on all protected routes

## Change Summary Format

After modifications, always provide:

```
CHANGES MADE:
- [file]: [what changed and why]

THINGS I DIDN'T TOUCH:
- [file]: [intentionally left alone because...]

POTENTIAL CONCERNS:
- [any risks or things to verify]
```

## Failure Modes to Avoid

1. Making wrong assumptions without checking
2. Not managing confusion (silently picking one interpretation)
3. Not surfacing inconsistencies
4. Being sycophantic to bad ideas
5. Overcomplicating code and APIs
6. Not cleaning up dead code after refactors
7. Modifying code orthogonal to the task
8. Removing things you don't fully understand

## Tech Stack

- **Backend**: Node.js, NestJS, Prisma ORM, class-validator
- **Database**: PostgreSQL
- **Frontend**: Next.js, shadcn/ui, Tailwind
- **Auth**: Email + password (bcrypt), JWT
- **Hosting**: AWS (App Runner, RDS, S3/CloudFront)
