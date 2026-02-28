# Database Field Mapping

**Purpose:** For every screen and every field, this document tells you exactly which database table the data comes from, which column, what filter is applied, and for write operations — what table/column the data goes into.

**How to use:** Pick your screen → find the field → check Table + Column + Filter → open Prisma Studio and apply that filter to verify the data.

**Filter notation:**
- `:tenantId` = current tenant's UUID (always applied — every query is tenant-scoped)
- `:id` = the record UUID in the URL
- `:asOfDate` = the selected date parameter

---

## Table Reference

| Prisma Model | DB Table | Purpose |
|---|---|---|
| Tenant | `tenants` | Business accounts |
| User | `users` | User accounts per tenant |
| RefreshToken | `refresh_tokens` | JWT refresh tokens |
| Supplier | `suppliers` | Supplier master data |
| Customer | `customers` | Customer master data |
| Product | `products` | Product master data |
| ProductVariant | `product_variants` | Sizes/variants per product |
| PaymentAccount | `payment_accounts` | Cash/bank accounts |
| Transaction | `transactions` | All transaction headers |
| TransactionLine | `transaction_lines` | Line items per transaction |
| InventoryMovement | `inventory_movements` | Stock in/out movements |
| LedgerEntry | `ledger_entries` | AR/AP double-entry records |
| PaymentEntry | `payment_entries` | Cash flow records |
| Allocation | `allocations` | Payment-to-invoice links |
| DocumentSequence | `document_sequences` | Auto-number counters |
| ImportBatch | `import_batches` | Import job headers |
| ImportRow | `import_rows` | Import row data |
| StatusChangeLog | `status_change_logs` | Audit trail for status changes |

---

## SCREEN 01 — Login

### READ
| Field on Screen | Table | Column | Filter |
|---|---|---|---|
| (validate credentials) | `users` | `email`, `password_hash`, `status` | `WHERE email = :email` (case-insensitive) |
| (check tenant active) | `tenants` | `status` | `WHERE id = users.tenant_id` |
| Tenant name (stored after login) | `tenants` | `name`, `base_currency`, `timezone` | `WHERE id = users.tenant_id` |
| User role (stored after login) | `users` | `role` | `WHERE id = :userId` |

### WRITE
| Action | Table | Columns Written | Trigger |
|---|---|---|---|
| Successful login | `users` | `last_login_at = NOW()` | POST /auth/login success |
| Successful login | `refresh_tokens` | `user_id, tenant_id, token_hash, expires_at` | Token issued at login |

---

## SCREEN 02 — Register

### WRITE
| Action | Table | Columns Written | Trigger |
|---|---|---|---|
| Step 1: Register | `tenants` | `id, name (tenantName), status='ACTIVE', base_currency='PKR', timezone='Asia/Karachi'` | POST /auth/register |
| Step 1: Register | `users` | `id, tenant_id, full_name, email, password_hash, role='OWNER', status='ACTIVE'` | POST /auth/register |
| Step 1: Register | `refresh_tokens` | `user_id, tenant_id, token_hash, expires_at` | Immediately after register |
| Step 2: Apply settings | `tenants` | `base_currency, timezone` | PATCH /auth/tenant (called immediately after step 1 with the accessToken) |

---

## SCREEN 03 — Dashboard

### READ: Top Stat Cards

| Card | Table | Column | Filter |
|---|---|---|---|
| Total Cash | `payment_accounts` | `opening_balance` (base) | `WHERE tenant_id = :tenantId AND status = 'ACTIVE'` |
| Total Cash (movements) | `payment_entries` | `amount, direction` | `WHERE tenant_id = :tenantId AND transaction_date <= :asOfDate` → joined to `transactions WHERE status='POSTED'` |
| Total Receivables | `ledger_entries` | `amount, entry_type` | `WHERE tenant_id = :tenantId AND entry_type IN ('AR_INCREASE','AR_DECREASE') AND transaction_date <= :asOfDate` → joined to `transactions WHERE status='POSTED'` |
| Total Payables | `ledger_entries` | `amount, entry_type` | `WHERE tenant_id = :tenantId AND entry_type IN ('AP_INCREASE','AP_DECREASE') AND transaction_date <= :asOfDate` → joined to `transactions WHERE status='POSTED'` |
| Inventory Value | `inventory_movements` | `quantity, unit_cost_at_time, movement_type` | `WHERE tenant_id = :tenantId AND transaction_date <= :asOfDate` → joined with `product_variants WHERE status='ACTIVE'` |
| Overdue Receivables | `transactions` | `total_amount, transaction_date` | `WHERE tenant_id = :tenantId AND type='SALE' AND status='POSTED'` → LEFT JOIN `allocations` → `HAVING outstanding > 0 AND transaction_date < :overdueDate` |

### READ: Cash by Account list

| Field | Table | Column | Filter |
|---|---|---|---|
| Account name | `payment_accounts` | `name` | `WHERE tenant_id = :tenantId AND status='ACTIVE'` |
| Balance per account | `payment_entries` | `amount, direction` | `WHERE tenant_id = :tenantId AND payment_account_id = pa.id AND transaction_date <= :asOfDate` |

### READ: Recent Activity (second API call)

| Field | Table | Column | Filter |
|---|---|---|---|
| Date | `transactions` | `transaction_date` | `WHERE tenant_id = :tenantId AND status='POSTED' ORDER BY created_at DESC LIMIT 10` |
| Type | `transactions` | `type` | same |
| Party name | `suppliers` / `customers` | `name` | `LEFT JOIN suppliers ON supplier_id = suppliers.id` / same for customers |
| Amount | `transactions` | `total_amount` | same |
| Document # | `transactions` | `document_number` | same |

---

## SCREEN 04 — Transactions List

### READ

