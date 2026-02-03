# UI Specification (V1)

This document defines the user interface scope, screen inventory, workflows, and validation rules. The UI must follow the posting rules exactly.

## Screen Inventory (V1)

1. Dashboard
   - Summary cards: Cash, Payables, Receivables
   - Stock alerts (low stock)
   - Recent transactions list

2. Suppliers
   - Supplier list
   - Create/Edit supplier
   - Supplier statement

3. Customers
   - Customer list
   - Create/Edit customer
   - Customer statement

4. Products
   - Product list
   - Create/Edit product
   - Product stock view

5. Purchases
   - Purchase list
   - Create purchase
   - Purchase detail

6. Sales
   - Sales list
   - Create sale
   - Sale detail

7. Supplier Payments
   - Supplier payment list
   - Create supplier payment

8. Customer Payments
   - Customer payment list
   - Create customer payment

9. Statements
   - Supplier statements
   - Customer statements

Planned for V1.1:

- Returns (supplier return, customer return)
- Internal transfers
- Voids and adjustments

## Core Workflows

### Create Purchase (Partial Payment)

Steps:

- Select supplier
- Add line items (product, qty, unit cost)
- System calculates subtotal and total
- Optional: enter paid now and choose payment account
- Submit -> POST transaction
- Show posted document and updated supplier balance

Validations:

- Supplier required
- Qty > 0, unit_cost > 0
- If paid_now > 0 -> payment_account required

### Create Sale (Partial Payment)

Steps:

- Select customer
- Add line items (product, qty, unit price)
- System calculates subtotal and total
- Optional: enter received now and choose payment account
- Submit -> POST transaction
- Show posted document and updated customer balance

Validations:

- Customer required
- Qty > 0, unit_price > 0
- Stock check (no negative stock)
- If received_now > 0 -> payment_account required

### Supplier Payment (Apply to Bills)

Steps:

- Select supplier
- Enter amount and payment account
- Allocate to open purchase bills (manual allocation UI)
- Submit -> POST transaction

Validations:

- Supplier required
- Amount > 0
- Payment account required
- Allocation total <= payment amount

### Customer Payment (Apply to Invoices)

Steps:

- Select customer
- Enter amount and payment account
- Allocate to open sales invoices
- Submit -> POST transaction

Validations:

- Customer required
- Amount > 0
- Payment account required
- Allocation total <= payment amount

### Statements

Steps:

- Select supplier or customer
- Pick date range
- Show ledger entries with running balance

## Form Defaults

- Transaction date defaults to today
- Paid now defaults to 0
- Payment account required only when paid_now > 0

## Validation Messages (Examples)

- "Stock not sufficient for product X"
- "Payment amount exceeds outstanding balance"
- "Allocation exceeds payment amount"
- "Return quantity exceeds original quantity"
- "Idempotency key conflict"

## UI Rules (Non-Negotiable)

- All totals must match posted transaction totals.
- Never show derived balances from cached fields unless they match ledger sums.
- Only POSTED transactions affect balances and stock.
- Drafts are not counted in balances.

## V1.1 Workflows (Planned)

### Returns

- Supplier return reduces payable and stock
- Customer return reduces receivable and increases stock
- Refund requires payment account

### Internal Transfer

- Moves money between accounts
- Always two-leg in payment entries

### Voids

- Voiding creates reversal entries
- Requires reason and actor
