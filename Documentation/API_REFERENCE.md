# API Reference

## Overview
-   **Base URL:** The API is prefixed with `/api/v1/`. For example, a request to `POST /auth/register` would be `POST http://localhost:3000/api/v1/auth/register` (port 3000 is default from `main.ts`).
-   **Authentication:** Authentication is primarily handled via JWT (JSON Web Tokens). After successful login or registration, the API returns an `accessToken`. This token must be included in the `Authorization` header of subsequent requests as a `Bearer` token (e.g., `Authorization: Bearer <your_access_token>`). Endpoints marked with `@Public()` do not require authentication.
-   **Pagination:** List endpoints that return collections of resources adhere to a standard pagination response shape:
    ```json
    {
      "data": [...],       // Array of resource objects
      "meta": {
        "page": 1,         // Current page number (default 1)
        "limit": 20,       // Number of items per page (default 20, max 100)
        "total": 45,       // Total number of items across all pages
        "totalPages": 3    // Total number of pages
      }
    }
    ```
-   **Error Format:** The API returns standardized JSON error responses for client (4xx) and server (5xx) errors.
    ```json
    {
      "statusCode": 400,
      "message": "Validation failed",
      "errors": [
        {
          "field": "email",
          "message": "email must be an email"
        }
      ],
      "timestamp": "2026-02-11T13:26:58.345Z",
      "path": "/api/v1/auth/register",
      "requestId": "uuid"
    }
    ```
    For 4xx errors, `errors` array provides field-specific validation messages.
-   **Tenant Isolation Note:** The system is multi-tenant. All JWT-protected list/get endpoints are automatically scoped to the authenticated user's `tenantId`. Attempts to access records belonging to a different tenant will result in a `404 Not Found` response, rather than a `403 Forbidden`, to prevent information leakage about the existence of other tenants' data.

## Modules

### Auth

Authentication and user management endpoints.

---

**1. `POST /api/v1/auth/register`**

*   **Purpose:** Registers a new business (tenant) and its owner user, returning JWTs for immediate authentication.
*   **Auth:** Public
*   **Request Body:** `application/json`
    ```typescript
    interface RegisterDto {
      tenantName: string; // Required, string, 2-100 chars, trimmed. Example: "Acme Trading Co."
      fullName: string;   // Required, string, 2-100 chars, trimmed. Example: "John Doe"
      email: string;      // Required, valid email format, trimmed, lowercase. Example: "john@acme.com"
      password: string;   // Required, min 8 chars, 1 uppercase, 1 lowercase, 1 number, 0 symbols. Example: "MyPass123!"
    }
    ```
*   **Success Response:** `201 Created`
    ```json
    {
      "accessToken": "eyJhbGc...", // JWT for authenticated requests
      "refreshToken": "eyJhbGc...", // JWT for refreshing access token (longer expiry)
      "user": {
        "id": "uuid",
        "tenantId": "uuid",
        "fullName": "John Doe",
        "email": "john@example.com",
        "role": "OWNER"
      }
    }
    ```
*   **Error Responses:**
    *   `400 Bad Request`: Validation failed (e.g., missing fields, invalid email format, weak password).
    *   `409 Conflict`: `Email already exists`.

---

**2. `POST /api/v1/auth/login`**

*   **Purpose:** Authenticates an existing user, returning JWTs.
*   **Auth:** Public
*   **Request Body:** `application/json`
    ```typescript
    interface LoginDto {
      email: string;    // Required, valid email format, trimmed, lowercase. Example: "john@acme.com"
      password: string; // Required, string. Example: "MyPass123!"
    }
    ```
*   **Success Response:** `200 OK`
    ```json
    {
      "accessToken": "eyJhbGc...",
      "refreshToken": "eyJhbGc...",
      "user": {
        "id": "uuid",
        "tenantId": "uuid",
        "fullName": "John Doe",
        "email": "john@example.com",
        "role": "OWNER",
        "tenant": {
          "id": "uuid",
          "name": "Test Business",
          "baseCurrency": "PKR",
          "timezone": "Asia/Karachi"
        }
      }
    }
    ```
*   **Error Responses:**
    *   `400 Bad Request`: Validation failed (e.g., invalid email format, missing password).
    *   `401 Unauthorized`: `Invalid credentials` (for wrong email or password).
    *   `403 Forbidden`: `Account inactive` or `Tenant inactive`.

---

**3. `POST /api/v1/auth/refresh`**

*   **Purpose:** Exchanges a valid refresh token for a new access token.
*   **Auth:** Public
*   **Request Body:** `application/json`
    ```typescript
    { refreshToken: string }
    ```
*   **Success Response:** `200 OK`
    ```json
    { "accessToken": "eyJhbGc..." }
    ```
*   **Error Responses:**
    *   `401 Unauthorized`: Token invalid, expired, or revoked.

---

**4. `POST /api/v1/auth/logout`**

*   **Purpose:** Revokes a refresh token so it can no longer be used.
*   **Auth:** Public
*   **Request Body:** `application/json`
    ```typescript
    { refreshToken: string }
    ```
*   **Success Response:** `200 OK` — `{ "message": "Logged out" }`

---

**5. `PATCH /api/v1/auth/tenant`**

*   **Purpose:** Updates the authenticated tenant's business profile fields.
*   **Auth:** JWT Bearer — **OWNER role required**
*   **Request Body:** `application/json` — at least one field required
    ```typescript
    interface UpdateTenantDto {
      name?: string;         // 1-100 chars
      timezone?: string;     // IANA identifier, e.g. "Asia/Karachi"
      baseCurrency?: string; // ISO 4217 3-letter code, e.g. "PKR"
    }
    ```
*   **Success Response:** `200 OK`
    ```json
    {
      "id": "uuid",
      "name": "Acme Trading Co.",
      "baseCurrency": "PKR",
      "timezone": "Asia/Karachi"
    }
    ```
*   **Error Responses:**
    *   `400 Bad Request`: No fields provided, or validation failed.
    *   `401 Unauthorized`: Missing or invalid JWT.
    *   `403 Forbidden`: User role is not OWNER.

---

### Health

Endpoints for monitoring application health and version information.

---

**1. `GET /api/v1/health`**

*   **Purpose:** Provides an overview of the application's health, including database connectivity and memory usage.
*   **Auth:** Public
*   **Request Body/Query Params:** None
*   **Success Response:** `200 OK`
    ```json
    {
      "status": "ok",
      "info": {
        "database": { "status": "up", "responseTime": "5ms" },
        "memory": { "status": "ok", "heapUsed": "120MB", "heapTotal": "256MB" }
      },
      "error": {},
      "details": {
        "database": { "status": "up", "responseTime": "5ms" },
        "memory": { "status": "ok", "heapUsed": "120MB", "heapTotal": "256MB" }
      }
    }
    ```
*   **Error Responses:**
    *   `503 Service Unavailable`: If the database connection fails.
        ```json
        {
          "status": "error",
          "info": {},
          "error": { "database": { "status": "down", "message": "Connection timeout" } },
          "details": { "database": { "status": "down", "message": "Connection timeout" } }
        }
        ```

---

**2. `GET /api/v1/version`**

