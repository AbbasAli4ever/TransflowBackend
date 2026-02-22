# Screen API Mapping Priority Analysis

**Date:** 2026-02-20  
**Scope:** `Documentation/SCREEN_API_MAPPING.md` vs current backend implementation in `backend/src`  
**Goal:** Identify what is wrong, what was missed, and what should be done differently from a senior engineering perspective.

---

## Executive Summary

The current mapping document has three major problems:

1. **Contract drift**: multiple entries no longer match real DTOs/controllers.
2. **Contradictions**: same screen sometimes says both "missing" and "available".
3. **Mixed concerns**: implemented behavior, known backend gaps, and frontend workarounds are mixed without clear priority or ownership.

This creates high risk for frontend rework, false bug reports, and avoidable integration failures.

---

## Priority Matrix

## P0 — Critical (must fix before relying on mapping for implementation)

### 1) Register API contract is incorrect
- **Problem:** Mapping says `baseCurrency` and `timezone` can/must be sent on register.
- **Reality:** `RegisterDto` accepts only `tenantName`, `fullName`, `email`, `password`.
- **Evidence:**
  - `Documentation/SCREEN_API_MAPPING.md` (Screen 02)
  - `backend/src/auth/dto/register.dto.ts`
  - `backend/src/common/pipes/validation.pipe.ts` (`forbidNonWhitelisted: true`)
- **Impact:** Frontend calls with extra fields will fail validation (400).
- **Action:** Update mapping immediately and remove unsupported register payload fields.

### 2) Sale `deliveryType` enum is wrong in mapping
- **Problem:** Mapping documents `NONE/DELIVERY`.
- **Reality:** Backend enum is `STORE_PICKUP/HOME_DELIVERY`.
- **Evidence:**
  - `Documentation/SCREEN_API_MAPPING.md` (Screen 08)
  - `backend/prisma/schema.prisma` (`DeliveryType`)
  - `backend/src/transactions/dto/create-sale-draft.dto.ts`
- **Impact:** FE sends invalid enum and gets 400.
- **Action:** Correct enum values in mapping and UI options.

### 3) Mapping says no P&L and no inventory valuation APIs, but both exist
- **Problem:** Mapping marks screens 32 and 36 as missing backend APIs.
- **Reality:** `/reports/profit-loss` and `/reports/inventory-valuation` are implemented.
- **Evidence:**
  - `Documentation/SCREEN_API_MAPPING.md` (Screen 32, 36)
  - `backend/src/reports/reports.controller.ts`
- **Impact:** Wrong product decisions and unnecessary workaround design.
- **Action:** Mark these as implemented and map exact response fields.

### 4) Direct contradictions within the same document
- **Problem:** Same feature marked both missing and available (example: allocation `documentNumber`; customer open-doc `documentNumber`).
- **Evidence:**
  - `Documentation/SCREEN_API_MAPPING.md` (Screen 05 and Screen 25 sections)
  - `backend/src/transactions/dto/transaction-response.dto.ts`
  - `backend/src/customers/customers.service.ts`
- **Impact:** Team confusion and unstable acceptance criteria.
- **Action:** Run one consistency pass and remove conflicting statements.

---

## P1 — High (fix next to prevent repeated integration friction)

### 1) Payment Accounts contract mismatch (`_computed`)
- **Problem:** Mapping highlights `_computed` missing, DTO still documents `_computed`, service does not return it in list.
- **Evidence:**
  - `Documentation/SCREEN_API_MAPPING.md` (Screen 29)
  - `backend/src/payment-accounts/payment-accounts.service.ts`
  - `backend/src/payment-accounts/dto/payment-account-response.dto.ts`
- **Impact:** Swagger/types and runtime behavior diverge.
- **Action:** Either implement `_computed` in service or remove from DTO and provide dedicated aggregate endpoint.

### 2) Supplier balance naming drift
- **Problem:** Mapping references `totalPaid`; service returns `totalPayments` + `totalReturns`.
- **Evidence:**
  - `Documentation/SCREEN_API_MAPPING.md` (Screen 18 note)
  - `backend/src/suppliers/suppliers.service.ts`
