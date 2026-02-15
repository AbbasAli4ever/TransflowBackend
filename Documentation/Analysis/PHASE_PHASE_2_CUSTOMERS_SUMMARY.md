# PHASE SUMMARY REPORT

Title:
Phase 2 — Customers

Module Purpose:
- Manage tenant-scoped customer master records and expose derived AR-facing customer read models (customer balance and open sales documents) without storing balances directly.

Top Risks:
1. Service-only uniqueness checks for customer name are race-prone (no DB unique constraint), allowing duplicate counterparties under concurrency.
2. Monetary aggregates are converted from SQL `bigint` to JS `Number` in balance/open-doc endpoints, risking silent precision loss at scale.
3. Open-doc and status-management behaviors are under-specified/under-tested versus implementation-plan expectations (query controls, transition policies, audit detail).

Common Failure Patterns:
- Check-then-write uniqueness logic (`findFirst` then `create/update`) without database enforcement.
- Heavy reliance on implicit invariants from other modules (allocations integrity, posted-only entry creation) without defensive query qualification.
- Incomplete negative test matrix around auth, validation, and malformed IDs for several customer routes.

Financial Integrity Risks:
- Duplicate customer records can split receivables, distort aging, and misdirect allocations.
- Precision truncation from `bigint -> Number` can corrupt externally visible balances in high-volume tenants.
- Status changes can deactivate active counterparties with outstanding balance without control gate or audit reason persistence.

Architectural Weaknesses:
- Tenant isolation is implemented at service/query level rather than enforced by database row-level policy.
- Customer `status` is free-text at DB level; API validation is the only guard.
- API documentation drift exists: master-data spec still lists DELETE for customers (`../Documentation/docs/04-api-spec.md:135-140`), while implementation uses status endpoint.

Missing Tests:
- `POST /customers`: concurrent duplicate create race test; same-name different-tenant acceptance test.
- `GET /customers`: invalid query parameter tests, unauthorized test, sort behavior tests.
- `GET /customers/:id`: invalid UUID and unauthorized tests.
- `PATCH /customers/:id`: duplicate rename conflict, 404 unknown ID, invalid body/UUID, unauthorized tests.
- `PATCH /customers/:id/status`: invalid status, unknown ID, unauthorized, open-balance transition policy tests.
- `GET /customers/:id/balance`: precision boundary and negative-credit tests.
- `GET /customers/:id/open-documents`: customer cross-tenant isolation test, unauthorized/invalid UUID tests, partial/full payment allocation behavior tests.
- Unit tests for `getBalance` and `getOpenDocuments` in `CustomersService`.

Frontend Impact:
- Potentially inconsistent or rounded balances on large tenants can mislead dashboards and collection workflows.
- Missing open-document query controls (`asOfDate`, `includeFullyPaid`) limits UI filter capabilities documented in implementation plan.
- Status changes without enforced business policy can hide customers still carrying receivables, creating operational blind spots.

Phase Verdict:
⚠ Needs fixes