*   **Purpose:** Returns the current application version, environment details, and build information.
*   **Auth:** Public
*   **Request Body/Query Params:** None
*   **Success Response:** `200 OK`
    ```json
    {
      "version": "1.0.0",
      "environment": "development",
      "nodeVersion": "20.x.x",
      "buildDate": null,
      "gitCommit": null
    }
    ```
*   **Error Responses:** None explicitly handled; unhandled errors would result in a generic `500 Internal Server Error`.

---

### Suppliers

Endpoints for managing supplier master data.

---

**1. `POST /api/v1/suppliers`**

*   **Purpose:** Creates a new supplier for the authenticated tenant.
*   **Auth:** JWT Bearer
*   **Request Body:** `application/json`
    ```typescript
    interface CreateSupplierDto {
      name: string;    // Required, string, 2-200 chars, trimmed. Example: "Acme Supplies"
      phone?: string;  // Optional, string, max 20 chars. Example: "+923001234567"
      address?: string; // Optional, string, max 500 chars. Example: "123 Main St, City"
      notes?: string;   // Optional, string, max 1000 chars.
    }
    ```
*   **Success Response:** `201 Created`
    ```json
    {
      "id": "uuid",
      "tenantId": "uuid",
      "name": "Acme Supplies",
      "phone": "+923001234567",
      "address": "123 Main St, City",
      "notes": null,
      "status": "ACTIVE",
      "createdBy": "uuid",
      "createdAt": "2026-02-11T...",
      "updatedAt": "2026-02-11T...",
      "_computed": {
        "totalPurchases": 0,    // Placeholder, will be actual calculated value in future phase
        "currentBalance": 0,    // Placeholder, will be actual calculated value in future phase
        "lastPurchaseDate": null // Placeholder, will be actual calculated value in future phase
      }
    }
    ```
*   **Error Responses:**
    *   `400 Bad Request`: Validation failed (e.g., missing `name`, `name` too short).
    *   `401 Unauthorized`: Missing or invalid JWT.
    *   `409 Conflict`: `Supplier name already exists` (case-insensitive check within tenant).

---

**2. `GET /api/v1/suppliers`**

*   **Purpose:** Retrieves a paginated list of suppliers for the authenticated tenant, with optional filtering and sorting.
*   **Auth:** JWT Bearer
*   **Query Parameters:**
    ```typescript
    interface ListSuppliersQueryDto extends PaginationQueryDto {
      page?: number;     // Optional, integer, min 1, default 1
      limit?: number;    // Optional, integer, min 1, max 100, default 20
      search?: string;   // Optional, string (case-insensitive search in `name`, `phone`)
      status?: 'ACTIVE' | 'INACTIVE' | 'ALL'; // Optional, default 'ACTIVE'
      sortBy?: 'name' | 'createdAt'; // Optional, default 'name'
      sortOrder?: 'asc' | 'desc';    // Optional, default 'asc'
    }
    ```
*   **Success Response:** `200 OK` (Paginated response)
    ```json
    {
      "data": [
        {
          "id": "uuid",
          "tenantId": "uuid",
          "name": "Alpha Supplier",
          "phone": null,
          "address": null,
          "notes": null,
          "status": "ACTIVE",
          "createdBy": "uuid",
          "createdAt": "2026-02-11T...",
          "updatedAt": "2026-02-11T...",
          "_computed": {
            "totalPurchases": 0,
            "currentBalance": 0,
            "lastPurchaseDate": null
          }
        }
      ],
      "meta": {
        "page": 1,
        "limit": 20,
        "total": 2, // Total suppliers for the tenant
        "totalPages": 1
      }
    }
    ```
*   **Error Responses:**
    *   `401 Unauthorized`: Missing or invalid JWT.
    *   `400 Bad Request`: Invalid query parameters (e.g., `limit` > 100, invalid `status` value).

---

**3. `GET /api/v1/suppliers/:id`**

*   **Purpose:** Retrieves a single supplier by its ID for the authenticated tenant.
*   **Auth:** JWT Bearer
*   **Path Params:** `id: string` (UUID, required)
*   **Success Response:** `200 OK`
    ```json
    {
      "id": "uuid",
      "tenantId": "uuid",
      "name": "Test Supplier",
      "phone": null,
      "address": null,
      "notes": null,
      "status": "ACTIVE",
      "createdBy": "uuid",
      "createdAt": "2026-02-11T...",
      "updatedAt": "2026-02-11T...",
      "_computed": {
        "totalPurchases": 0,
        "currentBalance": 0,
        "lastPurchaseDate": null
      }
    }
    ```
*   **Error Responses:**
    *   `401 Unauthorized`: Missing or invalid JWT.
    *   `404 Not Found`: Supplier not found, or supplier belongs to another tenant (tenant isolation).

---

**4. `PATCH /api/v1/suppliers/:id`**

*   **Purpose:** Updates fields of an existing supplier for the authenticated tenant.
*   **Auth:** JWT Bearer
*   **Path Params:** `id: string` (UUID, required)
*   **Request Body:** `application/json`
    ```typescript
    interface UpdateSupplierDto {
      name?: string;    // Optional, string, 2-200 chars, trimmed.
      phone?: string;   // Optional, string, max 20 chars.
      address?: string; // Optional, string, max 500 chars.
      notes?: string;   // Optional, string, max 1000 chars.
    }
    ```
*   **Success Response:** `200 OK` (Returns the updated supplier object)
    ```json
    {
      "id": "uuid",
      "tenantId": "uuid",
      "name": "Updated Supplier Name",
      "phone": "+92300 9999999",
      "address": null,
      "notes": null,
      "status": "ACTIVE",
      "createdBy": "uuid",
      "createdAt": "2026-02-11T...",
      "updatedAt": "2026-02-11T...", // Updated timestamp
      "_computed": {
        "totalPurchases": 0,
        "currentBalance": 0,
        "lastPurchaseDate": null
      }
    }
    ```
*   **Error Responses:**
    *   `400 Bad Request`: Validation failed (e.g., `name` too short, empty request body).
    *   `401 Unauthorized`: Missing or invalid JWT.
    *   `404 Not Found`: Supplier not found, or supplier belongs to another tenant.
    *   `409 Conflict`: `Supplier name already exists` (if trying to update name to an already existing one within the tenant).

---

**5. `PATCH /api/v1/suppliers/:id/status`**

*   **Purpose:** Updates the status of a supplier (e.g., to `INACTIVE`) for the authenticated tenant.
*   **Auth:** JWT Bearer
*   **Path Params:** `id: string` (UUID, required)
*   **Request Body:** `application/json`
    ```typescript
    interface UpdateStatusDto {
      status: 'ACTIVE' | 'INACTIVE'; // Required, string. Example: "INACTIVE"
      reason?: string;                // Optional, string (reason for status change, if applicable).
    }
    ```
*   **Success Response:** `200 OK` (Returns the updated supplier object)
    ```json
    {
      "id": "uuid",
      "tenantId": "uuid",
      "name": "Active Supplier",
      "phone": null,
      "address": null,
      "notes": null,
      "status": "INACTIVE", // Updated status
      "createdBy": "uuid",
      "createdAt": "2026-02-11T...",
      "updatedAt": "2026-02-11T...",
      "_computed": {
        "totalPurchases": 0,
        "currentBalance": 0,
        "lastPurchaseDate": null
      }
    }
    ```
