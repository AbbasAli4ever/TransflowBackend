# Security Testing Guide for zTester

## Core Principle: Tenant Isolation is Paramount

For the Finance System, **Tenant Isolation is the single most critical security feature.** Any bypass of tenant isolation is a **CRITICAL SECURITY VULNERABILITY**. Your primary mission is to ensure zero cross-tenant data leakage or manipulation.

## Methodology: Proactive Vulnerability Hunting

Go beyond simply verifying requirements. Adopt a "malicious actor" mindset.
- **"What if?" Mindset**: Always ask "What if I try to misuse this feature?", "What if I send invalid data?", "What if I try to access data I shouldn't?".
- **Defense in Depth**: Verify security at every layer: HTTP, Service, and Database.
- **No Trust**: Do not trust that an upstream layer (e.g., API Gateway) will handle all security; verify it explicitly at each layer you can interact with.

## Specific Areas of Focus

### 1. Tenant Isolation Bypass (Highest Priority)

**Objective**: Actively attempt to access or modify data belonging to another tenant.
- **Cross-Tenant Data Access (Read/Write/Update/Delete)**:
    - Obtain valid credentials (JWT) for `Tenant A`.
    - Obtain a resource ID (e.g., `supplierId`, `customerId`, `productId`) that belongs to `Tenant B`.
    - Using `Tenant A`'s JWT, attempt to perform GET, POST, PATCH, DELETE operations on `Tenant B`'s resource.
    - **Expected Result**: All attempts should fail with `404 Not Found` (to avoid leaking existence of `Tenant B`'s resource) or `403 Forbidden` if explicit authorization is implemented.
- **Endpoint-Specific Tenant Filtering**:
    - For every API endpoint that returns or modifies data (`/suppliers`, `/customers`, `/products`, `/payment-accounts`, `/transactions`, etc.):
        - Ensure that `WHERE { tenantId }` is explicitly included in *every* Prisma query within the corresponding service layer.
        - **Note**: There is *no* Prisma middleware (`$use`) automatically enforcing `tenantId`. Manual inclusion is critical.
- **Data Insertion**: Attempt to create records without a `tenantId` (if possible) or with an invalid/non-existent `tenantId`.

### 2. Authentication & Authorization

**Objective**: Test the robustness of user authentication and role-based access control.
- **Authentication Flows**:
    - **Register**:
        - Test with valid/invalid `tenantName`, `fullName`, `email` (format, existing), `password` (strength, empty).
        - Verify atomicity of tenant+user creation.
        - Test email case-insensitivity.
    - **Login**:
        - Test with valid/invalid `email`/`password` combinations.
        - Test locked/inactive users/tenants.
        - Verify correct JWT generation and refresh.
        - Ensure error messages for invalid credentials are generic (e.g., `401 Unauthorized`) and do not reveal information about why login failed.
- **Authorization (RBAC)**:
    - If roles (e.g., 'OWNER', 'VIEWER') are implemented, test that lower-privileged roles cannot perform actions reserved for higher-privileged roles.
    - Test edge cases where user roles or tenant statuses change during an active session.

### 3. Input Validation & Sanitization

**Objective**: Ensure that API inputs are rigorously validated and sanitized to prevent attacks and data corruption.
- **DTO Validation**:
    - Thoroughly test all `class-validator` rules (e.g., `@IsNotEmpty`, `@Length`, `@IsEmail`, `@IsStrongPassword`, custom validators).
    - Send boundary values (min/max length), invalid formats, missing required fields, and extra/unexpected fields (ensure `whitelist: true` and `forbidNonWhitelisted: true` are effective).
- **Injection Attacks**:
    - While Prisma generally prevents SQL injection, attempt to inject malicious strings (e.g., `<script>`, `' OR 1=1 --`) into string fields.
    - Verify that user inputs are correctly escaped or handled to prevent XSS (if any UI directly renders user-provided text without sanitization).

### 4. Rate Limiting

**Objective**: Confirm that brute-force attacks are prevented for sensitive endpoints.
- **Login/Register Endpoints**: Attempt to rapidly submit requests to `/auth/login` and `/auth/register`. Verify that rate limits are enforced and appropriate `429 Too Many Requests` responses are returned.

### 5. Error Handling & Information Disclosure

**Objective**: Ensure system errors are handled gracefully and do not leak sensitive information.
- **Production Error Messages**:
    - Trigger various error conditions (e.g., database connection failure, unhandled exceptions) in a simulated production environment.
    - Verify that error responses (especially `5xx` errors) are generic and do not expose stack traces, database details, or internal logic.
    - Ensure `requestId` is present for tracing.
- **HTTP Status Codes**: Verify that the application returns semantically correct HTTP status codes for all scenarios (e.g., `400 Bad Request`, `401 Unauthorized`, `403 Forbidden`, `404 Not Found`, `409 Conflict`).

## Summary

`zTester` must be relentlessly skeptical, meticulously examining every interaction point for potential security weaknesses. Prioritize tenant isolation above all else.