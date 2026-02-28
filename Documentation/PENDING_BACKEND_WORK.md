# Pending Backend Work for Frontend Screens

**Purpose:** Lists all backend API gaps, missing endpoints, missing response fields, and new endpoints needed to fully support the 44 wireframe screens.

**Priority Legend:**
- **P0 — Blocker**: Screen is non-functional without this
- **P1 — Major**: Key feature of the screen is broken/missing
- **P2 — Minor**: Screen works but with degraded UX or requires workaround
- **P3 — Nice to have**: Can be deferred or handled frontend-only

---

## 1. MISSING ENDPOINTS (New APIs Needed)

### ~~1.1 P&L Report Endpoint~~ — ✓ RESOLVED (Screen 32)
**Endpoint:** `GET /api/v1/reports/profit-loss?dateFrom=YYYY-MM-DD&dateTo=YYYY-MM-DD`
**Implemented:** 2026-02-20

**Note on COGS:** The spec said `SUM(costTotal)` from transaction_lines — this is incorrect. `costTotal` on SALE draft lines equals revenue (lineTotal), not cost. The correct source is `inventory_movements` WHERE `movement_type IN ('SALE_OUT', 'CUSTOMER_RETURN_IN')`, which records the actual unit cost at time of movement. COGS = SALE_OUT cost − CUSTOMER_RETURN_IN cost, giving net COGS that accounts for returns.

---

### ~~1.2 Trial Balance Endpoint~~ — ✓ RESOLVED (Screen 35)
**Endpoint:** `GET /api/v1/reports/trial-balance?asOfDate=YYYY-MM-DD`
**Implemented:** 2026-02-20

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

### ~~1.3 Inventory Valuation Report Endpoint~~ — ✓ RESOLVED (Screen 36)
**Endpoint:** `GET /api/v1/reports/inventory-valuation?asOfDate=YYYY-MM-DD`
**Implemented:** 2026-02-20 — returns `{ asOfDate, grandTotalValue, products[{ productId, productName, sku, category, variants[{ variantId, size, sku, qtyOnHand, avgCost, totalValue }], productTotalQty, productTotalValue }] }`

---

### ~~1.4 Tenant Update Endpoint~~ — ✓ RESOLVED (Screen 42)
**Endpoint:** `PATCH /api/v1/auth/tenant`
**Implemented:** 2026-02-20
**Body:** `{ name?, timezone?, baseCurrency? }` — OWNER role required.

---

### ~~1.5 Users List Endpoint~~ — ✓ RESOLVED (Screen 43)
**Endpoint:** `GET /api/v1/users` (tenant-scoped, paginated)
**Implemented:** 2026-02-20

---

### ~~1.6 User Role Change Endpoint~~ — ✓ RESOLVED (Screen 43)
**Endpoint:** `PATCH /api/v1/users/:id/role`
**Implemented:** 2026-02-20
**Note:** Cannot change own role. Role must be OWNER or ADMIN.

---

### ~~1.7 User Deactivation Endpoint~~ — ✓ RESOLVED (Screen 43)
**Endpoint:** `PATCH /api/v1/users/:id/status`
**Implemented:** 2026-02-20
**Note:** Cannot deactivate self or last active OWNER.

---

### ~~1.8 Delete Draft Transaction Endpoint~~ — ✓ RESOLVED (Screen 05)
**Endpoint:** `DELETE /api/v1/transactions/:id`
**Implemented:** 2026-02-20
**Constraints:** Only DRAFT status transactions can be deleted. Cascades child records in transaction.

---

### ~~1.9 Edit Draft Transaction Endpoint~~ — ✓ RESOLVED (Screen 05)
**Endpoint:** `PATCH /api/v1/transactions/:id`
**Implemented:** 2026-02-20
**All 8 types supported.** PURCHASE/SALE: full line replacement via deleteMany+createMany + total recompute. PAYMENTS/TRANSFER: header + amount. RETURNS: per-line quantity update only (sourceTransactionLineId immutable, returnable qty re-validated). ADJUSTMENT: full line replacement.

---

### ~~1.10 Edit Product Variant Endpoint~~ — ✓ RESOLVED (Screen 28)
**Endpoint:** `PATCH /api/v1/products/:id/variants/:variantId`
**Implemented:** 2026-02-20
**Body:** `{ size?, sku? }` — `P2002` → 409 if duplicate size within product.

---

### ~~1.11 Inventory Movements Endpoint~~ — ✓ RESOLVED (Screen 28)
**Endpoint:** `GET /api/v1/products/:id/movements?page=1&limit=20`
**Implemented:** 2026-02-20
**Response:** `{ data: [{ date, documentNumber, type, variantSize, quantityIn, quantityOut, runningStock }], meta }` — running stock computed via stock-before-page sub-query.

---

### ~~1.12 Returnable Lines Info Endpoint~~ — ✓ RESOLVED (Screens 12, 13)
**Endpoint:** `GET /api/v1/transactions/:id/returnable-lines`
**Implemented:** 2026-02-20
**Note:** Only works on POSTED PURCHASE or SALE transactions. Batch query for already-returned counts; no N+1.

