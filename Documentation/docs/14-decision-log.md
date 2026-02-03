# Decision Log

This log records major architectural and product decisions so future contributors understand the "why."

## 2026-02-03

- **Global unique email (not per-tenant)**
  - Reason: One identity per email across the entire system. Simplifies user management and prevents confusion when users work across tenants in future.
  - Trade-off: Users cannot have separate accounts per tenant with same email.
  - Decision: Accepted for V1. Can revisit if multi-tenant per user becomes requirement.

- **`created_by` FK uses onDelete: SetNull**
  - Reason: Preserve business data and audit trail when users are deleted/deactivated.
  - Impact: Deleting a user sets their `created_by` references to NULL rather than cascading deletes.
  - Alternative rejected: `onDelete: Restrict` would block user deletion if they created any records.

- **AGENTS.md as primary agent context file**
  - Reason: Standardized format (agents.md) for AI coding agents, provides comprehensive context for implementation.
  - Complements: .claude/CLAUDE.md (agent behavior), IMPLEMENTATION_PLAN*.md (phase details).

- **Prisma v6 instead of v5**
  - Reason: Latest stable with better TypeScript integration.
  - Note: Some schema syntax differs from v5 examples online.

## 2026-02-02

- **Phase 1 implementation approach**
  - Reason: Start with minimal viable backend (auth, health, logging) before adding business logic.
  - Benefit: Establishes patterns and infrastructure that all subsequent phases build upon.

## 2026-02-01

- **Weighted Average Costing (V1)**
  - Reason: Simpler than FIFO and fits wholesale workflows.

- **Single-currency PKR (V1)**
  - Reason: Avoids conversion complexity and aligns with target market.

- **Append-only entries**
  - Reason: Auditability and accounting integrity.

- **Stack: NestJS + Prisma + Postgres + Next.js**
  - Reason: Stable, fast-to-ship, and good developer ergonomics.

- **Strict returns (must link to original line)**
  - Reason: Prevents over-returns and keeps audit trail clean.
