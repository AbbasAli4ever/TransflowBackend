# API Specification (V1)

This API contract is the single source of truth for backend and frontend integration. All endpoints are RESTful and JSON-based.

## Conventions

- Base URL: `/api/v1`
- Auth: Bearer JWT
- All write endpoints require `Idempotency-Key` header
- Money values are integers (PKR)
- Dates use `YYYY-MM-DD`
- Timestamps use ISO 8601 UTC

## Headers

- `Authorization: Bearer <token>`
- `Content-Type: application/json`
- `Idempotency-Key: <uuid>` (required for POST/PUT/PATCH that create or post data)

## Standard Response Envelope

Success:

```json
{
  "data": {},
  "meta": {}
}
```

Error:

```json
{
  "error": {
    "code": "INSUFFICIENT_STOCK",
    "message": "Not enough stock for product",
    "details": {
      "product_id": "uuid",
      "available": 2,
      "requested": 5
    }
  }
}
```

## Pagination

Use cursor or page/limit. Default page size: 50.

Example:

`GET /suppliers?page=1&limit=50`

Response meta:

```json
{
  "meta": {
    "page": 1,
    "limit": 50,
    "total": 123
  }
}
```

## Authentication

### POST /auth/login

Request:

```json
{
  "email": "owner@shop.com",
  "password": "secret"
}
```

Response:

```json
{
  "data": {
    "access_token": "jwt",
    "refresh_token": "jwt",
    "user": {
      "id": "uuid",
      "full_name": "Owner",
      "role": "OWNER"
    }
  }
}
```

### POST /auth/refresh

Request:

```json
{
  "refresh_token": "jwt"
}
```

### POST /auth/logout

Revokes refresh token.

---

## Master Data

### Suppliers

- `POST /suppliers`
- `GET /suppliers`
- `GET /suppliers/:id`
- `PATCH /suppliers/:id`
- `DELETE /suppliers/:id` (soft delete recommended)

Create request:

```json
{
  "name": "ABC Traders",
  "phone": "0300-0000000",
  "address": "Karachi",
  "notes": "Preferred supplier"
}
```

### Customers

- `POST /customers`
- `GET /customers`
- `GET /customers/:id`
- `PATCH /customers/:id`
- `DELETE /customers/:id`

### Products

- `POST /products`
- `GET /products`
- `GET /products/:id`
- `PATCH /products/:id`
- `DELETE /products/:id`

Create request:

```json
{
  "name": "Suit - Black",
  "sku": "S-BLK-001",
  "category": "Suits",
  "unit": "piece",
  "avg_cost": 0
}
```

### Payment Accounts

- `POST /payment-accounts`
- `GET /payment-accounts`
- `GET /payment-accounts/:id`
- `PATCH /payment-accounts/:id`
- `DELETE /payment-accounts/:id`

Create request:

```json
{
  "name": "Cash",
  "type": "CASH",
  "opening_balance": 0
}
```

---

## Transactions

All transaction endpoints post immediately in V1. Draft support may be added later.

### POST /purchases

Request:

```json
{
  "transaction_date": "2026-02-01",
  "supplier_id": "uuid",
  "lines": [
    { "product_id": "uuid", "qty": 10, "unit_cost": 500 }
  ],
  "paid_now": 2000,
  "payment_account_id": "uuid"
}
```

Response:

```json
{
  "data": {
    "id": "uuid",
    "status": "POSTED",
    "document_number": "PUR-000123",
    "total_amount": 5000,
    "paid_now": 2000
  }
}
```

### POST /sales

```json
{
  "transaction_date": "2026-02-01",
  "customer_id": "uuid",
  "lines": [
    { "product_id": "uuid", "qty": 2, "unit_price": 1200 }
  ],
  "paid_now": 500,
  "payment_account_id": "uuid"
}
```

### POST /transactions/supplier-returns/draft

Creates a draft for a supplier return. This transaction reduces inventory and creates a credit on the supplier's account (Accounts Payable).

**Business Rules:**
- Each line in the return **must** reference a `sourceTransactionLineId` from a previously `POSTED` `PURCHASE` transaction.
- The quantity being returned cannot exceed the original quantity purchased, minus any previous returns for that same line.

**Request:**
```json
{
  "supplierId": "uuid",
  "transactionDate": "2026-02-10",
  "lines": [
    {
      "sourceTransactionLineId": "uuid",
      "quantity": 2,
      "reason": "Defective items"
    }
  ],
  "notes": "Return damaged suits"
}
```

### POST /transactions/customer-returns/draft

Creates a draft for a customer return. This transaction increases inventory and creates a debit on the customer's account (Accounts Receivable).

**Business Rules:**
- Each line in the return **must** reference a `sourceTransactionLineId` from a previously `POSTED` `SALE` transaction.
- The quantity being returned cannot exceed the original quantity sold, minus any previous returns for that same line.
- At posting time, you must specify how the return should be handled.

**Request:**
```json
{
  "customerId": "uuid",
  "transactionDate": "2026-02-12",
  "lines": [
    {
      "sourceTransactionLineId": "uuid",
      "quantity": 1,
      "reason": "Customer changed mind"
    }
  ],
  "notes": "Process refund"
}
```

### POST /transactions/internal-transfers/draft

Creates a draft for a transfer of funds between two internal payment accounts (e.g., from Cash to Bank).

**Request:**
```json
{
  "fromPaymentAccountId": "uuid",
  "toPaymentAccountId": "uuid",
  "amount": 100000,
  "transactionDate": "2026-02-15",
  "notes": "Transfer cash to bank"
}
```

### POST /transactions/adjustments/draft

Creates a draft for a stock adjustment. This is an administrative action used to correct inventory levels due to events like damage, theft, or stock count corrections.

