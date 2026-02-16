# PHASE SUMMARY REPORT

Title:
Phase 2 — Customers

Module Purpose:
- Manage tenant-scoped customer master data and expose customer receivable/open-document read models for downstream collection, reporting, and posting workflows.

Top Risks:
1. `GET /api/v1/customers/:id/open-documents` computes outstanding from allocations only and ignores return credits, creating reconciliation drift versus ledger AR.
2. `PATCH /api/v1/customers/:id/status` performs receivable check outside the status-update transaction (TOCTOU race) and can deactivate customers with credit liabilities.
3. `GET /api/v1/customers/:id/balance` labels all `AR_DECREASE` as `totalReceived`, conflating payment receipts with return adjustments.

Common Failure Patterns:
- Read-model SQL is financially narrow (allocation-only for open docs), while posting model supports richer events (returns/credits).
- Validation rules in docs are stricter than implemented DTO/service checks (e.g., deactivation reason, empty PATCH).
- Authorization and tenant isolation are strong in code, but role-negative and edge-policy tests are sparse.

Financial Integrity Risks:
- Collection-facing outstanding totals may be overstated after customer returns or credit scenarios.
- Inactive customer state can coexist with unresolved customer-credit liability, obscuring payable-to-customer obligations.
- Balance breakdown semantics can mislead operational decisions if consumers interpret `totalReceived` as cash-only.

Architectural Weaknesses:
- Service-layer tenant scoping is manual and repeated; no query-level guardrail in Prisma layer.
- Status transition checks are not fully atomic with event posting concurrency.
- Customer balance/open-doc endpoints are not harmonized with richer report endpoints (which already distinguish some breakdown concepts).

Missing Tests:
- `PATCH /customers/:id/status` outstanding-balance rejection and concurrency race coverage.
- `GET /customers/:id/open-documents` partial/full allocation behavior, cross-tenant denial, unauthenticated request, and return-credit scenarios.
- Role-forbidden tests for customer writes (`POST`, `PATCH`, `PATCH status`) with STAFF role.
- `PATCH /customers/:id` empty payload rejection and duplicate-name conflict tests.
- `GET /customers/:id/balance` customer-return and credit-balance semantics tests.

Frontend Impact:
- Customer collection screens using open-documents can show collectible totals that do not match ledger balance.
- UI labels built around `totalReceived` risk misreporting cash inflow when returns are present.
- Status toggles may appear successful even when financial policy should block (depending on business expectation for customer credits).

Phase Verdict:
⚠ Needs fixes

