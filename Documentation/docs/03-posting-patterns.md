# Posting Patterns (Engineering Spec)

Posting converts a transaction event into immutable system outputs. These rules are the contract between the UI, API, and database.

## Global Posting Rules (Applies to All Transaction Types)

### Posting Preconditions

1. Transaction must be `DRAFT` and can become `POSTED` only once.
2. Posting is **atomic** (single DB transaction): all rows are created or none.
3. Posting is **idempotent**: the same idempotency key cannot create duplicate outputs.
4. `document_number` is assigned at posting time (unique per tenant + type + series).
5. `transaction_date` is business date; `posted_at` is system timestamp.

### Output Creation Rules

Only `POSTED` transactions generate:

- `inventory_movements` (stock changes)
- `ledger_entries` (AP/AR changes)
- `payment_entries` (money movement)
- `allocations` (settlement mapping)

### Money Rules

- Money stored as integer PKR.
- Amounts are always positive; direction is handled by entry types.
- For transfers: always create two legs.

### Stock Rules

- No negative stock by default.
- Before SALE_OUT / SUPPLIER_RETURN_OUT / ADJUSTMENT_OUT, validate available stock.
- Concurrency-safe stock posting is required (locks or optimistic checks).

### Allocation Rules (V1)

- `allocations` link a payment transaction to one or more documents (SALE/PURCHASE).
- Total allocated to a payment ≤ payment amount.
- Total allocated to a document ≤ document total.
- Unapplied payment becomes credit.
- Unpaid document balance remains pending.

---

## 2.5.1 PURCHASE (buy stock from supplier, may be partially paid)

### Inputs (required)

- `supplier_id`
- lines: `{product_id, qty, unit_cost}`
- optional: `paid_now` + `payment_account_id`

### Rows created on POST

**A) `transactions`**

- type = PURCHASE
- status = POSTED
- totals computed from lines (and delivery/discount if supported)

**B) `transaction_lines`** (one per product line)

- unit_cost set
- line_total = qty × unit_cost (minus discount if any)

**C) `inventory_movements`** (one per line)

- movement_type = PURCHASE_IN
- quantity = qty
- unit_cost_at_time = unit_cost

**D) `ledger_entries`**

- AP_INCREASE = total_amount (you owe supplier)

**E) If `paid_now > 0`**

- `payment_entries`: MONEY_OUT = paid_now (payment_account_id)
- `ledger_entries`: AP_DECREASE = paid_now
- `allocations`: apply paid_now to this PURCHASE (recommended auto allocation)

### Validations

- supplier required
- qty > 0, unit_cost > 0
- if paid_now > 0 -> payment_account_id required
- paid_now ≤ total_amount (if overpay is allowed, it becomes supplier credit)

---

## 2.5.2 SALE (sell to customer / checkout, may be partially paid)

### Inputs (required)

- `customer_id` (create if new)
- lines: `{product_id, qty, unit_price}`
- optional: `received_now` + `payment_account_id`
- optional delivery info

### Rows created on POST

**A) `transactions`**

- type = SALE
- status = POSTED

**B) `transaction_lines`**

- unit_price set
- line_total = qty × unit_price (minus discount if any)

**C) `inventory_movements`**

- movement_type = SALE_OUT
- quantity = qty
- unit_cost_at_time = current product avg_cost (for audit/profit later)

**D) `ledger_entries`**

- AR_INCREASE = total_amount (customer owes you)

**E) If `received_now > 0`**

- `payment_entries`: MONEY_IN = received_now (payment_account_id)
- `ledger_entries`: AR_DECREASE = received_now
- `allocations`: apply received_now to this SALE (auto allocation)

### Validations

- customer required
- qty > 0, unit_price > 0
- stock check (no negative stock)
- if received_now > 0 -> payment_account_id required

---

## 2.5.3 SUPPLIER_PAYMENT (pay supplier later)

### Inputs

- `supplier_id`
- `amount`
- `payment_account_id`
- optional: allocations target purchase document(s)

### Rows created on POST

**A) `transactions`**

- type = SUPPLIER_PAYMENT
- status = POSTED

**B) `payment_entries`**

- MONEY_OUT = amount

**C) `ledger_entries`**

- AP_DECREASE = amount

**D) `allocations`**

- if user selected documents -> allocate accordingly
- else auto-allocate oldest-first among open PURCHASE documents for that supplier
- leftover becomes supplier credit

### Validations

- supplier required
- amount > 0
- payment_account_id required

---

## 2.5.4 CUSTOMER_PAYMENT (receive from customer later)

### Inputs

- `customer_id`
- `amount`
- `payment_account_id`
- optional: allocations target sale invoice(s)

