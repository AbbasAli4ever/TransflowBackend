# FlowDocs/Fin — Frontend Integration Guide

**Last Updated:** 2026-02-21
**Backend Version:** NestJS 11.x
**Base Currency:** PKR (Pakistani Rupees)
**Default Timezone:** Asia/Karachi

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Base URL & API Versioning](#2-base-url--api-versioning)
3. [Authentication Flow](#3-authentication-flow)
4. [Request & Response Conventions](#4-request--response-conventions)
5. [Error Handling](#5-error-handling)
6. [Endpoints Reference](#6-endpoints-reference)
   - [6.1 Auth](#61-auth)
   - [6.2 Customers](#62-customers)
   - [6.3 Suppliers](#63-suppliers)
   - [6.4 Products](#64-products)
   - [6.5 Payment Accounts](#65-payment-accounts)
   - [6.6 Transactions](#66-transactions)
   - [6.7 Reports](#67-reports)
   - [6.8 Dashboard](#68-dashboard)
   - [6.9 Imports (Bulk Upload)](#69-imports-bulk-upload)
   - [6.10 Health Check](#610-health-check)
7. [Data Types & Enums](#7-data-types--enums)
8. [Pagination Pattern](#8-pagination-pattern)
9. [Role-Based Access Control](#9-role-based-access-control)
10. [Monetary Values](#10-monetary-values)
11. [Idempotency](#11-idempotency)
12. [Suggested Frontend HTTP Client Setup](#12-suggested-frontend-http-client-setup)
13. [Business Logic Rules to Know](#13-business-logic-rules-to-know)

---

## 1. Project Overview

This is a **multi-tenant financial management system** for small businesses. Key capabilities:

- Manage **customers** and **suppliers** with ledger tracking
- Manage **products** with inventory movements
- Manage **payment accounts** (cash, bank, wallet, card)
- Create and post **transactions** (purchases, sales, payments, returns, transfers, adjustments)
- Generate **financial reports** (balances, statements, receivables, payables)
- View **dashboard summaries**
- **Bulk import** records via CSV/XLSX

Every user belongs to exactly one **tenant**. All data is fully isolated between tenants.

---

## 2. Base URL & API Versioning

```
Development:  http://localhost:3000/api/v1
Staging:      https://staging.example.com/api/v1
Production:   https://api.example.com/api/v1
```

All endpoints are prefixed with `/api/v1`.

**Public endpoints** (no authentication required):
- `POST /api/v1/auth/register`
- `POST /api/v1/auth/login`
- `POST /api/v1/auth/refresh`
- `POST /api/v1/auth/logout`
- `GET  /api/v1/health`

**All other endpoints** require a valid `Authorization: Bearer <accessToken>` header.

---

## 3. Authentication Flow

### 3.1 Registration (New Tenant)

A new tenant + owner account is created in a single call. There is **no separate tenant creation step**.

```
POST /api/v1/auth/register
```

```json
// Request Body
{
  "tenantName": "My Business",
  "fullName": "John Doe",
  "email": "john@mybusiness.com",
  "password": "SecurePass1"
}
```

```json
// Response 201
{
  "accessToken": "<jwt>",
  "refreshToken": "<jwt>",
  "user": {
    "id": "uuid",
    "tenantId": "uuid",
    "fullName": "John Doe",
    "email": "john@mybusiness.com",
    "role": "OWNER"
  }
}
```

### 3.2 Login

```
POST /api/v1/auth/login
```

```json
// Request Body
{
  "email": "john@mybusiness.com",
  "password": "SecurePass1"
}
```

```json
// Response 200
{
  "accessToken": "<jwt>",
  "refreshToken": "<jwt>",
  "user": {
    "id": "uuid",
    "tenantId": "uuid",
    "fullName": "John Doe",
    "email": "john@mybusiness.com",
    "role": "OWNER",
    "tenant": {
      "id": "uuid",
      "name": "My Business",
      "baseCurrency": "PKR",
      "timezone": "Asia/Karachi"
    }
  }
}
```

### 3.3 Token Refresh

Access tokens expire in **24 hours**. Refresh tokens expire in **7 days**.

```
POST /api/v1/auth/refresh
```

```json
// Request Body
{
  "refreshToken": "<refresh_jwt>"
}
```

```json
// Response 200
{
  "accessToken": "<new_access_jwt>"
}
```

> **Important:** The `refreshToken` itself is NOT rotated on refresh — only the access token is renewed.

### 3.4 Logout

Revokes the given refresh token server-side.

```
POST /api/v1/auth/logout
```

```json
// Request Body
{
  "refreshToken": "<refresh_jwt>"
}
```

```json
// Response 200
{
  "message": "Logged out"
}
```

### 3.5 Attaching the Token

All authenticated requests must include:

```
Authorization: Bearer <accessToken>
```

The JWT payload contains:
```json
{
  "userId": "uuid",
  "tenantId": "uuid",
  "email": "john@example.com",
  "role": "OWNER"
}
```

You can decode this client-side (without verifying signature) to read `role` and `tenantId`.

---

## 4. Request & Response Conventions

### Headers

| Header | Required | Description |
|--------|----------|-------------|
| `Authorization` | Yes (all protected routes) | `Bearer <accessToken>` |
| `Content-Type` | Yes (POST/PATCH) | `application/json` (or `multipart/form-data` for imports) |
| `x-request-id` | Optional | Client-supplied UUID; server echoes it back for tracing |

### Response Header

| Header | Description |
|--------|-------------|
| `x-request-id` | UUID for the request — use this when reporting bugs |

### Date Formats

| Context | Format | Example |
|---------|--------|---------|
| Sending a date as input | ISO date (YYYY-MM-DD) | `"2026-02-18"` |
| Receiving timestamps | ISO 8601 datetime | `"2026-02-18T10:30:00.000Z"` |
| `transactionDate` in responses | ISO 8601 datetime | `"2026-02-18T00:00:00.000Z"` |

---

## 5. Error Handling

**All errors** return a uniform structure:

```json
{
  "statusCode": 400,
  "message": "Validation failed",
  "errors": [
    { "field": "email", "message": "must be an email" },
    { "field": "password", "message": "too short" }
  ],
  "timestamp": "2026-02-18T10:00:00.000Z",
  "path": "/api/v1/customers",
  "requestId": "550e8400-e29b-41d4-a716-446655440000"
}
```

- `errors` array is present only for validation errors (400)
- `requestId` maps to the `x-request-id` response header

### HTTP Status Code Reference

| Status | When |
|--------|------|
| `200` | Success (GET, PATCH, POST non-create) |
| `201` | Resource created (POST) |
| `400` | Validation error or bad request |
| `401` | Missing/expired/invalid JWT |
| `403` | Valid JWT but insufficient role (e.g., USER accessing OWNER endpoint) |
| `404` | Resource not found |
| `409` | Conflict — duplicate unique field (name, email, SKU) |
| `422` | Business rule violation (inactive entity, over-return, same account transfer) |
| `500` | Internal server error |
| `503` | Database unavailable |

### Frontend Error Handling Strategy

```
401 → Clear tokens, redirect to login
403 → Show "Access Denied" UI, do not redirect
404 → Show "Not Found" page or inline message
409 → Show "already exists" message on the relevant field
422 → Show the `message` field as a toast/alert (it describes the business rule)
400 → Map `errors` array to form field errors
5xx → Show generic error toast, log requestId
```

---

## 6. Endpoints Reference

---

### 6.1 Auth

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/auth/register` | Public | Register new tenant + owner |
| `POST` | `/auth/login` | Public | Login, get tokens |
| `POST` | `/auth/refresh` | Public | Refresh access token |
| `POST` | `/auth/logout` | Public | Revoke refresh token |

> See [Section 3](#3-authentication-flow) for full request/response details.

---

### 6.2 Customers

| Method | Path | Role Required | Description |
|--------|------|--------------|-------------|
| `POST` | `/customers` | OWNER/ADMIN | Create customer |
| `GET` | `/customers` | Any | List customers |
| `GET` | `/customers/:id` | Any | Get customer |
| `PATCH` | `/customers/:id` | OWNER/ADMIN | Update customer |
| `PATCH` | `/customers/:id/status` | OWNER/ADMIN | Activate/deactivate |
| `GET` | `/customers/:id/balance` | Any | Get balance summary |
| `GET` | `/customers/:id/open-documents` | Any | Get unpaid invoices |

#### Create Customer

```
POST /api/v1/customers
```

```json
// Request Body
{
  "name": "Ahmed Traders",
  "phone": "03001234567",
  "address": "Karachi, Pakistan",
  "notes": "Preferred payment: cash"
}
```

Field constraints:
- `name`: required, 2–200 chars, **unique within tenant**
- `phone`: optional, max 20 chars
- `address`: optional, max 500 chars
- `notes`: optional, max 1000 chars

```json
// Response 201
{
  "id": "uuid",
  "tenantId": "uuid",
  "name": "Ahmed Traders",
  "phone": "03001234567",
  "address": "Karachi, Pakistan",
  "notes": "Preferred payment: cash",
  "status": "ACTIVE",
  "createdAt": "2026-02-18T10:00:00.000Z",
  "updatedAt": "2026-02-18T10:00:00.000Z",
  "createdBy": "uuid"
}
```

> The `create` response returns the raw record. Computed fields like `currentBalance` are only included in the **list** response (see below).

#### List Customers

```
GET /api/v1/customers?page=1&limit=20&search=ahmed&status=ACTIVE&sortBy=name&sortOrder=asc
```

Query Parameters:

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `page` | number | `1` | Page number (min 1) |
| `limit` | number | `20` | Results per page (min 1, max 100) |
| `search` | string | — | Searches `name` and `phone` (case-insensitive) |
| `status` | `ACTIVE` \| `INACTIVE` \| `ALL` | `ACTIVE` | Filter by status |
| `sortBy` | `name` \| `createdAt` | `name` | Sort field |
| `sortOrder` | `asc` \| `desc` | `asc` | Sort direction |

```json
// Response 200
{
  "data": [
    {
      "id": "uuid",
      "tenantId": "uuid",
      "name": "Ahmed Traders",
      "phone": "03001234567",
      "address": "Karachi, Pakistan",
      "notes": "Preferred payment: cash",
      "status": "ACTIVE",
      "createdAt": "2026-02-18T10:00:00.000Z",
      "updatedAt": "2026-02-18T10:00:00.000Z",
      "createdBy": "uuid",
      "currentBalance": 45000
    }
  ],
  "meta": {
    "page": 1,
    "limit": 20,
    "total": 45,
    "totalPages": 3
  }
}
```

> Each customer in the list response includes a computed `currentBalance` field (AR_INCREASE − AR_DECREASE from ledger). Positive means customer owes you money.

#### Get Customer Balance

```
GET /api/v1/customers/:id/balance
```

```json
// Response 200
{
  "customerId": "uuid",
  "totalSales": 150000,
  "totalPayments": 100000,
  "totalReturns": 5000,
  "currentBalance": 45000
}
```

> All amounts are integers in PKR. See [Section 10](#10-monetary-values).

#### Get Open Documents

Returns all unpaid/partially-paid sales invoices for a customer.

```
GET /api/v1/customers/:id/open-documents
```

```json
// Response 200
{
  "customerId": "uuid",
  "customerName": "Ahmed Traders",
  "totalOutstanding": 45000,
  "unappliedCredits": 0,
  "netOutstanding": 45000,
  "documents": [
    {
      "id": "uuid",
      "documentNumber": "SALE-0001",
      "transactionDate": "2026-02-10T00:00:00.000Z",
      "totalAmount": 20000,
      "paidAmount": 10000,
      "outstanding": 10000
    }
  ]
}
```

#### Update Customer Status

```
PATCH /api/v1/customers/:id/status
```

```json
// Request Body
{
  "status": "INACTIVE",
  "reason": "Duplicate record"
}
```

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `status` | `ACTIVE` \| `INACTIVE` | Yes | New status |
| `reason` | string | No | Optional reason for the status change (logged for audit) |

> **Deactivation rule:** You **cannot** deactivate a customer who has an outstanding receivable balance (AR balance > 0). The API returns `400 Bad Request` with message `"Cannot deactivate customer with outstanding receivable balance"`. Settle all outstanding invoices first.

> Deactivating a customer prevents new transactions from being created against them. Existing transactions are unaffected. All status changes are logged server-side for audit purposes.

---

### 6.3 Suppliers

Suppliers follow the same endpoint structure as Customers but with supplier-specific semantics (AP instead of AR).

| Method | Path | Role Required | Description |
|--------|------|--------------|-------------|
| `POST` | `/suppliers` | OWNER/ADMIN | Create supplier |
| `GET` | `/suppliers` | Any | List suppliers |
| `GET` | `/suppliers/:id` | Any | Get supplier |
| `PATCH` | `/suppliers/:id` | OWNER/ADMIN | Update supplier |
| `PATCH` | `/suppliers/:id/status` | OWNER/ADMIN | Activate/deactivate |
| `GET` | `/suppliers/:id/balance` | Any | Get balance summary |
| `GET` | `/suppliers/:id/open-documents` | Any | Get unpaid purchase bills |

#### Create Supplier

```
POST /api/v1/suppliers
```

```json
// Request Body
{
  "name": "Acme Supplies",
  "phone": "03001234567",
  "address": "Site Area, Karachi",
  "notes": "Preferred supplier"
}
```

Field constraints:
- `name`: required, 2–200 chars, **unique within tenant**, auto-trimmed
- `phone`: optional, max 20 chars
- `address`: optional, max 500 chars
- `notes`: optional, max 1000 chars

```json
// Response 201
{
  "id": "uuid",
  "tenantId": "uuid",
  "name": "Acme Supplies",
  "phone": "03001234567",
  "address": "Site Area, Karachi",
  "notes": "Preferred supplier",
  "status": "ACTIVE",
  "createdAt": "2026-02-18T10:00:00.000Z",
  "updatedAt": "2026-02-18T10:00:00.000Z",
  "createdBy": "uuid"
}
```

#### List Suppliers

```
GET /api/v1/suppliers?page=1&limit=20&search=acme&status=ACTIVE&sortBy=name&sortOrder=asc
```

Query Parameters:

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `page` | number | `1` | Page number (min 1) |
| `limit` | number | `20` | Results per page (min 1, max 100) |
| `search` | string | — | Searches `name` and `phone` (case-insensitive) |
| `status` | `ACTIVE` \| `INACTIVE` \| `ALL` | `ACTIVE` | Filter by status |
| `sortBy` | `name` \| `createdAt` | `name` | Sort field |
| `sortOrder` | `asc` \| `desc` | `asc` | Sort direction |

```json
// Response 200
{
  "data": [
    {
      "id": "uuid",
      "tenantId": "uuid",
      "name": "Acme Supplies",
      "phone": "03001234567",
      "address": "Site Area, Karachi",
      "notes": "Preferred supplier",
      "status": "ACTIVE",
      "createdAt": "2026-02-18T10:00:00.000Z",
      "updatedAt": "2026-02-18T10:00:00.000Z",
      "createdBy": "uuid",
      "currentBalance": 40000
    }
  ],
  "meta": {
    "page": 1,
    "limit": 20,
    "total": 12,
    "totalPages": 1
  }
}
```

> Each supplier in the list response includes a computed `currentBalance` field (AP_INCREASE − AP_DECREASE from ledger). Positive means you owe the supplier money.

#### Get Supplier Balance

```
GET /api/v1/suppliers/:id/balance
```

```json
// Response 200
{
  "supplierId": "uuid",
  "totalPurchases": 200000,
  "totalPayments": 150000,
  "totalReturns": 10000,
  "currentBalance": 40000
}
```

> All amounts are integers in PKR. See [Section 10](#10-monetary-values).
>
> - `totalPurchases`: Sum of all AP_INCREASE ledger entries
> - `totalPayments`: Sum of AP_DECREASE entries (excluding supplier returns)
> - `totalReturns`: Sum of AP_DECREASE entries from SUPPLIER_RETURN transactions
> - `currentBalance` = totalPurchases − totalPayments − totalReturns
>
> Positive `currentBalance` means you owe the supplier money.

#### Get Open Documents

Returns all unpaid/partially-paid purchase bills for a supplier.

```
GET /api/v1/suppliers/:id/open-documents
```

```json
// Response 200
{
  "supplierId": "uuid",
  "supplierName": "Acme Supplies",
  "totalOutstanding": 100000,
  "unappliedCredits": 10000,
  "netOutstanding": 90000,
  "documents": [
    {
      "id": "uuid",
      "documentNumber": "PURCH-0001",
      "transactionDate": "2026-02-10T00:00:00.000Z",
      "totalAmount": 50000,
      "paidAmount": 20000,
      "outstanding": 30000
    }
  ]
}
```

> - `totalOutstanding`: Sum of all open purchase document amounts
> - `unappliedCredits`: Supplier return credits not yet allocated to any purchase
> - `netOutstanding`: max(0, totalOutstanding − unappliedCredits)

#### Update Supplier Status

```
PATCH /api/v1/suppliers/:id/status
```

```json
// Request Body
{
  "status": "INACTIVE",
  "reason": "No longer supplying"
}
```

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `status` | `ACTIVE` \| `INACTIVE` | Yes | New status |
| `reason` | string | No | Optional reason for the status change (logged for audit) |

> **Deactivation rule:** You **cannot** deactivate a supplier who has an outstanding payable balance (AP balance > 0). The API returns `400 Bad Request` with message `"Cannot deactivate supplier with outstanding payable balance"`. Settle all outstanding bills first.

> Deactivating a supplier prevents new transactions from being created against them. Existing transactions are unaffected. All status changes are logged server-side for audit purposes.

---

### 6.4 Products

| Method | Path | Role Required | Description |
|--------|------|--------------|-------------|
| `POST` | `/products` | OWNER/ADMIN | Create product |
| `GET` | `/products` | Any | List products |
| `GET` | `/products/:id` | Any | Get product |
| `PATCH` | `/products/:id` | OWNER/ADMIN | Update product |
| `PATCH` | `/products/:id/status` | OWNER/ADMIN | Activate/deactivate |
| `GET` | `/products/:id/stock` | Any | Get stock summary |

#### Create Product

```
POST /api/v1/products
```

```json
// Request Body
{
  "name": "Cotton Fabric",
  "sku": "CTN-001",
  "category": "Fabrics",
  "unit": "meter"
}
```

Field constraints:
- `name`: required, 2–200 chars
- `sku`: optional, max 50 chars, **uppercase alphanumeric + hyphens/underscores**, **unique within tenant**
- `category`: optional, max 100 chars
- `unit`: optional, max 20 chars, default `"piece"`

```json
// Response 201
{
  "id": "uuid",
  "tenantId": "uuid",
  "name": "Cotton Fabric",
  "sku": "CTN-001",
  "category": "Fabrics",
  "unit": "meter",
  "status": "ACTIVE",
  "avgCost": 0,
  "createdAt": "2026-02-18T10:00:00.000Z",
  "updatedAt": "2026-02-18T10:00:00.000Z"
}
```

> `avgCost` is automatically updated by the system using **weighted average** whenever purchase transactions are posted. Don't set it manually.

#### List Products

```
GET /api/v1/products?search=cotton&status=ACTIVE&category=Fabrics&page=1&limit=20
```

Additional query param vs customers:
- `category`: filter by category string (exact match)

#### Get Product Stock

```
GET /api/v1/products/:id/stock
```

```json
// Response 200
{
  "productId": "uuid",
  "totalQuantity": 500,
  "avgCost": 1200,
  "totalValue": 600000,
  "movements": [
    {
      "type": "PURCHASE_IN",
      "quantity": 100,
      "date": "2026-01-15T00:00:00.000Z"
    },
    {
      "type": "SALE_OUT",
      "quantity": 50,
      "date": "2026-02-01T00:00:00.000Z"
    }
  ]
}
```

Movement types: `PURCHASE_IN`, `SALE_OUT`, `SUPPLIER_RETURN_OUT`, `CUSTOMER_RETURN_IN`, `ADJUSTMENT_IN`, `ADJUSTMENT_OUT`

---

### 6.5 Payment Accounts

Payment accounts represent physical accounts where money lives: cash drawer, bank accounts, digital wallets, credit cards.

| Method | Path | Role Required | Description |
|--------|------|--------------|-------------|
| `POST` | `/payment-accounts` | OWNER/ADMIN | Create account |
| `GET` | `/payment-accounts` | Any | List accounts |
| `GET` | `/payment-accounts/:id` | Any | Get account |
| `PATCH` | `/payment-accounts/:id` | OWNER/ADMIN | Update account |
| `PATCH` | `/payment-accounts/:id/status` | OWNER/ADMIN | Activate/deactivate |
| `GET` | `/payment-accounts/:id/balance` | Any | Get balance |

#### Create Payment Account

```
POST /api/v1/payment-accounts
```

```json
// Request Body
{
  "name": "HBL Business Account",
  "type": "BANK",
  "openingBalance": 500000
}
```

Field constraints:
- `name`: required, 2–100 chars, **unique within tenant**
- `type`: required, one of `CASH` | `BANK` | `WALLET` | `CARD`
- `openingBalance`: optional, integer PKR, default `0`

#### List Payment Accounts

```
GET /api/v1/payment-accounts?type=BANK&status=ACTIVE&page=1&limit=20
```

Additional query param:
- `type`: filter by `CASH` | `BANK` | `WALLET` | `CARD`

#### Get Payment Account Balance

```
GET /api/v1/payment-accounts/:id/balance
```

```json
// Response 200
{
  "paymentAccountId": "uuid",
  "openingBalance": 500000,
  "totalIn": 800000,
  "totalOut": 300000,
  "currentBalance": 1000000
}
```

---

### 6.6 Transactions

Transactions follow a **2-step workflow**:

```
1. Create DRAFT  →  POST /transactions/{type}/draft
2. Post it       →  POST /transactions/:id/post
```

A DRAFT transaction reserves nothing — it's just staged data. Posting it commits ledger/inventory/payment effects.

> **Never** create a transaction and skip posting if you want it to actually affect balances.

#### Transaction Types

| Type | Description |
|------|-------------|
| `PURCHASE` | Buy goods from a supplier |
| `SALE` | Sell goods to a customer |
| `SUPPLIER_PAYMENT` | Pay money to a supplier |
| `CUSTOMER_PAYMENT` | Receive money from a customer |
| `SUPPLIER_RETURN` | Return goods to supplier |
| `CUSTOMER_RETURN` | Accept returned goods from customer |
| `INTERNAL_TRANSFER` | Move money between payment accounts |
| `ADJUSTMENT` | Inventory adjustment (in or out) |

#### Transaction Statuses

| Status | Meaning |
|--------|---------|
| `DRAFT` | Created but not posted. No financial effect. |
| `POSTED` | Posted. Affects all balances and inventory. |
| `VOIDED` | Cancelled. Effects reversed. |

---

#### 6.6.1 Create Purchase Draft

```
POST /api/v1/transactions/purchases/draft
```

```json
// Request Body
{
  "supplierId": "uuid",
  "transactionDate": "2026-02-18",
  "lines": [
    {
      "productId": "uuid",
      "quantity": 100,
      "unitCost": 1500,
      "discountAmount": 0
    },
    {
      "productId": "uuid2",
      "quantity": 50,
      "unitCost": 800
    }
  ],
  "deliveryFee": 2000,
  "notes": "Urgent order",
  "idempotencyKey": "client-generated-uuid"
}
```

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `supplierId` | UUID | Yes | Must be ACTIVE supplier |
| `transactionDate` | ISO date | Yes | `YYYY-MM-DD` |
| `lines` | array | Yes | Min 1 item |
| `lines[].productId` | UUID | Yes | Must be ACTIVE product |
| `lines[].quantity` | integer | Yes | > 0 |
| `lines[].unitCost` | integer PKR | No | Per unit purchase price |
| `lines[].discountAmount` | integer PKR | No | Line-level discount, default 0 |
| `deliveryFee` | integer PKR | No | Default 0 |
| `notes` | string | No | Max 1000 chars |
| `idempotencyKey` | string | No | Max 64 chars; prevents duplicate drafts |

---

#### 6.6.2 Create Sale Draft

```
POST /api/v1/transactions/sales/draft
```

```json
// Request Body
{
  "customerId": "uuid",
  "transactionDate": "2026-02-18",
  "lines": [
    {
      "productId": "uuid",
      "quantity": 20,
      "unitPrice": 2000,
      "discountAmount": 500
    }
  ],
  "deliveryFee": 0,
  "deliveryType": "HOME_DELIVERY",
  "deliveryAddress": "Block 5, Karachi",
  "notes": "Rush order",
  "idempotencyKey": "client-uuid"
}
```

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `customerId` | UUID | Yes | Must be ACTIVE |
| `transactionDate` | ISO date | Yes | |
| `lines[].unitPrice` | integer PKR | No | Sale price per unit |
| `deliveryType` | string | No | `STORE_PICKUP` or `HOME_DELIVERY` |
| `deliveryAddress` | string | No | Max 500 chars |

---

#### 6.6.3 Create Supplier Payment Draft

```
POST /api/v1/transactions/supplier-payments/draft
```

```json
// Request Body
{
  "supplierId": "uuid",
  "paymentAccountId": "uuid",
  "transactionDate": "2026-02-18",
  "amount": 50000,
  "notes": "Partial payment"
}
```

---

#### 6.6.4 Create Customer Payment Draft

```
POST /api/v1/transactions/customer-payments/draft
```

```json
// Request Body
{
  "customerId": "uuid",
  "paymentAccountId": "uuid",
  "transactionDate": "2026-02-18",
  "amount": 30000,
  "notes": "Receipt of payment"
}
```

---

#### 6.6.5 Create Supplier Return Draft

Return goods previously purchased from a supplier. References the original purchase transaction lines.

```
POST /api/v1/transactions/supplier-returns/draft
```

```json
// Request Body
{
  "supplierId": "uuid",
  "transactionDate": "2026-02-18",
  "lines": [
    {
      "sourceTransactionLineId": "uuid-of-original-purchase-line",
      "quantity": 10,
      "reason": "Damaged goods"
    }
  ],
  "notes": "Return of defective items",
  "idempotencyKey": "client-uuid"
}
```

> `sourceTransactionLineId` must reference a line from a **POSTED** purchase transaction. You cannot return more than the original quantity.

---

#### 6.6.6 Create Customer Return Draft

Accept returned goods from a customer. References the original sale transaction lines.

```
POST /api/v1/transactions/customer-returns/draft
```

```json
// Request Body
{
  "customerId": "uuid",
  "transactionDate": "2026-02-18",
  "lines": [
    {
      "sourceTransactionLineId": "uuid-of-original-sale-line",
      "quantity": 5,
      "reason": "Wrong size"
    }
  ],
  "notes": "Customer return"
}
```

---

#### 6.6.7 Create Internal Transfer Draft

Move money between two payment accounts.

```
POST /api/v1/transactions/internal-transfers/draft
```

```json
// Request Body
{
  "fromPaymentAccountId": "uuid-cash-account",
  "toPaymentAccountId": "uuid-bank-account",
  "transactionDate": "2026-02-18",
  "amount": 100000,
  "notes": "Deposit cash to bank"
}
```

> `fromPaymentAccountId` and `toPaymentAccountId` must be different.

---

#### 6.6.8 Create Adjustment Draft (OWNER/ADMIN only)

Adjust inventory quantities without a purchase/sale.

```
POST /api/v1/transactions/adjustments/draft
```

```json
// Request Body
{
  "transactionDate": "2026-02-18",
  "lines": [
    {
      "productId": "uuid",
      "quantity": 50,
      "movementType": "ADJUSTMENT_IN",
      "reason": "Stock count correction"
    }
  ],
  "notes": "Annual stock take"
}
```

`movementType`: `ADJUSTMENT_IN` (stock increase) or `ADJUSTMENT_OUT` (stock decrease)

---

#### 6.6.9 Post a Transaction

This is the most important step — it commits financial effects.

```
POST /api/v1/transactions/:id/post
```

```json
// Minimal Request Body (all transaction types)
{
  "idempotencyKey": "unique-key-per-posting-attempt"
}
```

```json
// Full Request Body (for payment transactions or when paying at time of sale)
{
  "idempotencyKey": "unique-posting-key",
  "paidNow": 20000,
  "receivedNow": 30000,
  "paymentAccountId": "uuid",
  "allocations": [
    {
      "appliesToTransactionId": "uuid-of-invoice",
      "amount": 15000
    }
  ],
  "returnHandling": "STORE_CREDIT"
}
```

| Field | Type | Required | When to use |
|-------|------|----------|-------------|
| `idempotencyKey` | string | **Always** | Prevents double-posting. Use a fresh UUID per attempt. |
| `paidNow` | integer PKR | No | When posting a SUPPLIER_PAYMENT: amount being paid now |
| `receivedNow` | integer PKR | No | When posting a CUSTOMER_PAYMENT: amount received now |
| `paymentAccountId` | UUID | No | Which account the money goes from/to |
| `allocations` | array | No | Manually link payment to specific invoices |
| `returnHandling` | string | No | For CUSTOMER_RETURN: `REFUND_NOW` or `STORE_CREDIT` |

**What posting does:**
- Marks transaction status → `POSTED`
- Sets `postedAt` timestamp
- Creates inventory movements (for purchases, sales, returns, adjustments)
- Creates ledger entries (for supplier/customer balance changes)
- Creates payment entries (for payment account balance changes)
- Updates product `avgCost` (weighted average, for purchases)
- Auto-allocates payments to oldest open invoices (FIFO)

---

#### 6.6.10 List Transactions

```
GET /api/v1/transactions?type=SALE&status=POSTED&dateFrom=2026-01-01&dateTo=2026-02-18&customerId=uuid&page=1&limit=20&sortBy=transactionDate&sortOrder=desc
```

| Param | Type | Description |
|-------|------|-------------|
| `type` | enum | Filter by transaction type |
| `status` | enum | `DRAFT`, `POSTED`, or `VOIDED` |
| `dateFrom` | ISO date | Start of date range |
| `dateTo` | ISO date | End of date range |
| `supplierId` | UUID | Filter by supplier |
| `customerId` | UUID | Filter by customer |
| `sortBy` | string | `transactionDate`, `createdAt`, `totalAmount` |
| `sortOrder` | string | `asc`, `desc` |

#### Transaction Response Shape

```json
{
  "id": "uuid",
  "tenantId": "uuid",
  "type": "SALE",
  "status": "POSTED",
  "documentNumber": "SALE-0001",
  "transactionDate": "2026-02-18T00:00:00.000Z",
  "customerId": "uuid",
  "supplierId": null,
  "subtotal": 39500,
  "discountTotal": 500,
  "deliveryFee": 1000,
  "totalAmount": 40000,
  "paidNow": 20000,
  "deliveryType": "HOME_DELIVERY",
  "deliveryAddress": "Block 5, Karachi",
  "notes": "Rush order",
  "postedAt": "2026-02-18T11:00:00.000Z",
  "createdAt": "2026-02-18T10:00:00.000Z",
  "updatedAt": "2026-02-18T11:00:00.000Z",
  "transactionLines": [
    {
      "id": "uuid",
      "transactionId": "uuid",
      "productId": "uuid",
      "quantity": 20,
      "unitPrice": 2000,
      "unitCost": null,
      "discountAmount": 500,
      "lineTotal": 39500,
      "costTotal": 24000
    }
  ]
}
```

#### 6.6.11 Get Allocations

See how payments have been applied to invoices.

```
GET /api/v1/transactions/allocations?customerId=uuid&page=1&limit=20
```

| Param | Type | Description |
|-------|------|-------------|
| `supplierId` | UUID | Filter by supplier |
| `customerId` | UUID | Filter by customer |
| `purchaseId` | UUID | Filter by purchase transaction |
| `saleId` | UUID | Filter by sale transaction |
| `dateFrom` | ISO date | |
| `dateTo` | ISO date | |

```json
// Response
{
  "data": [
    {
      "id": "uuid",
      "tenantId": "uuid",
      "paymentTransactionId": "uuid",
      "appliesToTransactionId": "uuid",
      "amountApplied": 15000,
      "paymentTransaction": {
        "documentNumber": "CPAY-0001",
        "totalAmount": 30000
      },
      "appliesToTransaction": {
        "documentNumber": "SALE-0001",
        "totalAmount": 40000
      }
    }
  ],
  "meta": { "page": 1, "limit": 20, "total": 3, "totalPages": 1 }
}
```

---

### 6.7 Reports

All report endpoints require **OWNER or ADMIN** role.

#### Supplier Balance Report

```
GET /api/v1/reports/suppliers/:id/balance?asOfDate=2026-02-18
```

```json
// Response 200
{
  "supplierId": "uuid",
  "supplierName": "Fabric House",
  "asOfDate": "2026-02-18",
  "totalPurchases": 500000,
  "totalPayments": 400000,
  "totalReturns": 20000,
  "balanceByType": {
    "posted": 80000,
    "draft": 10000
  },
  "lastTransactionDate": "2026-02-15T00:00:00.000Z"
}
```

#### Customer Balance Report

```
GET /api/v1/reports/customers/:id/balance?asOfDate=2026-02-18
```

Same structure, customer-oriented.

#### Payment Account Balance Report

```
GET /api/v1/reports/payment-accounts/:id/balance?asOfDate=2026-02-18
```

#### Product Stock Report

```
GET /api/v1/reports/products/:id/stock?asOfDate=2026-02-18
```

```json
// Response 200
{
  "productId": "uuid",
  "productName": "Cotton Fabric",
  "asOfDate": "2026-02-18",
  "quantity": 450,
  "avgCost": 1200,
  "totalValue": 540000,
  "movements": [
    {
      "type": "PURCHASE_IN",
      "quantity": 100,
      "unitCost": 1500,
      "date": "2026-01-15T00:00:00.000Z"
    }
  ]
}
```

#### Pending Receivables (What customers owe you)

```
GET /api/v1/reports/pending-receivables?asOfDate=2026-02-18&customerId=uuid&minAmount=1000
```

```json
// Response 200
{
  "asOfDate": "2026-02-18",
  "receivables": [
    {
      "customerId": "uuid",
      "customerName": "Ahmed Traders",
      "totalOutstanding": 45000,
      "unappliedCredits": 0,
      "netOutstanding": 45000,
      "documents": [
        {
          "id": "uuid",
          "documentNumber": "SALE-0001",
          "outstanding": 20000
        }
      ]
    }
  ]
}
```

#### Pending Payables (What you owe suppliers)

```
GET /api/v1/reports/pending-payables?asOfDate=2026-02-18&supplierId=uuid&minAmount=1000
```

Same structure but for suppliers.

#### Supplier Statement

A chronological ledger of all transactions with a supplier over a date range.

```
GET /api/v1/reports/suppliers/:id/statement?dateFrom=2026-01-01&dateTo=2026-02-18
```

Both `dateFrom` and `dateTo` are **required**.

```json
// Response 200
{
  "supplierId": "uuid",
  "supplierName": "Fabric House",
  "dateFrom": "2026-01-01",
  "dateTo": "2026-02-18",
  "openingBalance": 10000,
  "closingBalance": 80000,
  "entries": [
    {
      "date": "2026-01-10T00:00:00.000Z",
      "transactionId": "uuid",
      "documentNumber": "PURCH-0001",
      "entryType": "AP_INCREASE",
      "amount": 100000,
      "balance": 110000
    },
    {
      "date": "2026-01-15T00:00:00.000Z",
      "transactionId": "uuid",
      "documentNumber": "SPAY-0001",
      "entryType": "AP_DECREASE",
      "amount": 50000,
      "balance": 60000
    }
  ]
}
```

Ledger entry types:
- `AP_INCREASE` — purchase increases what you owe supplier
- `AP_DECREASE` — payment decreases what you owe supplier
- `AR_INCREASE` — sale increases what customer owes you
- `AR_DECREASE` — payment decreases what customer owes you

#### Customer Statement

```
GET /api/v1/reports/customers/:id/statement?dateFrom=2026-01-01&dateTo=2026-02-18
```

Same structure as supplier statement.

#### Payment Account Statement

```
GET /api/v1/reports/payment-accounts/:id/statement?dateFrom=2026-01-01&dateTo=2026-02-18
```

---

### 6.8 Dashboard

Single endpoint that returns a full financial overview for the tenant.

```
GET /api/v1/dashboard/summary?asOfDate=2026-02-18
```

`asOfDate` is optional; defaults to today.

```json
// Response 200
{
  "asOfDate": "2026-02-18",
  "cash": {
    "totalBalance": 1500000,
    "accounts": [
      { "name": "Cash Drawer", "balance": 500000 },
      { "name": "HBL Account", "balance": 1000000 }
    ]
  },
  "inventory": {
    "totalValue": 3000000,
    "totalProducts": 42,
    "lowStockCount": 3
  },
  "receivables": {
    "totalAmount": 450000,
    "customerCount": 12,
    "overdueAmount": 100000,
    "overdueCount": 3
  },
  "payables": {
    "totalAmount": 200000,
    "supplierCount": 5,
    "overdueAmount": 50000,
    "overdueCount": 1
  },
  "recentActivity": {
    "todaySales": 80000,
    "todayPurchases": 0,
    "todayPayments": 30000,
    "todayReceipts": 50000
  }
}
```

---

### 6.9 Imports (Bulk Upload)

The import system allows uploading CSV or XLSX files to bulk-create records. It follows a **3-step process**:

```
Step 1: Upload file       → POST /imports
Step 2: Map columns       → POST /imports/:id/map
Step 3: Commit records    → POST /imports/:id/commit
```

Optional: `POST /imports/:id/rollback` to undo a completed import.

#### Supported Modules

| Module | Creates |
|--------|---------|
| `CUSTOMERS` | Customer records |
| `SUPPLIERS` | Supplier records |
| `PRODUCTS` | Product records |
| `OPENING_BALANCES` | Opening balances for existing customers/suppliers |

#### Step 1: Upload File

```
POST /api/v1/imports
Content-Type: multipart/form-data
```

| Form Field | Type | Description |
|------------|------|-------------|
| `file` | File | CSV or XLSX file, max 10MB |
| `module` | string | `CUSTOMERS`, `SUPPLIERS`, `PRODUCTS`, or `OPENING_BALANCES` |

```json
// Response 201
{
  "id": "uuid",
  "module": "CUSTOMERS",
  "fileName": "customers.csv",
  "totalRows": 150,
  "status": "PENDING_MAPPING",
  "detectedColumns": ["Customer Name", "Phone Number", "City"],
  "requiredFields": [
    { "field": "name", "required": true },
    { "field": "phone", "required": false },
    { "field": "address", "required": false }
  ]
}
```

#### Step 2: Map Columns

Tell the system which CSV column maps to which system field.

```
POST /api/v1/imports/:id/map
```

```json
// Request Body
{
  "columnMapping": {
    "Customer Name": "name",
    "Phone Number": "phone",
    "City": "address"
  }
}
```

```json
// Response 200
{
  "id": "uuid",
  "status": "VALIDATED",
  "totalRows": 150,
  "validRows": 148,
  "invalidRows": 2,
  "errors": [
    { "rowNumber": 5, "field": "name", "error": "too short", "value": "A" },
    { "rowNumber": 89, "field": "phone", "error": "too long", "value": "123456789012345678901" }
  ],
  "preview": [
    { "rowNumber": 1, "data": { "name": "Ahmed Traders", "phone": "03001234567" }, "status": "VALID" },
    { "rowNumber": 5, "data": { "name": "A", "phone": "" }, "status": "INVALID" }
  ]
}
```

#### Step 3: Commit

```
POST /api/v1/imports/:id/commit
```

Requires OWNER/ADMIN role.

```json
// Request Body
{
  "strategy": "CREATE_ONLY",
  "skipValidationErrors": false
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `strategy` | string | `CREATE_ONLY` | `CREATE_ONLY` skips existing; `UPDATE_OR_CREATE` upserts |
| `skipValidationErrors` | boolean | false | If true, skips invalid rows and commits valid ones |

```json
// Response 200
{
  "id": "uuid",
  "status": "COMPLETED",
  "totalRows": 150,
  "successRows": 148,
  "failedRows": 2,
  "skippedRows": 0,
  "createdRecords": [
    { "rowNumber": 1, "recordId": "uuid", "recordType": "CUSTOMER" }
  ],
  "completedAt": "2026-02-18T11:30:00.000Z"
}
```

#### Rollback (OWNER/ADMIN)

Deletes all records created by this import batch (only if no dependent transactions exist).

```
POST /api/v1/imports/:id/rollback
```

```json
// Response 200
{
  "id": "uuid",
  "status": "ROLLED_BACK",
  "rolledBackCount": 148,
  "rolledBackAt": "2026-02-18T12:00:00.000Z"
}
```

#### List Imports

```
GET /api/v1/imports?status=COMPLETED&module=CUSTOMERS&page=1&limit=20
```

#### Get Import Batch Detail

```
GET /api/v1/imports/:id?page=1&limit=20
```

Returns the batch with paginated row-level detail (useful for showing errors to user).

---

### 6.10 Health Check

```
GET /api/v1/health
```

Public endpoint. Use this for frontend connectivity checks.

```json
// Response 200
{
  "status": "ok",
  "uptime": 3600,
  "version": "1.0.0",
  "database": "connected",
  "timestamp": "2026-02-18T10:00:00.000Z",
  "info": {
    "database": { "status": "up", "responseTime": 12 },
    "memory": { "status": "up", "heapUsed": 85000000, "heapTotal": 120000000 }
  }
}
```

If database is down → returns `503 Service Unavailable`.

---

## 7. Data Types & Enums

### Transaction Types

```typescript
type TransactionType =
  | "PURCHASE"
  | "SALE"
  | "SUPPLIER_PAYMENT"
  | "CUSTOMER_PAYMENT"
  | "SUPPLIER_RETURN"
  | "CUSTOMER_RETURN"
  | "INTERNAL_TRANSFER"
  | "ADJUSTMENT";
```

### Transaction Statuses

```typescript
type TransactionStatus = "DRAFT" | "POSTED" | "VOIDED";
```

### Payment Account Types

```typescript
type PaymentAccountType = "CASH" | "BANK" | "WALLET" | "CARD";
```

### User Roles

```typescript
type UserRole = "OWNER" | "ADMIN" | "USER";
```

### Entity Statuses

```typescript
type EntityStatus = "ACTIVE" | "INACTIVE";
```

### Inventory Movement Types

```typescript
type MovementType =
  | "PURCHASE_IN"
  | "SALE_OUT"
  | "SUPPLIER_RETURN_OUT"
  | "CUSTOMER_RETURN_IN"
  | "ADJUSTMENT_IN"
  | "ADJUSTMENT_OUT";
```

### Ledger Entry Types

```typescript
type LedgerEntryType = "AP_INCREASE" | "AP_DECREASE" | "AR_INCREASE" | "AR_DECREASE";
```

### Payment Entry Types

```typescript
type PaymentEntryType = "MONEY_IN" | "MONEY_OUT" | "TRANSFER";
```

### Delivery Types

```typescript
type DeliveryType = "STORE_PICKUP" | "HOME_DELIVERY";
```

### Import Modules

```typescript
type ImportModule = "CUSTOMERS" | "SUPPLIERS" | "PRODUCTS" | "OPENING_BALANCES";
```

### Import Statuses

```typescript
type ImportStatus =
  | "PENDING_MAPPING"
  | "VALIDATED"
  | "PROCESSING"
  | "COMPLETED"
  | "FAILED"
  | "ROLLED_BACK";
```

---

## 8. Pagination Pattern

All list endpoints return:

```json
{
  "data": [],
  "meta": {
    "page": 1,
    "limit": 20,
    "total": 200,
    "totalPages": 10
  }
}
```

- Default `page`: `1`
- Default `limit`: `20`
- Navigate with `?page=2&limit=50`

---

## 9. Role-Based Access Control

Three roles exist. **OWNER** is the most privileged and is assigned at registration.

| Role | Capabilities |
|------|-------------|
| `OWNER` | Full access to all endpoints |
| `ADMIN` | Same as OWNER for most endpoints; intended for managers |
| `USER` | Read access only; cannot create/edit/delete; cannot post transactions |

### Endpoints requiring OWNER or ADMIN

- Create/update/delete: customers, suppliers, products, payment accounts
- Post transactions
- Commit/rollback imports
- All `/reports/*` endpoints
- Create adjustments

### Endpoints accessible by USER

- All `GET` (list, detail, balance) endpoints
- Upload import file (Step 1), map columns (Step 2)

### How to Check Role Client-Side

Decode the JWT (base64 decode the payload, no signature check needed):

```javascript
const payload = JSON.parse(atob(accessToken.split('.')[1]));
const role = payload.role; // "OWNER" | "ADMIN" | "USER"
```

Use this to conditionally show/hide UI elements (edit buttons, delete options, etc.). The server will still enforce roles — this is just for UX.

---

## 10. Monetary Values

**All monetary amounts are integers representing Pakistani Rupees (PKR).**

There are no decimal places in the API. The implicit unit is PKR.

```
5000  → PKR 5,000
150000 → PKR 1,50,000
```

When displaying to users, format as `PKR 5,000` or `Rs. 5,000`.

> **Do not divide by 100.** The values are already full rupee amounts, not paisa.

When sending amounts to the API, round to the nearest rupee before sending.

---

## 11. Idempotency

Several endpoints support an optional `idempotencyKey` to prevent duplicate operations.

**For draft creation** (purchases, sales, returns, transfers, adjustments):
- Include `idempotencyKey` as a client-generated UUID in the request body
- If you send the same `idempotencyKey` twice, the second call returns the same response as the first (no duplicate record created)
- The key is unique per tenant

**For transaction posting** (`POST /transactions/:id/post`):
- `idempotencyKey` is **required** in the request body
- Use a fresh UUID for each posting attempt
- This prevents double-posting if the network drops after the server commits but before the client receives the response

**Recommended pattern:**
```javascript
// Generate once, store in local state, retry safely
const idempotencyKey = crypto.randomUUID();
await api.post(`/transactions/${draftId}/post`, { idempotencyKey });
```

---

## 12. Suggested Frontend HTTP Client Setup

Here is a minimal HTTP client setup (framework-agnostic) covering auth, refresh, and error handling:

```typescript
// api.ts
const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000/api/v1';

let accessToken: string | null = null;
let refreshToken: string | null = null;

export function setTokens(access: string, refresh: string) {
  accessToken = access;
  refreshToken = refresh;
  // persist to localStorage if needed
}

export function clearTokens() {
  accessToken = null;
  refreshToken = null;
}

async function refreshAccessToken(): Promise<boolean> {
  if (!refreshToken) return false;
  try {
    const res = await fetch(`${BASE_URL}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });
    if (!res.ok) { clearTokens(); return false; }
    const data = await res.json();
    accessToken = data.accessToken;
    return true;
  } catch {
    clearTokens();
    return false;
  }
}

export async function apiRequest<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const requestId = crypto.randomUUID();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-request-id': requestId,
    ...(options.headers as Record<string, string>),
  };

  if (accessToken) {
    headers['Authorization'] = `Bearer ${accessToken}`;
  }

  let res = await fetch(`${BASE_URL}${path}`, { ...options, headers });

  // Auto-refresh on 401
  if (res.status === 401 && refreshToken) {
    const refreshed = await refreshAccessToken();
    if (refreshed) {
      headers['Authorization'] = `Bearer ${accessToken}`;
      res = await fetch(`${BASE_URL}${path}`, { ...options, headers });
    }
  }

  if (!res.ok) {
    const error = await res.json().catch(() => ({ message: 'Unknown error' }));
    throw { ...error, status: res.status };
  }

  return res.json() as Promise<T>;
}
```

**Usage example:**
```typescript
// List customers
const { data, meta } = await apiRequest<{ data: Customer[]; meta: Meta }>(
  '/customers?page=1&limit=20'
);

// Create a sale draft
const draft = await apiRequest<Transaction>('/transactions/sales/draft', {
  method: 'POST',
  body: JSON.stringify({
    customerId: '...',
    transactionDate: '2026-02-18',
    lines: [{ productId: '...', quantity: 10, unitPrice: 2000 }],
    idempotencyKey: crypto.randomUUID(),
  }),
});

// Post it
const posted = await apiRequest<Transaction>(`/transactions/${draft.id}/post`, {
  method: 'POST',
  body: JSON.stringify({
    idempotencyKey: crypto.randomUUID(),
    paidNow: 5000,
    paymentAccountId: '...',
  }),
});
```

---

## 13. Business Logic Rules to Know

These are system behaviors that affect UI design decisions:

### Multi-Tenancy
- Each user belongs to exactly one tenant
- All data is isolated per tenant — no shared data between tenants
- The `tenantId` is embedded in the JWT and applied automatically — you never need to send it explicitly

### Transaction Posting
- Drafts have **zero financial impact** — only posted transactions affect balances
- You cannot un-post a transaction; only void it (not yet exposed in API)
- Always use a unique `idempotencyKey` when posting

### Balances Are Calculated, Not Stored
- Customer/supplier balances are computed on-the-fly from posted transactions
- Only `POSTED` transactions count toward balances
- `DRAFT` transactions don't affect any balance anywhere

### Auto Payment Allocation (FIFO)
- When you post a customer/supplier payment, the system automatically applies it against the oldest unpaid invoices first (First In, First Out)
- You can override this with the `allocations` array in the post body

### Product Average Cost
- Updated automatically using **weighted average** when purchase transactions are posted
- Never send `avgCost` — it's read-only and system-managed

### Returns Must Reference Source Lines
- Supplier/customer returns require `sourceTransactionLineId`
- You cannot return more than the original quantity
- The source transaction must be POSTED

### Inactive Entities Block New Transactions
- You cannot create a transaction with an INACTIVE customer, supplier, product, or payment account
- Show a warning if user tries to create a transaction with an inactive entity

### Deactivation Requires Zero Outstanding Balance
- You **cannot** deactivate a customer who has an outstanding receivable balance (AR > 0)
- You **cannot** deactivate a supplier who has an outstanding payable balance (AP > 0)
- The API returns `400 Bad Request` — show the error message to the user
- UI should disable the "Deactivate" button or show a warning when balance > 0

### Status Changes Are Audited
- Every status change (activate/deactivate) for customers, suppliers, products, and payment accounts is logged server-side with:
  - Who made the change (`actorUserId`)
  - Previous and new status
  - Optional `reason` field (include a text input in the UI when deactivating)
  - Timestamp

### Duplicate Names
- Customer names are unique per tenant
- Supplier names are unique per tenant
- Product SKUs are unique per tenant
- Payment account names are unique per tenant
- API returns `409 Conflict` on duplicates

### Internal Transfers Need Two Different Accounts
- `fromPaymentAccountId` ≠ `toPaymentAccountId`
- API returns `400` if they are the same

### Document Numbers Are Auto-Generated
- Do not send `documentNumber` — it's assigned by the server on posting
- Format: `PURCH-0001`, `SALE-0001`, `CPAY-0001`, etc.

### Import is Irreversible After Dependencies Exist
- Once customers/products from an import are used in transactions, the import batch cannot be rolled back
- Warn users before they create transactions from imported data if rollback might still be needed

---

*End of Frontend Integration Guide*
