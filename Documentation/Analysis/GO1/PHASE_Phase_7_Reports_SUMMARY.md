# PHASE SUMMARY REPORT

Title:
Phase 7 — Reports

Module Purpose:
- Provide tenant-scoped, point-in-time financial reporting for AP/AR balances, payment account balances, inventory stock/valuation, pending documents, and account statements.

Top Risks:
1. Pending receivables/payables are historically inaccurate because open-document outstanding uses allocations without an `asOfDate` boundary on the payment side.
2. Product stock valuation can be materially wrong; `avgCost` is derived from purchases only and does not robustly account for supplier-return valuation effects and non-purchase inflows.
3. Monetary aggregates are converted from SQL bigint to JS `Number` without safe-range controls, creating silent precision-loss risk.

Common Failure Patterns:
- Trust in implicit invariants instead of explicit SQL guards (e.g., posted-only semantics not always enforced in report queries).
- Multi-query reports are built outside a snapshot transaction, so outputs can combine different read moments under concurrent posting.
- Validation is syntactic (date string format) but misses semantic rules (dateFrom/dateTo ordering, report-range guardrails).
- Authorization is coarse; all authenticated tenant users can access sensitive reports with no role-level checks.

Financial Integrity Risks:
- Pending reports can show customer/supplier balances that do not reconcile with their own open-document lines for the same `asOfDate`.
- Inventory stock value can be overstated or understated after supplier returns and adjustment-heavy histories.
- Large tenants risk arithmetic drift from integer precision loss in API-layer conversions.
- Default `asOfDate` uses server UTC date, not tenant timezone business date, causing off-by-one-day snapshots near day boundaries.

Architectural Weaknesses:
- No repository boundary; business-critical SQL is embedded directly in service methods, increasing duplication and inconsistent safeguards.
- No consistent read model abstraction for as-of reporting; each endpoint independently re-implements balance math.
- Read consistency policy is undefined for multi-query reports (no repeatable-read/snapshot contract).

Missing Tests:
- Critical regression tests for future-allocation leakage into historical pending reports.
- Product valuation tests for supplier-return-heavy scenarios and adjustment-only stock states.
- Authorization (`401/403`) tests for all report endpoints.
- Cross-tenant isolation tests for every report route (only partial coverage exists).
- Validation tests for invalid UUID/query params and inverted statement date ranges.
- Precision boundary tests with large aggregate values.

Frontend Impact:
- AR/AP aging screens can display contradictory totals vs document rows.
- Inventory valuation widgets can show inaccurate stock value and margin context.
- Statement screens may silently accept invalid ranges and display misleading outputs.
- Date defaults may not align with tenant-local “today,” confusing users near midnight.

Phase Verdict:
❌ Blocker