*   **Error Responses:**
    *   `400 Bad Request`: Validation failed (e.g., invalid `status` value).
    *   `401 Unauthorized`: Missing or invalid JWT.
    *   `404 Not Found`: Supplier not found, or supplier belongs to another tenant.
    *   `409 Conflict`: (Potentially, if business logic dictates. Not explicitly handled in service but might be for future phases if supplier has active transactions).

---

### Customers

Endpoints for managing customer master data. Structure and behavior are largely identical to Suppliers.

---

**1. `POST /api/v1/customers`**

*   **Purpose:** Creates a new customer for the authenticated tenant.
*   **Auth:** JWT Bearer
*   **Request Body:** `application/json`
    ```typescript
    interface CreateCustomerDto {
      name: string;    // Required, string, 2-200 chars, trimmed. Example: "Big Corp"
      phone?: string;  // Optional, string, max 20 chars.
      address?: string; // Optional, string, max 500 chars.
      notes?: string;   // Optional, string, max 1000 chars.
    }
    ```
*   **Success Response:** `201 Created`
    ```json
    {
      "id": "uuid",
      "tenantId": "uuid",
      "name": "Big Corp",
      "phone": null,
      "address": null,
      "notes": null,
      "status": "ACTIVE",
      "createdBy": "uuid",
      "createdAt": "2026-02-11T...",
      "updatedAt": "2026-02-11T...",
      "_computed": {
        "totalSales": 0,
        "currentBalance": 0,
        "lastSaleDate": null
      }
    }
    ```
*   **Error Responses:**
    *   `400 Bad Request`: Validation failed.
    *   `401 Unauthorized`: Missing or invalid JWT.
    *   `409 Conflict`: `Customer name already exists`.

---

**2. `GET /api/v1/customers`**

*   **Purpose:** Retrieves a paginated list of customers for the authenticated tenant, with optional filtering and sorting.
*   **Auth:** JWT Bearer
*   **Query Parameters:**
    ```typescript
    interface ListCustomersQueryDto extends PaginationQueryDto {
      page?: number;     // Optional, integer, min 1, default 1
      limit?: number;    // Optional, integer, min 1, max 100, default 20
      search?: string;   // Optional, string (case-insensitive search in `name`, `phone`)
      status?: 'ACTIVE' | 'INACTIVE' | 'ALL'; // Optional, default 'ACTIVE'
      sortBy?: 'name' | 'createdAt'; // Optional, default 'name'
      sortOrder?: 'asc' | 'desc';    // Optional, default 'asc'
    }
    ```
*   **Success Response:** `200 OK` (Paginated response)
    ```json
    {
      "data": [
        {
          "id": "uuid",
          "tenantId": "uuid",
          "name": "Alpha Customer",
          "phone": null,
          "address": null,
          "notes": null,
          "status": "ACTIVE",
          "createdBy": "uuid",
          "createdAt": "2026-02-11T...",
          "updatedAt": "2026-02-11T...",
          "_computed": {
            "totalSales": 0,
            "currentBalance": 0,
            "lastSaleDate": null
          }
        }
      ],
      "meta": {
        "page": 1,
        "limit": 20,
        "total": 2,
        "totalPages": 1
      }
    }
    ```
*   **Error Responses:**
    *   `401 Unauthorized`: Missing or invalid JWT.
    *   `400 Bad Request`: Invalid query parameters.

---

**3. `GET /api/v1/customers/:id`**

*   **Purpose:** Retrieves a single customer by its ID for the authenticated tenant.
*   **Auth:** JWT Bearer
*   **Path Params:** `id: string` (UUID, required)
*   **Success Response:** `200 OK`
    ```json
    {
      "id": "uuid",
      "tenantId": "uuid",
      "name": "Test Customer",
      "phone": null,
      "address": null,
      "notes": null,
      "status": "ACTIVE",
      "createdBy": "uuid",
      "createdAt": "2026-02-11T...",
      "updatedAt": "2026-02-11T...",
      "_computed": {
        "totalSales": 0,
        "currentBalance": 0,
        "lastSaleDate": null
      }
    }
    ```
*   **Error Responses:**
    *   `401 Unauthorized`: Missing or invalid JWT.
    *   `404 Not Found`: Customer not found, or customer belongs to another tenant (tenant isolation).

---

**4. `PATCH /api/v1/customers/:id`**

*   **Purpose:** Updates fields of an existing customer for the authenticated tenant.
*   **Auth:** JWT Bearer
*   **Path Params:** `id: string` (UUID, required)
*   **Request Body:** `application/json`
    ```typescript
    interface UpdateCustomerDto {
      name?: string;    // Optional, string, 2-200 chars, trimmed.
      phone?: string;   // Optional, string, max 20 chars.
      address?: string; // Optional, string, max 500 chars.
      notes?: string;   // Optional, string, max 1000 chars.
    }
    ```
*   **Success Response:** `200 OK` (Returns the updated customer object)
    ```json
    {
      "id": "uuid",
      "tenantId": "uuid",
      "name": "Updated Customer Name",
      "phone": "+92300 1111111",
      "address": null,
      "notes": null,
      "status": "ACTIVE",
      "createdBy": "uuid",
      "createdAt": "2026-02-11T...",
      "updatedAt": "2026-02-11T...",
      "_computed": {
        "totalSales": 0,
        "currentBalance": 0,
        "lastSaleDate": null
      }
    }
    ```
*   **Error Responses:**
    *   `400 Bad Request`: Validation failed.
    *   `401 Unauthorized`: Missing or invalid JWT.
    *   `404 Not Found`: Customer not found, or customer belongs to another tenant.
    *   `409 Conflict`: `Customer name already exists`.

---

**5. `PATCH /api/v1/customers/:id/status`**

*   **Purpose:** Updates the status of a customer (e.g., to `INACTIVE`) for the authenticated tenant.
*   **Auth:** JWT Bearer
*   **Path Params:** `id: string` (UUID, required)
*   **Request Body:** `application/json` (See `UpdateStatusDto` for Suppliers)
    ```typescript
    interface UpdateStatusDto {
      status: 'ACTIVE' | 'INACTIVE'; // Required, string.
      reason?: string;                // Optional, string.
    }
    ```
*   **Success Response:** `200 OK` (Returns the updated customer object)
    ```json
    {
      "id": "uuid",
      "tenantId": "uuid",
      "name": "Active Customer",
      "phone": null,
      "address": null,
      "notes": null,
      "status": "INACTIVE",
      "createdBy": "uuid",
      "createdAt": "2026-02-11T...",
      "updatedAt": "2026-02-11T...",
      "_computed": {
        "totalSales": 0,
        "currentBalance": 0,
        "lastSaleDate": null
      }
    }
    ```
*   **Error Responses:**
    *   `400 Bad Request`: Validation failed.
    *   `401 Unauthorized`: Missing or invalid JWT.
    *   `404 Not Found`: Customer not found, or customer belongs to another tenant.

