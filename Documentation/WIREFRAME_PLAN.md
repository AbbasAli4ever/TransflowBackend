# Frontend Wireframe Plan
**Product:** Persona Finance System — Trading Business ERP
**Audience:** Design agent
**Total Screens:** 44
**Stack context:** Web app, sidebar navigation, data-heavy tables, form-heavy entry screens

---

## CHANGELOG

### v1.1 — ProductVariant (2026-02-18)
**Reason:** Products now have size variants (S / M / L / XL / XXL or custom). A `ProductVariant` is the unit that carries `avgCost` and participates in transactions — not the parent `Product`. Every product has at least one variant; the first is auto-created.

**Screens changed:**

| Screen | Change summary |
|--------|----------------|
| 05 — Transaction Detail | Added **Size** column to Transaction Lines table |
| 06 — Create Purchase | Product line-item selection is now **Product → Size** (two-step dropdown) |
| 08 — Create Sale | Same as Screen 06 |
| 12 — Supplier Return | Added **Size** column to returnable lines table |
| 13 — Customer Return | Same as Screen 12 |
| 15 — Stock Adjustment | Product line-item now selects **Product + Size** |
| 26 — Products List | **Avg Cost** and **Current Stock** columns replaced with aggregate totals with "(all sizes)" note; SKU clarified as product-level |
| 27 — Add Product | Clarified that a default **"one-size"** variant is auto-created; added note about adding more variants from Product Detail |
| 28 — Product Detail | Stock cards replaced with **per-variant breakdown table**; aggregate totals shown above |
| 36 — Inventory Valuation | Added **Size** column; rows are now per-variant not per-product |

### v1.2 — Wireframe Review Fixes (2026-02-18)
**Reason:** Two gaps identified during design review of v1.1 output.

**Screens changed:**

| Screen | Change summary |
|--------|----------------|
| 28 — Product Detail | Added **Edit** inline action to per-variant table (edit size label + variant SKU); clarified what is editable |
| 37 — Imports List | Corrected status filter labels to actual backend enum values: `PENDING_MAPPING / VALIDATED / PROCESSING / COMPLETED / ROLLED_BACK` |

---

## NAVIGATION STRUCTURE

```
Sidebar (always visible when logged in):
├── Dashboard
├── Transactions
│   ├── All Transactions
│   ├── New Purchase
│   ├── New Sale
│   ├── New Payment (Supplier)
│   ├── New Receipt (Customer)
│   ├── New Supplier Return
│   ├── New Customer Return
│   ├── New Internal Transfer
│   └── New Stock Adjustment
├── Suppliers
├── Customers
├── Products
├── Payment Accounts
├── Reports
│   ├── P&L
│   ├── Trial Balance
│   ├── Aged Receivables
│   ├── Aged Payables
│   └── Inventory Valuation
├── Imports
└── Settings
```

---

## SCREEN 01 — Login

**Purpose:** Authenticate existing user.

**Layout:** Centered card on a plain background. No sidebar.

**Content:**
- Product logo + name at top
- Heading: "Sign in to your account"
- Email input field
- Password input field (with show/hide toggle)
- "Sign in" button (primary, full width)
- Link: "Don't have an account? Register"
- Error state: inline error banner below form ("Invalid email or password")

**Notes:**
- No "Forgot password" for now (not in backend)
- No social login

---

## SCREEN 02 — Register

**Purpose:** Create a new tenant (business) and owner account.

**Layout:** Centered card, slightly taller than login. No sidebar.

**Content:**
- Logo + name at top
- Heading: "Create your account"
- **Section: Business Info**
  - Business name input
  - Base currency input (default: PKR)
  - Timezone dropdown (default: Asia/Karachi)
- **Section: Owner Account**
  - Full name input
  - Email input
  - Password input (with strength indicator)
  - Confirm password input
- "Create Account" button (primary, full width)
- Link: "Already have an account? Sign in"
- Error state: inline error banner for conflict (email taken), validation errors inline per field

---

## SCREEN 03 — Dashboard

**Purpose:** Single-glance business health view. First screen after login.

**Layout:** Full page with sidebar. Top row = stat cards. Middle row = charts. Bottom row = quick-action buttons + recent activity.

