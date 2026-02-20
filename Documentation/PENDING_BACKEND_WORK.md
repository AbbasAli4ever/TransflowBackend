# Pending Backend Work for Frontend Screens

**Purpose:** Lists all backend API gaps, missing endpoints, missing response fields, and new endpoints needed to fully support the 44 wireframe screens.

**Priority Legend:**
- **P0 — Blocker**: Screen is non-functional without this
- **P1 — Major**: Key feature of the screen is broken/missing
- **P2 — Minor**: Screen works but with degraded UX or requires workaround
- **P3 — Nice to have**: Can be deferred or handled frontend-only

---

## 1. MISSING ENDPOINTS (New APIs Needed)

### 1.1 P&L Report Endpoint — **P0** (Screen 32)
**Needed:** `GET /api/v1/reports/profit-loss?dateFrom=YYYY-MM-DD&dateTo=YYYY-MM-DD`
**Why:** No P&L endpoint exists. Screen 32 requires sales revenue, sales returns, cost of goods sold, gross profit, and margin calculation — all impossible to compute efficiently on the frontend.

**Response shape needed:**
```json
{
  "dateFrom": "2026-01-01",
  "dateTo": "2026-01-31",
  "sales": 500000,
  "salesReturns": 25000,
  "netRevenue": 475000,
  "costOfGoodsSold": 300000,
  "grossProfit": 175000,
  "grossProfitMargin": 36.84
}
```

**Implementation notes:**
- `sales` = SUM(totalAmount) WHERE type='SALE' AND status='POSTED' AND transactionDate BETWEEN dateFrom AND dateTo
- `salesReturns` = SUM(totalAmount) WHERE type='CUSTOMER_RETURN' AND status='POSTED' AND date range
- `costOfGoodsSold` = SUM(costTotal) from transaction lines WHERE type='SALE' AND posted AND date range
- `grossProfit` = netRevenue - costOfGoodsSold
- `grossProfitMargin` = (grossProfit / netRevenue) × 100

---

### 1.2 Trial Balance Endpoint — **P1** (Screen 35)
**Needed:** `GET /api/v1/reports/trial-balance?asOfDate=YYYY-MM-DD`
**Why:** No trial balance endpoint exists.

**Response shape needed:**
```json
{
  "asOfDate": "2026-02-18",
  "accounts": [
    { "name": "Accounts Receivable", "debit": 150000, "credit": 0 },
    { "name": "Accounts Payable", "debit": 0, "credit": 200000 },
    { "name": "Cash - Main", "debit": 0, "credit": 500000 },
    { "name": "HBL Business", "debit": 0, "credit": 300000 },
    { "name": "Inventory", "debit": 450000, "credit": 0 }
  ],
  "totalDebit": 600000,
  "totalCredit": 1000000
}
```

**Note:** Could be constructed on frontend from dashboard summary data, but that's fragile and inaccurate. A dedicated endpoint is cleaner.

**Workaround (P2):** Frontend can assemble from `GET /api/v1/dashboard/summary` — AR=debit, AP=credit, each payment account=credit, inventory=debit.

---

### 1.3 Inventory Valuation Report Endpoint — **P0** (Screen 36)
**Needed:** `GET /api/v1/reports/inventory-valuation?asOfDate=YYYY-MM-DD`
**Why:** No bulk inventory valuation endpoint exists. The per-product stock endpoint (`GET /api/v1/reports/products/:id/stock`) requires knowing all product IDs and is N+1.

**Response shape needed:**
```json
{
  "asOfDate": "2026-02-18",
  "grandTotalValue": 1500000,
  "products": [
    {
      "productId": "uuid",
      "productName": "Cotton T-Shirt",
      "sku": "CT-001",
      "category": "Apparel",
      "variants": [
        { "variantId": "uuid", "size": "M", "sku": "CT-001-M", "qtyOnHand": 50, "avgCost": 800, "totalValue": 40000 },
        { "variantId": "uuid", "size": "L", "sku": "CT-001-L", "qtyOnHand": 30, "avgCost": 800, "totalValue": 24000 }
      ],
      "productTotalQty": 80,
      "productTotalValue": 64000
    }
  ]
}
```