### Rows created on POST

**A) `transactions`**

- type = CUSTOMER_PAYMENT
- status = POSTED

**B) `payment_entries`**

- MONEY_IN = amount

**C) `ledger_entries`**

- AR_DECREASE = amount

**D) `allocations`**

- if user selected documents -> allocate accordingly
- else auto-allocate oldest-first among open SALE documents for that customer
- leftover becomes customer credit

### Validations

- customer required
- amount > 0
- payment_account_id required

---

## 2.5.5 SUPPLIER_RETURN (return stock back to supplier) (V1.1)

### Inputs

- `supplier_id`
- lines: `{product_id, qty}`
- mandatory link: link each return line to original purchase line(s)

### Rows created on POST

**A) `transactions`**

- type = SUPPLIER_RETURN
- status = POSTED

**B) `transaction_lines`**

- quantity set
- unit_cost determined (see return valuation)
- line_total = qty × unit_cost

**C) `inventory_movements`**

- movement_type = SUPPLIER_RETURN_OUT
- quantity = qty
- unit_cost_at_time = unit_cost used

**D) `ledger_entries`**

- AP_DECREASE = return_total_value (reduces what you owe supplier)

### Return valuation rule (V1)

- If linked to original purchase line -> use that `unit_cost`
- Else fallback to current `avg_cost` of product

### Validations

- supplier required
- qty > 0
- stock check (can’t return more than current stock)

---

## 2.5.6 CUSTOMER_RETURN (customer returns product) (V1.1)

### Inputs

- `customer_id`
- lines: `{product_id, qty}`
- return handling choice:
  - **Refund now** (requires payment_account_id), OR
  - **Store credit** (no immediate money movement)
- recommended: link to original sale line(s)

### Rows created on POST

**A) `transactions`**

- type = CUSTOMER_RETURN
- status = POSTED

**B) `transaction_lines`**

- quantity set
- unit_price for return valuation (see below)
- line_total = qty × return_unit_price

**C) `inventory_movements`**

- movement_type = CUSTOMER_RETURN_IN
- quantity = qty
- unit_cost_at_time = current avg_cost (for valuation)

**D) `ledger_entries`**

- AR_DECREASE = return_total_value (reduces what customer owes)

**E) Refund handling**

- If refund now:
  - `payment_entries`: MONEY_OUT = refund_amount (payment_account_id)
- If store credit:
  - no payment entry (customer credit will exist if AR goes negative)

### Return valuation rule (V1)

- If linked to original sale line -> use original `unit_price`
- Else use user-entered return price (admin/business rule controlled)

### Validations

- customer required
- qty > 0
- if refund now -> payment_account_id required

---

## 2.5.7 INTERNAL_TRANSFER (move money between accounts) (V1.1)

### Inputs

- `from_payment_account_id`
- `to_payment_account_id`
- `amount`

### Rows created on POST

**A) `transactions`**

- type = INTERNAL_TRANSFER
- status = POSTED

**B) `payment_entries`** (two rows)

- OUT: from_payment_account_id, MONEY_OUT = amount
- IN: to_payment_account_id, MONEY_IN = amount
- both share same `transfer_group_id`

### Validations

- from != to
- amount > 0

---

## 2.5.8 ADJUSTMENT (admin-only in V1, schema-ready) (V1.1)

### Inputs

- product lines: `{product_id, qty, direction(IN/OUT), reason}`
- optional: cost override (rare)

### Rows created on POST

- `transactions`: type = ADJUSTMENT
- `transaction_lines`
- `inventory_movements`:
  - ADJUSTMENT_IN or ADJUSTMENT_OUT
- No ledger/payment entries in V1 (inventory-only)

### Validations

- reason required
- stock check for ADJUSTMENT_OUT

---

## Credits (How They Appear)

Credits are not a separate manual record. They appear naturally when balances go below zero:

- **Customer credit**: customer has paid more than owed (AR becomes negative / net AR_DECREASE > AR_INCREASE)
- **Supplier credit**: you paid supplier more than you owed (AP becomes negative / net AP_DECREASE > AP_INCREASE)

(Optionally surface as “credit balance” in UI.)

## Legacy Reference (Notion Source)

- Posting patterns index: `Documentation/Financial System/Data Model/2 5 Posting Patterns (Engineering Spec) 2fa91bf6339080098f3df4bb254bb527.md`
- Global posting rules: `Documentation/Financial System/Data Model/2 5 Posting Patterns (Engineering Spec)/2 5 0 Global Posting Rules (applies to all transac 2fa91bf63390809aae20f692c6e45a25.md`