- **Impact:** UI mapping bugs and wrong labels.
- **Action:** Standardize balance response naming across supplier/customer endpoints and docs.

### 3) Import detail `createdBy` semantics are described inaccurately
- **Problem:** Mapping says created/committed by is missing; batch object already includes `createdBy` UUID.
- **Evidence:**
  - `Documentation/SCREEN_API_MAPPING.md` (Screen 41)
  - `backend/src/imports/imports.service.ts` (`getBatchDetail` returns `...batch`)
- **Impact:** False gap reporting.
- **Action:** Reword as: "UUID available, resolved user profile name not available."

### 4) Missing permission matrix per screen/action
- **Problem:** Mapping mostly ignores role restrictions.
- **Reality:** Many write endpoints are OWNER/ADMIN only.
- **Evidence:**
  - `backend/src/*/*.controller.ts` (`@Roles(...)`)
- **Impact:** FE allows actions users cannot execute.
- **Action:** Add `Allowed Roles` row for every screen action.

### 5) Missing business-rule mapping (not just field mapping)
- **Problem:** Key runtime constraints are not documented at screen level.
- **Examples:**
  - Future date blocked
  - Idempotency conflict behavior
  - Payment/account constraints on posting
  - Stock insufficiency errors
- **Evidence:**
  - `backend/src/transactions/transactions.service.ts`
  - `backend/src/transactions/posting.service.ts`
- **Impact:** FE happy-path works, but production error handling fails.
- **Action:** Add "Validation & Failure Modes" section per create/post screen.

---

## P2 — Medium (architectural quality and maintainability)

### 1) Too much "frontend workaround" accounting logic in mapping
- **Problem:** Several report-like outputs are designed as FE multi-call aggregation.
- **Risk:** Reconciliation drift and duplicated finance logic outside posting/reporting layer.
- **Action:** Prefer backend-derived report endpoints for financial totals.

### 2) No canonical source assignment for overlapping endpoints
- **Problem:** Similar data exists in both operational modules and reports module.
- **Impact:** Team uncertainty on which endpoint is source of truth.
- **Action:** Declare canonical ownership:
  - Operational screens -> operational endpoints
  - As-of/date-range statements/reports -> reports endpoints

### 3) Date/time semantics are under-specified in mapping
- **Problem:** System has timezone-aware business date logic; mapping does not document timezone edge behavior consistently.
- **Evidence:**
  - `backend/src/dashboard/dashboard.service.ts`
  - `backend/src/reports/reports.service.ts`
- **Action:** Add global note on business date vs UTC and expected response date format.

---

## P3 — Process and governance improvements

### 1) No automated doc-to-API consistency gate
- **Action:** Add CI check:
  - Generate OpenAPI
  - Validate critical mapping fields/enums/endpoints against generated spec

### 2) Mapping document mixes statuses without labels
- **Action:** Add explicit status tags per row:
  - `Implemented`
  - `Partial`
  - `Missing`
  - `Frontend-only`

### 3) No ownership/target release tracking for gaps
- **Action:** Add columns:
  - Owner
  - Priority
  - Target sprint
  - Blocking/non-blocking

---

## True Backend Gaps Still Open (not just doc drift)

These appear to be genuinely missing or incomplete features:

1. Transaction edit/delete draft endpoints.
2. Return preview endpoint exposing `alreadyReturned` / `returnableQty` before draft submit.
3. Variant edit endpoint (size/SKU update).
4. Stock/inventory movement listing endpoint.
5. Trial balance endpoint.
6. Tenant settings update endpoint.
7. User invitation endpoint (list/update role/status now exist under `/users`).
8. Payment account statement entry party name enrichment.
9. Import template download endpoint.
10. Import upload response sample values preview.

---

## Fresh API Audit (Code-First, 2026-02-20)

This section is from a fresh controller/service/DTO audit (independent of screen-mapping assumptions).

## P0 — Critical