**Content:**

**Top stat cards (5 cards in a row):**
- Total Cash (sum of all payment accounts)
- Total Receivables (what customers owe)
- Total Payables (what we owe suppliers)
- Inventory Value (stock qty × avg cost)
- Overdue (combined overdue receivables amount)

**Each card shows:**
- Label
- Main number (formatted currency)
- Sub-label (e.g., "from 12 customers", "3 accounts", "8 overdue")
- Color indicator (green = healthy, red = overdue/negative)

**Middle section — two panels side by side:**
- Left: Cash by Account — horizontal bar chart or simple list showing each payment account name + balance
- Right: Receivables vs Payables — simple comparison bar or donut chart

**Bottom section:**
- Left: Recent Activity table
  - Columns: Date, Type (SALE/PURCHASE/PAYMENT etc.), Party name, Amount, Status badge
  - Last 10 transactions, no pagination
  - Each row is clickable (goes to transaction detail)
- Right: Quick Actions — large icon buttons
  - New Sale
  - New Purchase
  - Receive Payment
  - Pay Supplier

**Top bar:**
- Date filter: "As of date" date picker (defaults to today)
- Refresh button

---

## SCREEN 04 — Transactions List

**Purpose:** View and filter all transactions across all types.

**Layout:** Full page with sidebar. Filter bar at top, table below.

**Content:**

**Filter bar (horizontal, collapsible):**
- Date range: From / To date pickers
- Type dropdown: ALL / PURCHASE / SALE / SUPPLIER_PAYMENT / CUSTOMER_PAYMENT / SUPPLIER_RETURN / CUSTOMER_RETURN / INTERNAL_TRANSFER / ADJUSTMENT
- Status dropdown: ALL / DRAFT / POSTED
- Party search: text input (searches supplier or customer name)
- Reset filters button

**Table columns:**
- Date
- Document # (e.g., PUR-000012) — clickable
- Type badge (color-coded pill: PURCHASE=blue, SALE=green, PAYMENT=teal, RETURN=orange, ADJUSTMENT=gray)
- Status badge (DRAFT=yellow, POSTED=green)
- Party (supplier or customer name)
- Amount (right-aligned, formatted)
- Action: View button

**Table footer:**
- Pagination: Previous / Page X of Y / Next
- Page size selector: 20 / 50 / 100

**Top right:**
- "New Transaction" dropdown button with sub-options (Purchase, Sale, etc.)

---

## SCREEN 05 — Transaction Detail

**Purpose:** View a single transaction in full — all lines, payment info, status.

**Layout:** Full page with sidebar. Header info block, then lines table, then payment section.

**Content:**

**Header block (top card):**
- Document number (large, prominent)
- Status badge (DRAFT or POSTED)
- Transaction type
- Date
- Party name (supplier or customer) — clickable link to their profile
- Created by + created at timestamp

**Transaction Lines table:**
- Columns: Product name, **Size**, Qty, Unit Cost / Unit Price, Discount, Line Total
- "Size" shows the variant size (e.g., "M", "XL", "one-size")
- Footer row: Subtotal, Discount Total, Delivery Fee, **Total Amount** (bold)

**Payment Info block (below lines, only if applicable):**
- For purchases: Paid Now, Payment Account used
- For sales: Received Now, Payment Account used
- For payments: Amount, Payment Account, Allocations applied

**Allocations section (if payment type):**
- Table: Applied to Document #, Date, Amount Applied
- Total allocated vs total amount

**Actions bar (top right):**
- If DRAFT: "Post Transaction" button (primary) + "Edit" button + "Delete Draft" button
- If POSTED: "Print / Export PDF" button (placeholder, no backend needed)

---

## SCREEN 06 — Create Purchase (Step 1: Draft)

**Purpose:** Enter a new purchase from a supplier.

**Layout:** Full page with sidebar. Two-column: left = form, right = live summary panel.

**Content:**

**Left — Form:**
- **Header fields:**
  - Supplier — searchable dropdown (search by name, shows active suppliers)
  - Transaction Date — date picker (defaults to today)
  - Idempotency Key — hidden field (auto-generated by frontend, not shown to user)