---

### Products

Endpoints for managing product master data.

---

**1. `POST /api/v1/products`**

*   **Purpose:** Creates a new product for the authenticated tenant.
*   **Auth:** JWT Bearer
*   **Request Body:** `application/json`
    ```typescript
    interface CreateProductDto {
      name: string;      // Required, string, 2-200 chars. Example: "Men Suit - Black"
      sku?: string;      // Optional, string, max 50 chars, transformed to uppercase. Must contain only uppercase letters, numbers, hyphens, and underscores. Example: "SUIT-BLK-001"
      category?: string; // Optional, string, max 100 chars. Example: "Suits"
      unit?: string;     // Optional, string, max 20 chars, default "piece". Example: "piece"
    }
    ```
*   **Success Response:** `201 Created`
    ```json
    {
      "id": "uuid",
      "tenantId": "uuid",
      "name": "Widget",
      "sku": null,
      "category": null,
      "unit": "piece",
      "status": "ACTIVE",
      "avgCost": 0,
      "createdBy": "uuid",
      "createdAt": "2026-02-11T...",
      "updatedAt": "2026-02-11T...",
      "_computed": {
        "currentStock": 0,       // Placeholder, will be actual calculated value in future phase
        "totalPurchased": 0,     // Placeholder
        "totalSold": 0,          // Placeholder
        "lastPurchaseDate": null, // Placeholder
        "lastSaleDate": null     // Placeholder
      }
    }
    ```
*   **Error Responses:**
    *   `400 Bad Request`: Validation failed (e.g., missing `name`, invalid `sku` format).
    *   `401 Unauthorized`: Missing or invalid JWT.
    *   `409 Conflict`: `SKU already exists for this tenant`.

---

**2. `GET /api/v1/products`**

*   **Purpose:** Retrieves a paginated list of products for the authenticated tenant, with optional filtering and search.
*   **Auth:** JWT Bearer
*   **Query Parameters:**
    ```typescript
    interface ListProductsQueryDto extends PaginationQueryDto {
      page?: number;     // Optional, integer, min 1, default 1
      limit?: number;    // Optional, integer, min 1, max 100, default 20
      search?: string;   // Optional, string (case-insensitive search in `name`, `sku`, `category`)
      status?: 'ACTIVE' | 'INACTIVE' | 'ALL'; // Optional, default 'ACTIVE'
      category?: string; // Optional, string (filter by category, case-insensitive)
      sortBy?: 'name' | 'createdAt'; // Optional, default 'name'
      sortOrder?: 'asc' | 'desc'; // Optional, default 'asc'
    }
    ```
*   **Success Response:** `200 OK` (Paginated response)
    ```json
    {
      "data": [
        {
          "id": "uuid",
          "tenantId": "uuid",
          "name": "Electronics Widget",
          "sku": null,
          "category": "Electronics",
          "unit": "piece",
          "status": "ACTIVE",
          "avgCost": 0,
          "createdBy": "uuid",
          "createdAt": "2026-02-11T...",
          "updatedAt": "2026-02-11T...",
          "_computed": {
            "currentStock": 0,
            "totalPurchased": 0,
            "totalSold": 0,
            "lastPurchaseDate": null,
            "lastSaleDate": null
          }
        }
      ],
      "meta": {
        "page": 1,
        "limit": 20,
        "total": 2,
        "totalPages": 1
      }
    }
    ```
*   **Error Responses:**
    *   `401 Unauthorized`: Missing or invalid JWT.
    *   `400 Bad Request`: Invalid query parameters.

---

**3. `GET /api/v1/products/:id`**

*   **Purpose:** Retrieves a single product by its ID for the authenticated tenant.
*   **Auth:** JWT Bearer
*   **Path Params:** `id: string` (UUID, required)
*   **Success Response:** `200 OK`
    ```json
    {
      "id": "uuid",
      "tenantId": "uuid",
      "name": "Test Product",
      "sku": null,
      "category": null,
      "unit": "piece",
      "status": "ACTIVE",
      "avgCost": 0,
      "createdBy": "uuid",
      "createdAt": "2026-02-11T...",
      "updatedAt": "2026-02-11T...",
      "_computed": {
        "currentStock": 0,
        "totalPurchased": 0,
        "totalSold": 0,
        "lastPurchaseDate": null,
        "lastSaleDate": null
      }
    }
    ```
*   **Error Responses:**
    *   `401 Unauthorized`: Missing or invalid JWT.
    *   `404 Not Found`: Product not found, or product belongs to another tenant (tenant isolation).

---

**4. `PATCH /api/v1/products/:id`**

*   **Purpose:** Updates fields of an existing product for the authenticated tenant.
*   **Auth:** JWT Bearer
*   **Path Params:** `id: string` (UUID, required)
*   **Request Body:** `application/json`
    ```typescript
    interface UpdateProductDto {
      name?: string;      // Optional, string, 2-200 chars.
      sku?: string;      // Optional, string, max 50 chars, uppercase transform, must contain only uppercase letters, numbers, hyphens, and underscores.
      category?: string; // Optional, string, max 100 chars.
      unit?: string;     // Optional, string, max 20 chars.
      // avgCost is NOT updatable via this endpoint; it is managed by the posting engine.
    }
    ```
*   **Success Response:** `200 OK` (Returns the updated product object)
    ```json
    {
      "id": "uuid",
      "tenantId": "uuid",
      "name": "Updated Product Name",
      "sku": null,
      "category": "New Category",
      "unit": "piece",
      "status": "ACTIVE",
      "avgCost": 0,
      "createdBy": "uuid",
      "createdAt": "2026-02-11T...",
      "updatedAt": "2026-02-11T...",
      "_computed": {
        "currentStock": 0,
        "totalPurchased": 0,
        "totalSold": 0,
        "lastPurchaseDate": null,
        "lastSaleDate": null
      }
    }
    ```
*   **Error Responses:**
    *   `400 Bad Request`: Validation failed (e.g., trying to update `avgCost`, invalid `sku` format).
    *   `401 Unauthorized`: Missing or invalid JWT.
    *   `404 Not Found`: Product not found, or product belongs to another tenant.
    *   `409 Conflict`: `SKU already exists for this tenant` (if trying to update `sku` to an already existing one within the tenant).

---

**5. `PATCH /api/v1/products/:id/status`**

*   **Purpose:** Updates the status of a product (e.g., to `INACTIVE`) for the authenticated tenant.
*   **Auth:** JWT Bearer
*   **Path Params:** `id: string` (UUID, required)
*   **Request Body:** `application/json` (See `UpdateStatusDto` for Suppliers)
    ```typescript
    interface UpdateStatusDto {
      status: 'ACTIVE' | 'INACTIVE'; // Required, string.
      reason?: string;                // Optional, string.
    }
    ```
*   **Success Response:** `200 OK` (Returns the updated product object)
    ```json
    {
      "id": "uuid",
      "tenantId": "uuid",
      "name": "Active Product",
      "sku": null,
      "category": null,
      "unit": "piece",
      "status": "INACTIVE",
      "avgCost": 0,
      "createdBy": "uuid",
      "createdAt": "2026-02-11T...",
      "updatedAt": "2026-02-11T...",
      "_computed": {
        "currentStock": 0,
        "totalPurchased": 0,
        "totalSold": 0,
        "lastPurchaseDate": null,
        "lastSaleDate": null
      }
    }
    ```