---

### 1.4 Tenant Update Endpoint — **P1** (Screen 42)
**Needed:** `PATCH /api/v1/settings/tenant` or `PATCH /api/v1/auth/tenant`
**Why:** Screen 42 (Business Profile) needs to update business name and timezone. No endpoint exists.

**Body:** `{ name?: string, timezone?: string }`

---

### 1.5 Users List Endpoint — **P1** (Screen 43)
**Needed:** `GET /api/v1/users` (tenant-scoped)
**Why:** Screen 43 (Users & Roles) needs to list all users in the tenant. No endpoint exists.

**Response:** Array of `{ id, fullName, email, role, status, createdAt }`

---

### 1.6 User Role Change Endpoint — **P1** (Screen 43)
**Needed:** `PATCH /api/v1/users/:id/role`
**Why:** Screen 43 has "Change Role" action.

**Body:** `{ role: "ADMIN" | "STAFF" }` (OWNER can't be changed)

---

### 1.7 User Deactivation Endpoint — **P1** (Screen 43)
**Needed:** `PATCH /api/v1/users/:id/status`
**Why:** Screen 43 has "Deactivate" action.

**Body:** `{ status: "INACTIVE" }`

---

### 1.8 Delete Draft Transaction Endpoint — **P1** (Screen 05)
**Needed:** `DELETE /api/v1/transactions/:id`
**Why:** Screen 05 has "Delete Draft" button. No delete endpoint exists.

**Constraints:** Only DRAFT status transactions can be deleted. Must check no dependencies.

---

### 1.9 Edit Draft Transaction Endpoint — **P2** (Screen 05)
**Needed:** `PATCH /api/v1/transactions/:id`
**Why:** Screen 05 has "Edit" button for drafts. No PATCH endpoint exists.

**Note:** This is complex — would need to allow updating lines, amounts, party etc. on a draft. Can be deferred (user can delete draft and recreate).

---

### 1.10 Edit Product Variant Endpoint — **P2** (Screen 28)
**Needed:** `PATCH /api/v1/products/:id/variants/:variantId`
**Why:** Screen 28 has inline edit for variant size label and variant SKU. Currently only status change exists.

**Body:** `{ size?: string, sku?: string }`

---

### 1.11 Inventory Movements Endpoint — **P2** (Screen 28)
**Needed:** `GET /api/v1/products/:id/movements?page=1&limit=20`
**Why:** Screen 28 "Stock Movements" tab needs chronological list of inventory movements per product. Backend tracks `InventoryMovement` in DB but doesn't expose via API.

**Response:** Array of `{ date, documentNumber, type, variantSize, quantityIn, quantityOut, runningStock }`

---

### 1.12 Returnable Lines Info Endpoint — **P2** (Screens 12, 13)
**Needed:** `GET /api/v1/transactions/:id/returnable-lines`
**Why:** Screens 12/13 need to show per-line "Already Returned" and "Returnable Qty". Backend validates this at draft creation but doesn't expose the data.

**Response:**
```json
{
  "transactionId": "uuid",
  "lines": [
    {
      "lineId": "uuid",
      "productName": "Cotton T-Shirt",
      "variantSize": "M",
      "originalQty": 10,
      "alreadyReturned": 3,
      "returnableQty": 7
    }
  ]
}
```

**Workaround:** Frontend could submit the draft and let the backend reject if qty exceeds returnable — but UX is poor (no preview).

---

## 2. MISSING RESPONSE FIELDS (Existing APIs Need Enhancement)

### 2.1 Transaction List — Include Party Names — **P0** (Screen 04)
**Endpoint:** `GET /api/v1/transactions`
**Issue:** `findAll` does NOT include `supplier`/`customer` relations — only `supplierId`/`customerId` UUIDs.
**Fix:** Add `include: { supplier: { select: { id: true, name: true } }, customer: { select: { id: true, name: true } } }` to the list query.

**Impact:** Without this, the transactions list cannot show party names — requires N+1 lookups or client-side cache join.

---

### 2.2 Supplier/Customer List — Include Balance — **P1** (Screens 16, 21)
**Endpoint:** `GET /api/v1/suppliers`, `GET /api/v1/customers`
**Issue — CONFIRMED:** `_computed` was removed in Remediation Wave 5 ("Misleading _computed placeholder fields removed"). The `findAll` methods do plain `prisma.supplier.findMany()` / `prisma.customer.findMany()` with **zero balance data**. The DTO class still defines `_computed` but services never populate it.
**Impact:** Supplier/Customer list views cannot show "Current Balance" column.
**Options:**
  - **(A)** Re-add a lightweight `currentBalance` field to list responses via a raw SQL subquery or Prisma `$queryRaw` (compute balance inline per page of results)
  - **(B)** Add a batch balance endpoint: `GET /api/v1/suppliers/balances?ids=uuid1,uuid2,...`
  - **(C)** Frontend calls per-entity `/balance` endpoint (N+1, unacceptable for lists)

**Recommendation:** Option A — add a single `currentBalance` field per list item via a subquery. Can be done with a single raw SQL query that joins with ledger_entries aggregation for the current page of supplier/customer IDs. Does NOT need the full `_computed` object with `totalPurchases`, `lastPurchaseDate`, etc.

---

### 2.3 Payment Account List — Include Balance — **P1** (Screen 29)
**Endpoint:** `GET /api/v1/payment-accounts`
**Issue — CONFIRMED:** Same as 2.2 — `_computed` was removed. `findAll` does plain `prisma.paymentAccount.findMany()`. List has `openingBalance` (stored field) but no `currentBalance`, `totalIn`, `totalOut`.
**Fix:** Add computed fields to list response via raw SQL subquery on payment_entries for the current page of account IDs. At minimum need `currentBalance` (= openingBalance + totalIn - totalOut).

---

### 2.4 Product List — Include Stock Totals — **P1** (Screen 26)
**Endpoint:** `GET /api/v1/products`
**Issue:** Product list doesn't include stock data. Screen 26 needs "Total Stock" column.
**Fix:** Add a computed `totalStock` field to list items via an aggregation subquery on InventoryMovement.

**Note:** This can be expensive. Consider:
- A materialized view or cached value
- Only computing for the current page of results
- A separate batch endpoint

---

### 2.5 Statement Entries — Add Description — **P2** (Screens 19, 24)
**Endpoint:** `GET /api/v1/reports/suppliers/:id/statement`, `GET /api/v1/reports/customers/:id/statement`
**Issue:** `StatementDebitCreditEntryDto` has no `description` field. Wireframe wants a "Description" column.
**Fix:** Add `description` derived from transaction `notes` or auto-generated from type (e.g., "Purchase from Supplier X", "Payment via Cash").

---

### 2.6 Payment Account Statement — Add Party Name — **P2** (Screen 31)
**Endpoint:** `GET /api/v1/reports/payment-accounts/:id/statement`
**Issue:** Statement entries have no party name. Wireframe shows a "Party" column.
**Fix:** JOIN supplier/customer name into the statement query.

---

### ~~2.7 Open Documents — Add Document Number~~ — **RESOLVED** ✓
**Endpoint:** `GET /api/v1/suppliers/:id/open-documents`, `GET /api/v1/customers/:id/open-documents`
**Status:** `documentNumber` IS included in the response. The raw SQL query selects `t.document_number` and maps it to `documentNumber`. **No backend change needed.**

---

### 2.8 Dashboard Recent Activity — **P1** (Screen 03)
**Endpoint:** `GET /api/v1/dashboard/summary`
**Issue:** `recentActivity` only returns aggregate today-totals (`todaySales`, `todayPurchases`, `todayPayments`, `todayReceipts`). Wireframe wants a "Last 10 transactions" table with Date, Type, Party, Amount, Status.
**Options:**
  - **(A)** Add `recentTransactions[]` array to dashboard response (top 10 recent posted transactions with party name)
  - **(B)** Frontend makes a second call: `GET /api/v1/transactions?limit=10&sortBy=createdAt&sortOrder=desc`

**Recommendation:** Option B is simpler and avoids bloating the dashboard query. But needs party name fix from 2.1 first.

---

### 2.9 Import Upload — Add Sample Row Values — **P3** (Screen 39)
**Endpoint:** `POST /api/v1/imports`
**Issue:** Upload response returns `detectedColumns[]` (header names) but no sample values. Wireframe wants "first 2 sample values" per column.
**Fix:** Add `sampleValues: Record<string, string[]>` to `ImportUploadResponseDto` — each key is a column header, value is first 2 row values.

---

### 2.10 Transaction findOne — CreatedBy User Name — **P3** (Screen 05)
**Endpoint:** `GET /api/v1/transactions/:id`
**Issue:** Response includes `createdBy` as UUID but no user name/email.
**Fix:** Add `include: { createdByUser: { select: { fullName: true } } }` or return `createdByName` field.

---

### 2.11 Import Detail — CreatedBy User — **P3** (Screen 41)
**Endpoint:** `GET /api/v1/imports/:id`
**Issue:** No `createdBy` / `committedBy` user info.
**Fix:** Include user relation in import batch query.

---

## 3. MISSING QUERY CAPABILITIES

### 3.1 Transaction List — Text Search for Party Name — **P2** (Screen 04)
**Current:** `?supplierId=uuid` and `?customerId=uuid` (UUID only)
**Needed:** `?partySearch=text` — searches across both supplier and customer names
**Why:** Wireframe has a text search input for party name

**Workaround:** Frontend searches suppliers/customers first via their respective list APIs, collects matching IDs, then filters transactions by ID. Works but clunky.

---

### 3.2 Transaction List — Filter by Product — **P2** (Screen 28)
**Current:** No `productId` or `variantId` filter on transactions list
**Needed:** `?productId=uuid` to filter transactions that contain a specific product in their lines
**Why:** Screen 28 tabs "Purchase History" and "Sale History" need transactions filtered by product

**Workaround:** None feasible — would require fetching all transactions and filtering client-side.

---

### 3.3 Imports List — Module and Status Filter — **OK**
**Current:** `GET /api/v1/imports?module=SUPPLIERS&status=COMPLETED` — both filters exist ✓

---

## 4. RESPONSE SHAPE INCONSISTENCIES

### 4.1 Transaction DTO vs Actual Response
**Issue:** `TransactionResponseDto` class doesn't include `documentNumber`, `supplier`, `customer`, `paymentEntries`, `ledgerEntries`, `inventoryMovements` — but the actual `findOne` response returns all of these (raw Prisma with includes).

**Risk:** Swagger docs are misleading. Frontend devs relying on swagger will miss available fields.

**Fix:** Either:
- **(A)** Update `TransactionResponseDto` to document all actually-returned fields
- **(B)** Add a mapper function that transforms Prisma result into a proper DTO (preferred for consistency)

---

### 4.2 List vs Detail Response Asymmetry
**Issue:** `findOne` returns rich data (supplier object, customer object, payment entries, inventory movements) but `findAll` only returns basic transaction + lines. This creates confusion.

**Fix:** Decide on a clear pattern:
- List: minimal fields (add party name only)
- Detail: full fields (current behavior is fine)

---

## 5. FRONTEND-ONLY FEATURES (No Backend Needed)

These wireframe features are entirely frontend concerns:

| Feature | Screen | Notes |
|---|---|---|
| Password strength indicator | 02 | Client-side validation display |
| Confirm password match | 02 | Client-side only |
| Line total calculation | 06, 08 | `(qty × unitCost/Price) - discount` |
| Live summary panel | 06, 08 | Sum of computed line totals |
| Allocation remainder display | 10, 11 | `amount - allocated` |
| Days Outstanding | 20, 25 | `today - transactionDate` |
| Balance label (PAYABLE/CREDIT/SETTLED) | 18, 23 | Based on sign of currentBalance |
| Aging bucket grouping | 33, 34 | Group open docs by `daysPastDue` |
| Color-coded badges | All | Type/status → color mapping |
| Stock warnings (inline) | 08, 15 | Compare qty with stock data |
| Role-based UI hiding | 15, etc. | Hide buttons based on `user.role` |
| Draft count badge | Sidebar | `GET /api/v1/transactions?status=DRAFT&limit=1` → `meta.total` |
| Quick action buttons | 03 | Navigation links |
| Template CSV download | 38 | Static files hosted by frontend |
| Export PDF/CSV buttons | Various | Placeholder — generate client-side later |
| Confirmation modals | All | Frontend component |
| Toast notifications | All | Frontend component |
| Skeleton loaders | All | Frontend component |
| Collapsible sidebar | Global | Frontend responsive layout |

---

## 6. SUMMARY — PRIORITY MATRIX

### P0 — Blockers (Screen non-functional)
| # | Item | Screens Affected |
|---|---|---|
| 1.1 | P&L Report endpoint | 32 |
| 1.3 | Inventory Valuation endpoint | 36 |
| 2.1 | Transaction list include party names | 04 |

### P1 — Major (Key feature missing)
| # | Item | Screens Affected |
|---|---|---|
| 1.2 | Trial Balance endpoint | 35 |
| 1.4 | Tenant update endpoint | 42 |
| 1.5 | Users list endpoint | 43 |
| 1.6 | User role change endpoint | 43 |
| 1.7 | User deactivation endpoint | 43 |
| 1.8 | Delete draft transaction | 05 |
| 2.2 | Supplier/Customer list include balance | 16, 21 |
| 2.3 | Payment account list include balance | 29 |
| 2.4 | Product list include stock totals | 26 |
| 2.8 | Dashboard recent transactions | 03 |

### P2 — Minor (Workaround available)
| # | Item | Screens Affected |
|---|---|---|
| 1.9 | Edit draft transaction | 05 |
| 1.10 | Edit product variant (size/sku) | 28 |
| 1.11 | Inventory movements endpoint | 28 |
| 1.12 | Returnable lines info endpoint | 12, 13 |
| 2.5 | Statement entry description field | 19, 24 |
| 2.6 | Payment account statement party name | 31 |
| ~~2.7~~ | ~~Open documents document number~~ | ~~20, 25~~ (RESOLVED ✓) |
| 3.1 | Party name text search on transactions | 04 |
| 3.2 | Product filter on transactions | 28 |

### P3 — Nice to have
| # | Item | Screens Affected |
|---|---|---|
| 2.9 | Import sample values in upload response | 39 |
| 2.10 | CreatedBy user name on transaction | 05 |
| 2.11 | CreatedBy user on import detail | 41 |
| 4.1 | DTO vs actual response alignment | All |

---

## 7. RECOMMENDED IMPLEMENTATION ORDER

**Phase 1 — Unblock core screens (1-2 days):**
1. Transaction list: add `supplier`/`customer` include (2.1)
2. Supplier/Customer/PaymentAccount lists: re-add computed balance (2.2, 2.3)
3. Product list: add stock totals (2.4)

**Phase 2 — Reports (1-2 days):**
4. P&L report endpoint (1.1)
5. Inventory valuation report endpoint (1.3)
6. Trial balance endpoint (1.2)

**Phase 3 — Transaction management (1 day):**
7. Delete draft endpoint (1.8)
8. Dashboard: use separate transaction list call for recent activity (frontend)

**Phase 4 — User management (1 day):**
10. Users list endpoint (1.5)
11. User role change (1.6)
12. User deactivation (1.7)
13. Tenant update endpoint (1.4)

**Phase 5 — Polish (1-2 days):**
14. Returnable lines endpoint (1.12)
15. Inventory movements endpoint (1.11)
16. Edit variant size/sku (1.10)
17. Statement description fields (2.5, 2.6)
18. Edit draft transaction (1.9)
19. DTO alignment (4.1)
