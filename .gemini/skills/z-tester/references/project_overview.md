# Project Overview - Finance System

## Core Purpose
A transaction-ledger system for small businesses with a strong focus on accounting integrity. It follows an event-sourced architecture where business actions are recorded as immutable events, and balances are derived from these events.

## Architecture
- **Backend:** Node.js (NestJS framework), Prisma ORM, PostgreSQL database.
- **Frontend:** Next.js (shadcn/ui, Tailwind CSS) - *Note: Frontend details are less relevant for backend testing.*

## System Invariants (Non-Negotiable Core Principles)

### 1. Truth Model (Accounting Engine)
- **Event → Entries Only**: All business actions create a `Transaction` (event) and post derived entries (`ledger_entries`, `inventory_movements`, `payment_entries`). No direct balance mutation.
- **Append-Only Entries**: `ledger_entries`, `payment_entries`, `inventory_movements` are strictly append-only. NEVER edited in-place.
- **Balances are Derived**: Supplier/Customer/Payment balances are computed from entries.
- **Atomic Posting**: Posting processes run within a single database transaction (all or nothing).
- **Idempotency**: All write endpoints are idempotent using an idempotency key per tenant.

### 2. Transaction Lifecycle
- **Explicit States**: Draft → Posted → (Voided in V1.1).
- **No Hard Deletes for Posted**: Drafts can be deleted, Posted transactions cannot.
- **Stable Document Numbering**: Every posted transaction has an immutable `document_number`, unique per tenant+type+series.

### 3. Data Integrity
- **Money Stored as Integers**: Money values are stored as integers to avoid floating-point issues.
- **Referential Integrity**: No orphans. Every entry references its transaction event. Mandatory `created_by`, `created_at` audit trail.

### 4. Tenant Isolation (CRITICAL)
- **Tenant Scoping**: Every record MUST have a `tenant_id`, and this must be enforced at the database query level (either via Prisma extensions/middleware or explicit `WHERE` clauses in every service query).
- **Zero Cross-Tenant Leakage**: Absolutely no data from one tenant should be accessible or modifiable by another.

## Key Implementation Phases (relevant to zTester)

### Phase 1: Backend Foundation & Production Skeleton
- **Objective:** Establish a production-ready backend skeleton, proving infrastructure, authentication, and tenant scoping.
- **Key Features:** NestJS structure, Prisma setup, Authentication (email/password), **Tenant Scoping Middleware**, Global Error Handling, Request Validation, Structured Logging, Health Checks, API Security Baseline.
- **Testing Focus:** Verification of core infrastructure, robust authentication flows (register/login), and **strict tenant isolation enforcement at every layer**.

### Phase 2: Schema V1 + Constraints + Indexes
- **Objective:** Implement the complete database schema with all integrity constraints, indexes, and validation rules to enforce business rules at the database level.
- **Key Features:** All 14 core tables, foreign key constraints, unique constraints, check constraints (where applicable), indexes.
- **Testing Focus:** Verify all database constraints, ensure referential integrity, confirm unique constraints prevent data corruption, and validate index performance assumptions (if test data available).

### Phase 3: Master Data APIs (Supplier, Customer, Product, Payment Account)
- **Objective:** Build CRUD (Create, Read, Update, Delete) endpoints for foundational master data entities.
- **Key Features:** APIs for Suppliers, Customers, Products, Payment Accounts; data validation; soft delete (status=INACTIVE); list endpoints with filtering, sorting, pagination.
- **Testing Focus:** Comprehensive CRUD testing, validation robustness, pagination/filtering correctness, and **critical tenant scoping on all API operations to prevent cross-tenant data access/modification**. Ensure soft delete works as expected.

---

*This document provides a high-level overview. For detailed specifications, refer to `Documentation/IMPLEMENTATION_PLAN.md` and `Documentation/01-architecture.md`.*