# PHASE SUMMARY REPORT

Title:
Phase 8 — Suppliers

Module Purpose:
- Manage supplier master data and expose supplier-focused operational read models (`balance`, `open-documents`) used by posting/allocation workflows.

Top Risks:
1. `GET /suppliers/:id/open-documents` can overstate outstanding when supplier returns/credits exist, creating financial inconsistency with AP balance.
2. `PATCH /suppliers/:id/status` deactivation safeguard can be bypassed because purchase draft posting path does not revalidate supplier active status at post time.
3. Supplier balance/read contracts are drifting (`SupplierBalanceResponseDto` vs actual payload keys), raising integration and reconciliation risk.

Common Failure Patterns:
- TOCTOU checks (read-then-write without lock/version checks).
- Cross-module invariant dependence without enforcement at both edges (status module assumes posting module behavior).
- Spec/DTO/runtime drift in response structures.

Financial Integrity Risks:
- Open-document totals can diverge from true payable state.
- Inactive suppliers can still end up with new AP obligations from older drafts.
- Operational screens can show contradictory liability numbers across endpoints.

Architectural Weaknesses:
- Tenant safety and invariants are enforced mostly at service/query level, not by composite DB constraints.
- Raw SQL read models are duplicated across modules with limited shared invariant guards.
- Functional uniqueness index for supplier names exists in migration SQL but not in Prisma model metadata.

Missing Tests:
- Role-based 403 for supplier create/update/status endpoints.
- Deactivation rejection when supplier has outstanding AP.
- Supplier return + open-documents consistency tests.
- Balance response contract key assertions (`totalPayments`/`totalReturns` vs documented fields).
- Concurrent status-update correctness and status log assertions.

Frontend Impact:
- Frontend can display unresolved supplier invoices while supplier balance shows settled/credit state.
- API contract mismatch on balance keys can break typed clients or cause silent UI misbinding.
- Admin workflows may wrongly trust deactivation as a hard stop for future liabilities.

Phase Verdict:
❌ Blocker