| Column | Table | Column | Filter |
|---|---|---|---|
| Date | `transactions` | `transaction_date` | `WHERE tenant_id = :tenantId` |
| Document # | `transactions` | `document_number` | same (NULL for drafts) |
| Type | `transactions` | `type` | Optional: `AND type = :type` |
| Status | `transactions` | `status` | Optional: `AND status = :status` |
| Party Name | `suppliers` | `name` | `LEFT JOIN suppliers ON supplier_id = suppliers.id` |
| Party Name | `customers` | `name` | `LEFT JOIN customers ON customer_id = customers.id` |
| Amount | `transactions` | `total_amount` | same |
| Pagination total | `transactions` | `COUNT(*)` | Same filters as above |

**Available filters applied to `transactions` table:**
- `?type=PURCHASE` → `AND type = 'PURCHASE'`
- `?status=DRAFT` → `AND status = 'DRAFT'`
- `?supplierId=:id` → `AND supplier_id = :id`
- `?customerId=:id` → `AND customer_id = :id`
- `?partySearch=text` → `AND (supplier.name ILIKE '%text%' OR customer.name ILIKE '%text%')`
- `?productId=:id` → `AND EXISTS (SELECT 1 FROM transaction_lines tl JOIN product_variants pv ON pv.id = tl.variant_id WHERE pv.product_id = :id AND tl.transaction_id = t.id)`
- `?dateFrom=` → `AND transaction_date >= :dateFrom`
- `?dateTo=` → `AND transaction_date <= :dateTo`

---

## SCREEN 05 — Transaction Detail

### READ: Header

| Field | Table | Column | Filter |
|---|---|---|---|
| Document # | `transactions` | `document_number` | `WHERE id = :id AND tenant_id = :tenantId` |
| Status | `transactions` | `status` | same |
| Type | `transactions` | `type` | same |
| Date | `transactions` | `transaction_date` | same |
| Party name (supplier) | `suppliers` | `name` | `JOIN suppliers ON transactions.supplier_id = suppliers.id` |
| Party name (customer) | `customers` | `name` | `JOIN customers ON transactions.customer_id = customers.id` |
| Created by | `users` | `full_name` | `JOIN users ON transactions.created_by = users.id` (via `createdByUser` include) |
| Created at | `transactions` | `created_at` | same |

### READ: Lines Table

| Field | Table | Column | Filter |
|---|---|---|---|
| Product name | `products` | `name` | `JOIN product_variants pv ON tl.variant_id = pv.id JOIN products p ON pv.product_id = p.id` — via `transactionLines.variant.product` |
| Size | `product_variants` | `size` | same include |
| Qty | `transaction_lines` | `quantity` | `WHERE transaction_id = :transactionId` |
| Unit Cost / Price | `transaction_lines` | `unit_cost` / `unit_price` | same |
| Discount | `transaction_lines` | `discount_amount` | same |
| Line Total | `transaction_lines` | `line_total` | same |
| Subtotal | `transactions` | `subtotal` | header record |
| Discount Total | `transactions` | `discount_total` | header record |
| Delivery Fee | `transactions` | `delivery_fee` | header record |
| Total Amount | `transactions` | `total_amount` | header record |

### READ: Payment Info

| Field | Table | Column | Filter |
|---|---|---|---|
| Paid/Received amount | `payment_entries` | `amount` | `WHERE transaction_id = :transactionId AND tenant_id = :tenantId` |
| Payment account ID | `payment_entries` | `payment_account_id` | same |

### READ: Allocations

| Field | Table | Column | Filter |
|---|---|---|---|
| Allocation rows | `allocations` | `payment_transaction_id, applies_to_transaction_id, amount_applied` | `WHERE (payment_transaction_id = :id OR applies_to_transaction_id = :id) AND tenant_id = :tenantId` |
| Applied to Document # | `transactions` | `document_number` | `JOIN transactions ON allocations.applies_to_transaction_id = transactions.id` |

---

## SCREEN 06 — Create Purchase (Step 1: Draft)

### READ (for populating dropdowns)

| Field | Table | Column | Filter |
|---|---|---|---|
| Supplier list | `suppliers` | `id, name, status` | `WHERE tenant_id = :tenantId AND status = 'ACTIVE'` |
| Supplier balance hint | `ledger_entries` | `amount, entry_type` | `WHERE tenant_id = :tenantId AND supplier_id = :id AND t.status='POSTED'` |
| Product list | `products` | `id, name, sku, status` | `WHERE tenant_id = :tenantId AND status = 'ACTIVE'` |
| Variant list | `product_variants` | `id, size, status` | `WHERE product_id = :productId AND status = 'ACTIVE'` (included in product response) |
| Stock hint per variant | `inventory_movements` | `quantity, movement_type` | `WHERE tenant_id = :tenantId AND variant_id = :variantId` (calculated as IN - OUT) |
| Payment accounts (step 2) | `payment_accounts` | `id, name, type, opening_balance` + computed balance | `WHERE tenant_id = :tenantId AND status = 'ACTIVE'` |

### WRITE (on draft submit)

| Table | Columns Written | Trigger |
|---|---|---|
| `transactions` | `id, tenant_id, type='PURCHASE', status='DRAFT', supplier_id, transaction_date, subtotal, discount_total, delivery_fee, total_amount, notes, idempotency_key, created_by` | POST /transactions/purchases/draft |
| `transaction_lines` | `id, tenant_id, transaction_id, variant_id, quantity, unit_cost, discount_amount, line_total, cost_total, created_by` | same — one row per line |

---

## SCREEN 07 — Create Purchase (Step 2: Post)

### WRITE (on post submit)

