# PHASE SUMMARY REPORT

Title:
Phase 5 — Payment Accounts

Module Purpose:
- Manage tenant-scoped payment accounts (Cash/Bank/Wallet/Card), expose account metadata, and provide derived current balance from `payment_entries` + `opening_balance`.

Top Risks:
1. `PATCH /payment-accounts/:id/status` has a TOCTOU race between non-zero-balance check and status update; concurrent postings can bypass deactivation intent.
2. Response contract drift: DTO/docs advertise `_computed` for account read/list responses, but implementation returns raw rows without `_computed`.
3. Input normalization gaps (trim/canonicalization/reserved-name policy) can create semantically duplicate accounts and reporting ambiguity.

Common Failure Patterns:
- Service-layer tenant scoping is manually repeated everywhere (no automatic query scoping), so safety depends on developer discipline.
- Several critical rules exist in comments/docs but are not fully enforced or tested (deactivation race behavior, role 403 coverage, same-status idempotency semantics).

Financial Integrity Risks:
- Status deactivation can be inconsistent under concurrency with payment posting.
- Final `currentBalance` arithmetic is not explicitly safe-range-guarded after bigint conversion.
- Contract mismatch may push balance derivation into clients, increasing risk of incorrect financial display.

Architectural Weaknesses:
- No repository abstraction or shared policy layer for account invariants; logic is concentrated in service methods with mixed Prisma/raw SQL.
- No DB-level safeguard preventing new payment entries against an account that was concurrently inactivated.

Missing Tests:
- Role authorization tests (403) for `POST`, `PATCH /:id`, `PATCH /:id/status`.
- Deactivation negative path: non-zero balance should block status change.
- Concurrency test: posting payment while deactivating same account.
- Response-contract tests for `_computed` presence/absence alignment.
- Boundary tests for numeric precision and malformed UUIDs on all routes.

Frontend Impact:
- Frontend integrating against Swagger/DTO contract may expect `_computed` and fail or misrender balances for list/detail screens.
- Error semantics mismatch (expected 409 vs implemented 400 on non-zero-balance deactivation) can break client-side error handling rules.

Phase Verdict:
⚠ Needs fixes
