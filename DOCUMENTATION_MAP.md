# Documentation Map - Quick Navigation

> **TL;DR**: Start here if you're new to the project. This file points you to exactly what you need.

---

## 🎯 I'm Starting Work on [Phase X]

### Step 1: Read AGENTS.md (Required - 5 min)
**File**: `/AGENTS.md`
- Current phase status
- System invariants (non-negotiable rules)
- Task boundaries (✅ Always / ⚠️ Ask / 🚫 Never)
- Context files in priority order

### Step 2: Read Phase Implementation Details (Required - 10 min)
**File**: `Documentation/PHASE_IMPLEMENTATIONS.md`
- How previous phases were built
- Architecture patterns used
- Code examples and naming conventions
- Lessons learned
- Pre-implementation checklist for next phase

### Step 3: Read Phase Requirements (Required - 15 min)
**File**: `Documentation/IMPLEMENTATION_PLAN*.md`
- Detailed deliverables for your phase
- API endpoint specifications
- Validation rules
- Test cases

### Step 4: Understand the Domain (Context - 10 min)
**File**: `Documentation/docs/` (pick relevant)
- `01-architecture.md` - System invariants & design
- `02-data-model.md` - Complete schema specification
- `03-posting-patterns.md` - How posting engine works
- `04-api-spec.md` - REST API contracts
- `14-decision-log.md` - Why each decision was made

---

## 📚 Documentation Structure

```
Root Files:
├── AGENTS.md .......................... Operational guide for AI agents
├── DOCUMENTATION_MAP.md ............... This file - navigation guide
└── CHANGELOG.md ....................... Version history

Code:
└── backend/
    ├── src/auth/ ...................... Authentication implementation (Phase 1)
    ├── src/common/ .................... Shared utilities & patterns
    ├── prisma/
    │   ├── schema.prisma .............. Current database schema (Phase 2)
    │   └── seed.ts .................... Seed data for testing
    └── test/
        └── [test files] ............... Unit & integration tests

Documentation:
└── Documentation/
    ├── IMPLEMENTATION_PLAN_README.md .. Overview & navigation
    ├── IMPLEMENTATION_PLAN.md ......... Phases 1-3 detailed plan
    ├── IMPLEMENTATION_PLAN_PHASES_4-7.md ... Phases 4-5
    ├── IMPLEMENTATION_PLAN_PHASES_6-7_FINAL.md ... Phases 6-7
    ├── PHASE_IMPLEMENTATIONS.md ....... ⭐ HOW each phase was built (+ patterns)
    ├── README.md ...................... Setup instructions
    ├── CHANGELOG.md ................... Changes per version
    └── docs/
        ├── 00-overview.md ............ System overview
        ├── 01-architecture.md ........ Architecture & invariants
        ├── 02-data-model.md .......... Schema specification
        ├── 03-posting-patterns.md .... How posting works
        ├── 04-api-spec.md ............ REST API contracts
        ├── 05-testing.md ............ Testing strategy
        ├── 08-security.md ............ Auth & audit
        ├── 14-decision-log.md ........ Decision history
        └── [others] .................. Domain-specific specs
```

---

## 🔍 Find Information About...

| Topic | File | Section |
|-------|------|---------|
| System Invariants | `AGENTS.md` | § 4.3 |
| Task Boundaries | `AGENTS.md` | § 4.2 |
| Phase Status | `AGENTS.md` | § 2 |
| Phase 1 Implementation | `PHASE_IMPLEMENTATIONS.md` | § Phase 1 |
| Phase 2 Schema | `PHASE_IMPLEMENTATIONS.md` | § Phase 2 |
| Testing Patterns | `PHASE_IMPLEMENTATIONS.md` | § 1.5 & 2.7 |
| Architecture Decisions | `PHASE_IMPLEMENTATIONS.md` | § 1.2 & 2.2 |
| API Endpoints | `Documentation/docs/04-api-spec.md` | [All sections] |
| Database Schema | `backend/prisma/schema.prisma` | [All models] |
| Posting Engine | `Documentation/docs/03-posting-patterns.md` | [All sections] |
| Tenant Isolation | `AGENTS.md` § 4.3 | Invariant #8 |
| Idempotency | `AGENTS.md` § 4.3 | Invariant #5 |
| Decision Rationale | `Documentation/docs/14-decision-log.md` | [All entries] |
| Setup & Commands | `AGENTS.md` | § 6 |
| Error Messages | `Documentation/docs/04-api-spec.md` | Error Response section |