---

## 2. MISSING RESPONSE FIELDS (Existing APIs Need Enhancement)

### ~~2.1 Transaction List — Include Party Names~~ — **RESOLVED** ✓ (Screen 04)
**Endpoint:** `GET /api/v1/transactions`
**Fix applied:** `findAll` now includes `supplier: { select: { id, name } }` and `customer: { select: { id, name } }`. Both `supplier.name` and `customer.name` are available in list response.

---

### ~~2.2 Supplier/Customer List — Include Balance~~ — **RESOLVED** ✓ (Screens 16, 21)
**Endpoint:** `GET /api/v1/suppliers`, `GET /api/v1/customers`
**Fix applied:** `findAll` now runs one batch `$queryRaw` per page to aggregate `currentBalance` (AP_INCREASE − AP_DECREASE for suppliers; AR_INCREASE − AR_DECREASE for customers). `currentBalance` is present on every list item — no N+1.

---

### ~~2.3 Payment Account List — Include Balance~~ — **RESOLVED** ✓ (Screen 29)
**Endpoint:** `GET /api/v1/payment-accounts`
**Fix applied:** `findAll` now runs one batch `$queryRaw` per page to aggregate `totalIn`/`totalOut` from posted `payment_entries`. `_computed.currentBalance`, `_computed.totalIn`, `_computed.totalOut` are present on every list item — no N+1.

---

### ~~2.4 Product List — Include Stock Totals~~ — **RESOLVED** ✓ (Screen 26)
**Endpoint:** `GET /api/v1/products`
**Fix applied:** `findAll` now runs one batch `$queryRaw` per page to aggregate `currentStock` per variant from `inventory_movements`, then merges `currentStock` onto each variant and computes `totalStock` per product. Both `totalStock` (product-level) and `variants[].currentStock` (per size) are present in list response — no N+1.

---

### ~~2.5 Statement Entries — Add Description~~ — **RESOLVED** ✓ (Screens 19, 24)
**Endpoint:** `GET /api/v1/reports/suppliers/:id/statement`, `GET /api/v1/reports/customers/:id/statement`
**Fix applied:** `description` field added to statement entries — maps to `t.notes` on the transaction. Nullable (null when transaction has no notes).

---

### ~~2.6 Payment Account Statement — Add Party Name~~ — **RESOLVED** ✓ (Screen 31)
**Endpoint:** `GET /api/v1/reports/payment-accounts/:id/statement`
**Fix applied:** LEFT JOIN suppliers + customers on `pe.supplier_id` / `pe.customer_id`. `partyName` (nullable) added to each statement entry. `null` for internal transfers.

---

### ~~2.7 Open Documents — Add Document Number~~ — **RESOLVED** ✓
**Endpoint:** `GET /api/v1/suppliers/:id/open-documents`, `GET /api/v1/customers/:id/open-documents`
**Status:** `documentNumber` IS included in the response. The raw SQL query selects `t.document_number` and maps it to `documentNumber`. **No backend change needed.**

---

### ~~2.8 Dashboard Recent Activity~~ — **RESOLVED** ✓ (Screen 03)
**No backend change needed.** `GET /api/v1/transactions?limit=10&sortBy=createdAt&sortOrder=desc&status=POSTED` already returns the last 10 transactions with `supplier.name` and `customer.name`. Frontend makes this as a second parallel call alongside `GET /api/v1/dashboard/summary`.

---

### ~~2.9 Import Upload — Add Sample Row Values~~ — **RESOLVED** ✓ (Screen 39)
**Implemented:** 2026-02-20 — `sampleValues: Record<string, string[]>` added to upload response. Each key is a column header; value is first 2 non-empty row values.

---

### ~~2.10 Transaction findOne — CreatedBy User Name~~ — **RESOLVED** ✓ (Screen 05)
**Implemented:** 2026-02-20 — `findOne` now includes `createdByUser: { select: { fullName: true } }`. Response has `createdByUser: { fullName }` (null if no user linked).

---

### ~~2.11 Import Detail — CreatedBy User~~ — **RESOLVED** ✓ (Screen 41)
**Implemented:** 2026-02-20 — `getBatchDetail` now includes `createdByUser: { select: { fullName: true } }`. Response has `createdByUser: { fullName }` alongside all batch fields.

---

## 3. MISSING QUERY CAPABILITIES

### ~~3.1 Transaction List — Text Search for Party Name~~ — **RESOLVED** ✓ (Screen 04)
**Fix applied:** `?partySearch=text` added to `ListTransactionsQueryDto` and `findAll()`. Uses Prisma `OR: [supplier.name contains, customer.name contains]` with `mode: 'insensitive'`.

---

### ~~3.2 Transaction List — Filter by Product~~ — **RESOLVED** ✓ (Screen 28)
**Fix applied:** `?productId=uuid` added. Uses Prisma `transactionLines: { some: { variant: { productId } } }` nested filter.