### 1) Public contract mismatch on register payload in mapping-led implementations
- **Issue:** Clients sending `baseCurrency/timezone` to `POST /auth/register` will fail due to strict validation.
- **Evidence:** `backend/src/auth/dto/register.dto.ts`, `backend/src/common/pipes/validation.pipe.ts`.
- **Why critical:** Immediate 400s in onboarding flow if frontend follows stale mapping.

### 2) Documented enum drift for sale delivery flow
- **Issue:** UI guidance using `NONE/DELIVERY` is incompatible with API enum (`STORE_PICKUP/HOME_DELIVERY`).
- **Evidence:** `backend/prisma/schema.prisma`, `backend/src/transactions/dto/create-sale-draft.dto.ts`.
- **Why critical:** Immediate create-sale draft failures.

## P1 — High

### 1) Payment accounts response contract is inconsistent with implementation
- **Issue:** `PaymentAccountResponseDto` requires `_computed`, but `findAll` returns plain rows without `_computed`.
- **Evidence:** `backend/src/payment-accounts/dto/payment-account-response.dto.ts`, `backend/src/payment-accounts/payment-accounts.service.ts`.
- **Risk:** Swagger-generated clients and frontend assumptions break at runtime.

### 2) `Users` API documentation enum under-represents actual role values
- **Issue:** `UserResponseDto.role` documents only `OWNER|ADMIN`, but system actively uses `STAFF`.
- **Evidence:** `backend/src/users/dto/user-response.dto.ts`, `backend/prisma/schema.prisma`, auth/seed usage patterns.
- **Risk:** Client type generation mismatch and invalid UI state handling.

### 3) Mapping and implementation drift on user management capabilities
- **Issue:** User management APIs do exist (`GET /users`, `PATCH /users/:id/role`, `PATCH /users/:id/status`) while docs claim missing.
- **Evidence:** `backend/src/users/users.controller.ts`, `backend/src/app.module.ts` (UsersModule imported).
- **Risk:** Duplicate feature work and wrong backlog prioritization.

## P2 — Medium

### 1) Tenant timezone not used in transaction future-date validation
- **Issue:** `assertDateNotFuture` compares against `new Date().toISOString()` (UTC date), not tenant business date.
- **Evidence:** `backend/src/transactions/transactions.service.ts`.
- **Risk:** Around day boundaries, valid local dates may be rejected or invalid ones accepted.

### 2) Profit & Loss report is not snapshot-consistent
- **Issue:** Revenue and COGS queries run concurrently without a shared DB snapshot transaction.
- **Evidence:** `backend/src/reports/reports.service.ts` (`getProfitLoss` uses `Promise.all` directly).
- **Risk:** Under concurrent posting, report can mix two different points-in-time.

### 3) Import status model contains state that is not used at batch level
- **Issue:** `ImportStatus.FAILED` exists, but batch transitions never set FAILED; only row-level failures are used.
- **Evidence:** `backend/src/imports/imports.service.ts`.
- **Risk:** Misleading status semantics for operations/monitoring.

## P3 — Low

### 1) Audit/event log model overloaded for role changes
- **Issue:** `status_change_logs` fields (`previousStatus/newStatus`) are used for role changes too.
- **Evidence:** `backend/src/users/users.service.ts` (`updateRole` logs role values in status fields).
- **Risk:** Ambiguous audit analytics and naming debt.

---

## Recommended Execution Order

1. **P0 doc corrections (same day)**: remove false/misaligned contracts and contradictions.
2. **P1 contract alignment (1–2 days)**: payment-accounts `_computed` decision + permissions/validation sections.
3. **P2 architecture cleanup (2–4 days)**: canonical endpoint policy + FE workaround reduction.
4. **P3 governance (ongoing)**: CI contract checks and ownership columns.

---

## Definition of Done for This Analysis

- High-risk mismatches identified with evidence.
- Prioritized remediation plan provided.
- Distinction made between:
  - doc inaccuracies,
  - contract drift,
  - actual backend feature gaps.
