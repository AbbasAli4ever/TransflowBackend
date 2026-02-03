# Security and Access Control

This document defines authentication, authorization, and audit requirements. Even if V1 is single-owner, the model must scale to multi-user in V2 without redesign.

## Authentication

- Email + password (bcrypt)
- JWT access token
- Refresh token (recommended)
- Password policy: minimum 8 characters

## Authorization (V1)

- Role: OWNER only
- OWNER can access all features

## Authorization (Planned V2)

Roles:

- OWNER
- MANAGER
- STAFF

Example matrix:

- STAFF: create sales, create customer payments, view statements
- MANAGER: approve returns, manage products, view reports
- OWNER: full access

## Tenant Isolation

- Every table has `tenant_id`
- Every query filters by tenant_id
- No cross-tenant access

## Audit Requirements

All important records must include:

- `created_at`
- `updated_at`
- `created_by`
- `source` (UI / API / IMPORT)
- `notes`

Transactions must also include:

- `posted_at`
- `voided_at`, `voided_by`, `void_reason`
- `idempotency_key`

## Session Management

- Access tokens expire after short duration
- Refresh tokens stored securely
- Logout revokes refresh tokens

## Data Privacy

- No deletion of posted transactions
- Soft delete for master data (status = INACTIVE)
- Export data on request

## Security Defaults

- HTTPS only
- Rate limit login endpoints
- Log failed login attempts

## Future Enhancements

- Two-factor authentication (2FA)
- Role-based access control per endpoint
- IP allowlists for sensitive actions
