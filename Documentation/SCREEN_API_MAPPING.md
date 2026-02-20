# Screen → API Mapping

**Purpose:** For every screen in the wireframe plan, this document maps every displayed value, user action, and interaction to the specific backend API endpoint, request/response fields, and any frontend-side calculations needed.

**API Base:** `GET/POST/PATCH /api/v1/...`
**Auth:** All endpoints (except login/register) require `Authorization: Bearer <accessToken>` header.

---

## SCREEN 01 — Login

| UI Element | Source | API / Notes |
|---|---|---|
| Email input | User input | — |
| Password input | User input | — |
| "Sign in" button | Action | `POST /api/v1/auth/login` body: `{ email, password }` |
| Error banner | API response | HTTP 401 → message: `"Authentication failed"` |
| Redirect after login | Response | Store `accessToken`, `refreshToken`, `user` (with `user.role`, `user.tenant.name`, `user.tenant.baseCurrency`, `user.tenant.timezone`) from `AuthResponseDto` |

**Frontend storage needed:** accessToken, refreshToken, user object (id, tenantId, fullName, email, role, tenant.name, tenant.baseCurrency, tenant.timezone)

---

## SCREEN 02 — Register

| UI Element | Source | API / Notes |
|---|---|---|
| Business name input | User input | Maps to `tenantName` |
| Base currency input | User input | Maps to `baseCurrency` (default: `"PKR"`) |
| Timezone dropdown | User input | Maps to `timezone` (default: `"Asia/Karachi"`) |
| Full name input | User input | Maps to `fullName` |
| Email input | User input | Maps to `email` |
| Password input | User input | Maps to `password` (must pass `@IsStrongPassword`) |
| Confirm password | User input | **Frontend-only validation** (not sent to API) |
| "Create Account" button | Action | `POST /api/v1/auth/register` body: `{ tenantName, fullName, email, password, baseCurrency?, timezone? }` |
| Error: email taken | API response | HTTP 409 → `"Registration failed"` |
| Validation errors | API response | HTTP 400 with field-level messages |

**Notes:**
- `baseCurrency` and `timezone` are optional in the DTO (defaults applied server-side if omitted) — but wireframe shows them, so send them
- Password strength indicator is **frontend-only** — backend uses `@IsStrongPassword` validator

---

## SCREEN 03 — Dashboard

| UI Element | Source | API / Notes |
|---|---|---|
| **All data on this screen** | Single API | `GET /api/v1/dashboard/summary?asOfDate=YYYY-MM-DD` |
| "As of date" date picker | Query param | `?asOfDate=2026-02-18` (defaults to tenant business date if omitted) |
| Refresh button | Action | Re-call `GET /api/v1/dashboard/summary` |

### Top Stat Cards

| Card | Response Field | Sub-label Source |
|---|---|---|
| Total Cash | `cash.totalBalance` | `cash.accounts.length` → "X accounts" |
| Total Receivables | `receivables.totalAmount` | `receivables.customerCount` → "from X customers" |
| Total Payables | `payables.totalAmount` | `payables.supplierCount` → "X suppliers" |
| Inventory Value | `inventory.totalValue` | `inventory.totalProducts` → "X products" |
| Overdue | `receivables.overdueAmount` | `receivables.overdueCount` → "X overdue" |

### Middle Section

| Panel | Response Field | Notes |
|---|---|---|
| Cash by Account (left) | `cash.accounts[]` → each has `{ name, balance }` | Render as bar chart / list |
| Receivables vs Payables (right) | `receivables.totalAmount` vs `payables.totalAmount` | **Frontend chart** — data already available from same response |

### Bottom Section

| Panel | Response Field | Notes |
|---|---|---|
| Recent Activity table | **NOT in dashboard response** | **MISSING API** — dashboard `recentActivity` only has `todaySales`, `todayPurchases`, `todayPayments`, `todayReceipts` (aggregate amounts, no transaction list). Need `GET /api/v1/transactions?limit=10&sortBy=createdAt&sortOrder=desc&status=POSTED` as a separate call |
| Quick Actions buttons | N/A | Frontend navigation links only |

**Frontend calculations:** None — all values come directly from API.

**GAPS:**
- Dashboard `recentActivity` returns only today's aggregate totals (todaySales, todayPurchases, todayPayments, todayReceipts) — **no list of recent transactions**. The wireframe wants a "Last 10 transactions" table with Date, Type, Party, Amount, Status. Must use `GET /api/v1/transactions` as a second API call.
- Dashboard response has no `lowStockCount` sub-label — actually it does: `inventory.lowStockCount` is available.
- Color indicator (green/red) is **frontend logic** based on sign of values.

---

## SCREEN 04 — Transactions List

| UI Element | Source | API / Notes |
|---|---|---|
| All table data | API | `GET /api/v1/transactions` |
| Date range filter | Query params | `?dateFrom=YYYY-MM-DD&dateTo=YYYY-MM-DD` |
| Type filter | Query param | `?type=PURCHASE` (enum: PURCHASE, SALE, SUPPLIER_PAYMENT, CUSTOMER_PAYMENT, SUPPLIER_RETURN, CUSTOMER_RETURN, INTERNAL_TRANSFER, ADJUSTMENT) |
| Status filter | Query param | `?status=DRAFT` or `?status=POSTED` |
| Party search | Query param | `?supplierId=uuid` or `?customerId=uuid` |
| Pagination | Query params | `?page=1&limit=20` |
| Sort | Query params | `?sortBy=transactionDate&sortOrder=desc` (options: transactionDate, createdAt, totalAmount) |

### Table Columns Mapping

| Column | Response Field | Notes |
|---|---|---|
| Date | `transactionDate` | Format: ISO string → display as date |
| Document # | `documentNumber` | Available in raw Prisma response (generated at posting time, e.g., "PUR-2026-0012"). Null for drafts. Not in DTO definition but IS returned by API. |
| Type badge | `type` | Color mapping is frontend logic |
| Status badge | `status` | DRAFT=yellow, POSTED=green is frontend |
| Party | `supplier.name` / `customer.name` | Both `findAll` and `findOne` include shallow `{ id, name }` select for supplier/customer. Available directly in list response. |
| Amount | `totalAmount` | Right-aligned, format as currency |
| Pagination | `meta.page`, `meta.total`, `meta.totalPages`, `meta.limit` | From response |

