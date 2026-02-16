# FINANCIAL REMEDIATION BACKLOG — ROUND 2

**Author:** Principal Software Architect
**Date:** 2026-02-16
**Based on:** 18 current audit reports (SUMMARY + TRACE per module) in `Documentation/Analysis/`
**Prior work reference:** `Documentation/Analysis/GO1/FINANCIAL_REMEDIATION_BACKLOG.md` (Waves 1–6 complete, 474 tests)
**System:** Multi-tenant accounting/ledger backend (NestJS + Prisma + PostgreSQL)

---

## Context

Waves 1–6 of the prior remediation program addressed posting-engine invariants, temporal query slicing, entity uniqueness, import atomicity, data-truth surfaces, and auth hardening. This document captures what the **current** codebase audit identifies as remaining or newly surfaced risks after those fixes. Items that were confirmed resolved by Waves 1–6 are not repeated here.

---

# SECTION 1 — Systemic Risk Categories

Eight invariant classes remain after Wave 1–6 remediation. Each represents a class of financial or operational failure that is not addressed by the prior backlog.

---

## Category 1: Semantic Date Validation

**Invariant:** Any date parameter accepted by the API must represent a real calendar date. A value that is syntactically well-formed (`YYYY-MM-DD`) but semantically invalid (e.g., `2026-02-31`, `2026-13-01`) must be rejected at the validation layer with a deterministic 400 response — not allowed to propagate to the SQL execution layer.

**Why it matters:** Wave 2 added `@Matches(/^\d{4}-\d{2}-\d{2}$/)` to all date DTOs, which correctly rejects datetime strings and freeform text. It does not reject impossible calendar dates. When an impossible date reaches a PostgreSQL `::date` cast, the database throws a runtime exception that bubbles as a 500. The client receives an opaque server error for a request-level input mistake. In a financial system, incorrect date parameters on balance or aging reports can produce wrong period-in-time results silently, depending on how the DB handles the cast in some driver configurations.

**Affected modules/APIs:**
- Dashboard: `GET /dashboard/summary` (`asOfDate`)
- Reports: all 9 endpoints (`asOfDate`, `dateFrom`, `dateTo`)
- Transactions: `GET /transactions` (`dateFrom`, `dateTo`)
- Imports: `POST /imports/:id/map` (date fields in row validation for opening balances)

**Failure scenario:** A controller POSTs `asOfDate=2026-02-31` to the AR aging report. The request passes the regex validator. PostgreSQL raises `invalid input syntax for type date`. The response is HTTP 500 with no actionable message. The finance manager retries, the product team opens a support ticket, and the root cause is a missing calendar validator.

**Severity:** High

---

## Category 2: Return Valuation Integrity

**Invariant:** A return transaction must reduce AP or AR by the amount the system actually recorded when the original transaction was posted — not by `quantity × unit_price` from the source line. For a purchase line that carried a discount, the posted per-unit cost was `(line_total - discount) / quantity`. A return using the gross `unit_price` over-credits the supplier and over-reduces AP.

**Why it matters:** Wave 1 fixed over-return quantity bounds and duplicate source-line duplication. It did not address the valuation computation. The posting engine still computes `returnTotal = returnQty × sourceLine.unitPrice`. On a discounted purchase, `unitPrice` is the list price; the actually-paid cost is lower. The supplier receives credit for more than they were ever paid. The AP balance decreases by more than the liability reduction warrants. Over time, AP balances drift below actual payable obligations. The same defect applies symmetrically to customer returns — `qty × unitPrice` over-credits AR when the original sale had a line discount.

**Affected modules/APIs:**
- `POST /transactions/supplier-returns/draft` — draft total computed from source `unitCost` without discount deduction
- `POST /transactions/customer-returns/draft` — draft total computed from source `unitPrice` without discount deduction
- `POST /transactions/:id/post` — posting uses draft totals without recomputation

**Failure scenario:** A supplier quotes 100 units at 1,000 each. The purchase line has a 10% line discount — actual cost paid is 90,000, unit effective cost is 900. The purchase is posted. Later, 50 units are returned. The return draft sets `unitCost = 1,000` (gross source price). The AP credit is 50,000. But only 45,000 AP was created for those 50 units. The system credits 5,000 more than it owes. The supplier appears to have a credit balance they are not entitled to.

**Severity:** Critical

---

## Category 3: Authentication State Liveness

**Invariant:** Every authenticated request must verify that the user and tenant are currently active at the time of the request. A JWT that was valid at issuance must not remain valid if the user or tenant is subsequently deactivated. Authentication must not be gameable through account enumeration.

**Why it matters:** `JwtStrategy.validate()` returns the token payload directly without querying the database to confirm current user/tenant status. A user whose account is `INACTIVE` — or a tenant that has been `SUSPENDED` — retains full API access until their access token expires (typically 15–60 minutes). For a financial system, this means a terminated employee or a suspended account can continue to post transactions, read financial statements, and access ledger data for the token's remaining lifetime. This is compounded by the fact that POST `/auth/register` still returns `"Email already exists"` on conflict, leaking account existence information.