*   **Error Responses:**
    *   `400 Bad Request`: Validation failed.
    *   `401 Unauthorized`: Missing or invalid JWT.
    *   `404 Not Found`: Product not found, or product belongs to another tenant.

---

**6. `POST /api/v1/products/:id/variants`**

*   **Purpose:** Adds a new size variant to an existing product.
*   **Auth:** JWT Bearer — OWNER or ADMIN
*   **Path Params:** `id: string` (product UUID)
*   **Request Body:** `application/json`
    ```typescript
    interface CreateProductVariantDto {
      size: string;   // Required, e.g. "M", "XL", "500g"
      sku?: string;   // Optional, variant-level SKU
    }
    ```
*   **Success Response:** `201 Created` — returns created variant object.
*   **Error Responses:**
    *   `404 Not Found`: Product not found.
    *   `409 Conflict`: A variant with this size already exists for this product.

---

**7. `PATCH /api/v1/products/:id/variants/:variantId`**

*   **Purpose:** Updates the `size` label and/or `sku` of an existing variant.
*   **Auth:** JWT Bearer — OWNER or ADMIN
*   **Path Params:** `id` (product UUID), `variantId` (variant UUID)
*   **Request Body:** `application/json` — at least one field required
    ```typescript
    interface UpdateProductVariantDto {
      size?: string;          // New size label (1-50 chars)
      sku?: string | null;    // New variant SKU (null to clear)
    }
    ```
*   **Success Response:** `200 OK` — returns updated variant object.
*   **Error Responses:**
    *   `400 Bad Request`: No fields provided.
    *   `404 Not Found`: Product or variant not found.
    *   `409 Conflict`: A variant with this size already exists for this product.

---

**8. `PATCH /api/v1/products/:id/variants/:variantId/status`**

*   **Purpose:** Activates or deactivates a size variant.
*   **Auth:** JWT Bearer — OWNER or ADMIN
*   **Path Params:** `id` (product UUID), `variantId` (variant UUID)
*   **Request Body:** `application/json`
    ```typescript
    { status: 'ACTIVE' | 'INACTIVE'; reason?: string }
    ```
*   **Success Response:** `200 OK` — returns updated variant.
*   **Error Responses:**
    *   `400 Bad Request`: Cannot deactivate variant with positive stock.
    *   `404 Not Found`: Variant not found.

---

**9. `GET /api/v1/products/:id/stock`**

*   **Purpose:** Returns current stock quantities and average cost per size variant for a product.
*   **Auth:** JWT Bearer
*   **Path Params:** `id: string` (product UUID)
*   **Success Response:** `200 OK`
    ```json
    {
      "productId": "uuid",
      "totalStock": 80,
      "variants": [
        { "variantId": "uuid", "size": "M", "currentStock": 50, "avgCost": 800 },
        { "variantId": "uuid", "size": "L", "currentStock": 30, "avgCost": 800 }
      ]
    }
    ```

---

**10. `GET /api/v1/products/:id/movements`**

*   **Purpose:** Returns a paginated, chronological list of all inventory movements for a product (all variants combined), with a running stock total.
*   **Auth:** JWT Bearer
*   **Path Params:** `id: string` (product UUID)
*   **Query Parameters:**

| Parameter | Required | Default | Description |
|-----------|----------|---------|-------------|
| `page`    | No       | 1       | Page number |
| `limit`   | No       | 20      | Items per page (max 100) |

*   **Success Response:** `200 OK`
    ```json
    {
      "data": [
        {
          "date": "2026-02-10",
          "documentNumber": "PUR-0001",
          "type": "PURCHASE",
          "variantSize": "M",
          "quantityIn": 20,
          "quantityOut": 0,
          "runningStock": 20
        },
        {
          "date": "2026-02-15",
          "documentNumber": "SAL-0003",
          "type": "SALE",
          "variantSize": "M",
          "quantityIn": 0,
          "quantityOut": 5,
          "runningStock": 15
        }
      ],
      "meta": { "page": 1, "limit": 20, "total": 45, "totalPages": 3 }
    }
    ```
*   **Field notes:**
    - `quantityIn` — non-zero for movement types: `PURCHASE_IN`, `CUSTOMER_RETURN_IN`, `ADJUSTMENT_IN`
    - `quantityOut` — non-zero for movement types: `SALE_OUT`, `SUPPLIER_RETURN_OUT`, `ADJUSTMENT_OUT`
    - `runningStock` — cumulative stock level after this movement (computed from stock before the page offset + movements on the page)
*   **Error Responses:**
    *   `404 Not Found`: Product not found.
    *   `401 Unauthorized`: Missing or invalid JWT.

---

### Payment Accounts

Endpoints for managing payment account master data.

---

**1. `POST /api/v1/payment-accounts`**

*   **Purpose:** Creates a new payment account for the authenticated tenant.
*   **Auth:** JWT Bearer
*   **Request Body:** `application/json`
    ```typescript
    interface CreatePaymentAccountDto {
      name: string;    // Required, string, 2-100 chars. Example: "Main Cash"
      type: 'CASH' | 'BANK' | 'WALLET' | 'CARD'; // Required, enum. Example: "CASH"
      openingBalance?: number; // Optional, integer (can be negative), default 0. Example: 50000
    }
    ```
*   **Success Response:** `201 Created`
    ```json
    {
      "id": "uuid",
      "tenantId": "uuid",
      "name": "Main Cash",
      "type": "CASH",
      "status": "ACTIVE",
      "openingBalance": 0,
      "createdBy": "uuid",
      "createdAt": "2026-02-11T...",
      "updatedAt": "2026-02-11T...",
      "_computed": {
        "currentBalance": 0,         // Placeholder
        "totalIn": 0,                // Placeholder
        "totalOut": 0,               // Placeholder
        "lastTransactionDate": null  // Placeholder
      }
    }
    ```
*   **Error Responses:**
    *   `400 Bad Request`: Validation failed (e.g., missing `name` or `type`, invalid `type` enum value).
    *   `401 Unauthorized`: Missing or invalid JWT.
    *   `409 Conflict`: `Payment account name already exists` (case-insensitive check within tenant).

---

**2. `GET /api/v1/payment-accounts`**

*   **Purpose:** Retrieves a paginated list of payment accounts for the authenticated tenant, with optional filtering.
*   **Auth:** JWT Bearer
*   **Query Parameters:**
    ```typescript
    interface ListPaymentAccountsQueryDto extends PaginationQueryDto {
      page?: number;     // Optional, integer, min 1, default 1
      limit?: number;    // Optional, integer, min 1, max 100, default 20
      type?: 'CASH' | 'BANK' | 'WALLET' | 'CARD'; // Optional, filter by type
      status?: 'ACTIVE' | 'INACTIVE' | 'ALL'; // Optional, default 'ACTIVE'
    }
    ```