**GAPS:**
- **`documentNumber`** — IS in the raw Prisma response but only populated for POSTED transactions. Available in list.
- **Party search** — wireframe says "text input (searches supplier or customer name)" but API only accepts `supplierId` or `customerId` UUID. Frontend must search suppliers/customers first, then filter by ID.
- **"New Transaction" dropdown** — frontend navigation only.
- **Reset filters button** — frontend state only.
- **Page size selector** — use `limit` query param (20/50/100).

---

## SCREEN 05 — Transaction Detail

| UI Element | Source | API / Notes |
|---|---|---|
| All data | API | `GET /api/v1/transactions/:id` |

### Header Block

| Field | Response Field | Notes |
|---|---|---|
| Document number | `documentNumber` | Available in response (null for drafts, populated at posting) |
| Status badge | `status` | |
| Transaction type | `type` | |
| Date | `transactionDate` | |
| Party name | `supplier.name` / `customer.name` | `findOne` includes full supplier/customer via Prisma include |
| Created by + timestamp | `createdAt` | `createdBy` is a UUID — no user name included. Need `GET /api/v1/users/:id` (which doesn't exist) or join with cached user data |

### Transaction Lines Table

| Column | Response Field | Notes |
|---|---|---|
| Product name | `transactionLines[].variant.product.name` | `findOne` includes variant→product via deep include. Product name IS available in detail view. |
| Size | `transactionLines[].variantSize` | Available directly |
| Qty | `transactionLines[].quantity` | |
| Unit Cost / Unit Price | `transactionLines[].unitCost` or `transactionLines[].unitPrice` | Depends on type |
| Discount | `transactionLines[].discountAmount` | |
| Line Total | `transactionLines[].lineTotal` | |
| Subtotal (footer) | `subtotal` | From transaction level |
| Discount Total (footer) | `discountTotal` | From transaction level |
| Delivery Fee (footer) | `deliveryFee` | From transaction level |
| Total Amount (footer) | `totalAmount` | From transaction level |

### Payment Info Block

| Field | Source | Notes |
|---|---|---|
| Paid Now / Received Now | `paymentEntries[].amount` | `findOne` includes `paymentEntries` — sum amounts for total paid/received |
| Payment Account used | `paymentEntries[].paymentAccountId` | Available but as UUID — no account name. Frontend must join with payment accounts cache |

### Allocations Section

| Field | Source | API |
|---|---|---|
| Allocations table | Separate API | `GET /api/v1/transactions/allocations?purchaseId=:id` or `?saleId=:id` |
| Applied to Document # | `allocations[].appliesToTransaction.documentNumber` | **MISSING** — `AllocationTransactionRefDto` has `id`, `transactionDate`, `totalAmount`, `type` but no `documentNumber` |
| Amount Applied | `allocations[].amountApplied` | |

### Actions

| Action | API | Notes |
|---|---|---|
| Post Transaction | `POST /api/v1/transactions/:id/post` | Body: `PostTransactionDto` |
| Edit | **NO API** | No PATCH endpoint for transactions |
| Delete Draft | **NO API** | No DELETE endpoint for transactions |
| Print / Export PDF | N/A | Placeholder (no backend) |

**GAPS:**
- **`documentNumber` OK** — available in `findOne` (null for drafts, populated after posting)
- **Product name OK** — `findOne` deep includes `variant.product`
- **Party name OK** — `findOne` includes `supplier`/`customer` objects
- **`createdBy` user name** — response has `createdBy` UUID but no user profile endpoint to resolve it to a name
- **Payment entries OK** — `findOne` includes `paymentEntries[]`; payment account name must be joined client-side
- **No Edit transaction API** — no PATCH endpoint for transactions
- **No Delete draft API** — no DELETE endpoint for transactions
- **Allocation `documentNumber`** — IS available in `AllocationTransactionRefDto` ✓

---

## SCREEN 06 — Create Purchase (Step 1: Draft)

### Form Fields → API Mapping

| Field | API Field | Notes |
|---|---|---|
| Supplier dropdown | `supplierId` (UUID) | Populate from `GET /api/v1/suppliers?status=ACTIVE&limit=100` |
| Transaction Date | `transactionDate` | Format: `"YYYY-MM-DD"` |
| Idempotency Key | `idempotencyKey` | Auto-generated UUID v4 by frontend |
| Product dropdown | — | Populate from `GET /api/v1/products?status=ACTIVE&limit=100` |
| Size/Variant dropdown | — | After product selected, filter `product.variants[]` (already included in product response) to show active variants |
| Quantity | `lines[].quantity` | Min 1 |
| Unit Cost | `lines[].unitCost` | Min 1 (PKR integer) |
| Discount | `lines[].discountAmount` | Default 0 |
| Line Total | **Frontend calc** | `(quantity × unitCost) - discountAmount` |
| Delivery Fee | `deliveryFee` | Default 0 |
| Notes | `notes` | Optional, max 1000 chars |

**Submit:** `POST /api/v1/transactions/purchases/draft`

Body:
```json
{
  "supplierId": "uuid",
  "transactionDate": "2026-02-18",
  "lines": [
    { "variantId": "uuid", "quantity": 5, "unitCost": 1000, "discountAmount": 0 }
  ],
  "deliveryFee": 200,
  "notes": "...",
  "idempotencyKey": "client-uuid"
}
```

### Live Summary Panel

| Field | Source |
|---|---|
| Subtotal | **Frontend calc:** sum of all line totals |
| Total Discount | **Frontend calc:** sum of all `discountAmount` |
| Delivery Fee | User input |
| Total Amount | **Frontend calc:** subtotal + deliveryFee |
| Supplier current balance | `GET /api/v1/suppliers/:id/balance` → `currentBalance` |

### "Save & Post" Flow
1. `POST /api/v1/transactions/purchases/draft` → get `id`
2. Then `POST /api/v1/transactions/:id/post` (opens Screen 07)

**Notes:**
- Variant stock hint (e.g., "M — 12 in stock") requires `GET /api/v1/products/:id/stock` → `variants[].currentStock`
- Variant dropdown should only show ACTIVE variants (`variant.status === 'ACTIVE'`)

---

## SCREEN 07 — Create Purchase (Step 2: Post / Payment)

| UI Element | API | Notes |
|---|---|---|
| Draft summary | From Screen 06 response | Already have transaction data |
| "Pay now?" toggle | Frontend state | Controls whether paidNow is sent |
| Amount to Pay | `paidNow` field in `PostTransactionDto` | Integer, min 0, max = totalAmount |
| Payment Account dropdown | `paymentAccountId` in `PostTransactionDto` | Populate from `GET /api/v1/payment-accounts?status=ACTIVE` — show `name` + `_computed.currentBalance` |
| Idempotency key | `idempotencyKey` in `PostTransactionDto` | New UUID v4 (different from draft key) |
| "Confirm & Post" button | Action | `POST /api/v1/transactions/:id/post` |

Body:
```json
{
  "idempotencyKey": "new-client-uuid",
  "paidNow": 5000,
  "paymentAccountId": "uuid"
}
```

**Notes:**
- If pay toggle is OFF, just send `{ idempotencyKey }` with no `paidNow`
- `paidNow` is optional — if omitted, purchase posts as fully on credit

---

## SCREEN 08 — Create Sale (Step 1: Draft)

| Field | API Field | Notes |
|---|---|---|
| Customer dropdown | `customerId` | Populate from `GET /api/v1/customers?status=ACTIVE&limit=100` |
| Transaction Date | `transactionDate` | |
| Delivery Type | `deliveryType` | Enum: `NONE` / `DELIVERY` (optional) |
| Delivery Address | `deliveryAddress` | Max 500 chars |
| Notes | `notes` | |
| Product dropdown | — | `GET /api/v1/products?status=ACTIVE` |
| Size/Variant dropdown | — | From `product.variants[]` (filter active) |
| Quantity | `lines[].quantity` | |
| Unit Price | `lines[].unitPrice` | Min 1 |
| Discount | `lines[].discountAmount` | |
| Line Total | **Frontend calc** | `(quantity × unitPrice) - discountAmount` |
| Delivery Fee | `deliveryFee` | |
| Stock warning | **Frontend check** | Compare qty with `GET /api/v1/products/:id/stock` → variant's `currentStock` |

**Submit:** `POST /api/v1/transactions/sales/draft`

### Live Summary Panel (same pattern as purchase)
| Field | Source |
|---|---|
| Customer current balance | `GET /api/v1/customers/:id/balance` → `currentBalance` |

---

## SCREEN 09 — Create Sale (Step 2: Post / Payment)

| Field | API | Notes |
|---|---|---|
| "Receive payment now?" toggle | Frontend state | |
| Amount Received | `receivedNow` in `PostTransactionDto` | |
| Payment Account | `paymentAccountId` | Populate from `GET /api/v1/payment-accounts?status=ACTIVE` |
| "Confirm & Post" | Action | `POST /api/v1/transactions/:id/post` body: `{ idempotencyKey, receivedNow?, paymentAccountId? }` |

---

## SCREEN 10 — Create Supplier Payment

| Field | API Field | Notes |
|---|---|---|
| Supplier dropdown | `supplierId` | `GET /api/v1/suppliers?status=ACTIVE` |
| Current balance hint | Separate call | `GET /api/v1/suppliers/:id/balance` → `currentBalance` |
| Amount | `amount` | Min 1 |
| Payment Account | `paymentAccountId` | `GET /api/v1/payment-accounts?status=ACTIVE` — show balance from `_computed.currentBalance` |
| Transaction Date | `transactionDate` | |
| Notes | `notes` | |

### Allocations Section

| Field | Source | Notes |
|---|---|---|
| Auto-allocate toggle | Frontend state | If ON: don't send `allocations` — backend auto-allocates |
| Open purchase invoices | API | `GET /api/v1/suppliers/:id/open-documents` → `documents[]` |
| Document # | `documents[].documentNumber` | Available ✓ — included in open documents response |
| Allocate Amount per doc | `allocations[].amount` | User input per row |

**Submit flow:**
1. `POST /api/v1/transactions/supplier-payments/draft` body: `{ supplierId, amount, paymentAccountId, transactionDate, notes?, idempotencyKey? }`
2. `POST /api/v1/transactions/:id/post` body: `{ idempotencyKey, allocations?: [{ transactionId, amount }] }`

### Right Panel

| Field | Source |
|---|---|
| Payment amount | User input |
| Total allocated | **Frontend calc:** sum of allocation amounts |
| Unallocated remainder | **Frontend calc:** payment amount - total allocated |

---

## SCREEN 11 — Create Customer Receipt (Customer Payment)

Same pattern as Screen 10, mirrored for customers.

| Field | API Field | Notes |
|---|---|---|
| Customer dropdown | `customerId` | `GET /api/v1/customers?status=ACTIVE` |
| Current balance hint | `GET /api/v1/customers/:id/balance` → `currentBalance` | |
| Amount | `amount` | |
| Payment Account | `paymentAccountId` | `GET /api/v1/payment-accounts?status=ACTIVE` |
| Open sales invoices | `GET /api/v1/customers/:id/open-documents` → `documents[]` | For manual allocation |

**Submit flow:**
1. `POST /api/v1/transactions/customer-payments/draft`
2. `POST /api/v1/transactions/:id/post` body: `{ idempotencyKey, allocations?: [...] }`

---

## SCREEN 12 — Create Supplier Return

### Step 1 — Select Source

| Field | Source | Notes |
|---|---|---|
| Supplier dropdown | `GET /api/v1/suppliers?status=ACTIVE` | |
| Source Purchase dropdown | `GET /api/v1/transactions?supplierId=:id&type=PURCHASE&status=POSTED` | Shows posted purchases for this supplier |
| Available lines | `GET /api/v1/transactions/:purchaseId` → `transactionLines[]` | |
| Product name | `transactionLines[].productId` | **Need product name** — must join with products cache |
| Size | `transactionLines[].variantSize` | Available |
| Original Qty | `transactionLines[].quantity` | |
| Already Returned | **MISSING** | Backend checks returnable qty at draft time, but doesn't expose "already returned" count per line in any API |
| Returnable Qty | **MISSING** | Same — backend validates but doesn't tell frontend the remaining returnable qty |
| Return Qty input | `lines[].quantity` in draft DTO | |

**Submit:** `POST /api/v1/transactions/supplier-returns/draft`
Body:
```json
{
  "supplierId": "uuid",
  "transactionDate": "2026-02-18",
  "lines": [
    { "sourceTransactionLineId": "uuid", "quantity": 2 }
  ],
  "notes": "...",
  "idempotencyKey": "..."
}
```

### Step 2 — Review & Confirm

| Action | API |
|---|---|
| "Confirm Return" | `POST /api/v1/transactions/:id/post` body: `{ idempotencyKey }` |

**GAPS:**
- **No API to get "already returned" quantity** per transaction line. Frontend can't show "Original Qty / Already Returned / Returnable" without this. Backend validates at draft creation but doesn't expose the data.
- **No product name** in transaction lines

---

## SCREEN 13 — Create Customer Return

Same pattern as Screen 12, mirrored for customers.

| Field | Difference from Supplier Return |
|---|---|
| Customer dropdown | `GET /api/v1/customers?status=ACTIVE` |
| Source Sale dropdown | `GET /api/v1/transactions?customerId=:id&type=SALE&status=POSTED` |
| Return Handling (Step 2) | `returnHandling` in `PostTransactionDto` — enum: `REFUND_NOW` / `STORE_CREDIT` |
| If "Refund now" | Also send `paymentAccountId` in post body |

**Submit flow:**
1. `POST /api/v1/transactions/customer-returns/draft`
2. `POST /api/v1/transactions/:id/post` body: `{ idempotencyKey, returnHandling: "REFUND_NOW", paymentAccountId?: "uuid" }`

**GAPS:** Same as Screen 12 — no "already returned" data.

---

## SCREEN 14 — Create Internal Transfer

| Field | API Field | Notes |
|---|---|---|
| From Account | `fromPaymentAccountId` | `GET /api/v1/payment-accounts?status=ACTIVE` |
| To Account | `toPaymentAccountId` | Same list, exclude selected From account (frontend filter) |
| Amount | `amount` | Min 1 |
| Available balance hint | `_computed.currentBalance` from account list | Or `GET /api/v1/payment-accounts/:id/balance` |
| Transaction Date | `transactionDate` | |
| Notes | `notes` | |
| Validation: amount ≤ balance | **Frontend check** | Backend also validates at posting |

**Submit flow:**
1. `POST /api/v1/transactions/internal-transfers/draft`
2. `POST /api/v1/transactions/:id/post` body: `{ idempotencyKey }`

---

## SCREEN 15 — Create Stock Adjustment

| Field | API Field | Notes |
|---|---|---|
| Transaction Date | `transactionDate` | |
| Notes | `notes` | |
| Product dropdown | — | `GET /api/v1/products?status=ACTIVE` |
| Size/Variant dropdown | — | From `product.variants[]` (active only) |
| Direction | `lines[].direction` | `"IN"` or `"OUT"` |
| Quantity | `lines[].quantity` | Min 1 |
| Reason | `lines[].reason` | Max 500 chars |
| Current stock hint | `GET /api/v1/products/:id/stock` | Per-variant `currentStock` |
| OUT warning | **Frontend check** | If direction=OUT and qty > currentStock |
| Role check | **Frontend** | Hide "Save & Post" for STAFF role (use `user.role` from auth) |

**Submit flow:**
1. `POST /api/v1/transactions/adjustments/draft` (requires OWNER/ADMIN)
2. `POST /api/v1/transactions/:id/post` body: `{ idempotencyKey }`

Body:
```json
{
  "transactionDate": "2026-02-18",
  "lines": [
    { "variantId": "uuid", "quantity": 3, "direction": "OUT", "reason": "Damaged in warehouse" }
  ],
  "notes": "...",
  "idempotencyKey": "..."
}
```

### Right Panel — Summary

| Field | Source |
|---|---|
| Net IN/OUT by product | **Frontend calc** — aggregate lines by product+variant, sum IN/OUT quantities |

---

## SCREEN 16 — Suppliers List

| UI Element | Source | API / Notes |
|---|---|---|
| Table data | API | `GET /api/v1/suppliers` |
| Search input | Query param | `?search=text` (searches name or phone) |
| Status filter | Query param | `?status=ACTIVE` (or INACTIVE, ALL) |
| Sort by | Query param | `?sortBy=name&sortOrder=asc` (or `createdAt`) |
| Pagination | Query params | `?page=1&limit=20` |

### Table Columns

| Column | Response Field |
|---|---|
| Name | `name` |
| Phone | `phone` |
| Current Balance | `currentBalance` | Batch-aggregated from ledger entries in one query per page. AP_INCREASE − AP_DECREASE. |
| Status badge | `status` |

### Actions

| Action | API |
|---|---|
| View | Navigate to `/suppliers/:id` |
| Edit | Navigate to edit form, then `PATCH /api/v1/suppliers/:id` |
| Change Status | `PATCH /api/v1/suppliers/:id/status` body: `{ status: "INACTIVE" }` |
| + Add Supplier | Opens Screen 17 |

**FIXED:** `currentBalance` is now returned on every item in the list response. One batch `$queryRaw` runs per page (no N+1).

---

## SCREEN 17 — Add Supplier

| Field | API Field | Notes |
|---|---|---|
| Name | `name` | Required, 2-200 chars |
| Phone | `phone` | Optional, ≤20 chars |
| Address | `address` | Optional, ≤500 chars |
| Notes | `notes` | Optional, ≤1000 chars |
| "Save Supplier" button | Action | `POST /api/v1/suppliers` body: `{ name, phone?, address?, notes? }` |
| Error: name exists | API | HTTP 409 |

---

## SCREEN 18 — Supplier Detail

| UI Element | Source | API / Notes |
|---|---|---|
| Profile info | `GET /api/v1/suppliers/:id` | name, phone, address, notes, status |
| "Edit" button | Action | `PATCH /api/v1/suppliers/:id` |
| "Change Status" | Action | `PATCH /api/v1/suppliers/:id/status` |

### Balance Cards

| Card | Source | API |
|---|---|---|
| Total Purchased | `totalPurchases` | `GET /api/v1/suppliers/:id/balance` |
| Total Paid | `totalPayments` + `totalReturns` | Same endpoint — `SupplierBalanceResponseDto` has `totalPurchases`, `totalPaid`, `currentBalance`. **NOTE:** Wireframe says "Total Paid" but API has `totalPaid` (which should equal totalPayments per the balance endpoint). Need to check if `totalReturns` is separate. |
| Current Balance | `currentBalance` | Same endpoint |

**Note:** `GET /api/v1/suppliers/:id/balance` returns `{ supplierId, totalPurchases, totalPaid, currentBalance }`. The wireframe's 3 cards map directly. Balance label (PAYABLE/CREDIT/SETTLED) needs **frontend logic**: if currentBalance > 0 → PAYABLE, < 0 → CREDIT, = 0 → SETTLED.

### Tabs

| Tab | Source |
|---|---|
| Ledger | Navigate to Screen 19 |
| Open Documents | Navigate to Screen 20 (or inline via `GET /api/v1/suppliers/:id/open-documents`) |
| Transactions | `GET /api/v1/transactions?supplierId=:id` |

---

## SCREEN 19 — Supplier Ledger (Statement)

| UI Element | Source | API |
|---|---|---|
| Date From / Date To | Query params | Required |
| "Run Report" button | Action | `GET /api/v1/reports/suppliers/:id/statement?dateFrom=YYYY-MM-DD&dateTo=YYYY-MM-DD` |

### Ledger Table

| Column | Response Field | Notes |
|---|---|---|
| Date | `entries[].date` | |
| Document # | `entries[].documentNumber` | Nullable — may be null |
| Type | `entries[].type` | Transaction type |
| Description | `entries[].description` | Maps to `t.notes` on the transaction. Nullable — null when no notes were set. |
| Debit (AP Increase) | `entries[].debit` | |
| Credit (AP Decrease) | `entries[].credit` | |
| Running Balance | `entries[].runningBalance` | |

### Footer

| Field | Response Field |
|---|---|
| Opening Balance | `openingBalance` |
| Closing Balance | `closingBalance` |

**GAPS:**
- Export button is placeholder

---

## SCREEN 20 — Supplier Open Documents

| UI Element | Source | API |
|---|---|---|
| All data | API | `GET /api/v1/suppliers/:id/open-documents` |

### Table

| Column | Response Field | Notes |
|---|---|---|
| Document # | `documents[].documentNumber` | Available ✓ — raw SQL query includes `t.document_number` |
| Date | `documents[].transactionDate` | |
| Total Amount | `documents[].totalAmount` | |
| Paid Amount | `documents[].paidAmount` | |
| Outstanding | `documents[].outstanding` | |
| Days Outstanding | **MISSING** | Not in response — must be **frontend calc**: `today - transactionDate` in days |

### Footer

| Field | Response Field |
|---|---|
| Total Outstanding | `totalOutstanding` |
| Unapplied Credits | `unappliedCredits` |
| Net Outstanding | `netOutstanding` |

### Quick Action

| Action | Notes |
|---|---|
| "Pay Now" per row | Navigate to Screen 10 pre-filled with `supplierId` and document info |

**GAPS:**
- **No `documentNumber`** in open documents response
- **No `daysOutstanding`** — frontend must calculate

---

## SCREEN 21 — Customers List

Identical pattern to Screen 16 (Suppliers List).

| API | `GET /api/v1/customers` |
|---|---|
| Query params | Same: `search`, `status`, `sortBy`, `sortOrder`, `page`, `limit` |
| Balance column | `currentBalance` — now available in list response. Batch-aggregated (AR_INCREASE − AR_DECREASE) in one query per page, no N+1. |

---

## SCREEN 22 — Add Customer

Identical to Screen 17 (Add Supplier).

**API:** `POST /api/v1/customers`

---

## SCREEN 23 — Customer Detail

Same pattern as Screen 18 (Supplier Detail).

### Balance Cards

| Card | API Source |
|---|---|
| Total Sales | `GET /api/v1/customers/:id/balance` → `totalSales` |
| Total Received | `totalPayments` + `totalReturns` from balance endpoint |
| Current Balance | `currentBalance` |

**Balance label logic (frontend):** currentBalance > 0 → RECEIVABLE, < 0 → CREDIT, = 0 → SETTLED

---

## SCREEN 24 — Customer Ledger (Statement)

Same as Screen 19, for customers.

**API:** `GET /api/v1/reports/customers/:id/statement?dateFrom=YYYY-MM-DD&dateTo=YYYY-MM-DD`

| Column | Notes |
|---|---|
| Debit (AR Decrease) | `entries[].debit` — payments/returns |
| Credit (AR Increase) | `entries[].credit` — sales |

**Same as Screen 19** — `description` is now available (`entries[].description` maps to `t.notes`). Export is still placeholder.

---

## SCREEN 25 — Customer Open Documents

Same as Screen 20, for customers.

**API:** `GET /api/v1/customers/:id/open-documents`

**Same gaps** — no `documentNumber`, no `daysOutstanding`.

---

## SCREEN 26 — Products List

| UI Element | Source | API |
|---|---|---|
| Table data | `GET /api/v1/products` | |
| Search | `?search=text` | Searches name, SKU, category |
| Status filter | `?status=ACTIVE` | |
| Category filter | `?category=text` | |
| Pagination | `?page=1&limit=20` | |

### Table Columns

| Column | Response Field | Notes |
|---|---|---|
| Name | `name` | |
| SKU | `sku` | Product-level |
| Category | `category` | |
| Unit | `unit` | |
| Total Stock | **MISSING in list** | Product list doesn't include stock data. Need `GET /api/v1/products/:id/stock` per product — N+1 problem |
| # Sizes | `variants.length` | Count of variants array (variants are included in product response) |
| Status badge | `status` | |

**GAPS:**
- **No stock data in product list response** — `ProductResponseDto` includes `variants[]` with `avgCost` and `status` but NO `currentStock`. Must call `GET /api/v1/products/:id/stock` per product which is N+1.
- Need either: a **list endpoint that includes stock**, or a **batch stock endpoint**.

---

## SCREEN 27 — Add Product

| Field | API Field | Notes |
|---|---|---|
| Name | `name` | Required, 2-200 chars |
| SKU | `sku` | Optional, ≤50 chars, uppercase/numbers/hyphens/underscores |
| Category | `category` | Optional, ≤100 chars |
| Unit | `unit` | Optional (default "piece") |
| "Save Product" | `POST /api/v1/products` | Auto-creates "one-size" variant |

---

## SCREEN 28 — Product Detail

| UI Element | Source | API |
|---|---|---|
| Product info | `GET /api/v1/products/:id` | name, sku, category, unit, status, variants[] |
| Stock data | `GET /api/v1/products/:id/stock` | totalStock, variants[].currentStock, variants[].avgCost |

### Aggregate Summary Cards

| Card | Source | Notes |
|---|---|---|
| Total Stock | `stock.totalStock` | From stock endpoint |
| Total Inventory Value | **Frontend calc** | Sum of `variant.currentStock × variant.avgCost` across all variants (stock endpoint has both fields) |
| Active Sizes | **Frontend calc** | `product.variants.filter(v => v.status === 'ACTIVE').length` |

### Per-Size Breakdown Table

| Column | Source | Notes |
|---|---|---|
| Size | `variants[].size` | From product detail |
| SKU | `variants[].sku` | Variant-level |
| Current Stock | `stock.variants[].currentStock` | From stock endpoint (match by variantId) |
| Avg Cost | `stock.variants[].avgCost` | From stock endpoint |
| Value | **Frontend calc** | `currentStock × avgCost` |
| Status badge | `variants[].status` | From product detail |

### Actions

| Action | API | Notes |
|---|---|---|
| Edit size/SKU | **NO API** | No PATCH endpoint for variant fields (size, sku). Only status change exists. |
| Change Status | `PATCH /api/v1/products/:id/variants/:variantId/status` | Body: `{ status: "INACTIVE" }` |
| Add Size | `POST /api/v1/products/:id/variants` | Body: `{ size: "XL", sku?: "..." }` |

### Tabs

| Tab | API |
|---|---|
| Purchase History | `GET /api/v1/transactions?type=PURCHASE&status=POSTED` — **No product filter available** |
| Sale History | `GET /api/v1/transactions?type=SALE&status=POSTED` — **No product filter** |
| Stock Movements | **NO API** — No inventory movements endpoint |

**GAPS:**
- **No PATCH variant endpoint** to edit size label or variant SKU
- **No product filter** on transactions list — can't filter transactions by productId
- **No stock movements / inventory movements endpoint** — backend tracks inventory movements in DB but doesn't expose them via API

---

## SCREEN 29 — Payment Accounts List

| UI Element | Source | API |
|---|---|---|
| Account data | `GET /api/v1/payment-accounts` | |
| Type filter | `?type=CASH` | Enum: CASH, BANK, WALLET, CARD |
| Status filter | `?status=ACTIVE` | |

### Account Cards/Rows

| Field | Response Field | Notes |
|---|---|---|
| Account name | `name` | |
| Type badge | `type` | |
| Current Balance | **NOT AVAILABLE in list** | `_computed` was removed. `findAll` is plain `findMany`. Need backend fix (item 2.3 in PENDING_BACKEND_WORK.md). Separate `GET /api/v1/payment-accounts/:id/balance` exists but is N+1. |
| Opening Balance | `openingBalance` | Available — this is a stored field on the model |
| Total In / Total Out | **NOT AVAILABLE in list** | Same — was in `_computed`, now removed. Only available via per-account `/balance` endpoint. |
| Status badge | `status` | |

### Top Summary

| Field | Source |
|---|---|
| Total across all accounts | **NOT AVAILABLE** — depends on `_computed` fix. Once balance is in list response, frontend sums it. Alternatively use `GET /api/v1/dashboard/summary` → `cash.totalBalance`. |

### Actions

| Action | API |
|---|---|
| View Statement | Navigate to Screen 31 |
| Edit | `PATCH /api/v1/payment-accounts/:id` |
| Change Status | `PATCH /api/v1/payment-accounts/:id/status` |
| + Add Account | Screen 30 |

---

## SCREEN 30 — Add Payment Account

| Field | API Field |
|---|---|
| Name | `name` (2-100 chars) |
| Type | `type` (CASH/BANK/WALLET/CARD) |
| Opening Balance | `openingBalance` (default 0) |

**API:** `POST /api/v1/payment-accounts`

---

## SCREEN 31 — Payment Account Statement

| UI Element | Source | API |
|---|---|---|
| Date From / Date To | Query params | Required |
| "Run Report" | Action | `GET /api/v1/reports/payment-accounts/:id/statement?dateFrom=YYYY-MM-DD&dateTo=YYYY-MM-DD` |

### Summary Cards

| Card | Response Field |
|---|---|
| Opening Balance | `openingBalance` |
| Total In | **Frontend calc** — sum of `entries[].moneyIn` |
| Total Out | **Frontend calc** — sum of `entries[].moneyOut` |
| Closing Balance | `closingBalance` |

### Statement Table

| Column | Response Field | Notes |
|---|---|---|
| Date | `entries[].date` | |
| Document # | `entries[].documentNumber` | Nullable |
| Transaction Type | `entries[].type` | |
| Party | **MISSING** | No party name in statement entries |
| Money In | `entries[].moneyIn` | |
| Money Out | `entries[].moneyOut` | |
| Running Balance | `entries[].runningBalance` | |

**GAPS:**
- **No party name** in payment account statement entries
- Export is placeholder

---

## SCREEN 32 — P&L Report

| UI Element | Source | API |
|---|---|---|
| Date From / Date To | Query params | |
| "Generate" button | Action | **NO API** — There is no P&L endpoint in the reports module |

**GAP: No P&L report API exists.** The reports module has balance reports, pending reports, and statement reports — but no profit & loss report.

The P&L report needs:
- `Sales` = sum of SALE totalAmount in date range
- `Sales Returns` = sum of CUSTOMER_RETURN totalAmount in date range
- `Net Revenue` = Sales - Sales Returns
- `Cost of Sales` = sum of costTotal for SALE transaction lines
- `Gross Profit` = Net Revenue - Cost of Sales
- `Gross Profit Margin` = Gross Profit / Net Revenue × 100

**Either:** Build a new backend endpoint, OR calculate entirely on frontend using `GET /api/v1/transactions?type=SALE&status=POSTED&dateFrom=...&dateTo=...` plus `?type=CUSTOMER_RETURN` — but this requires iterating all transactions to sum costTotal, which is not practical.

---

## SCREEN 33 — Aged Receivables Report

| UI Element | Source | API |
|---|---|---|
| As of Date | Query param | |
| "Generate" button | Action | `GET /api/v1/reports/pending-receivables?asOfDate=YYYY-MM-DD` |

### Table Mapping

| Column | Response Field | Notes |
|---|---|---|
| Customer Name | `customers[].customerName` | |
| Current (0-30 days) | **MISSING** | API doesn't break down by aging buckets |
| 31-60 days | **MISSING** | |
| 61-90 days | **MISSING** | |
| 90+ days | **MISSING** | |
| Total Outstanding | `customers[].balance` | |

**GAP: No aging bucket breakdown.** The `PendingReceivablesReportResponseDto` returns `customers[]` with `balance`, `oldestInvoiceDate`, `daysPastDue`, and `openDocuments[]` — but does NOT calculate 0-30 / 31-60 / 61-90 / 90+ buckets.

**Workaround:** Use `customers[].openDocuments[]` → each has `daysPastDue` → **frontend must bucket** documents by days past due and sum `outstanding` per bucket. This is feasible since open documents data is available.

---

## SCREEN 34 — Aged Payables Report

Same pattern as Screen 33, for suppliers.

**API:** `GET /api/v1/reports/pending-payables?asOfDate=YYYY-MM-DD`

**Same aging bucket gap** — frontend must bucket from `suppliers[].openDocuments[].daysPastDue`.

---

## SCREEN 35 — Trial Balance

| UI Element | Source | API |
|---|---|---|
| As of Date | Query param | |
| "Generate" button | Action | **NO API** — No trial balance endpoint exists |

**GAP: No Trial Balance API.** The wireframe shows:
- Accounts Receivable (debit)
- Accounts Payable (credit)
- Cash accounts (credit)
- Inventory (debit)

**Workaround:** Frontend can construct this from multiple API calls:
1. AR total → `GET /api/v1/reports/pending-receivables?asOfDate=...` → `totalReceivables`
2. AP total → `GET /api/v1/reports/pending-payables?asOfDate=...` → `totalPayables` (need to check field name)
3. Cash totals → `GET /api/v1/dashboard/summary?asOfDate=...` → `cash.totalBalance`
4. Inventory → `GET /api/v1/dashboard/summary?asOfDate=...` → `inventory.totalValue`

This is hacky but works since the wireframe only shows 4 account lines.

---

## SCREEN 36 — Inventory Valuation Report

| UI Element | Source | API |
|---|---|---|
| As of Date | Query param | |
| "Generate" button | Action | **NO API** — No inventory valuation endpoint exists |

**GAP: No Inventory Valuation report API.** Needs per-variant stock × avgCost as of a date.

**Workaround:** Could use `GET /api/v1/reports/products/:id/stock?asOfDate=...` per product — but that's N+1 and only works if you know all product IDs.

**Needs:** A new `GET /api/v1/reports/inventory-valuation?asOfDate=YYYY-MM-DD` endpoint that returns all products with per-variant stock and valuation.

---

## SCREEN 37 — Imports List

| UI Element | Source | API |
|---|---|---|
| Table data | `GET /api/v1/imports` | |
| Module filter | `?module=SUPPLIERS` | Enum: SUPPLIERS, CUSTOMERS, PRODUCTS, OPENING_BALANCES |
| Status filter | `?status=COMPLETED` | Enum: PENDING_MAPPING, VALIDATED, PROCESSING, COMPLETED, ROLLED_BACK |
| Pagination | `?page=1&limit=20` | |

### Table Columns

| Column | Response Field | Notes |
|---|---|---|
| Date | `createdAt` | |
| Module badge | `module` | |
| File name | `fileName` | |
| Total / Success / Failed | `totalRows`, `successRows`, `failedRows` | |
| Status badge | `status` | |

### Actions

| Action | API | Notes |
|---|---|---|
| View | Navigate to import detail, `GET /api/v1/imports/:id` | |
| Rollback | `POST /api/v1/imports/:id/rollback` | Only if status=COMPLETED |

**Note:** `PROCESSING` status exists in the enum but the wireframe's table won't typically show it (transient state during commit).

---

## SCREEN 38 — New Import (Step 1: Upload)

| Field | API | Notes |
|---|---|---|
| Module selector | `module` field in form data | |
| File upload | `file` in multipart form | Max 10MB, .csv or .xlsx |
| "Upload & Continue" | `POST /api/v1/imports` | Content-Type: multipart/form-data |

**Response:** `ImportUploadResponseDto` with `id`, `detectedColumns[]`, `requiredFields[]`, `totalRows`, `status=PENDING_MAPPING`

**Template download:** **NO API** — wireframe says "Download sample CSV for [module]" but no endpoint exists for this. Frontend must provide static template files.

---

## SCREEN 39 — New Import (Step 2: Map Columns)

| UI Element | Source | Notes |
|---|---|---|
| Detected columns | `detectedColumns[]` from upload response | |
| Required fields | `requiredFields[]` from upload response | Each has `{ field, required }` |
| Sample values preview | **MISSING** | API doesn't return sample row values in upload response |
| Column mapping dropdowns | User input → `columnMappings` | Map system field → CSV header |
| "Next: Preview" button | `POST /api/v1/imports/:id/map` body: `{ columnMappings: { name: "Company Name", phone: "Phone" } }` | |

**Response:** `ImportMapResponseDto` with `validRows`, `invalidRows`, `errors[]`, `preview[]`

**GAPS:**
- **No sample values** in upload response — wireframe wants "first 2 sample values" shown next to each detected column. The upload response only has header names.

---

## SCREEN 40 — New Import (Step 3: Preview & Commit)

| UI Element | Source | Notes |
|---|---|---|
| Summary bar | From map response | `totalRows`, `validRows`, `invalidRows` |
| Preview table | `preview[]` from map response | Each row has `rowNumber`, `data{}`, `status` |
| Error details | `errors[]` from map response | Each has `rowNumber`, `field`, `error`, `value` |
| "Commit Import" | `POST /api/v1/imports/:id/commit` | Body: `{ skipInvalidRows: true }` |
| After commit | Response | `ImportCommitResponseDto` with `successRows`, `failedRows`, `skippedRows` |

---

## SCREEN 41 — Import Detail

| UI Element | Source | API |
|---|---|---|
| All data | `GET /api/v1/imports/:id?page=1&limit=20` | Returns `ImportBatchDetailResponseDto` |

### Header

| Field | Response Field | Notes |
|---|---|---|
| Module badge | `module` | |
| Status badge | `status` | |
| File name | `fileName` | |
| Committed at | `updatedAt` | **No specific `committedAt` field** — use `updatedAt` |
| Committed by | **MISSING** | No `createdBy` field in import batch |

### Summary Cards

| Card | Response Field |
|---|---|
| Total Rows | `totalRows` |
| Committed | `successRows` |
| Failed | `failedRows` |

### Results Table

| Column | Response Field |
|---|---|
| Row # | `rows[].rowNumber` |
| Data | `rows[].rawDataJson` |
| Status | `rows[].status` |
| Error | `rows[].errorMessage` |
| Created Record | `rows[].createdRecordId`, `rows[].createdRecordType` |

### Actions

| Action | API |
|---|---|
| Rollback Import | `POST /api/v1/imports/:id/rollback` |

**GAPS:**
- **No `committedBy` / `createdBy`** in import detail

---

## SCREEN 42 — Settings: Business Profile

| Field | Source | Notes |
|---|---|---|
| Business Name | `user.tenant.name` from auth response | |
| Base Currency | `user.tenant.baseCurrency` | Read-only |
| Timezone | `user.tenant.timezone` | |
| "Save Changes" | **NO API** | No PATCH endpoint for tenant settings |

**GAP: No tenant update API.** Cannot save business profile changes.

---

## SCREEN 43 — Settings: Users & Roles

| UI Element | Source | Notes |
|---|---|---|
| Users table | **NO API** | No `GET /api/v1/users` or tenant users list endpoint |
| Change Role | **NO API** | No role change endpoint |
| Deactivate | **NO API** | No user deactivation endpoint |
| Invite User | **NO API** | Placeholder (noted in wireframe) |

**GAP: No user management API.** Backend has auth (register/login) but no user list, role management, or user deactivation endpoints.

---

## SCREEN 44 — Settings: Payment Accounts

Links to Screen 29 (Payment Accounts List) and Screen 30 (Add Account). No additional API needed.

---

## GLOBAL COMPONENTS

### Top Navigation Bar

| Element | Source |
|---|---|
| Business name | `user.tenant.name` from stored auth data |
| User avatar + name | `user.fullName` from stored auth data |
| Logout | `POST /api/v1/auth/logout` body: `{ refreshToken }` |

### Sidebar Badge Count (Draft transactions)

| Element | Source | Notes |
|---|---|---|
| Draft count | **NO dedicated API** | Could use `GET /api/v1/transactions?status=DRAFT&limit=1` → `meta.total` |

### Token Refresh

| Trigger | API |
|---|---|
| Access token expired | `POST /api/v1/auth/refresh` body: `{ refreshToken }` → new `accessToken` |

---

## FRONTEND CALCULATIONS SUMMARY

These values must be calculated on the frontend:

| Calculation | Screen | Formula |
|---|---|---|
| Line Total (purchase) | 06 | `(quantity × unitCost) - discountAmount` |
| Line Total (sale) | 08 | `(quantity × unitPrice) - discountAmount` |
| Subtotal | 06, 08 | Sum of all line totals |
| Total Discount | 06, 08 | Sum of all discountAmounts |
| Total Amount | 06, 08 | `subtotal + deliveryFee` |
| Allocation remainder | 10, 11 | `paymentAmount - totalAllocated` |
| Days Outstanding | 20, 25 | `today - transactionDate` in days |
| Balance label | 18, 23 | `> 0 → PAYABLE/RECEIVABLE`, `< 0 → CREDIT`, `= 0 → SETTLED` |
| Inventory Value | 28 | Sum of `currentStock × avgCost` per variant |
| Aging buckets | 33, 34 | Group `openDocuments` by `daysPastDue` into 0-30/31-60/61-90/90+ |
| Adjustment summary | 15 | Aggregate lines by product, net IN/OUT |
| Total across accounts | 29 | Sum all payment account balances |
| Color indicators | 03 | Green/red based on sign/threshold |