---

### 3.3 Imports List — Module and Status Filter — **OK**
**Current:** `GET /api/v1/imports?module=SUPPLIERS&status=COMPLETED` — both filters exist ✓

---

## 4. RESPONSE SHAPE INCONSISTENCIES

### ~~4.1 Transaction DTO vs Actual Response~~ — **RESOLVED** ✓
**Implemented:** 2026-02-20 — `TransactionResponseDto` now documents all fields returned by `findOne`: `documentNumber`, `createdByUser`, `inventoryMovements`, `ledgerEntries`, `paymentEntries`. `TransactionLineResponseDto` now documents `variant` (with nested `product`). Swagger is accurate.

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
| ~~1.1~~ | ~~P&L Report endpoint~~ | ~~32~~ **RESOLVED ✓** |
| ~~1.3~~ | ~~Inventory Valuation endpoint~~ | ~~36~~ **RESOLVED ✓** |
| ~~2.1~~ | ~~Transaction list include party names~~ | ~~04~~ **RESOLVED ✓** |

### P1 — Major (Key feature missing)
| # | Item | Screens Affected |
|---|---|---|
| ~~1.2~~ | ~~Trial Balance endpoint~~ | ~~35~~ **RESOLVED ✓** |
| ~~1.4~~ | ~~Tenant update endpoint~~ | ~~42~~ **RESOLVED ✓** |
| ~~1.5~~ | ~~Users list endpoint~~ | ~~43~~ **RESOLVED ✓** |
| ~~1.6~~ | ~~User role change endpoint~~ | ~~43~~ **RESOLVED ✓** |
| ~~1.7~~ | ~~User deactivation endpoint~~ | ~~43~~ **RESOLVED ✓** |
| ~~1.8~~ | ~~Delete draft transaction~~ | ~~05~~ **RESOLVED ✓** |
| ~~2.2~~ | ~~Supplier/Customer list include balance~~ | ~~16, 21~~ **RESOLVED ✓** |
| ~~2.3~~ | ~~Payment account list include balance~~ | ~~29~~ **RESOLVED ✓** |
| ~~2.4~~ | ~~Product list include stock totals~~ | ~~26~~ **RESOLVED ✓** |
| ~~2.8~~ | ~~Dashboard recent transactions~~ | ~~03~~ **RESOLVED ✓** |

### P2 — Minor (Workaround available)
| # | Item | Screens Affected |
|---|---|---|
| ~~1.9~~ | ~~Edit draft transaction~~ | ~~05~~ **RESOLVED ✓** |
| ~~1.10~~ | ~~Edit product variant (size/sku)~~ | ~~28~~ **RESOLVED ✓** |
| ~~1.11~~ | ~~Inventory movements endpoint~~ | ~~28~~ **RESOLVED ✓** |
| ~~1.12~~ | ~~Returnable lines info endpoint~~ | ~~12, 13~~ **RESOLVED ✓** |
| ~~2.5~~ | ~~Statement entry description field~~ | ~~19, 24~~ **RESOLVED ✓** |
| ~~2.6~~ | ~~Payment account statement party name~~ | ~~31~~ **RESOLVED ✓** |
| ~~2.7~~ | ~~Open documents document number~~ | ~~20, 25~~ **RESOLVED ✓** |
| ~~3.1~~ | ~~Party name text search on transactions~~ | ~~04~~ **RESOLVED ✓** |
| ~~3.2~~ | ~~Product filter on transactions~~ | ~~28~~ **RESOLVED ✓** |

### P3 — Nice to have
| # | Item | Screens Affected |
|---|---|---|
| ~~2.9~~ | ~~Import sample values in upload response~~ | ~~39~~ **RESOLVED ✓** |
| ~~2.10~~ | ~~CreatedBy user name on transaction~~ | ~~05~~ **RESOLVED ✓** |
| ~~2.11~~ | ~~CreatedBy user on import detail~~ | ~~41~~ **RESOLVED ✓** |
| ~~4.1~~ | ~~DTO vs actual response alignment~~ | ~~All~~ **RESOLVED ✓** |

---

## 7. IMPLEMENTATION STATUS

All P0, P1, and P2 items completed on 2026-02-20. Only P3 items remain.

**✓ Phase 1 — Core screen unblocking:** 2.1, 2.2, 2.3, 2.4
**✓ Phase 2 — Reports:** 1.1, 1.3, 1.2
**✓ Phase 3 — Transaction management:** 1.8, 2.8 (frontend)
**✓ Phase 4 — User management:** 1.4, 1.5, 1.6, 1.7
**✓ Phase 5 — Polish:** 1.9, 1.10, 1.11, 1.12, 2.5, 2.6, 3.1, 3.2

**✓ Phase 6 — P3 polish (2026-02-20):** 2.9, 2.10, 2.11, 4.1

**All items complete. No pending backend work remaining.**