**Affected modules/APIs:**
- All JWT-protected endpoints (every API except auth)
- `POST /auth/register` (email enumeration via 409 message)

**Failure scenario:** An employee is terminated at 9:00 AM. The administrator deactivates the user account. The employee's access token does not expire until 9:15 AM. During that window, the employee posts a CUSTOMER_PAYMENT to a dummy account. The transaction is accepted because the JWT is cryptographically valid and the guard does not check the current DB status. By the time the token expires, the damage is done.

**Severity:** High

---

## Category 4: Financial Read Surface Consistency

**Invariant:** Every field in an API response that presents a financial figure must accurately represent the quantity it is named for. Balance endpoint field labels must not conflate distinct financial events. Open-document outstanding amounts must reflect all events — payments, returns, and credits — that affect the actual collectible or payable amount. Overdue classification must operate at the document level, not the party level.

**Why it matters:** Three distinct labeling and computation gaps remain after Wave 5:

1. **Customer balance conflation.** `GET /customers/:id/balance` returns `totalReceived` which sums all `AR_DECREASE` ledger entries — both customer payments and customer return credits. Wave 5 split `totalPaid` into `totalPayments` + `totalReturns` for the supplier balance, but the customer balance endpoint retains the misleading `totalReceived` label. A collections officer reading this will overestimate actual cash collected.

2. **Open-document outstanding ignores return credits.** Both `GET /customers/:id/open-documents` and `GET /suppliers/:id/open-documents` compute outstanding as `totalAmount - SUM(allocations.amount_applied)`. Return transactions reduce the party's ledger balance (`AR_DECREASE` / `AP_DECREASE`) but do not create allocation rows. The open-document total remains unchanged despite the ledger balance decreasing. A supplier that was partially paid and partially returned against will show higher open-document outstanding than the actual AP balance.

3. **Dashboard overdue semantics.** `queryReceivables` and `queryPayables` classify a party as overdue if any of their documents is overdue, then count their full outstanding balance as overdue. A customer with one invoice overdue by 1 day and five invoices current will have 100% of their balance counted in the overdue bucket. This overstates portfolio overdue exposure.

**Affected modules/APIs:**
- `GET /customers/:id/balance`
- `GET /customers/:id/open-documents`
- `GET /suppliers/:id/open-documents`
- `GET /dashboard/summary` (overdue sub-query)

**Failure scenario:** A supplier has a 100,000 AP from a purchase. They return 80,000 worth of goods. No payment allocations exist. `GET /suppliers/:id/open-documents` shows 100,000 outstanding. The AP balance is 20,000. A finance manager authorizes a payment of 100,000. The company overpays by 80,000.

**Severity:** High

---

## Category 5: Ledger Entry Provenance Enforcement

**Invariant:** Any financial query that reads from `payment_entries` to derive a cash balance or cash statement must join to the parent `transactions` table and filter `transactions.status = 'POSTED'`. Non-posted, voided, or corrupt payment entries must never appear in financial reports.

**Why it matters:** The system architecture guarantees that the posting engine creates payment entries only within a SERIALIZABLE transaction that simultaneously sets `transaction.status = 'POSTED'`. This is a strong runtime invariant. However, the report queries for payment account balance and statement do not encode this invariant in SQL. They read `payment_entries` directly without confirming the parent transaction is posted. If any data integrity issue, migration error, or future code change allows a payment entry to exist outside a posted transaction, the cash balance and statements will be contaminated — with no visible error. Defense-in-depth requires the SQL to be self-sufficient.

**Affected modules/APIs:**
- `GET /reports/payment-accounts/:id/balance` — SQL aggregates `payment_entries` without `transactions.status = 'POSTED'` filter
- `GET /reports/payment-accounts/:id/statement` — same, for both historical and in-range queries

**Failure scenario:** A data migration creates a payment entry row without a corresponding posted transaction (orphaned row). The cash balance endpoint now includes this entry in the total. The account shows higher cash than was actually deposited. Financial statements are materially wrong. No validation, no log, no alert.

**Severity:** High

---

## Category 6: Draft Idempotency and Sequence Safety

**Invariant:** Write operations that clients may retry — particularly draft creation — must not produce duplicate records. Document numbers must be generated by a mechanism that is race-safe under concurrent posting, not by a `COUNT + 1` query.

**Why it matters:** All eight draft creation endpoints (`purchase`, `sale`, `supplier-payment`, `customer-payment`, `supplier-return`, `customer-return`, `internal-transfer`, `adjustment`) are non-idempotent. A client timeout followed by a retry creates two identical drafts. Downstream posting of both drafts would double-count the financial obligation. The document number generation uses `COUNT(transactions WHERE type = X) + 1` under a Serializable transaction with a unique constraint retry loop. This is functionally safe but operationally brittle: under concurrent burst posting, it produces high retry rates and can cause request latency spikes. For a system that will handle period-end posting bursts, this is a scalability risk.

**Affected modules/APIs:**
- All `POST /transactions/*/draft` endpoints (8 endpoints)
- `POST /transactions/:id/post` (document number generation)