---

## 🚀 Quick Start for New Agents

### Workflow for Starting a Phase

```
1. Read AGENTS.md quickly (understand current status + invariants)
   └─ 5 minutes, reference section 2 (Phase Status) + section 4.3 (Invariants)

2. Read PHASE_IMPLEMENTATIONS.md for previous phase
   └─ 10 minutes, see patterns that will be replicated

3. Read IMPLEMENTATION_PLAN*.md for your phase
   └─ 15 minutes, know exactly what you're building

4. Skim relevant docs/ files
   └─ 10 minutes, understand domain context

5. Check backend/src/ for existing code
   └─ 5 minutes, see real implementations

6. Write code following established patterns

7. COMMIT with proper message (see PHASE_IMPLEMENTATIONS.md § Commit Pattern)
```

**Total Prep Time: ~45 minutes → Then implement with high confidence**

---

## 📋 Checklist: Before Implementing Phase N

```
Documentation:
□ Reviewed AGENTS.md (section 2: Phase Status)
□ Reviewed PHASE_IMPLEMENTATIONS.md (previous phase)
□ Reviewed IMPLEMENTATION_PLAN*.md (your phase section)
□ Identified architectural patterns to follow
□ Read test examples from previous phases

Code:
□ Reviewed existing backend/src/ implementations
□ Checked prisma/schema.prisma for relationships
□ Understood tenant isolation patterns
□ Found testing patterns to replicate

Clarity:
□ List of deliverables is clear
□ Edge cases documented
□ API contracts finalized
□ Test cases understood
```

If any checkbox is false: **Stop and read the relevant section first**.

---

## 💡 Reading Tips

### For Code Patterns
→ Read `PHASE_IMPLEMENTATIONS.md` with IDE open
→ Reference the actual code in `backend/src/` while reading

### For Schema Understanding
→ Read `Documentation/docs/02-data-model.md` with diagram (if exists)
→ Cross-check with `backend/prisma/schema.prisma`

### For Business Rules
→ Start with `Documentation/docs/01-architecture.md` (system invariants)
→ Then `Documentation/docs/03-posting-patterns.md` (workflows)
→ Finally `Documentation/docs/04-api-spec.md` (contract details)

### For API Contracts
→ Read `Documentation/docs/04-api-spec.md`
→ Check error response formats
→ Note idempotency requirements (Idempotency-Key header)

---

## 🔗 Cross-References

These documents reference each other:

```
AGENTS.md
  ├─→ PHASE_IMPLEMENTATIONS.md (how to code)
  ├─→ IMPLEMENTATION_PLAN*.md (what to code)
  ├─→ docs/01-architecture.md (why)
  └─→ docs/02-data-model.md (schema)

PHASE_IMPLEMENTATIONS.md
  ├─→ Code in backend/src/ (real examples)
  ├─→ backend/prisma/schema.prisma (actual schema)
  └─→ IMPLEMENTATION_PLAN*.md (specifications)

IMPLEMENTATION_PLAN*.md
  ├─→ docs/02-data-model.md (schema details)
  ├─→ docs/04-api-spec.md (endpoint contracts)
  └─→ PHASE_IMPLEMENTATIONS.md (previous patterns)
```

**Reading Tip**: Start with AGENTS.md, then follow the arrow to the document you need.

---

## ✅ Validation Gates

Before moving to the next phase, verify in AGENTS.md § 10:

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

---

## 📞 If You're Stuck

| Issue | Solution |
|-------|----------|
| "What are system invariants?" | Read AGENTS.md § 4.3 |
| "How should I structure my code?" | Read PHASE_IMPLEMENTATIONS.md § Key Patterns |
| "How do I test this?" | Read PHASE_IMPLEMENTATIONS.md + IMPLEMENTATION_PLAN § Testing |
| "What's the schema for X?" | Read backend/prisma/schema.prisma or docs/02-data-model.md |
| "What API should I build?" | Read IMPLEMENTATION_PLAN*.md or docs/04-api-spec.md |
| "Why was decision X made?" | Read docs/14-decision-log.md |
| "What's the posting engine?" | Read docs/03-posting-patterns.md |
| "How's Phase N scheduled?" | Read AGENTS.md § 2 (Phase Status Tracker) |

---

**Last Updated**: 2026-02-03
**Purpose**: Single source of truth for documentation navigation
**Audience**: AI agents and human developers