| Table | Columns Written | Trigger | Condition |
|---|---|---|---|
| `transactions` | `status='POSTED', document_number, series, paid_now, posted_at, idempotency_key` | POST /transactions/:id/post | Always |
| `inventory_movements` | `tenant_id, transaction_id, transaction_line_id, variant_id, movement_type='PURCHASE_IN', quantity, unit_cost_at_time=line.unit_cost, transaction_date, created_by` | same | Always — one row per line |
| `product_variants` | `avg_cost` = calculateWeightedAvgCost(preStock, oldAvg, qty, unitCost) | same | Always — one update per variant |
| `ledger_entries` | `entry_type='AP_INCREASE', supplier_id, amount=total_amount, transaction_date` | same | Always |
| `document_sequences` | `last_value = last_value + 1` WHERE `tenant_id=:tenantId AND transaction_type='PURCHASE'` | same | Always — atomic UPSERT |
| `payment_entries` | `payment_account_id, entry_type='MONEY_OUT', direction='OUT', amount=paid_now, supplier_id` | same | **Only if paidNow > 0** |
| `ledger_entries` | `entry_type='AP_DECREASE', supplier_id, amount=paid_now` | same | **Only if paidNow > 0** |
| `allocations` | `payment_transaction_id=txn.id, applies_to_transaction_id=txn.id, amount_applied=paid_now` | same | **Only if paidNow > 0** |

---

## SCREEN 08 — Create Sale (Step 1: Draft)

### READ (same pattern as Screen 06 but for customers)

| Field | Table | Column | Filter |
|---|---|---|---|
| Customer list | `customers` | `id, name, status` | `WHERE tenant_id = :tenantId AND status = 'ACTIVE'` |
| Customer balance hint | `ledger_entries` | `amount, entry_type` | AR entries for customer |
| Products/Variants | same as Screen 06 | | |
| Stock warning | `inventory_movements` | `quantity, movement_type` | same stock calculation |

### WRITE

| Table | Columns Written |
|---|---|
| `transactions` | `type='SALE', status='DRAFT', customer_id, transaction_date, delivery_type (STORE_PICKUP/HOME_DELIVERY), delivery_address, subtotal, discount_total, delivery_fee, total_amount, notes` |
| `transaction_lines` | `transaction_id, variant_id, quantity, unit_price, discount_amount, line_total, cost_total` |

---

## SCREEN 09 — Create Sale (Step 2: Post)

### WRITE

| Table | Columns Written | Condition |
|---|---|---|
| `transactions` | `status='POSTED', document_number, series, posted_at` | Always |
| `inventory_movements` | `movement_type='SALE_OUT', unit_cost_at_time=variant.avg_cost (NOT sale price), quantity` | Always — one per line |
| `ledger_entries` | `entry_type='AR_INCREASE', customer_id, amount=total_amount` | Always |
| `document_sequences` | `last_value+1` WHERE `transaction_type='SALE'` | Always |
| `payment_entries` | `entry_type='MONEY_IN', direction='IN', amount=received_now, customer_id` | **Only if receivedNow > 0** |
| `ledger_entries` | `entry_type='AR_DECREASE', customer_id, amount=received_now` | **Only if receivedNow > 0** |
| `allocations` | `payment_transaction_id=txn.id, applies_to_transaction_id=txn.id, amount_applied=received_now` | **Only if receivedNow > 0** |

---

## SCREEN 10 — Create Supplier Payment

### READ

| Field | Table | Column | Filter |
|---|---|---|---|
| Supplier list | `suppliers` | `id, name` | `WHERE tenant_id=:tenantId AND status='ACTIVE'` |
| Current balance | `ledger_entries` | `amount, entry_type` | `WHERE supplier_id=:id AND t.status='POSTED'` → AP_INCREASE − AP_DECREASE |
| Open purchase invoices | `transactions` | `id, document_number, transaction_date, total_amount` | `WHERE tenant_id=:tenantId AND supplier_id=:id AND type='PURCHASE' AND status='POSTED'` |
| Already paid (per invoice) | `allocations` | `amount_applied` | `WHERE applies_to_transaction_id = t.id AND tenant_id=:tenantId` — SUM |
| Payment accounts | `payment_accounts` | `id, name, opening_balance, _computed.current_balance` | `WHERE tenant_id=:tenantId AND status='ACTIVE'` |

### WRITE

| Table | Columns Written | Condition |
|---|---|---|
| `transactions` | `type='SUPPLIER_PAYMENT', status='DRAFT', supplier_id, from_payment_account_id, total_amount=amount, subtotal=amount` | POST draft |
| `transactions` | `status='POSTED', document_number (SPY-YYYY-NNNN), series, posted_at` | POST /post |
| `payment_entries` | `entry_type='MONEY_OUT', direction='OUT', payment_account_id, amount, supplier_id, transaction_date` | POST /post — always |
| `ledger_entries` | `entry_type='AP_DECREASE', supplier_id, amount, transaction_date` | POST /post — always |
| `allocations` | `payment_transaction_id=txn.id, applies_to_transaction_id=invoice.id, amount_applied` | POST /post — auto (FIFO oldest first) OR manual |
| `document_sequences` | `last_value+1` WHERE `transaction_type='SUPPLIER_PAYMENT'` | POST /post |

---

## SCREEN 11 — Create Customer Payment (Receipt)

Identical pattern to Screen 10 but mirrored for customers:

| Difference | Detail |
|---|---|
| Party | `customers` instead of `suppliers` |
| Ledger entries | `AR_DECREASE` instead of `AP_DECREASE` |
| Payment entry | `direction='IN'` (money coming IN) |
| Document number | `CPY-YYYY-NNNN` |
| Open invoices | `type='SALE'` instead of `PURCHASE` |

---

## SCREEN 12 — Create Supplier Return

### READ

| Field | Table | Column | Filter |
|---|---|---|---|
| Supplier list | `suppliers` | `id, name` | `WHERE tenant_id=:tenantId AND status='ACTIVE'` |
| Source purchase dropdown | `transactions` | `id, document_number, transaction_date` | `WHERE tenant_id=:tenantId AND supplier_id=:id AND type='PURCHASE' AND status='POSTED'` |
| Original lines | `transaction_lines` | `id, variant_id, quantity, unit_cost, line_total` | `WHERE transaction_id=:purchaseId` → joined with `product_variants.size` and `products.name` |
| Already returned (per line) | `transaction_lines` | `quantity` (SUM) | `WHERE source_transaction_line_id=:lineId AND t.status='POSTED' AND t.type IN ('SUPPLIER_RETURN','CUSTOMER_RETURN')` |
| Returnable qty | computed | `originalQty - alreadyReturned` | via GET /transactions/:id/returnable-lines |