**Business Rules:**
- Only users with the `OWNER` or `ADMIN` role can create adjustments.
- This transaction only affects inventory; it does not create any ledger or payment entries.

**Request:**
```json
{
  "transactionDate": "2026-02-20",
  "reason": "Physical stock count correction",
  "lines": [
    {
      "productId": "uuid",
      "direction": "IN",
      "quantity": 3,
      "reason": "Found 3 missing units during audit"
    },
    {
      "productId": "uuid",
      "direction": "OUT",
      "quantity": 2,
      "reason": "2 damaged units written off"
    }
  ],
  "notes": "Monthly stock audit adjustments"
}
```

### POST /transactions/:id/post

This generic endpoint is used to post any `DRAFT` transaction, including the new types from Phase 6. The behavior depends on the transaction's type.

**For a Customer Return, the request body is special:**
```json
{
  "idempotencyKey": "uuid",
  "returnHandling": "REFUND_NOW", // or "STORE_CREDIT"
  "paymentAccountId": "uuid" // Required only if returnHandling is REFUND_NOW
}
```
- **`REFUND_NOW`**: Immediately creates a `MONEY_OUT` payment entry from the specified `paymentAccountId` to refund the customer.
- **`STORE_CREDIT`**: No payment entry is created. The customer's balance will reflect a credit that can be used later.

For all other transaction types, only the `idempotencyKey` is required.

### GET /transactions

Filters:

- `type`
- `status`
- `from_date`
- `to_date`
- `supplier_id` / `customer_id`

---

## Dashboard

### GET /dashboard/summary

Provides a high-level, tenant-wide financial snapshot.

**Query Parameters:**
- `asOfDate` (optional, string): Calculate summary as of a specific date. Defaults to today.

**Response (200):**
```json
{
  "asOfDate": "2026-02-15",
  "cash": { "totalBalance": 325000, "accounts": [...] },
  "inventory": { "totalValue": 2500000, "totalProducts": 150, "lowStockCount": 12 },
  "receivables": { "totalAmount": 250000, "overdueAmount": 120000, ... },
  "payables": { "totalAmount": 180000, "overdueAmount": 45000, ... },
  "recentActivity": { "todaySales": 85000, "todayPurchases": 120000, ... }
}
```

---

## Reports

Provides detailed, point-in-time analytical queries.

### GET /reports/suppliers/:id/balance
- **Summary**: Retrieves a supplier's balance as of a specific date, with a breakdown of purchases vs. payments.
- **Query Parameters**: `asOfDate` (optional).

### GET /reports/customers/:id/balance
- **Summary**: Retrieves a customer's balance as of a specific date.
- **Query Parameters**: `asOfDate` (optional).

### GET /reports/payment-accounts/:id/balance
- **Summary**: Retrieves a payment account's balance as of a specific date.
- **Query Parameters**: `asOfDate` (optional).

### GET /reports/products/:id/stock
- **Summary**: Retrieves a product's stock level as of a specific date, with a breakdown by movement type.
- **Query Parameters**: `asOfDate` (optional).

### GET /reports/pending-receivables
- **Summary**: Lists all customers with outstanding balances.
- **Query Parameters**: `asOfDate` (optional), `customerId` (optional), `minAmount` (optional).

### GET /reports/pending-payables
- **Summary**: Lists all suppliers with outstanding balances.
- **Query Parameters**: `asOfDate` (optional), `supplierId` (optional), `minAmount` (optional).

### GET /reports/suppliers/:id/statement
- **Summary**: Generates an account statement for a supplier over a date range with a running balance.
- **Query Parameters**: `dateFrom` (required), `dateTo` (required).

### GET /reports/customers/:id/statement
- **Summary**: Generates an account statement for a customer.
- **Query Parameters**: `dateFrom` (required), `dateTo` (required).

### GET /reports/payment-accounts/:id/statement
- **Summary**: Generates a statement for a payment account.
- **Query Parameters**: `dateFrom` (required), `dateTo` (required).

---

## Imports

Provides endpoints for bulk-uploading data via CSV or XLSX files. See the `import-guide.md` for a full walkthrough.

### POST /imports
- **Summary**: Upload a file to create a new import batch.
- **Content-Type**: `multipart/form-data`
- **Request Body Fields**: `file`, `module` (e.g., 'SUPPLIERS', 'CUSTOMERS').

### GET /imports
- **Summary**: List all import batches, with filtering.
- **Query Parameters**: `module`, `status`, `page`, `limit`.

### GET /imports/:id
- **Summary**: Get the detailed status of a specific import batch, including validation errors.
- **Query Parameters**: `page`, `limit` (for paginating through rows with errors).

### POST /imports/:id/map
- **Summary**: Map the columns from the uploaded file to the system's fields and trigger validation.
- **Request Body**: `{ "columnMappings": { "system_field": "File Header", ... } }`.

### POST /imports/:id/commit
- **Summary**: Commit a validated batch, creating records in the database.
- **Request Body**: `{ "skipInvalidRows": true }` (optional).

### POST /imports/:id/rollback
- **Summary**: Roll back a completed import, deleting any records it created (if they have no subsequent transactions).

---

## Error Codes

- `VALIDATION_ERROR`
- `UNAUTHORIZED`
- `FORBIDDEN`
- `NOT_FOUND`
- `INSUFFICIENT_STOCK`
- `IDEMPOTENCY_KEY_REUSE`
- `PERIOD_CLOSED`

---

## Idempotency Behavior

- Same idempotency key returns the original successful response.
- If the original request failed validation, the same error is returned.
- Idempotency keys are scoped per tenant and endpoint.

---

## Notes

- All POST endpoints must be safe to retry.
- Document numbering happens at posting time.
- POSTed transactions are immutable.