**Failure scenario:** A client posts a purchase draft. The network times out at 4,900ms (client timeout is 5,000ms). The server completed the operation. The client retries. A second identical draft is created. Both drafts are later posted by different team members. The supplier is obligated for twice the AP, twice the inventory arrives in the system, and the discrepancy is only discovered during reconciliation.

**Severity:** Medium

---

## Category 7: Import Financial Baseline Safety

**Invariant:** Opening balance import must not silently corrupt the financial baseline of an account that already has transaction history. Overwriting `opening_balance` on an account with existing `payment_entries` retroactively changes every historical balance calculation derived from that account. The system must guard against this at commit time.

**Why it matters:** Wave 3 correctly addressed the rollback restoration issue (per-row `previousOpeningBalance` stored at commit, restored in reverse-order iteration). However, the **commit path** still permits overwriting an account's opening balance even when the account has payment history. The opening balance is a base term in the formula `currentBalance = openingBalance + SUM(IN) - SUM(OUT)`. Changing it after entries exist does not create a new ledger entry — it silently changes the mathematical base, retroactively shifting every historical balance query for that account. Additionally, the map-time validator performs case-insensitive account name lookup, but the commit-time lookup is case-sensitive. An account named "Cash" that is mapped to "cash" in the file will validate successfully but fail to commit.

**Affected modules/APIs:**
- `POST /imports/:id/commit` — `OPENING_BALANCES` module path

**Failure scenario:** An accountant imports a corrected opening balance for "Cash Account" from 0 to 200,000. The account already has 3 months of payment history. Commit succeeds. Every historical cash report now shows 200,000 more than it did before — including months before the import existed. The dashboard for February now shows 200,000 even though that balance did not exist until the import. Auditors flag the retroactive change with no ledger-entry audit trail.

**Severity:** Critical

---

## Category 8: API Input Safety and Pagination Bounds

**Invariant:** All API inputs must be validated before reaching service or persistence logic. DTO transforms that can throw on non-string payloads must be guarded. Paginated endpoints must enforce an upper bound on result-set size. Partial updates must reject empty payloads.

**Why it matters:** Several input-safety gaps remain: (1) `@Transform(({ value }) => value?.trim())` on DTO fields will throw `TypeError: value.trim is not a function` if the JSON payload provides a numeric value — producing a 500 instead of a clean 400. (2) `GET /transactions/allocations` has no `@Max()` on its `limit` parameter — a client can request arbitrarily large result sets, creating memory and response-time risk. (3) `PATCH` endpoints for customers, suppliers, and products accept an empty `{}` body, executing a no-op database write that touches `updatedAt` and pollutes the audit trail without changing any data.

**Affected modules/APIs:**
- `POST /auth/register`, `POST /auth/login` — unsafe `@Transform`
- `GET /transactions/allocations` — unbounded `limit`
- `GET /imports` — unbounded `limit`
- `PATCH /customers/:id`, `PATCH /suppliers/:id`, `PATCH /products/:id`, `PATCH /payment-accounts/:id` — empty payload accepted

**Failure scenario:** A frontend sends `{ "name": 42 }` in a customer update (numeric value instead of string). The DTO's `@Transform(({ value }) => value?.trim())` throws at runtime. The global exception filter converts this to a 500 response. The client receives a server error for what should have been a 400 validation error. The error appears in alerting infrastructure as a system fault rather than a client mistake.

**Severity:** Medium

---

# SECTION 2 — Remediation Tasks

---

## Category 1: Semantic Date Validation

### Task 1.1 — Add calendar-strict date validator to all date DTOs

- **Goal:** Reject syntactically valid but semantically impossible dates with a deterministic 400 response before any service or SQL logic executes.
- **Scope:** `src/dashboard/dto/dashboard-query.dto.ts`, `src/reports/dto/balance-query.dto.ts`, `src/reports/dto/statement-query.dto.ts`, `src/reports/dto/pending-receivables-query.dto.ts`, `src/reports/dto/pending-payables-query.dto.ts`.
- **Required code changes:** Create a shared custom class-validator decorator `@IsCalendarDate()` that: (a) confirms the string matches `YYYY-MM-DD`, (b) constructs a `Date` object from the string, and (c) verifies the reconstructed date's day, month, and year values match the parsed string (rejecting day overflow). Apply this decorator to every date field currently using `@Matches`.
- **Tests to add:** For each date-parameterized endpoint: submit `2026-02-31` → assert 400. Submit `2026-13-01` → assert 400. Submit `2026-02-28` → assert 200 (valid). Submit `2026-02-29` (non-leap year) → assert 400.
- **Risk of regression:** Low — only rejects inputs that previously caused 500 errors.
- **Estimated difficulty:** Low
- **Dependencies:** None

### Task 1.2 — Validate date range ordering on all statement and list endpoints

