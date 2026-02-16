# PHASE SUMMARY REPORT

Title:
Phase 10 — imports

Module Purpose:
- Provide a tenant-scoped bulk import lifecycle (`upload -> map -> validate -> commit -> rollback`) for suppliers, customers, products, and opening balances.

Top Risks:
1. Opening-balance rollback corruption risk for repeated same-account rows in one batch (can restore intermediate value instead of true pre-import baseline).
2. Opening-balance commit can overwrite `payment_accounts.opening_balance` without checking existing payment history, which can retroactively distort financial reporting.
3. Input and pagination guardrails are incomplete (`GET /imports/:id` page/limit not bounded; list/detail limits can be abused).

Common Failure Patterns:
- Validation asymmetry: map-time validation and commit-time lookup rules are inconsistent (e.g., case-insensitive account validation vs case-sensitive commit lookup).
- DTO constraints are shallow for dynamic mapping payloads (`columnMappings` shape not strict).
- Endpoint-level tests focus on happy-path lifecycle but miss security matrix (401/403/tenant isolation per endpoint) and adversarial edge cases.

Financial Integrity Risks:
- Opening balance is a base term in account balance formulas; unsafe overwrite/restore behavior directly affects cash/bank balances and downstream reports.
- Rollback for opening balances is not guaranteed to be value-preserving when one account appears multiple times in a single batch.

Architectural Weaknesses:
- `ImportsService` centralizes parsing, validation, orchestration, and persistence in a single large service, increasing change risk.
- Import lifecycle does not use a formal state machine abstraction; transitions are encoded imperatively.
- Commit path does not expose explicit idempotency semantics despite broader API notes that POST operations should be retry-safe.

Missing Tests:
- 401 unauthorized tests for all six imports endpoints.
- 403 role-enforcement tests for `POST /imports/:id/commit` and `POST /imports/:id/rollback`.
- Tenant-isolation tests for `POST /imports`, `POST /imports/:id/map`, `POST /imports/:id/commit`, `POST /imports/:id/rollback`, and `GET /imports`.
- `GET /imports/:id` pagination validation tests (`page<1`, `limit<1`, oversized `limit`).
- Upload stress/edge tests: >10,000 rows, duplicate headers, MIME spoofing.
- Opening balance regression: same account appears multiple times in one batch, then rollback.

Frontend Impact:
- Import UI can present misleading outcomes when edge cases are hit (e.g., validated account name later failing commit due casing mismatch).
- Pagination without strict limits can degrade batch-detail screens under large imports.
- Financial dashboards/reports can show incorrect balances if unsafe opening-balance flows are exercised.

Phase Verdict:
❌ Blocker
