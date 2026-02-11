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