### WRITE

| Table | Columns Written | Condition |
|---|---|---|
| `transactions` | `type='SUPPLIER_RETURN', status='DRAFT', supplier_id, transaction_date, subtotal, total_amount` | POST draft |
| `transaction_lines` | `source_transaction_line_id, variant_id, quantity, unit_cost (derived from source), line_total` | POST draft |
| `transactions` | `status='POSTED', document_number (SRN-YYYY-NNNN), posted_at` | POST /post |
| `inventory_movements` | `movement_type='SUPPLIER_RETURN_OUT', variant_id, quantity, unit_cost_at_time=line.unit_cost` | POST /post |
| `ledger_entries` | `entry_type='AP_DECREASE', supplier_id, amount=total_amount` | POST /post |
| `document_sequences` | `last_value+1` WHERE `transaction_type='SUPPLIER_RETURN'` | POST /post |

---

## SCREEN 13 — Create Customer Return

Mirrors Screen 12 for customers:

| Difference | Detail |
|---|---|
| Source transaction | `type='SALE'` |
| Party | `customers` |
| Movement type | `CUSTOMER_RETURN_IN` (stock comes BACK in) |
| avgCost update | `product_variants.avg_cost` recalculated via `calculateReturnAvgCost()` |
| Ledger entry | `AR_DECREASE` |
| Document number | `CRN-YYYY-NNNN` |
| Extra: REFUND_NOW | also writes `payment_entries` with `direction='OUT'` |

---

## SCREEN 14 — Create Internal Transfer

### READ

| Field | Table | Column | Filter |
|---|---|---|---|
| From Account list | `payment_accounts` | `id, name, type, _computed.current_balance` | `WHERE tenant_id=:tenantId AND status='ACTIVE'` |
| To Account list | same | | same (frontend filters out selected "from" account) |

### WRITE

| Table | Columns Written | Condition |
|---|---|---|
| `transactions` | `type='INTERNAL_TRANSFER', status='DRAFT', from_payment_account_id, to_payment_account_id, total_amount=amount` | POST draft |
| `transactions` | `status='POSTED', document_number (TRF-YYYY-NNNN), posted_at` | POST /post |
| `payment_entries` | `direction='OUT', payment_account_id=from_account, amount, transfer_group_id=UUID()` | POST /post — entry 1 |
| `payment_entries` | `direction='IN', payment_account_id=to_account, amount, transfer_group_id=same UUID` | POST /post — entry 2, same group |
| `document_sequences` | `last_value+1` WHERE `transaction_type='INTERNAL_TRANSFER'` | POST /post |

**Note:** No `ledger_entries` written (no AR/AP impact). Two `payment_entries` are linked by `transfer_group_id`.

---

## SCREEN 15 — Create Stock Adjustment

### READ

| Field | Table | Column | Filter |
|---|---|---|---|
| Products/Variants | `products`, `product_variants` | `id, name, size, status` | `WHERE tenant_id=:tenantId AND status='ACTIVE'` |
| Current stock per variant | `inventory_movements` | `quantity, movement_type` | `WHERE tenant_id=:tenantId AND variant_id=:variantId` (IN - OUT) |

### WRITE

| Table | Columns Written | Condition |
|---|---|---|
| `transactions` | `type='ADJUSTMENT', status='DRAFT', total_amount=0` | POST draft — OWNER/ADMIN only |
| `transaction_lines` | `variant_id, quantity, line_total=0, description=JSON{direction:'IN'/'OUT', reason:'...'}` | POST draft |
| `transactions` | `status='POSTED', document_number (ADJ-YYYY-NNNN), posted_at` | POST /post |
| `inventory_movements` | `movement_type='ADJUSTMENT_IN' or 'ADJUSTMENT_OUT', quantity, unit_cost_at_time=0` | POST /post — one per line |
| `document_sequences` | `last_value+1` WHERE `transaction_type='ADJUSTMENT'` | POST /post |

**Note:** No `ledger_entries` written. No `payment_entries` written.

---

## SCREEN 16 — Suppliers List

### READ

| Column | Table | Column | Filter |
|---|---|---|---|
| Name | `suppliers` | `name` | `WHERE tenant_id=:tenantId AND status='ACTIVE'` (default) |
| Phone | `suppliers` | `phone` | same |
| Current Balance | `ledger_entries` | `amount, entry_type` | `WHERE tenant_id=:tenantId AND supplier_id IN (:pageIds)` → SUM(AP_INCREASE) - SUM(AP_DECREASE) |
| Status | `suppliers` | `status` | same |
| Search | `suppliers` | `name, phone` | `AND (name ILIKE '%:search%' OR phone ILIKE '%:search%')` |

---

## SCREEN 17 — Add Supplier

### WRITE

| Table | Columns Written |
|---|---|
| `suppliers` | `id, tenant_id, name, phone, address, notes, status='ACTIVE', created_by` |
| `status_change_logs` | NOT written on create — only on status change |

---

## SCREEN 18 — Supplier Detail

### READ: Profile

| Field | Table | Column | Filter |
|---|---|---|---|
| Name, Phone, Address, Notes | `suppliers` | all fields | `WHERE id=:id AND tenant_id=:tenantId` |
| Status | `suppliers` | `status` | same |

### READ: Balance Cards

