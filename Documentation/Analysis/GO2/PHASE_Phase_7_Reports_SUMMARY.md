# PHASE SUMMARY REPORT

Title:
Phase 7 — Reports

Module Purpose:
- Provide tenant-scoped analytical read APIs for balances, statements, stock, and pending receivable/payable aging using event-entry tables as source of truth.

Top Risks:
1. Pending receivables/payables can become financially inconsistent because open-document outstanding is allocation-driven while net balance is ledger-driven (return/credit effects are not reconciled).
2. Product stock valuation logic is unsafe: quantity includes customer returns/adjustments while cost pool excludes corresponding cost effects, producing materially wrong `avgCost` and `stockValue`.
3. Date validation is format-only; calendar-invalid dates can bypass DTO validation and fail at query cast/runtime layer.

Common Failure Patterns:
- Regex-only date checks used instead of strict parsed-date validation.
- Reliance on service-layer invariants without DB-level safeguards (posted provenance not consistently enforced in report SQL).
- BigInt-to-number conversion is guarded per value, but downstream arithmetic across values is unguarded.
- Incomplete deterministic ordering keys for statement row sequencing under timestamp ties.

Financial Integrity Risks:
- Misstated pending collections/payables at document level in presence of returns/credits.
- Misstated inventory valuation from asymmetric cost-pool math.
- Cash statement/balance contamination risk if non-posted/corrupt payment entries exist (queries do not consistently enforce `POSTED`).

Architectural Weaknesses:
- No repository abstraction or centralized query policy for posted-only entry provenance.
- No DB constraint enforcing allocation semantics (payment txn type vs applied doc type), leaving correctness to service code.
- Repeated raw SQL logic without shared audited primitives increases drift risk.

Missing Tests:
- Unauthorized (401) and forbidden-role (403) tests for all reports endpoints.
- Invalid calendar-date tests (`2026-02-30`, `2026-13-01`) for all date-driven APIs.
- Pending report reconciliation tests with supplier/customer returns and unapplied credits.
- Product valuation tests for customer returns and adjustments.
- Statement ordering determinism tests with equal `transaction_date` and near-identical timestamps.
- High-value precision boundary tests near `Number.MAX_SAFE_INTEGER`.

Frontend Impact:
- Receivables/payables screens can show totals that do not reconcile with underlying open document rows.
- Inventory reports can display believable but wrong valuation, leading to incorrect business decisions.
- Users may receive opaque 500 responses for malformed dates that look syntactically valid.

Phase Verdict:
❌ Blocker