- **Line Items section:**
  - Table with add/remove rows:
    - Product — searchable dropdown (shows product name, SKU)
    - Size / Variant — dependent dropdown (loads after product selected; lists active sizes with current stock hint per size, e.g. "M — 12 in stock")
    - Quantity — number input (min 1)
    - Unit Cost — number input (min 1)
    - Discount — number input (default 0)
    - Line Total — auto-calculated, read-only
  - "+ Add Line" button at bottom of table
  - Note: backend field sent is `variantId` (the selected variant's ID)

- **Footer fields:**
  - Delivery Fee — number input (default 0)
  - Notes — textarea (optional)

- **Buttons:**
  - "Save as Draft" — saves draft only
  - "Save & Post" — saves draft then immediately posts

**Right — Live Summary panel (sticky):**
- Subtotal
- Total Discount
- Delivery Fee
- **Total Amount** (large, prominent)
- Supplier current balance (shows what we currently owe them)

---

## SCREEN 07 — Create Purchase (Step 2: Post / Payment)

**Purpose:** Confirm posting and optionally record payment made at time of purchase.

**Layout:** Modal overlay OR inline expansion below the draft form.

**Content:**
- Summary of draft (document number, total amount)
- **Payment section (optional):**
  - "Pay now?" toggle
  - If yes:
    - Amount to Pay — number input (pre-filled with total, editable for partial payment)
    - Payment Account — dropdown (active accounts with current balances shown)
- Idempotency key for posting — hidden (auto-generated)
- "Confirm & Post" button
- "Cancel" link

**Notes:**
- If "Pay now?" is off, the purchase posts as fully on credit (adds to AP)
- Posting is irreversible — consider a confirmation warning

---

## SCREEN 08 — Create Sale (Step 1: Draft)

**Purpose:** Enter a new sale to a customer.

**Layout:** Identical structure to Create Purchase.

**Content:**

**Left — Form:**
- **Header fields:**
  - Customer — searchable dropdown
  - Transaction Date — date picker
  - Delivery Type — dropdown: NONE / DELIVERY (optional)
  - Delivery Address — text input (shown only if DELIVERY selected)
  - Notes — textarea (optional)

- **Line Items table:**
  - Product — searchable dropdown (shows product name, SKU)
  - Size / Variant — dependent dropdown (loads after product selected; shows active sizes with current stock hint per size, e.g. "L — 5 in stock")
  - Quantity — number input
  - Unit Price — number input
  - Discount — number input
  - Line Total — auto-calculated
  - Stock warning inline if qty exceeds current stock **for that size**
  - Note: backend field sent is `variantId`

- **Buttons:** "Save as Draft" / "Save & Post"

**Right — Live Summary panel:**
- Subtotal
- Total Discount
- Delivery Fee
- **Total Amount**
- Customer current balance (what they currently owe us)

---

## SCREEN 09 — Create Sale (Step 2: Post / Payment)

**Purpose:** Confirm posting and optionally record payment received.

**Layout:** Modal or inline expansion.

**Content:**
- Draft summary
- **Payment section:**
  - "Receive payment now?" toggle
  - If yes:
    - Amount Received — number input
    - Payment Account — dropdown
- "Confirm & Post" button
- "Cancel" link

---

## SCREEN 10 — Create Supplier Payment

**Purpose:** Record a payment made to a supplier against outstanding invoices.

**Layout:** Single page form, no line items needed.

**Content:**

**Form fields:**
- Supplier — searchable dropdown
  - Below: shows current balance owed to them
- Amount — number input
- Payment Account — dropdown (shows current balance of each account)
- Transaction Date — date picker
- Notes — textarea (optional)

**Allocations section (optional, shown after supplier selected):**
- "Auto-allocate" toggle (default ON — backend handles it)
- If OFF: table shows open purchase invoices for this supplier
  - Columns: Document #, Date, Total, Outstanding, Allocate Amount input
  - Total must not exceed payment amount

**Right panel:**
- Payment amount entered
- Total allocated
- Unallocated remainder

**Buttons:** "Save & Post" (payments go straight to posted, no draft review needed from UX perspective — but backend still creates draft first)

---

## SCREEN 11 — Create Customer Receipt (Customer Payment)

**Purpose:** Record a payment received from a customer.

**Layout:** Identical to Supplier Payment, mirrored for customers.

**Content:**
- Customer — searchable dropdown (shows current balance owed by them)
- Amount — number input
- Payment Account — dropdown
- Transaction Date — date picker
- Notes — textarea
- Allocations section (auto or manual, same pattern as supplier payment)
- "Save & Post" button

---

## SCREEN 12 — Create Supplier Return

**Purpose:** Return goods to a supplier, reducing AP.

**Layout:** Two-step: Step 1 = select source purchase + lines. Step 2 = confirm.

**Content:**

**Step 1 — Select Source:**
- Supplier — searchable dropdown
- Source Purchase — searchable dropdown (shows only POSTED purchases for selected supplier, with document # and date)
- After selection: shows available lines from that purchase
  - Table: Product, **Size**, Original Qty, Already Returned, Returnable Qty
  - Return Qty column — number input (max = returnable qty)
  - Each row is a specific product+size variant
- Notes — textarea
- "Continue" button

**Step 2 — Review & Confirm:**
- Summary card: supplier name, source document, return lines with quantities and amounts
- Calculated credit amount (how much AP will be reduced)
- "Confirm Return" button
- "Back" button

---

## SCREEN 13 — Create Customer Return

**Purpose:** Accept returned goods from a customer, reducing AR.

**Layout:** Same two-step pattern as Supplier Return.

**Content:**

**Step 1 — Select Source:**
- Customer — searchable dropdown
- Source Sale — dropdown (POSTED sales for this customer)
- Return lines table (same as supplier return — includes Product, **Size**, Original Qty, Already Returned, Returnable Qty)
- Notes — textarea
- "Continue" button

**Step 2 — Review & Handling:**
- Return lines summary
- **Return Handling — required:**
  - Radio buttons:
    - "Refund now" — reduces AR, triggers immediate credit
    - "Store credit" — keeps as credit on customer account
- If "Refund now": Payment Account dropdown appears
- "Confirm Return" button
- "Back" button

---

## SCREEN 14 — Create Internal Transfer

**Purpose:** Move money between payment accounts (e.g., Cash → Bank).

**Layout:** Simple single-page form.

**Content:**
- From Account — dropdown (active accounts with balances)
- To Account — dropdown (active accounts, excludes selected From account)
- Amount — number input (shows available balance of From account as hint)
- Transaction Date — date picker
- Notes — textarea (optional)
- "Transfer" button
- Validation: cannot transfer more than From account balance

---

## SCREEN 15 — Create Stock Adjustment

**Purpose:** Manually correct stock levels (damage, counting errors, write-offs).

**Layout:** Single page form with line items table.

**Content:**
- Transaction Date — date picker
- Notes — textarea

**Line Items table:**
- Product — searchable dropdown
- Size / Variant — dependent dropdown (loads after product selected; shows active sizes)
- Direction — toggle per row: IN / OUT (color coded: IN=green, OUT=red)
- Quantity — number input
- Reason — text input per line (e.g., "Damaged in warehouse")
- Current Stock for that size shown as hint
- OUT warning: if adjustment qty exceeds current stock **for that size**
- Note: backend field sent is `variantId`

**Right panel:**
- Summary of adjustments (net IN/OUT by product)

**Buttons:** "Save & Post" (OWNER/ADMIN only — enforced by backend, frontend should hide for STAFF)

---

## SCREEN 16 — Suppliers List

**Purpose:** Browse and manage all suppliers.

**Layout:** Full page with sidebar. Filter bar + table.

**Content:**

**Filter bar:**
- Search input (name or phone)
- Status filter: Active / Inactive / All (default: Active)
- Sort by: Name / Created Date

**Table columns:**
- Name (clickable → supplier detail)
- Phone
- Current Balance (what we owe them — from `_computed.currentBalance`)
- Status badge
- Actions: View / Edit / Change Status

**Top right:**
- "+ Add Supplier" button

**Empty state:** "No suppliers found. Add your first supplier."

---

## SCREEN 17 — Add Supplier

**Purpose:** Create a new supplier.

**Layout:** Modal dialog OR right-side drawer panel.

**Content:**
- Name — text input (required)
- Phone — text input (optional)
- Address — textarea (optional)
- Notes — textarea (optional)
- "Save Supplier" button
- "Cancel" button
- Error state: name already exists (409 from backend)

---

## SCREEN 18 — Supplier Detail

**Purpose:** Full profile + financial summary for one supplier.

**Layout:** Full page. Top = profile + balance cards. Below = tabbed content.

**Content:**

**Top section:**
- Supplier name (large heading)
- Status badge + "Change Status" button
- "Edit" button
- Phone, Address, Notes displayed

**Balance cards (3 cards):**
- Total Purchased (all time)
- Total Paid
- Current Balance (with PAYABLE / CREDIT / SETTLED label)

**Tabs:**
- **Ledger** — links to Supplier Ledger screen (Screen 19)
- **Open Documents** — unpaid invoices table
- **Transactions** — all transactions filtered for this supplier (links to transactions list with supplierId filter)

---

## SCREEN 19 — Supplier Ledger (Statement)

**Purpose:** Full chronological account of every transaction with this supplier, with running balance.

**Layout:** Full page. Date filter at top, ledger table below.

**Content:**

**Filter bar:**
- Date From / Date To pickers
- "Run Report" button

**Ledger table:**
- Columns: Date | Document # | Type | Description | Debit (AP Increase) | Credit (AP Decrease) | Running Balance
- Color: Debit rows = light red tint, Credit rows = light green tint
- Each Document # is clickable → Transaction Detail

**Footer:**
- Opening Balance (as of dateFrom)
- Closing Balance (as of dateTo)

**Top right:**
- Export button (PDF/CSV — placeholder)

---

## SCREEN 20 — Supplier Open Documents

**Purpose:** List all unpaid/partially-paid purchase invoices for a supplier.

**Layout:** Full page or tab within supplier detail.

**Content:**

**Table columns:**
- Document #
- Date
- Total Amount
- Paid Amount
- Outstanding (highlighted if large)
- Days Outstanding

**Footer:**
- Total Outstanding
- Unapplied Credits (return credits not yet offset)
- Net Outstanding

**Quick action:**
- "Pay Now" button per row (opens Create Supplier Payment pre-filled for this document)

---

## SCREEN 21 — Customers List

**Purpose:** Browse and manage all customers.

**Layout:** Identical structure to Suppliers List.

**Content:**
- Search input (name or phone)
- Status filter
- Sort by: Name / Created Date

**Table columns:**
- Name (clickable → customer detail)
- Phone
- Current Balance (what they owe us)
- Status badge
- Actions: View / Edit / Change Status

**Top right:**
- "+ Add Customer" button

---

## SCREEN 22 — Add Customer

**Purpose:** Create a new customer.

**Layout:** Modal dialog or drawer.

**Content:**
- Name — text input (required)
- Phone — text input (optional)
- Address — textarea (optional)
- Notes — textarea (optional)
- "Save Customer" button / "Cancel" button

---

## SCREEN 23 — Customer Detail

**Purpose:** Full profile + financial summary for one customer.

**Layout:** Identical structure to Supplier Detail.

**Content:**

**Balance cards:**
- Total Sales
- Total Received (Payments + Returns)
- Current Balance (RECEIVABLE / CREDIT / SETTLED)

**Tabs:**
- **Ledger** — links to Customer Ledger (Screen 24)
- **Open Documents** — unpaid sales table
- **Transactions** — all transactions for this customer

---

## SCREEN 24 — Customer Ledger (Statement)

**Purpose:** Full chronological statement for a customer.

**Layout:** Identical structure to Supplier Ledger.

**Content:**

**Ledger table:**
- Columns: Date | Document # | Type | Description | Debit (AR Decrease = payments/returns) | Credit (AR Increase = sales) | Running Balance

**Footer:**
- Opening Balance
- Closing Balance

---

## SCREEN 25 — Customer Open Documents

**Purpose:** Unpaid/partially-paid sales invoices for a customer.

**Layout:** Identical to Supplier Open Documents, mirrored for AR.

**Content:**
- Document #, Date, Total, Received, Outstanding, Days Outstanding
- Net Outstanding after unapplied credits

**Quick action:**
- "Receive Payment" button per row (opens Create Customer Receipt pre-filled)

---

## SCREEN 26 — Products List

**Purpose:** Browse all products with live stock.

**Layout:** Full page. Filter bar + table.

**Content:**

**Filter bar:**
- Search (name, SKU, category)
- Status filter: Active / Inactive / All
- Category filter — text input

**Table columns:**
- Name (clickable → product detail)
- SKU (product-level identifier)
- Category
- Unit
- Total Stock (sum across all sizes; highlight in red if 0)
- # Sizes (count of active variants, e.g. "5 sizes")
- Status badge
- Actions: View / Edit / Change Status

**Notes:**
- Avg Cost is per-variant and shown in Product Detail, not this list (too many values to summarize meaningfully)
- Clicking a row goes to Product Detail which shows per-size breakdown

**Top right:**
- "+ Add Product" button

---

## SCREEN 27 — Add Product

**Purpose:** Create a new product.

**Layout:** Modal dialog or drawer.

**Content:**
- Name — text input (required)
- SKU — text input (optional, auto-uppercase; product-level identifier)
- Category — text input (optional)
- Unit — text input (optional, e.g., "kg", "bag", "pcs")
- "Save Product" button / "Cancel"

**Notes:**
- Saving auto-creates a default **"one-size"** variant in the background (no extra UI step required)
- To add more sizes (S, M, L, XL, XXL etc.) the user goes to Product Detail → Sizes tab after creation
- The product cannot participate in transactions until at least one active variant exists (always true after creation)

---

## SCREEN 28 — Product Detail

**Purpose:** Full product profile + stock and cost information.

**Layout:** Full page. Top = profile + stock cards. Below = tabbed content.

**Content:**

**Aggregate summary cards (3 cards — totals across all sizes):**
- Total Stock (sum of all variant quantities)
- Total Inventory Value (sum of variant qty × avgCost per variant)
- Active Sizes (count of active variants)

**Per-size breakdown table (below the summary cards):**
- Columns: Size | SKU (variant-level, optional) | Current Stock | Avg Cost | Value (qty × avgCost) | Status badge | Actions
- **Actions per row:**
  - **Edit** — inline edit row: change size label (e.g. "M" → "Medium") and/or variant SKU; confirm with checkmark / cancel
  - **Change Status** — activate or deactivate the size (blocked if stock > 0 for deactivation)
- Low stock rows highlighted in amber (stock ≤ 5); zero stock rows highlighted in red
- "Add Size" button above table — opens inline form: Size name input + optional variant SKU
- Note: size label and variant SKU are the only editable fields post-creation; avgCost is system-managed via purchases

**Tabs:**
- **Purchase History** — transactions list filtered to PURCHASE type for this product
- **Sale History** — transactions list filtered to SALE type for this product
- **Stock Movements** — all inventory movements (purchase/sale/return/adjustment) per variant with Size column visible

---

## SCREEN 29 — Payment Accounts List

**Purpose:** View all cash/bank/wallet accounts with live balances.

**Layout:** Full page. Filter bar + cards OR table.

**Content:**

**Filter bar:**
- Type filter: All / CASH / BANK / WALLET / CARD
- Status filter: Active / Inactive / All

**Account cards (or table rows):**
- Account name
- Type badge (CASH / BANK / WALLET / CARD)
- Current Balance (large, prominent)
- Opening Balance
- Total In / Total Out (smaller text)
- Status badge
- Actions: View Statement / Edit / Change Status

**Top right:**
- "+ Add Account" button
- Total across all accounts (bold summary at top)

---

## SCREEN 30 — Add Payment Account

**Purpose:** Create a new payment account.

**Layout:** Modal dialog.

**Content:**
- Name — text input (required, e.g., "HBL Business Account")
- Type — dropdown: CASH / BANK / WALLET / CARD
- Opening Balance — number input (default 0)
- "Save Account" button / "Cancel"

---

## SCREEN 31 — Payment Account Statement

**Purpose:** Full transaction history for one account (cash book / bank statement view).

**Layout:** Full page. Filter bar at top, statement table below.

**Content:**

**Filter bar:**
- Date From / Date To
- "Run Report" button

**Statement table:**
- Columns: Date | Document # | Transaction Type | Party | Money In | Money Out | Running Balance
- Opening Balance row at top (from dateFrom)
- Closing Balance row at bottom

**Summary cards (above table):**
- Opening Balance
- Total In
- Total Out
- Closing Balance

**Top right:**
- Export button (placeholder)

---

## SCREEN 32 — P&L Report

**Purpose:** Profit & Loss for a date range.

**Layout:** Full page. Controls at top, formatted report below.

**Content:**

**Controls:**
- Date From / Date To pickers
- "Generate" button

**Report body (formatted like a real P&L):**
```
REVENUE
  Sales                          XXX,XXX
  Less: Sales Returns           (XX,XXX)
  Net Revenue                    XXX,XXX

COST OF GOODS SOLD
  Cost of Sales                 (XXX,XXX)
                                 ─────────
GROSS PROFIT                     XXX,XXX

GROSS PROFIT MARGIN              XX.X%
```
- Each line is clickable to drill into the transactions that make up that number

**Top right:**
- Export button (placeholder)

---

## SCREEN 33 — Aged Receivables Report

**Purpose:** See which customers owe money and how overdue they are.

**Layout:** Full page. Date filter + table.

**Content:**

**Controls:**
- As of Date picker
- "Generate" button

**Table columns:**
- Customer Name
- Current (0–30 days)
- 31–60 days
- 61–90 days
- 90+ days
- Total Outstanding

**Footer row:**
- Totals for each bucket

**Notes:**
- Rows in red if 90+ bucket has amount
- Click customer name → Customer Open Documents

---

## SCREEN 34 — Aged Payables Report

**Purpose:** Same as Aged Receivables but for suppliers.

**Layout:** Identical structure to Aged Receivables.

**Content:**
- Supplier Name
- Aging buckets: 0–30 / 31–60 / 61–90 / 90+
- Total Outstanding
- Footer totals
- Click supplier name → Supplier Open Documents

---

## SCREEN 35 — Trial Balance

**Purpose:** All account balances at a point in time.

**Layout:** Full page. Date filter + formatted report.

**Content:**

**Controls:**
- As of Date picker
- "Generate" button

**Report table:**
```
Account               Debit        Credit
─────────────────────────────────────────
Accounts Receivable   XXX,XXX
Accounts Payable                   XXX,XXX
Cash - Main                        XXX,XXX
Inventory             XXX,XXX
─────────────────────────────────────────
TOTALS                XXX,XXX      XXX,XXX
```

---

## SCREEN 36 — Inventory Valuation Report

**Purpose:** Stock on hand value by product.

**Layout:** Full page. Date filter + table.

**Content:**

**Controls:**
- As of Date picker
- "Generate" button

**Table columns:**
- Product Name
- **Size** (variant size, e.g. "M", "XL", "one-size")
- SKU (variant-level SKU if set, otherwise product SKU)
- Category
- Qty on Hand
- Avg Cost (per unit for this size)
- Total Value (Qty × Avg Cost)

**Grouping:**
- Rows grouped by Product Name (show product name only on first row of each group)
- Sub-total row per product group: Total Qty, Total Value

**Footer:**
- Grand Total Inventory Value

**Top right:**
- Export button (placeholder)

---

## SCREEN 37 — Imports List

**Purpose:** History of all bulk imports.

**Layout:** Full page. Filter bar + table.

**Content:**

**Filter bar:**
- Module filter: All / SUPPLIERS / CUSTOMERS / PRODUCTS / OPENING_BALANCES
- Status filter: All / PENDING_MAPPING / VALIDATED / PROCESSING / COMPLETED / ROLLED_BACK
  - `PENDING_MAPPING` — uploaded, awaiting column mapping
  - `VALIDATED` — columns mapped, rows validated, ready to commit
  - `PROCESSING` — commit in progress
  - `COMPLETED` — all valid rows imported
  - `ROLLED_BACK` — import undone

**Table columns:**
- Date
- Module badge
- File name
- Total Rows / Success / Failed
- Status badge
- Actions: View / Rollback (shown only if status = COMPLETED and rollback is still possible)

**Top right:**
- "+ New Import" button

---

## SCREEN 38 — New Import (Step 1: Upload)

**Purpose:** Start a new bulk import.

**Layout:** Centered card, stepper at top showing 3 steps.

**Stepper:** Upload → Map Columns → Preview & Commit

**Content:**
- Module selector — dropdown: SUPPLIERS / CUSTOMERS / PRODUCTS / OPENING_BALANCES
- File upload area — drag & drop zone + "Browse" button (accepts .csv, .xlsx)
- File size limit hint (max 10MB)
- "Upload & Continue" button
- Template download link: "Download sample CSV for [module]"

---

## SCREEN 39 — New Import (Step 2: Map Columns)

**Purpose:** Map CSV/XLSX headers to system fields.

**Layout:** Centered card, stepper at top (step 2 active).

**Content:**
- File name shown (readonly)
- Detected columns listed on left
- System required fields on right
- **Mapping rows:** for each system field — dropdown to select which CSV column maps to it
- Required fields marked with asterisk
- Optional fields shown but not required
- Detected column header previewed with first 2 sample values
- "Next: Preview" button
- "Back" button

---

## SCREEN 40 — New Import (Step 3: Preview & Commit)

**Purpose:** Review validated rows before committing.

**Layout:** Full page, stepper at top (step 3 active).

**Content:**

**Summary bar:**
- Total rows: X
- Valid rows: X (green)
- Failed rows: X (red)
- Warning: "Failed rows will be skipped. Proceed?"

**Preview table (all rows):**
- Row # | Data columns | Status badge (VALID / FAILED) | Error message (if failed)
- Failed rows highlighted in red
- Pagination for large files

**Action buttons:**
- "Commit Import" (primary) — imports valid rows, skips failed
- "Cancel" — goes back to imports list without committing

**After commit — success state on same screen:**
- "Import committed successfully"
- X records imported
- X records skipped
- "View Import Details" button → Import Detail

---

## SCREEN 41 — Import Detail

**Purpose:** Full results of a completed import with row-level detail.

**Layout:** Full page.

**Content:**

**Header:**
- Module badge
- Status badge
- File name
- Committed at timestamp
- Committed by

**Summary cards:**
- Total Rows / Committed / Failed

**Results table:**
- Row # | Data | Status | Error | Created Record (name, with link if COMMITTED)

**Actions:**
- "Rollback Import" button (danger, shown only if status = COMMITTED and rollback is possible)
- Rollback confirmation modal: "This will undo all records created by this import. Are you sure?"

---

## SCREEN 42 — Settings: Business Profile

**Purpose:** Edit tenant-level settings.

**Layout:** Settings page with left sub-nav.

**Content:**
- Business Name — text input
- Base Currency — text input (read-only for now)
- Timezone — dropdown
- "Save Changes" button

---

## SCREEN 43 — Settings: Users & Roles

**Purpose:** Manage users in the tenant.

**Layout:** Settings page.

**Content:**

**Users table:**
- Full Name
- Email
- Role badge (OWNER / ADMIN / STAFF)
- Status badge
- Actions: Change Role / Deactivate

**Note:** No invite flow in backend yet — placeholder "Invite User" button can show "Coming soon" modal.

---

## SCREEN 44 — Settings: Payment Accounts

**Purpose:** Shortcut to manage payment accounts from Settings.

**Content:** Links to Payment Accounts List (Screen 29) and Add Account (Screen 30). Or embed the same content.

---

## GLOBAL COMPONENTS (appear across multiple screens)

**Top Navigation Bar:**
- Business name / logo (left)
- Page title (center)
- User avatar + name (right) with dropdown: Profile / Logout

**Sidebar:**
- Collapsible on mobile
- Active item highlighted
- Badge counts on Transactions (DRAFT count)

**Confirmation Modal (reused everywhere):**
- Title, description, Confirm button (danger/primary), Cancel button

**Toast Notifications:**
- Success (green): "Transaction posted successfully"
- Error (red): "Failed to save. Please try again."
- Warning (yellow): "Stock below zero after this adjustment"

**Empty State (reused on all tables):**
- Icon + message + primary action button

**Loading States:**
- Skeleton loaders on tables (not spinners)
- Disabled buttons with spinner during API calls

---

## TOTAL SCREEN COUNT: 44 screens
(including the 4 global component notes above as design reference)