| Card | Table | Column | Filter |
|---|---|---|---|
| Total Purchased | `ledger_entries` | `amount` | `WHERE tenant_id=:tenantId AND supplier_id=:id AND entry_type='AP_INCREASE' AND t.status='POSTED' AND transaction_date <= :asOfDate` |
| Total Paid | `ledger_entries` | `amount` | same WHERE `entry_type='AP_DECREASE' AND t.type != 'SUPPLIER_RETURN'` |
| Total Returns | `ledger_entries` | `amount` | same WHERE `entry_type='AP_DECREASE' AND t.type = 'SUPPLIER_RETURN'` |
| Net Payable | computed | | `Total Purchased - Total Paid - Total Returns` |
| Balance Type | computed | | `> 0 → 'PAYABLE'`, `< 0 → 'CREDIT'`, `= 0 → 'SETTLED'` (returned as `balanceType` field) |

### READ: Transactions Tab

| Field | Table | Column | Filter |
|---|---|---|---|
| All transactions | `transactions` | all fields | `WHERE tenant_id=:tenantId AND supplier_id=:id` |

---

## SCREEN 19 — Supplier Ledger (Statement)

### READ

| Field | Table | Column | Filter |
|---|---|---|---|
| Opening Balance | `ledger_entries` | `amount, entry_type` | `WHERE tenant_id=:tenantId AND supplier_id=:id AND transaction_date < :dateFrom AND t.status='POSTED'` |
| Entry rows (date) | `ledger_entries` | `transaction_date` | `WHERE tenant_id=:tenantId AND supplier_id=:id AND transaction_date BETWEEN :dateFrom AND :dateTo AND t.status='POSTED'` |
| Entry rows (doc #) | `transactions` | `document_number` | `JOIN transactions ON le.transaction_id = t.id` |
| Entry rows (type) | `transactions` | `type` | same JOIN |
| Entry rows (description) | `transactions` | `notes` | same JOIN — nullable |
| Debit column | `ledger_entries` | `amount` WHERE `entry_type='AP_INCREASE'` | same |
| Credit column | `ledger_entries` | `amount` WHERE `entry_type='AP_DECREASE'` | same |
| Running Balance | computed | | calculated per row from opening balance |

---

## SCREEN 20 — Supplier Open Documents

### READ

| Field | Table | Column | Filter |
|---|---|---|---|
| Document # | `transactions` | `document_number` | `WHERE tenant_id=:tenantId AND supplier_id=:id AND type='PURCHASE' AND status='POSTED'` |
| Date | `transactions` | `transaction_date` | same |
| Total Amount | `transactions` | `total_amount` | same |
| Paid Amount | `allocations` | `amount_applied` (SUM) | `LEFT JOIN allocations ON applies_to_transaction_id = t.id AND tenant_id=:tenantId` |
| Outstanding | computed | | `total_amount - paid_amount` |
| Days Outstanding | **frontend calc** | | `today - transaction_date` in days |
| Total Outstanding | computed | | SUM of all outstanding |
| Unapplied Credits | `ledger_entries` | `amount` | Credits from SUPPLIER_RETURN not yet allocated |
| Net Outstanding | computed | | `Total Outstanding - Unapplied Credits` |

---

## SCREEN 21 — Customers List

Identical pattern to Screen 16 with these differences:

| Difference | Detail |
|---|---|
| Table | `customers` instead of `suppliers` |
| Balance calc | `AR_INCREASE - AR_DECREASE` from `ledger_entries` |

---

## SCREEN 22 — Add Customer

### WRITE

| Table | Columns Written |
|---|---|
| `customers` | `id, tenant_id, name, phone, address, notes, status='ACTIVE', created_by` |

---

## SCREEN 23 — Customer Detail

Same pattern as Screen 18 with these differences:

| Card | Table | Filter difference |
|---|---|---|
| Total Sales | `ledger_entries` | `entry_type='AR_INCREASE'` |
| Total Received | `ledger_entries` | `entry_type='AR_DECREASE' AND t.type != 'CUSTOMER_RETURN'` |
| Total Returns | `ledger_entries` | `entry_type='AR_DECREASE' AND t.type = 'CUSTOMER_RETURN'` |
| Net Receivable | computed | `breakdown.netReceivable` |
| Balance Type | computed | `> 0 → 'RECEIVABLE'` |

---

## SCREEN 24 — Customer Ledger (Statement)

Same as Screen 19 with:
- `customer_id` instead of `supplier_id`
- Debit = `AR_DECREASE` (payments received, returns)
- Credit = `AR_INCREASE` (sales)

---

## SCREEN 25 — Customer Open Documents

Same as Screen 20 with:
- `type='SALE'` filter instead of `PURCHASE`
- `customer_id` instead of `supplier_id`

---

## SCREEN 26 — Products List

### READ

| Column | Table | Column | Filter |
|---|---|---|---|
| Name | `products` | `name` | `WHERE tenant_id=:tenantId AND status='ACTIVE'` |
| SKU | `products` | `sku` | same |
| Category | `products` | `category` | same |
| Unit | `products` | `unit` | same |
| Total Stock | `inventory_movements` | `quantity, movement_type` (SUM per variant) | `WHERE tenant_id=:tenantId AND variant_id IN (:pageVariantIds)` → SUM(IN) - SUM(OUT) per variant, then summed across variants |
| # Sizes | `product_variants` | `COUNT(*)` | `WHERE product_id = p.id` (included in product response) |
| Status | `products` | `status` | same |
| Search | `products` | `name, sku, category` | `AND (name ILIKE '%:search%' OR sku ILIKE '%:search%' OR category ILIKE '%:search%')` |
| Category filter | `products` | `category` | `AND category = :category` |

---

## SCREEN 27 — Add Product

### WRITE

| Table | Columns Written |
|---|---|
| `products` | `id, tenant_id, name, sku, category, unit, status='ACTIVE', avg_cost=0, created_by` |
| `product_variants` | `id, tenant_id, product_id, size='one-size', sku=NULL, avg_cost=0, status='ACTIVE', created_by` — auto-created |

---

## SCREEN 28 — Product Detail

### READ: Summary Cards

| Card | Table | Column | Filter |
|---|---|---|---|
| Total Stock | `inventory_movements` | `quantity, movement_type` | `WHERE tenant_id=:tenantId AND variant_id IN (:productVariantIds)` → SUM(IN) - SUM(OUT) |
| Total Inventory Value | computed | | `SUM(currentStock × avgCost)` per variant |
| Active Sizes | `product_variants` | `status` | `WHERE product_id=:id AND status='ACTIVE'` |

### READ: Per-Variant Table

| Column | Table | Column | Filter |
|---|---|---|---|
| Size | `product_variants` | `size` | `WHERE product_id=:id AND tenant_id=:tenantId` |
| Variant SKU | `product_variants` | `sku` | same |
| Current Stock | `inventory_movements` | `quantity, movement_type` | `WHERE tenant_id=:tenantId AND variant_id=:variantId` |
| Avg Cost | `product_variants` | `avg_cost` | same (updated by posting engine on each purchase) |
| Status | `product_variants` | `status` | same |

### READ: Stock Movements Tab

| Column | Table | Column | Filter |
|---|---|---|---|
| Date | `inventory_movements` | `transaction_date` | `WHERE tenant_id=:tenantId AND pv.product_id=:id ORDER BY transaction_date ASC, created_at ASC LIMIT :limit OFFSET :skip` |
| Document # | `transactions` | `document_number` | `JOIN transactions ON im.transaction_id = t.id` |
| Type | `transactions` | `type` | same JOIN |
| Variant Size | `product_variants` | `size` | `JOIN product_variants ON im.variant_id = pv.id` |
| Qty In | `inventory_movements` | `quantity` WHERE `movement_type IN ('PURCHASE_IN','CUSTOMER_RETURN_IN','ADJUSTMENT_IN')` | same |
| Qty Out | `inventory_movements` | `quantity` WHERE `movement_type IN ('SALE_OUT','SUPPLIER_RETURN_OUT','ADJUSTMENT_OUT')` | same |
| Running Stock | computed | | Cumulative IN - OUT starting from stock before page offset |

### READ: Purchase/Sale History Tabs

| Field | Table | Column | Filter |
|---|---|---|---|
| All rows | `transactions` | all fields | `WHERE tenant_id=:tenantId AND type='PURCHASE'/'SALE' AND status='POSTED' AND EXISTS (SELECT 1 FROM transaction_lines tl JOIN product_variants pv ON pv.id=tl.variant_id WHERE pv.product_id=:productId AND tl.transaction_id=t.id)` |

### WRITE: Actions

| Action | Table | Columns |
|---|---|---|
| Add Size | `product_variants` | `id, tenant_id, product_id, size, sku, avg_cost=0, status='ACTIVE'` |
| Edit size/SKU | `product_variants` | `size` and/or `sku` WHERE `id=:variantId AND product_id=:id` |
| Change variant status | `product_variants` | `status='ACTIVE'/'INACTIVE'` WHERE `id=:variantId` |
| Change variant status | `status_change_logs` | `entity_type='PRODUCT_VARIANT', entity_id, previous_status, new_status, actor_user_id` |

---

## SCREEN 29 — Payment Accounts List

### READ

| Field | Table | Column | Filter |
|---|---|---|---|
| Name | `payment_accounts` | `name` | `WHERE tenant_id=:tenantId AND status='ACTIVE'` |
| Type | `payment_accounts` | `type` | same |
| Opening Balance | `payment_accounts` | `opening_balance` | same — stored field |
| Total In | `payment_entries` | `amount` WHERE `direction='IN'` | `WHERE tenant_id=:tenantId AND payment_account_id IN (:pageIds) AND t.status='POSTED'` |
| Total Out | `payment_entries` | `amount` WHERE `direction='OUT'` | same |
| Current Balance | computed | | `opening_balance + total_in - total_out` (stored in `_computed.current_balance`) |
| Type filter | `payment_accounts` | `type` | `AND type = :type` (CASH/BANK/WALLET/CARD) |

---

## SCREEN 30 — Add Payment Account

### WRITE

| Table | Columns Written |
|---|---|
| `payment_accounts` | `id, tenant_id, name, type, opening_balance, status='ACTIVE', created_by` |

---

## SCREEN 31 — Payment Account Statement

### READ

| Field | Table | Column | Filter |
|---|---|---|---|
| Opening Balance | `payment_entries` | `amount, direction` | `WHERE tenant_id=:tenantId AND payment_account_id=:id AND transaction_date < :dateFrom AND t.status='POSTED'` → then added to `payment_accounts.opening_balance` |
| Date | `payment_entries` | `transaction_date` | `WHERE tenant_id=:tenantId AND payment_account_id=:id AND transaction_date BETWEEN :dateFrom AND :dateTo AND t.status='POSTED'` |
| Document # | `transactions` | `document_number` | `JOIN transactions ON pe.transaction_id = t.id` |
| Type | `transactions` | `type` | same JOIN |
| Party Name | `suppliers` | `name` | `LEFT JOIN suppliers ON pe.supplier_id = s.id` |
| Party Name | `customers` | `name` | `LEFT JOIN customers ON pe.customer_id = c.id` |
| Money In | `payment_entries` | `amount` WHERE `direction='IN'` | same |
| Money Out | `payment_entries` | `amount` WHERE `direction='OUT'` | same |
| Running Balance | computed | | running total from opening balance |

---

## SCREEN 32 — P&L Report

### READ

| Field | Table | Column | Filter |
|---|---|---|---|
| Sales (revenue) | `transactions` | `total_amount` | `WHERE tenant_id=:tenantId AND type='SALE' AND status='POSTED' AND transaction_date BETWEEN :dateFrom AND :dateTo` |
| Sales Returns | `transactions` | `total_amount` | same WHERE `type='CUSTOMER_RETURN'` |
| COGS (sale portion) | `inventory_movements` | `quantity × unit_cost_at_time` | `WHERE tenant_id=:tenantId AND movement_type='SALE_OUT' AND transaction_date BETWEEN :dateFrom AND :dateTo` |
| COGS (return credit) | `inventory_movements` | `quantity × unit_cost_at_time` | same WHERE `movement_type='CUSTOMER_RETURN_IN'` |
| Net Revenue | computed | | `sales - salesReturns` |
| Gross Profit | computed | | `netRevenue - COGS` |
| Gross Margin | computed | | `grossProfit / netRevenue × 100` |

**Critical note:** COGS uses `unit_cost_at_time` from `inventory_movements` (actual avg cost at time of sale), NOT `unit_cost` from `transaction_lines`.

---

## SCREEN 33 — Aged Receivables Report

### READ

| Field | Table | Column | Filter |
|---|---|---|---|
| Customer balance | `ledger_entries` | `amount, entry_type` | `WHERE tenant_id=:tenantId AND transaction_date <= :asOfDate AND t.status='POSTED'` GROUP BY `customer_id` HAVING balance > 0 |
| Customer name | `customers` | `name` | `JOIN customers ON le.customer_id = c.id` |
| Open invoice rows | `transactions` | `id, document_number, transaction_date, total_amount` | `WHERE tenant_id=:tenantId AND customer_id IN (:ids) AND type='SALE' AND status='POSTED' AND transaction_date <= :asOfDate` |
| Paid per invoice | `allocations` | `amount_applied` (SUM) | `LEFT JOIN allocations ON applies_to_transaction_id = t.id` |
| Outstanding | computed | | `total_amount - SUM(allocations)` |
| Days Past Due | computed | | `(:asOfDate - transaction_date)` in days |
| Aging buckets | **frontend calc** | | Group `openDocuments` by `daysPastDue` into 0–30 / 31–60 / 61–90 / 90+ |

---

## SCREEN 34 — Aged Payables Report

Same as Screen 33 with:
- `supplier_id` instead of `customer_id`
- `type='PURCHASE'` filter
- `AP_INCREASE / AP_DECREASE` instead of AR

---

## SCREEN 35 — Trial Balance

### READ (3 parallel queries)

| Account Line | Table | Column | Filter |
|---|---|---|---|
| Accounts Receivable | `ledger_entries` | `amount, entry_type` | `WHERE tenant_id=:tenantId AND entry_type IN ('AR_INCREASE','AR_DECREASE') AND transaction_date <= :asOfDate AND t.status='POSTED'` → net_ar = SUM(AR_INCREASE) - SUM(AR_DECREASE) |
| Accounts Payable | `ledger_entries` | `amount, entry_type` | same WHERE `entry_type IN ('AP_INCREASE','AP_DECREASE')` → net_ap = SUM(AP_INCREASE) - SUM(AP_DECREASE) |
| Each Payment Account | `payment_accounts` | `name, opening_balance` | `WHERE tenant_id=:tenantId AND status='ACTIVE'` |
| Payment Account movements | `payment_entries` | `amount, direction` | `LEFT JOIN payment_entries WHERE transaction_date <= :asOfDate AND t.status='POSTED'` → balance = opening + IN - OUT |
| Inventory | `inventory_movements` | `quantity, unit_cost_at_time, movement_type` | `WHERE tenant_id=:tenantId AND movement_date <= :asOfDate` → SUM(IN cost) - SUM(OUT cost) |

---

## SCREEN 36 — Inventory Valuation Report

### READ

| Field | Table | Column | Filter |
|---|---|---|---|
| Product Name | `products` | `name, sku, category` | `WHERE tenant_id=:tenantId AND status='ACTIVE'` |
| Variant Size | `product_variants` | `size, sku` | `WHERE product_id=p.id AND status='ACTIVE'` |
| Qty on Hand | `inventory_movements` | `quantity, movement_type` | `WHERE tenant_id=:tenantId AND variant_id=:variantId AND transaction_date <= :asOfDate` → SUM(IN) - SUM(OUT) |
| Avg Cost | `inventory_movements` | `quantity × unit_cost_at_time` (weighted avg) | same filter → (net purchase cost) / (net purchase qty) |
| Total Value | computed | | `qtyOnHand × avgCost` per variant |
| Grand Total | computed | | SUM of all variant total values |

---

## SCREEN 37 — Imports List

### READ

| Column | Table | Column | Filter |
|---|---|---|---|
| Date | `import_batches` | `created_at` | `WHERE tenant_id=:tenantId` |
| Module | `import_batches` | `module` | Optional: `AND module=:module` |
| File Name | `import_batches` | `file_name` | same |
| Total Rows | `import_batches` | `total_rows` | same |
| Committed | `import_batches` | `success_rows` | same |
| Failed | `import_batches` | `failed_rows` | same |
| Status | `import_batches` | `status` | Optional: `AND status=:status` |

---

## SCREEN 38 — New Import (Upload)

### WRITE

| Table | Columns Written |
|---|---|
| `import_batches` | `id, tenant_id, module, file_name, status='PENDING_MAPPING', total_rows, detected_columns (JSON), created_by` |
| `import_rows` | `id, tenant_id, import_batch_id, row_number, raw_data_json (raw row as JSON), status='PENDING'` — one per CSV row |

---

## SCREEN 39 — New Import (Map Columns)

### WRITE

| Table | Columns Written |
|---|---|
| `import_batches` | `status='VALIDATED'` WHERE `id=:batchId` |
| `import_rows` | `status='VALID'/'INVALID', raw_data_json (re-mapped values), error_message` WHERE `import_batch_id=:batchId` |

---

## SCREEN 40 — New Import (Preview & Commit)

### WRITE (on commit)

| Table | Columns Written | Condition |
|---|---|---|
| `suppliers` | `id, tenant_id, name, phone, address, status='ACTIVE'` | module=SUPPLIERS |
| `customers` | `id, tenant_id, name, phone, address, status='ACTIVE'` | module=CUSTOMERS |
| `products` | `id, tenant_id, name, sku, category, unit, status='ACTIVE'` | module=PRODUCTS |
| `product_variants` | `id, tenant_id, product_id, size='one-size', avg_cost=0, status='ACTIVE'` | module=PRODUCTS — one per product |
| `payment_accounts` | `opening_balance` updated | module=OPENING_BALANCES |
| `import_rows` | `status='SUCCESS'/'FAILED', created_record_id, created_record_type, error_message` | per row |
| `import_batches` | `status='COMPLETED', success_rows, failed_rows` | at end |

---

## SCREEN 41 — Import Detail

### READ

| Field | Table | Column | Filter |
|---|---|---|---|
| Module, Status, File Name | `import_batches` | all fields | `WHERE id=:id AND tenant_id=:tenantId` |
| Committed by | `users` | `full_name` | `JOIN users ON import_batches.created_by = users.id` via `createdByUser` include |
| Committed at | `import_batches` | `updated_at` | same |
| Row # | `import_rows` | `row_number` | `WHERE import_batch_id=:batchId AND tenant_id=:tenantId ORDER BY row_number ASC LIMIT :limit OFFSET :skip` |
| Row Data | `import_rows` | `raw_data_json` | same |
| Row Status | `import_rows` | `status` | same |
| Error | `import_rows` | `error_message` | same |
| Created Record | `import_rows` | `created_record_id, created_record_type` | same |

---

## SCREEN 42 — Settings: Business Profile

### READ

| Field | Table | Column | Filter |
|---|---|---|---|
| Business Name | `tenants` | `name` | `WHERE id = user.tenant_id` (from JWT auth context) |
| Base Currency | `tenants` | `base_currency` | same |
| Timezone | `tenants` | `timezone` | same |

### WRITE

| Table | Columns Written | Filter |
|---|---|---|
| `tenants` | `name`, `timezone`, `base_currency` (whichever fields provided) | `WHERE id = :tenantId` from JWT |

---

## SCREEN 43 — Settings: Users & Roles

### READ

| Column | Table | Column | Filter |
|---|---|---|---|
| Full Name | `users` | `full_name` | `WHERE tenant_id=:tenantId` |
| Email | `users` | `email` | same |
| Role | `users` | `role` | same — Optional: `AND status=:status` |
| Status | `users` | `status` | same |
| Created At | `users` | `created_at` | same |

**Note:** `password_hash` is NEVER returned.

### WRITE

| Action | Table | Columns Written |
|---|---|---|
| Change Role | `users` | `role='OWNER'/'ADMIN'` WHERE `id=:userId AND tenant_id=:tenantId` |
| Change Role (audit) | `status_change_logs` | `entity_type='USER', entity_id, previous_status=oldRole, new_status=newRole, actor_user_id, reason` |
| Deactivate | `users` | `status='INACTIVE'` WHERE `id=:userId AND tenant_id=:tenantId` |
| Deactivate (audit) | `status_change_logs` | `entity_type='USER', entity_id, previous_status, new_status, actor_user_id, reason` |

---

## SCREEN 44 — Settings: Payment Accounts

Links to Screen 29 (list) and Screen 30 (add). No additional data — see those screens.

---

## Appendix: Key Table Relationships

```
tenants
  ├── users (tenant_id)
  ├── suppliers (tenant_id)
  ├── customers (tenant_id)
  ├── products → product_variants (product_id)
  ├── payment_accounts (tenant_id)
  └── transactions (tenant_id)
        ├── transaction_lines (transaction_id)
        │     └── product_variants (variant_id) → products
        ├── inventory_movements (transaction_id) → product_variants
        ├── ledger_entries (transaction_id) → suppliers/customers
        ├── payment_entries (transaction_id) → payment_accounts
        └── allocations (payment_transaction_id / applies_to_transaction_id)

import_batches (tenant_id)
  └── import_rows (import_batch_id)

document_sequences (tenant_id, transaction_type) — one row per type per tenant
status_change_logs (tenant_id) — audit trail for all status changes
```

## Appendix: Stock Calculation Formula

Used in `inventory_movements` table:

```sql
SELECT COALESCE(SUM(
  CASE WHEN movement_type IN ('PURCHASE_IN', 'CUSTOMER_RETURN_IN', 'ADJUSTMENT_IN')
       THEN quantity
       ELSE -quantity  -- SALE_OUT, SUPPLIER_RETURN_OUT, ADJUSTMENT_OUT
  END
), 0) AS current_stock
FROM inventory_movements
WHERE tenant_id = :tenantId AND variant_id = :variantId
-- Add: AND transaction_date <= :asOfDate   (for point-in-time reports)
```

## Appendix: Balance Calculation Formulas

**Supplier Balance (AP):**
```sql
SUM(CASE WHEN entry_type = 'AP_INCREASE' THEN amount ELSE 0 END)   -- purchases
- SUM(CASE WHEN entry_type = 'AP_DECREASE' THEN amount ELSE 0 END)  -- payments + returns
FROM ledger_entries WHERE supplier_id = :id AND t.status = 'POSTED'
```

**Customer Balance (AR):**
```sql
SUM(CASE WHEN entry_type = 'AR_INCREASE' THEN amount ELSE 0 END)   -- sales
- SUM(CASE WHEN entry_type = 'AR_DECREASE' THEN amount ELSE 0 END)  -- receipts + returns
FROM ledger_entries WHERE customer_id = :id AND t.status = 'POSTED'
```

**Payment Account Balance:**
```sql
opening_balance
+ SUM(CASE WHEN direction = 'IN'  THEN amount ELSE 0 END)   -- money received
- SUM(CASE WHEN direction = 'OUT' THEN amount ELSE 0 END)   -- money paid out
FROM payment_entries WHERE payment_account_id = :id AND t.status = 'POSTED'
```
