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

### POST /supplier-payments

```json
{
  "transaction_date": "2026-02-01",
  "supplier_id": "uuid",
  "amount": 3000,
  "payment_account_id": "uuid",
  "allocations": [
    { "transaction_id": "uuid", "amount": 3000 }
  ]
}
```

### POST /customer-payments

```json
{
  "transaction_date": "2026-02-01",
  "customer_id": "uuid",
  "amount": 1200,
  "payment_account_id": "uuid",
  "allocations": [
    { "transaction_id": "uuid", "amount": 1200 }
  ]
}
```

### POST /supplier-returns (V1.1)

```json
{
  "transaction_date": "2026-02-01",
  "supplier_id": "uuid",
  "lines": [
    {
      "product_id": "uuid",
      "qty": 1,
      "source_transaction_line_id": "uuid"
    }
  ],
  "refund_amount": 500,
  "payment_account_id": "uuid"
}
```

### POST /customer-returns (V1.1)

```json
{
  "transaction_date": "2026-02-01",
  "customer_id": "uuid",
  "lines": [
    {
      "product_id": "uuid",
      "qty": 1,
      "source_transaction_line_id": "uuid"
    }
  ],
  "refund_amount": 1200,
  "payment_account_id": "uuid"
}
```

### POST /internal-transfers (V1.1)

```json
{
  "transaction_date": "2026-02-01",
  "from_payment_account_id": "uuid",
  "to_payment_account_id": "uuid",
  "amount": 10000
}
```

### GET /transactions

Filters:

- `type`
- `status`
- `from_date`
- `to_date`
- `supplier_id` / `customer_id`

---

## Queries and Dashboards

- `GET /dashboard/summary`
- `GET /balances/suppliers/:supplier_id`
- `GET /balances/customers/:customer_id`
- `GET /balances/payment-accounts/:account_id`
- `GET /stock/products/:product_id`
- `GET /statements/suppliers/:supplier_id`
- `GET /statements/customers/:customer_id`
- `GET /pending/payables`
- `GET /pending/receivables`

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