- **Goal:** Reject inverted date ranges (`dateFrom > dateTo`) at the DTO layer.
- **Scope:** `src/reports/dto/statement-query.dto.ts` (already has `@IsNotBefore` — verify it covers all paths). `src/transactions/dto/list-transactions-query.dto.ts` (currently no such check).
- **Required code changes:** Confirm `StatementQueryDto` already enforces ordering and add an equivalent cross-field validator to `ListTransactionsQueryDto` for `dateFrom`/`dateTo`.
- **Tests to add:** `GET /transactions?dateFrom=2026-02-15&dateTo=2026-02-01` → assert 400. Valid range → assert 200.
- **Risk of regression:** None.
- **Estimated difficulty:** Low
- **Dependencies:** None

---

## Category 2: Return Valuation Integrity

### Task 2.1 — Compute return draft totals from effective per-unit amount, not gross unit price

- **Goal:** Return transaction draft totals must reflect the amount actually exchanged when the source transaction was posted, accounting for line discounts.
- **Scope:** `src/transactions/transactions.service.ts` — `createSupplierReturnDraft` and `createCustomerReturnDraft` methods.
- **Required code changes:** Derive the effective unit amount from the source transaction line as `effectiveUnitAmount = sourceLine.lineTotal / sourceLine.quantity` (where `lineTotal = unitPrice × qty - lineDiscount`). Use this value — not `sourceLine.unitPrice` or `sourceLine.unitCost` — as the per-unit cost/price for return lines. Where the source line has a fractional result, apply floor/ceiling per a documented rounding policy (recommend: floor to integer, banker's rounding for the remainder on the last line).
- **Tests to add:** Create purchase with discount: 10 units × 1,000 gross − 500 discount = 9,500 line total; effective cost = 950. Return 5 units. Assert return draft total = 4,750 (not 5,000). Same test matrix for customer returns with a discounted sale.
- **Risk of regression:** High — all existing return tests use undiscounted source lines. Tests with discounted source lines need to be added. Existing tests should still pass because `lineDiscount = 0` produces `effectiveUnitAmount = unitPrice`.
- **Estimated difficulty:** Medium
- **Dependencies:** None

### Task 2.2 — Add explicit rounding policy for partial discounted returns

- **Goal:** Define and document the system's integer rounding rule for fractional monetary values produced by partial discounted return calculations. Enforce it consistently.
- **Scope:** Return valuation logic (same location as Task 2.1). Add a constant or utility function `applyReturnRounding(amount: bigint): bigint`.
- **Required code changes:** Choose and document one rounding rule: recommended `Math.floor` for per-unit amounts with the rounding remainder absorbed into the first line. Update `createSupplierReturnDraft` and `createCustomerReturnDraft` to use this function.
- **Tests to add:** 3 units returned from a line of 10 at 100 gross − 10 discount = 990 total; effective per unit = 99. Return 3: total = 297. No rounding issue. Return 1 from 3 units at 1,000 gross − 1 discount = 999 total; effective per unit = 333.0. Return total = 333. Assert consistently.
- **Risk of regression:** Low — test coverage for fractional cases does not currently exist.
- **Estimated difficulty:** Low
- **Dependencies:** Task 2.1

---

## Category 3: Authentication State Liveness

### Task 3.1 — Re-validate user and tenant active status in JwtStrategy

- **Goal:** Every authenticated request must confirm the user is `ACTIVE` and the tenant is `ACTIVE` against the database before proceeding.
- **Scope:** `src/auth/strategies/jwt.strategy.ts` — `validate(payload)` method.
- **Required code changes:** In `validate()`, query `prisma.user.findUnique({ where: { id: payload.userId }, include: { tenant: true } })`. If user is null, `status !== 'ACTIVE'`, or `tenant.status !== 'ACTIVE'`, throw `UnauthorizedException`. Cache the result in the request context to avoid double DB hits within the same request.
- **Tests to add:** Login as active user. Deactivate the user via Prisma directly. Make an authenticated request with the still-valid access token → assert 401. Reactivate user → assert 200. Same test for tenant suspension.
- **Risk of regression:** Medium — adds a DB query to every authenticated request. Performance impact must be measured; consider a short-lived cache keyed by token `jti` (e.g., 30-second TTL in-memory map).
- **Estimated difficulty:** Medium
- **Dependencies:** None

### Task 3.2 — Remove account-existence information from register conflict response

- **Goal:** Registration conflict must not indicate that the email address is already registered. The response message must be generically safe.
- **Scope:** `src/auth/auth.service.ts` — `register()` P2002 handler.
- **Required code changes:** Change `throw new ConflictException('Email already exists')` to `throw new ConflictException('Registration failed')`. Retain the specific message in server-side logs only.
- **Tests to add:** Register with duplicate email → assert 409. Assert response body `message` is `'Registration failed'` (not containing the word "exists" or "email").
- **Risk of regression:** Low — only changes the external error message. Frontend error-handling flows may need updating.
- **Estimated difficulty:** Low
- **Dependencies:** None

---

## Category 4: Financial Read Surface Consistency

### Task 4.1 — Split customer balance `totalReceived` into `totalPayments` and `totalReturns`

- **Goal:** `GET /customers/:id/balance` must separately report cash received and return credits, mirroring the supplier balance endpoint that was corrected in Wave 5.
- **Scope:** `src/customers/customers.service.ts` — `getBalance()` method.
- **Required code changes:** Update the raw SQL to compute two separate aggregates: `totalPayments` = `SUM(AR_DECREASE where t.type = 'CUSTOMER_PAYMENT')`, `totalReturns` = `SUM(AR_DECREASE where t.type = 'CUSTOMER_RETURN')`. Return both fields; rename or remove `totalReceived`. Update the response DTO `CustomerBalanceResponseDto` accordingly.
- **Tests to add:** Create customer with a sale, a payment, and a return. Assert `totalPayments` equals the payment amount. Assert `totalReturns` equals the return amount. Assert `currentBalance = totalSales - totalPayments - totalReturns`.
- **Risk of regression:** Medium — any frontend consuming `totalReceived` must be updated.
- **Estimated difficulty:** Low
- **Dependencies:** None

### Task 4.2 — Incorporate return/credit effects in open-document outstanding for customers and suppliers

- **Goal:** Open-document outstanding computation must produce a total that is consistent with the party's net ledger balance.
- **Scope:** `src/customers/customers.service.ts` — `getOpenDocuments()`. `src/suppliers/suppliers.service.ts` — `getOpenDocuments()`.
- **Required code changes:** Two options: (a) Account for unapplied return credits by computing `net_outstanding = sum(open_doc_outstanding) - unapplied_credit_balance` where `unapplied_credit = AR_DECREASE_from_returns - allocations_from_returns`, or (b) simplify to `net_receivable = AR_INCREASE - AR_DECREASE` and display alongside open docs as a reconciliation field. **Recommended approach:** Add an `unappliedCredits` field to the response showing the return-credit amount not yet applied to specific documents.
- **Tests to add:** Create supplier with purchase, partial payment, and supplier return. Assert `totalOutstanding + unappliedCredits = supplier net AP balance`. Same matrix for customer.
- **Risk of regression:** Medium — response shape changes; new field added.
- **Estimated difficulty:** Medium
- **Dependencies:** None

### Task 4.3 — Change dashboard overdue to document-level aging

- **Goal:** Dashboard receivables and payables overdue metrics must classify each open document independently — not carry the full party balance when any document is overdue.
- **Scope:** `src/dashboard/dashboard.service.ts` — `queryReceivables()` and `queryPayables()` sub-queries.
- **Required code changes:** Instead of joining overdue parties and summing their entire outstanding, compute overdue at the document level: `overdue_amount = SUM(outstanding WHERE document_date + 30 < asOfDate)`. A party with mixed overdue/current documents contributes only the overdue document amounts to the overdue total.
- **Tests to add:** Create customer with one overdue invoice (500) and one current invoice (1,000). Assert `overdueAmount = 500`, not `1,500`. Assert `overdueCount = 1` (document count), not party count.
- **Risk of regression:** Medium — overdue figures will decrease for most tenants (previously overstated).
- **Estimated difficulty:** Medium
- **Dependencies:** None

---

## Category 5: Ledger Entry Provenance Enforcement

### Task 5.1 — Add `transactions.status = 'POSTED'` filter to payment account balance query

- **Goal:** `GET /reports/payment-accounts/:id/balance` must only aggregate payment entries whose parent transaction is posted.
- **Scope:** `src/reports/reports.service.ts` — `getPaymentAccountBalance()` SQL query.
- **Required code changes:** Add `JOIN transactions t ON t.id = pe.transaction_id AND t.status = 'POSTED'` to the existing `payment_entries` aggregate query. Ensure the join does not filter out the opening balance (which has no transaction parent — handle separately).
- **Tests to add:** Manually insert a `payment_entry` row with no corresponding posted transaction (simulating data corruption). Assert that `GET /reports/payment-accounts/:id/balance` does not include this entry. Assert the correct posted entries are included.
- **Risk of regression:** Low — only adds a defensive filter. Results will differ only if non-posted entries exist, which indicates a data integrity problem rather than a regression.
- **Estimated difficulty:** Low
- **Dependencies:** None

### Task 5.2 — Add `transactions.status = 'POSTED'` filter to payment account statement queries

- **Goal:** Both historical and in-range portions of `GET /reports/payment-accounts/:id/statement` must exclude non-posted payment entries.
- **Scope:** `src/reports/reports.service.ts` — `getPaymentAccountStatement()` — both the historical aggregate query and the in-range entry query.
- **Required code changes:** Add the same transaction-join-and-filter as Task 5.1 to both SQL queries inside the `RepeatableRead` transaction.
- **Tests to add:** Same approach as Task 5.1: verify orphan entries are excluded from statement.
- **Risk of regression:** Low — same reasoning as Task 5.1.
- **Estimated difficulty:** Low
- **Dependencies:** None

---

## Category 6: Draft Idempotency and Sequence Safety

### Task 6.1 — Add idempotency key support to all draft creation endpoints

- **Goal:** Draft creation must be safe to retry. Submitting the same idempotency key twice must return the existing draft, not create a duplicate.
- **Scope:** All 8 `POST /transactions/*/draft` endpoints. `src/transactions/transactions.service.ts`. Requires schema migration.
- **Required code changes:** Add `idempotencyKey: string` (optional) to all draft creation DTOs. Add `idempotency_key` column (nullable, unique per tenant) to `transactions` table. At draft creation: if key provided, attempt `upsert`-style logic — find existing draft with that key and return it; otherwise create with the key. If a key is provided that matches an already-posted transaction, return 409 `Conflict`.
- **Tests to add:** Submit draft twice with same idempotency key → assert second returns 200 (not 201) with original draft. Submit without key → assert normal 201. Submit same key after posting → assert 409.
- **Risk of regression:** Low — key is optional; all existing tests that omit the key remain unaffected.
- **Estimated difficulty:** High
- **Dependencies:** Schema migration.

### Task 6.2 — Replace `count + 1` document numbering with atomic sequence table

- **Goal:** Document number generation must be deterministic and race-free under concurrent posting load.
- **Scope:** `src/transactions/posting.service.ts` — document number generation logic. Requires schema migration.
- **Required code changes:** Create a `document_sequences` table with columns `(tenant_id, transaction_type, last_value)` and a `UNIQUE (tenant_id, transaction_type)` constraint. On each posting, use `UPDATE document_sequences SET last_value = last_value + 1 WHERE tenant_id = $1 AND transaction_type = $2 RETURNING last_value`. This is a single atomic increment — no count query, no retry loop required. Initialize rows per tenant on first posting of each type.
- **Tests to add:** Concurrent posting of 10 transactions of the same type for the same tenant → assert all 10 document numbers are unique and sequential with no gaps or duplicates.
- **Risk of regression:** Medium — existing document numbers are not affected. New postings will use the sequence. Must handle migration of tenants with existing transactions (initialize sequence from current max).
- **Estimated difficulty:** High
- **Dependencies:** Schema migration.

---

## Category 7: Import Financial Baseline Safety

### Task 7.1 — Block opening balance overwrite when account has payment history

- **Goal:** Committing an `OPENING_BALANCES` import row for an account that already has `payment_entries` must fail with a clear 400 error, not silently overwrite the baseline.
- **Scope:** `src/imports/imports.service.ts` — `commitImport()` — OPENING_BALANCES row processing logic.
- **Required code changes:** Before updating `payment_accounts.opening_balance`, query `payment_entries` for `paymentAccountId = account.id`. If count > 0, set the import row to `FAILED` with `errorMessage = 'Cannot overwrite opening balance for account with existing transaction history'`. Continue to the next row. Respect the `skipInvalidRows` flag.
- **Tests to add:** Create a payment account. Post one payment transaction to it. Import a new opening balance for that account. Assert the import row fails with the correct error message. Assert the account's opening balance is unchanged. Also: account with no payment history → assert import succeeds.
- **Risk of regression:** None — additive guard.
- **Estimated difficulty:** Low
- **Dependencies:** None

### Task 7.2 — Align account name lookup in commit to case-insensitive matching

- **Goal:** The case sensitivity of account name lookup in `commitImport` must match the case-insensitive validation performed at `mapColumns` time.
- **Scope:** `src/imports/imports.service.ts` — OPENING_BALANCES commit path where `payment_accounts` is looked up by name.
- **Required code changes:** Replace `prisma.paymentAccount.findFirst({ where: { name: mappedName, tenantId } })` with a raw query using `lower(name) = lower($mappedName)`. Alternatively, canonicalize the name to lowercase before lookup.
- **Tests to add:** Import OPENING_BALANCES row where `accountName = 'CASH'`. Account in DB is named `Cash`. Assert commit row succeeds (not fails with account-not-found). Assert balance is updated.
- **Risk of regression:** None — this fixes a silent failure (row marked FAILED when account exists but case differs).
- **Estimated difficulty:** Low
- **Dependencies:** None

---

## Category 8: API Input Safety and Pagination Bounds

### Task 8.1 — Guard DTO transforms against non-string input types

- **Goal:** All `@Transform` decorators that call `.trim()` or `.toLowerCase()` on a value must be preceded by a `typeof value === 'string'` guard to prevent runtime TypeError on non-string JSON values.
- **Scope:** All DTOs using `@Transform(({ value }) => value?.trim())` or `@Transform(({ value }) => value?.toLowerCase())`. Key files: `src/auth/dto/register.dto.ts`, `src/auth/dto/login.dto.ts`, and any master-data create/update DTOs with similar transforms.
- **Required code changes:** Change pattern from `@Transform(({ value }) => value?.trim())` to `@Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))`. Combined with `@IsString()` this will produce a clean 400 from the subsequent `@IsString()` check rather than a 500 from the transform.
- **Tests to add:** Submit `POST /auth/register` with `{ "tenantName": 42, ... }` → assert 400 (not 500). Same for other DTO fields with transforms.
- **Risk of regression:** None — only improves error handling path for invalid inputs.
- **Estimated difficulty:** Low
- **Dependencies:** None

### Task 8.2 — Add `@Max(100)` to unbounded `limit` parameters

- **Goal:** `GET /transactions/allocations` and `GET /imports` must reject `limit` values above 100 with a 400 error.
- **Scope:** `src/transactions/dto/list-allocations-query.dto.ts`, `src/imports/dto/list-imports-query.dto.ts`.
- **Required code changes:** Add `@Max(100)` decorator to the `limit` field in both DTOs. For `GET /imports/:id`, replace the raw `ParseIntPipe` with a validated DTO that includes `@Min(1) @Max(100)` on `limit` and `@Min(1)` on `page`.
- **Tests to add:** `GET /transactions/allocations?limit=1000` → assert 400. `GET /imports?limit=1000` → assert 400. `GET /imports/:id?limit=-1` → assert 400. Normal values → assert 200.
- **Risk of regression:** None for normal use. Clients requesting large pages will need to paginate instead.
- **Estimated difficulty:** Low
- **Dependencies:** None

### Task 8.3 — Reject empty PATCH payloads on master-data update endpoints

- **Goal:** `PATCH` requests with an empty body (`{}`) must be rejected with a 400 error. A no-op update that touches `updatedAt` without changing any data is a data quality violation.
- **Scope:** `src/customers/customers.service.ts#update`, `src/suppliers/suppliers.service.ts#update`, `src/products/products.service.ts#update`, `src/payment-accounts/payment-accounts.service.ts#update`.
- **Required code changes:** At the start of each `update()` method, check `if (Object.keys(dto).length === 0) throw new BadRequestException('At least one field must be provided for update')`.
- **Tests to add:** `PATCH /customers/:id` with `{}` → assert 400. `PATCH /customers/:id` with `{ "name": "New Name" }` → assert 200.
- **Risk of regression:** None — a no-op update was never intentional behavior.
- **Estimated difficulty:** Low
- **Dependencies:** None

---

# SECTION 3 — Execution Order

The remediation sequences by financial impact magnitude and dependency structure.

---

## Wave A — Financial Truth Fixes (Execute first; highest financial data correctness impact)

**Tasks:** 2.1, 2.2, 4.1, 4.2, 4.3, 5.1, 5.2, 7.1, 7.2

**Rationale:** These tasks correct values that are actively being returned incorrectly. Return valuation (2.1, 2.2) fixes an over-credit defect in a write path — every return posted before this fix has overstated AP/AR reduction. Customer balance split (4.1) and open-document outstanding (4.2) fix read surfaces that are actively misleading operations staff. Dashboard overdue (4.3) fixes a figure used in credit decisions. Payment account provenance (5.1, 5.2) adds defense-in-depth against future data corruption. Import baseline safety (7.1, 7.2) prevents the highest-severity write corruption risk.

**Parallelism:** 2.1 must precede 2.2. All others are independent and may execute concurrently.

---

## Wave B — Input Validation and Safety (Execute in parallel with Wave A)

**Tasks:** 1.1, 1.2, 8.1, 8.2, 8.3

**Rationale:** These are low-difficulty, zero-regression fixes that prevent 500 errors from becoming support incidents. They can execute immediately and in parallel with Wave A without any dependency.

**Parallelism:** All five tasks are fully independent.

---

## Wave C — Authentication Hardening (Execute after Wave A; requires Wave A data correctness)

**Tasks:** 3.1, 3.2

**Rationale:** JWT liveness validation (3.1) adds a DB query per request. It should be applied after the financial data is correct so that new authenticated traffic reads valid data. The email enumeration fix (3.2) is non-impactful on correctness but requires frontend coordination.

**Parallelism:** 3.1 and 3.2 are independent.

---

## Wave D — Infrastructure Changes (Execute last; require schema migrations and higher testing effort)

**Tasks:** 6.1, 6.2

**Rationale:** Draft idempotency (6.1) and sequence-backed document numbering (6.2) require schema migrations and have the highest difficulty rating. They do not affect the correctness of existing data — only the behavior of new writes. They should be planned with a dedicated migration window and load testing.

**Parallelism:** 6.1 and 6.2 are independent but both require migration windows.

---

**Summary of execution order:**

```
Wave A  ─────────────────────────────────────────── [Tasks 2.1, 2.2, 4.1, 4.2, 4.3, 5.1, 5.2, 7.1, 7.2]
Wave B  ─────────────────────────────────────────── [Tasks 1.1, 1.2, 8.1, 8.2, 8.3]   (parallel with A)
Wave C  ─── (after Wave A) ─────────────────────── [Tasks 3.1, 3.2]
Wave D  ─── (after Wave B; migration window) ─────  [Tasks 6.1, 6.2]
```

Total tasks: **17** across 8 categories, 4 execution waves.

---

# SECTION 4 — Invariant Guarantees After Remediation

Upon completion of all tasks in this backlog, the system will guarantee the following properties, in addition to those established by Waves 1–6:

### Semantic Date Validity
Every date parameter accepted by the API will represent a real calendar date. Impossible dates will be rejected with a deterministic 400 response before reaching any service or SQL execution layer.

### Return Valuation Accuracy
Return transactions will be valued at the effective per-unit amount actually exchanged in the source transaction. Discounted source lines will produce return credits proportional to the amount paid, not the list price. The rounding policy will be explicit, documented, and consistently applied.

### Live Authentication State
An access token for a deactivated user or suspended tenant will be rejected at the authentication layer via database revalidation. No window exists between deactivation and token expiry during which a deactivated principal can perform financial operations.

### Accurate Financial Labels
The customer balance endpoint will correctly distinguish cash received from return credits. Open-document outstanding amounts will reconcile with the party's net ledger balance by accounting for unapplied return credits. Dashboard overdue figures will reflect document-level aging, not party-level classification.

### Cash Balance Provenance
Payment account balance and statement queries will only include payment entries whose parent transaction is confirmed posted. Non-posted entries will not affect cash reporting regardless of how they arrived in the database.

### Opening Balance Integrity
Opening balance import will be blocked for accounts with existing transaction history, preventing retroactive balance corruption. Account name lookup during commit will be case-insensitive, matching the validation behavior at map time.

### Draft Safety
Draft creation will support optional idempotency keys, making retried requests safe to issue. Document numbers will be generated by an atomic sequence table, eliminating race conditions under concurrent posting bursts.

### Input Safety
DTO transform errors on non-string payloads will produce clean 400 responses. Pagination endpoints will enforce upper bounds on result-set size. No-op PATCH requests will be rejected.

---

# SECTION 5 — Risk if Not Fixed

### Category 1 — Semantic Date Validation
**If not fixed:** Clients that submit calendar-invalid dates (intentionally or due to client-side date library bugs) will receive opaque 500 responses. These errors will appear in monitoring as server faults rather than client validation failures. More critically, some database drivers may silently clamp impossible dates (e.g., February 31 → March 2), causing the query to execute against the wrong date with no error. A financial report requested for a date that does not exist will return data for a different date without indication.

### Category 2 — Return Valuation Integrity
**If not fixed:** Every discounted purchase that is subsequently returned will over-credit the supplier. Every discounted sale that is subsequently returned will over-credit the customer. AP and AR balances will systematically understate true obligations over time. The magnitude depends on discount frequency and volume. For a business that regularly negotiates purchase discounts (common in wholesale/distribution), AP aging will be materially incorrect by the end of the first operating quarter. This cannot be detected from the API — the numbers will look internally consistent, but they will not match the supplier's records.

### Category 3 — Authentication State Liveness
**If not fixed:** A terminated employee, deactivated account, or suspended tenant retains full API access for the remaining token lifetime after deactivation. For a 60-minute access token, this represents a 60-minute privilege escalation window on every deactivation event. In a financial system with posting authority, this window is sufficient to post fraudulent transactions, read financial statements, or modify master data. The risk is not theoretical — it is a deterministic gap that is exploitable by anyone with a recently-valid token.

### Category 4 — Financial Read Surface Consistency
**If not fixed:** Collections staff using `GET /customers/:id/open-documents` will pursue customers for amounts that have already been partially or fully offset by returns. The overstatement is invisible in the API response — there is no inconsistency within the open-documents endpoint itself. The error is only visible if you compare the open-document total against the balance endpoint. Dashboard overdue exposure figures will overstate portfolio risk, potentially triggering unwarranted collection actions or tightening of credit terms for customers who are only partially overdue.

### Category 5 — Ledger Entry Provenance Enforcement
**If not fixed:** The payment account balance and statement are vulnerable to data contamination that the system currently has no ability to detect. A single orphan payment entry — from a migration error, a future code defect, or a direct database insert — will permanently alter all cash reporting without any error or alert. The incorrect balance will propagate to all downstream calculations that use the cash position. Financial statements will appear self-consistent but will not reflect actual cash movements.

### Category 6 — Draft Idempotency and Sequence Safety
**If not fixed:** Network retries on draft creation will silently create duplicate financial obligations. In a production environment with mobile clients and intermittent connectivity, retry rates of 1–5% are normal. At any meaningful transaction volume, duplicated drafts will accumulate. If posted, they double-book the obligation. If left as drafts, they clutter the draft queue and mislead staff about pending work. Document number sequence collisions under concurrent posting will cause retry latency spikes during period-end posting bursts — when transaction throughput is highest and user tolerance for delays is lowest.

### Category 7 — Import Financial Baseline Safety
**If not fixed:** An accountant running an opening balance correction import will silently corrupt the historical cash position of any account that already has payment history. The corruption is immediate and retroactive — it changes the base term in every historical balance calculation. There is no ledger entry that records the change; no audit trail exists. To recover, the incorrect opening balance must be identified, the correct prior value must be retrieved from a backup, and the value must be manually restored. For a production system, this may require a maintenance window and customer notification.

### Category 8 — API Input Safety and Pagination Bounds
**If not fixed:** Malformed JSON payloads that pass non-string values for string fields will produce server-fault alerts in monitoring for what are client mistakes. Operations teams will chase false alarms. Unbounded pagination allows any authenticated user to exhaust server memory with a single request (`limit=999999`), creating a trivial denial-of-service vector. No-op PATCH requests silently pollute `updatedAt` timestamps, making audit-log analysis of "when was this record last meaningfully changed" unreliable.