*   **Success Response:** `200 OK` (Paginated response)
    ```json
    {
      "data": [
        {
          "id": "uuid",
          "tenantId": "uuid",
          "name": "Cash",
          "type": "CASH",
          "status": "ACTIVE",
          "openingBalance": 0,
          "createdBy": "uuid",
          "createdAt": "2026-02-11T...",
          "updatedAt": "2026-02-11T...",
          "_computed": {
            "currentBalance": 0,
            "totalIn": 0,
            "totalOut": 0,
            "lastTransactionDate": null
          }
        }
      ],
      "meta": {
        "page": 1,
        "limit": 20,
        "total": 2,
        "totalPages": 1
      }
    }
    ```
*   **Error Responses:**
    *   `401 Unauthorized`: Missing or invalid JWT.
    *   `400 Bad Request`: Invalid query parameters.

---

**3. `GET /api/v1/payment-accounts/:id`**

*   **Purpose:** Retrieves a single payment account by its ID for the authenticated tenant.
*   **Auth:** JWT Bearer
*   **Path Params:** `id: string` (UUID, required)
*   **Success Response:** `200 OK`
    ```json
    {
      "id": "uuid",
      "tenantId": "uuid",
      "name": "Test Account",
      "type": "CASH",
      "status": "ACTIVE",
      "openingBalance": 0,
      "createdBy": "uuid",
      "createdAt": "2026-02-11T...",
      "updatedAt": "2026-02-11T...",
      "_computed": {
        "currentBalance": 0,
        "totalIn": 0,
        "totalOut": 0,
        "lastTransactionDate": null
      }
    }
    ```
*   **Error Responses:**
    *   `401 Unauthorized`: Missing or invalid JWT.
    *   `404 Not Found`: Payment account not found, or account belongs to another tenant (tenant isolation).

---

**4. `PATCH /api/v1/payment-accounts/:id`**

*   **Purpose:** Updates the name of an existing payment account for the authenticated tenant.
*   **Auth:** JWT Bearer
*   **Path Params:** `id: string` (UUID, required)
*   **Request Body:** `application/json`
    ```typescript
    interface UpdatePaymentAccountDto {
      name?: string; // Optional, string, 2-100 chars. Example: "Updated Name"
      // 'type' and 'openingBalance' are NOT updatable via this endpoint; they are immutable.
    }
    ```
*   **Success Response:** `200 OK` (Returns the updated payment account object)
    ```json
    {
      "id": "uuid",
      "tenantId": "uuid",
      "name": "Updated Name",
      "type": "CASH",
      "status": "ACTIVE",
      "openingBalance": 0,
      "createdBy": "uuid",
      "createdAt": "2026-02-11T...",
      "updatedAt": "2026-02-11T...",
      "_computed": {
        "currentBalance": 0,
        "totalIn": 0,
        "totalOut": 0,
        "lastTransactionDate": null
      }
    }
    ```
*   **Error Responses:**
    *   `400 Bad Request`: Validation failed (e.g., trying to update `type` or `openingBalance`, `name` too short).
    *   `401 Unauthorized`: Missing or invalid JWT.
    *   `404 Not Found`: Payment account not found, or account belongs to another tenant.
    *   `409 Conflict`: `Payment account name already exists`.

---

**5. `PATCH /api/v1/payment-accounts/:id/status`**

*   **Purpose:** Updates the status of a payment account (e.g., to `INACTIVE`) for the authenticated tenant.
*   **Auth:** JWT Bearer
*   **Path Params:** `id: string` (UUID, required)
*   **Request Body:** `application/json` (See `UpdateStatusDto` for Suppliers)
    ```typescript
    interface UpdateStatusDto {
      status: 'ACTIVE' | 'INACTIVE'; // Required, string.
      reason?: string;                // Optional, string.
    }
    ```
*   **Success Response:** `200 OK` (Returns the updated payment account object)
    ```json
    {
      "id": "uuid",
      "tenantId": "uuid",
      "name": "Active Account",
      "type": "CASH",
      "status": "INACTIVE",
      "openingBalance": 0,
      "createdBy": "uuid",
      "createdAt": "2026-02-11T...",
      "updatedAt": "2026-02-11T...",
      "_computed": {
        "currentBalance": 0,
        "totalIn": 0,
        "totalOut": 0,
        "lastTransactionDate": null
      }
    }
    ```
*   **Error Responses:**
    *   `400 Bad Request`: Validation failed.
    *   `401 Unauthorized`: Missing or invalid JWT.
    *   `404 Not Found`: Payment account not found, or account belongs to another tenant.
    *   `409 Conflict`: (Potentially, if account has non-zero balance and cannot be inactivated. This specific check is not implemented in Phase 3, as `_computed.currentBalance` is always 0.)

---

## Reports

All report endpoints require `Authorization: Bearer <token>` and the user role must be `OWNER` or `ADMIN`.

**Base path:** `/api/v1/reports`

---

### `GET /api/v1/reports/profit-loss`

Returns a Profit & Loss summary for the specified date range. Revenue figures come from posted `SALE` and `CUSTOMER_RETURN` transactions. COGS is sourced from `inventory_movements` (actual unit cost at time of movement), not from transaction line `costTotal`.

**Query Parameters:**

| Parameter  | Required | Format     | Description                    |
|------------|----------|------------|--------------------------------|
| `dateFrom` | Yes      | YYYY-MM-DD | Start date (inclusive)         |
| `dateTo`   | Yes      | YYYY-MM-DD | End date (inclusive, ≥ dateFrom) |

**Response `200 OK`:**
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

**Field notes:**
- `sales` — SUM of `totalAmount` from POSTED SALE transactions in date range
- `salesReturns` — SUM of `totalAmount` from POSTED CUSTOMER_RETURN transactions in date range
- `netRevenue` = `sales` - `salesReturns`
- `costOfGoodsSold` — net COGS from inventory_movements: SALE_OUT cost minus CUSTOMER_RETURN_IN cost
- `grossProfit` = `netRevenue` - `costOfGoodsSold`
- `grossProfitMargin` — percentage to 2 decimal places; 0 when `netRevenue` = 0

**Error Responses:**
- `400 Bad Request` — missing or invalid `dateFrom`/`dateTo`, or `dateTo` before `dateFrom`
- `401 Unauthorized`

---

### `GET /api/v1/reports/inventory-valuation`

Returns inventory valuation for all active products and their active variants as of a point-in-time date. Returns all active products in one response (no pagination).

**Query Parameters:**

| Parameter  | Required | Format     | Description                              |
|------------|----------|------------|------------------------------------------|
| `asOfDate` | No       | YYYY-MM-DD | Defaults to today in tenant's timezone   |

**Response `200 OK`:**
```json
{
  "asOfDate": "2026-02-20",
  "grandTotalValue": 1500000,
  "products": [
    {
      "productId": "uuid",
      "productName": "Cotton T-Shirt",
      "sku": "CT-001",
      "category": "Apparel",
      "variants": [
        {
          "variantId": "uuid",
          "size": "M",
          "sku": "CT-001-M",
          "qtyOnHand": 50,
          "avgCost": 800,
          "totalValue": 40000
        },
        {
          "variantId": "uuid",
          "size": "L",
          "sku": "CT-001-L",
          "qtyOnHand": 30,
          "avgCost": 800,
          "totalValue": 24000
        }
      ],
      "productTotalQty": 80,
      "productTotalValue": 64000
    }
  ]
}
```

