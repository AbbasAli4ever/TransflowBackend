# PHASE SUMMARY REPORT

Title:
Phase 9 — Transactions

Module Purpose:
- Own draft creation, posting, retrieval, and allocation visibility for core financial transaction lifecycles (purchase/sale/payments/returns/transfers/adjustments).

Top Risks:
1. Return and adjustment posting can violate stock invariants (`SUPPLIER_RETURN_OUT` and `ADJUSTMENT_OUT` lack stock checks), enabling negative inventory.
2. Return quantity enforcement is bypassable with duplicate `sourceTransactionLineId` lines in one request/draft because validation is per-line, not aggregated.
3. Adjustment posting authorization is incomplete: draft creation is role-gated, but posting is not role-gated, enabling non-admin posting within tenant.

Common Failure Patterns:
- Critical invariants enforced in some transaction types (SALE) but not consistently across all outbound stock types.
- Draft-time validation present, but post-time revalidation is incomplete for status/role/control fields.
- DTO-level validation and business-spec validation diverge (e.g., zero price/cost allowed, optional return handling).

Financial Integrity Risks:
- Negative stock can be created through supplier returns/adjustments.
- Over-returns can exceed original sold/purchased quantity in aggregate edge cases.
- Ambiguous customer return treatment when `returnHandling` is omitted can lead to inconsistent receivable/credit behavior.

Architectural Weaknesses:
- Business-critical fields are encoded into generic text (`description` for adjustment direction/reason) instead of structured schema fields.
- Draft endpoints are not idempotent despite global idempotency guidance.
- Allocation listing uses endpoint-specific pagination DTO without max limit guard.

Missing Tests:
- Supplier return posting when current stock is insufficient.
- Adjustment posting by non-admin user (should be forbidden if policy is admin-only end-to-end).
- Adjustment OUT stock-underflow scenarios.
- Duplicate source line in same return payload (supplier and customer returns).
- Customer return posting without `returnHandling`.
- Post-time account/entity deactivation between draft and posting for payment flows.

Frontend Impact:
- UI may show successful operations that violate accounting expectations (negative stock, implicit store credit).
- Retry behavior is inconsistent for drafts (duplicate drafts possible without idempotency).
- Allocation and transaction filters can produce non-intuitive results under ambiguous query combinations/date semantics.

Phase Verdict:
❌ Blocker