**Field notes:**
- `qtyOnHand` — net stock from inventory_movements up to `asOfDate` (purchases + customer returns + adjustments in − sales − supplier returns − adjustments out)
- `avgCost` — (net purchase cost) / (net purchase qty), rounded to nearest integer; 0 if no purchases
- `totalValue` = `qtyOnHand` × `avgCost` per variant
- `grandTotalValue` = sum of all `productTotalValue`

**Error Responses:**
- `400 Bad Request` — invalid `asOfDate` format
- `401 Unauthorized`

---

### `GET /api/v1/reports/trial-balance`

Returns a point-in-time trial balance assembled from AR/AP ledger entries, payment account balances, and net inventory value.

**Auth:** JWT Bearer — OWNER or ADMIN

**Query Parameters:**

| Parameter  | Required | Format     | Description                            |
|------------|----------|------------|----------------------------------------|
| `asOfDate` | No       | YYYY-MM-DD | Defaults to today in tenant's timezone |

**Response `200 OK`:**
```json
{
  "asOfDate": "2026-02-20",
  "accounts": [
    { "name": "Accounts Receivable", "debit": 150000, "credit": 0 },
    { "name": "Accounts Payable",    "debit": 0,      "credit": 200000 },
    { "name": "Main Cash",           "debit": 85000,  "credit": 0 },
    { "name": "HBL Business",        "debit": 0,      "credit": 30000 },
    { "name": "Inventory",           "debit": 450000, "credit": 0 }
  ],
  "totalDebit": 685000,
  "totalCredit": 230000
}
```

**Field notes:**
- **Accounts Receivable** — net of `AR_INCREASE − AR_DECREASE` from posted `ledger_entries` up to `asOfDate`
- **Accounts Payable** — net of `AP_INCREASE − AP_DECREASE` from posted `ledger_entries` up to `asOfDate`; shown as credit when positive
- **Payment accounts** — one entry per active payment account; balance = `openingBalance + totalIn − totalOut` from posted `payment_entries`. Positive balance → debit; negative → credit
- **Inventory** — net value from `inventory_movements` up to `asOfDate` (purchase/adjustment/return-in cost minus sale/return-out/adjustment-out cost)
- Accounts with a zero balance are omitted from the response
- `totalDebit` / `totalCredit` are sums of all debit/credit entries respectively (not necessarily equal — this is not a double-entry system)

**Error Responses:**
- `401 Unauthorized`

---

## Transactions

The transactions module handles all financial transaction types. Every transaction goes through a two-step flow: **Draft → Post**.

**Auth:** All endpoints require JWT Bearer. All data is automatically scoped to the authenticated tenant.

**Transaction types:** `PURCHASE`, `SALE`, `SUPPLIER_PAYMENT`, `CUSTOMER_PAYMENT`, `SUPPLIER_RETURN`, `CUSTOMER_RETURN`, `INTERNAL_TRANSFER`, `ADJUSTMENT`

**Transaction statuses:** `DRAFT`, `POSTED`, `VOIDED`

---

### `POST /api/v1/transactions/purchases/draft`

Creates a DRAFT purchase transaction.

**Request Body:**
```typescript
{
  supplierId: string;       // UUID, required, must be ACTIVE
  transactionDate: string;  // YYYY-MM-DD, not in future
  lines: Array<{
    variantId: string;      // UUID, must be ACTIVE
    quantity: number;       // ≥ 1
    unitCost: number;       // ≥ 1 (PKR integer)
    discountAmount?: number; // ≥ 0, default 0
  }>;
  deliveryFee?: number;     // ≥ 0, default 0
  notes?: string;           // max 1000 chars
  idempotencyKey?: string;  // max 64 chars — resends same response if duplicate
}
```

**Success Response:** `201 Created` — full transaction object with `transactionLines[]`.

---

### `POST /api/v1/transactions/sales/draft`

Creates a DRAFT sale transaction.

**Request Body:**
```typescript
{
  customerId: string;
  transactionDate: string;
  lines: Array<{
    variantId: string;
    quantity: number;
    unitPrice: number;       // ≥ 1
    discountAmount?: number;
  }>;
  deliveryFee?: number;
  deliveryType?: string;     // e.g. "HOME_DELIVERY"
  deliveryAddress?: string;  // max 500 chars
  notes?: string;
  idempotencyKey?: string;
}
```

**Success Response:** `201 Created`

---

### `POST /api/v1/transactions/supplier-payments/draft`

Creates a DRAFT supplier payment (no lines — payment is a header-only transaction).

**Request Body:**
```typescript
{
  supplierId: string;
  amount: number;            // ≥ 1
  paymentAccountId: string;  // UUID, must be ACTIVE
  transactionDate: string;
  notes?: string;
  idempotencyKey?: string;
}
```

---

### `POST /api/v1/transactions/customer-payments/draft`

Same as supplier payment, but for customers. `customerId` instead of `supplierId`.

---

### `POST /api/v1/transactions/supplier-returns/draft`

Creates a DRAFT supplier return. Each line references a source purchase line.

**Request Body:**
```typescript
{
  supplierId: string;
  transactionDate: string;
  lines: Array<{
    sourceTransactionLineId: string; // UUID — must be from a POSTED PURCHASE for this supplier
    quantity: number;                // ≥ 1, ≤ returnableQty
  }>;
  notes?: string;
  idempotencyKey?: string;
}
```

**Validation:** `quantity` per line cannot exceed `returnableQty` (original qty minus already-returned in other posted returns).

---

### `POST /api/v1/transactions/customer-returns/draft`

Same as supplier return, but source lines must be from POSTED SALEs for the given customer.

---

### `POST /api/v1/transactions/internal-transfers/draft`

Creates a DRAFT internal transfer between two payment accounts.

**Request Body:**
```typescript
{
  fromPaymentAccountId: string; // must be ACTIVE, ≠ toPaymentAccountId
  toPaymentAccountId: string;   // must be ACTIVE
  amount: number;               // ≥ 1
  transactionDate: string;
  notes?: string;
  idempotencyKey?: string;
}
```

---

### `POST /api/v1/transactions/adjustments/draft`

Creates a DRAFT stock adjustment. Requires OWNER or ADMIN role.

**Request Body:**
```typescript
{
  transactionDate: string;
  lines: Array<{
    variantId: string;
    quantity: number;          // ≥ 1
    direction: 'IN' | 'OUT';
    reason: string;            // max 500 chars
  }>;
  notes?: string;
  idempotencyKey?: string;
}
```

---

### `POST /api/v1/transactions/:id/post`

Posts (finalises) a DRAFT transaction, creating ledger entries, inventory movements, and payment entries. Idempotent via `idempotencyKey`.

**Path Params:** `id: string` (transaction UUID)

**Request Body:**
```typescript
{
  idempotencyKey: string;
  paidNow?: number;            // PURCHASE only — amount paid at posting time
  receivedNow?: number;        // SALE only
  paymentAccountId?: string;   // required if paidNow/receivedNow > 0
  allocations?: Array<{        // PAYMENT types — manual allocation to open documents
    transactionId: string;
    amount: number;
  }>;
  returnHandling?: 'REFUND_NOW' | 'STORE_CREDIT'; // CUSTOMER_RETURN only
}
```

**Success Response:** `200 OK` — posted transaction object with `documentNumber` populated.

---

### `GET /api/v1/transactions`

Returns a paginated list of transactions for the authenticated tenant.

**Query Parameters:**

| Parameter     | Required | Description |
|---------------|----------|-------------|
| `page`        | No       | Default 1 |
| `limit`       | No       | Default 20, max 100 |
| `type`        | No       | Filter by transaction type enum |
| `status`      | No       | `DRAFT` / `POSTED` / `VOIDED` |
| `dateFrom`    | No       | YYYY-MM-DD |
| `dateTo`      | No       | YYYY-MM-DD |
| `supplierId`  | No       | UUID — filter by specific supplier |
| `customerId`  | No       | UUID — filter by specific customer |
| `partySearch` | No       | Text — case-insensitive search across supplier AND customer names |
| `productId`   | No       | UUID — filter transactions containing this product in any line |
| `sortBy`      | No       | `transactionDate` (default), `createdAt`, `totalAmount` |
| `sortOrder`   | No       | `asc`, `desc` (default) |

**Response:** Paginated list. Each item includes `supplier: { id, name }` and `customer: { id, name }` (nullable).

---

### `GET /api/v1/transactions/:id`

Returns full transaction detail including lines, inventory movements, ledger entries, payment entries, supplier, and customer.

---

### `PATCH /api/v1/transactions/:id`

Edits a DRAFT transaction. The type of the transaction determines which fields are editable.

**Path Params:** `id: string` (transaction UUID, must be DRAFT status)

**Request Body:** `PatchTransactionDto` — all fields optional, at least one required:
```typescript
{
  transactionDate?: string;
  notes?: string;
  supplierId?: string;             // PURCHASE, SUPPLIER_PAYMENT
  customerId?: string;             // SALE, CUSTOMER_PAYMENT
  deliveryFee?: number;            // PURCHASE, SALE
  deliveryType?: string;           // SALE only
  deliveryAddress?: string;        // SALE only
  amount?: number;                 // PAYMENT types, INTERNAL_TRANSFER
  fromPaymentAccountId?: string;   // PAYMENT types, INTERNAL_TRANSFER
  toPaymentAccountId?: string;     // INTERNAL_TRANSFER only
  lines?: Array<{
    // For PURCHASE, SALE, ADJUSTMENT — full line replacement (deleteMany + createMany)
    variantId?: string;
    quantity?: number;
    unitCost?: number;             // PURCHASE
    unitPrice?: number;            // SALE
    discountAmount?: number;
    direction?: 'IN' | 'OUT';     // ADJUSTMENT only
    reason?: string;               // ADJUSTMENT only
    // For RETURN types — per-line quantity update only
    lineId?: string;               // Required for RETURN types — existing line to update
  }>;
}
```

**Behaviour by type:**
- `PURCHASE` / `SALE`: full line replacement when `lines` provided; totals recomputed
- `SUPPLIER_RETURN` / `CUSTOMER_RETURN`: `lines[].lineId` + `lines[].quantity` only; `sourceTransactionLineId` is immutable; returnable qty re-validated
- `SUPPLIER_PAYMENT` / `CUSTOMER_PAYMENT`: header + amount only (no lines)
- `INTERNAL_TRANSFER`: header + amount + both account IDs
- `ADJUSTMENT`: full line replacement

**Error Responses:**
- `400 Bad Request`: Not a DRAFT, no fields provided, or attempting to add lines to a return.
- `404 Not Found`: Transaction or line not found.
- `422 Unprocessable Entity`: Variant/party inactive, or quantity exceeds returnable qty (for returns).

---

### `DELETE /api/v1/transactions/:id`

Deletes a DRAFT transaction and all its child records (lines, movements, ledger entries, payment entries, allocations).

**Path Params:** `id: string` (transaction UUID, must be DRAFT status)

**Success Response:** `200 OK` — `{ "message": "Transaction deleted" }`

**Error Responses:**
- `400 Bad Request`: Transaction is not a DRAFT.
- `404 Not Found`: Transaction not found.

---

### `GET /api/v1/transactions/:id/returnable-lines`

Returns the returnable quantity per line for a POSTED PURCHASE or SALE. Used by the supplier/customer return creation screens to pre-fill "Already Returned" and "Returnable Qty" columns.

**Path Params:** `id: string` (UUID of a POSTED PURCHASE or SALE transaction)

**Success Response:** `200 OK`
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

**Error Responses:**
- `400 Bad Request`: Transaction is not a POSTED PURCHASE or SALE.
- `404 Not Found`: Transaction not found.

---

### `GET /api/v1/transactions/allocations`

Returns payment allocations for a transaction. Filter by `purchaseId` or `saleId`.

**Query Parameters:** `purchaseId?: string`, `saleId?: string`, `page?`, `limit?`

---

## Users

User management within a tenant. All endpoints require JWT Bearer.

---

### `GET /api/v1/users`

Returns a paginated list of users in the authenticated tenant. Available to OWNER and ADMIN.

**Query Parameters:**

| Parameter | Required | Default  | Description |
|-----------|----------|----------|-------------|
| `status`  | No       | `ACTIVE` | `ACTIVE`, `INACTIVE`, or `ALL` |
| `page`    | No       | 1        | |
| `limit`   | No       | 20       | |

**Response `200 OK`:**
```json
{
  "data": [
    {
      "id": "uuid",
      "tenantId": "uuid",
      "fullName": "Jane Smith",
      "email": "jane@example.com",
      "role": "ADMIN",
      "status": "ACTIVE",
      "createdAt": "2026-02-01T10:00:00.000Z"
    }
  ],
  "meta": { "page": 1, "limit": 20, "total": 3, "totalPages": 1 }
}
```

**Note:** `passwordHash` is never included in the response.

---

### `PATCH /api/v1/users/:id/role`

Changes a user's role. **OWNER role required.** Cannot change your own role.

**Path Params:** `id: string` (user UUID)

**Request Body:**
```typescript
{ role: 'OWNER' | 'ADMIN'; reason?: string }
```

**Success Response:** `200 OK` — updated user object.

**Error Responses:**
- `403 Forbidden`: Caller is not OWNER, or attempting to change own role.
- `404 Not Found`: User not found.

---

### `PATCH /api/v1/users/:id/status`

Activates or deactivates a user. **OWNER role required.** Cannot deactivate yourself or the last active OWNER.

**Path Params:** `id: string` (user UUID)

**Request Body:**
```typescript
{ status: 'ACTIVE' | 'INACTIVE'; reason?: string }
```

**Success Response:** `200 OK` — updated user object.

**Error Responses:**
- `400 Bad Request`: Cannot deactivate the last active OWNER.
- `403 Forbidden`: Attempting to change own status.
- `404 Not Found`: User not found.
