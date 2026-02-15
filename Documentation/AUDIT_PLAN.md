# Backend API Forensic Audit Plan

Source: Generated OpenAPI document from current Nest Swagger configuration.

Phase 1 — Auth
  - [ ] POST /api/v1/auth/login
  - [ ] POST /api/v1/auth/register

Phase 2 — Customers
  - [ ] GET /api/v1/customers
  - [ ] GET /api/v1/customers/{id}
  - [ ] GET /api/v1/customers/{id}/balance
  - [ ] GET /api/v1/customers/{id}/open-documents
  - [ ] PATCH /api/v1/customers/{id}
  - [ ] PATCH /api/v1/customers/{id}/status
  - [ ] POST /api/v1/customers

Phase 3 — Dashboard
  - [ ] GET /api/v1/dashboard/summary

Phase 4 — Health
  - [ ] GET /api/v1/health
  - [ ] GET /api/v1/version

Phase 5 — Payment Accounts
  - [ ] GET /api/v1/payment-accounts
  - [ ] GET /api/v1/payment-accounts/{id}
  - [ ] GET /api/v1/payment-accounts/{id}/balance
  - [ ] PATCH /api/v1/payment-accounts/{id}
  - [ ] PATCH /api/v1/payment-accounts/{id}/status
  - [ ] POST /api/v1/payment-accounts

Phase 6 — Products
  - [ ] GET /api/v1/products
  - [ ] GET /api/v1/products/{id}
  - [ ] GET /api/v1/products/{id}/stock
  - [ ] PATCH /api/v1/products/{id}
  - [ ] PATCH /api/v1/products/{id}/status
  - [ ] POST /api/v1/products

Phase 7 — Reports
  - [ ] GET /api/v1/reports/customers/{id}/balance
  - [ ] GET /api/v1/reports/customers/{id}/statement
  - [ ] GET /api/v1/reports/payment-accounts/{id}/balance
  - [ ] GET /api/v1/reports/payment-accounts/{id}/statement
  - [ ] GET /api/v1/reports/pending-payables
  - [ ] GET /api/v1/reports/pending-receivables
  - [ ] GET /api/v1/reports/products/{id}/stock
  - [ ] GET /api/v1/reports/suppliers/{id}/balance
  - [ ] GET /api/v1/reports/suppliers/{id}/statement

Phase 8 — Suppliers
  - [ ] GET /api/v1/suppliers
  - [ ] GET /api/v1/suppliers/{id}
  - [ ] GET /api/v1/suppliers/{id}/balance
  - [ ] GET /api/v1/suppliers/{id}/open-documents
  - [ ] PATCH /api/v1/suppliers/{id}
  - [ ] PATCH /api/v1/suppliers/{id}/status
  - [ ] POST /api/v1/suppliers

Phase 9 — Transactions
  - [ ] GET /api/v1/transactions
  - [ ] GET /api/v1/transactions/allocations
  - [ ] GET /api/v1/transactions/{id}
  - [ ] POST /api/v1/transactions/adjustments/draft
  - [ ] POST /api/v1/transactions/customer-payments/draft
  - [ ] POST /api/v1/transactions/customer-returns/draft
  - [ ] POST /api/v1/transactions/internal-transfers/draft
  - [ ] POST /api/v1/transactions/purchases/draft
  - [ ] POST /api/v1/transactions/sales/draft
  - [ ] POST /api/v1/transactions/supplier-payments/draft
  - [ ] POST /api/v1/transactions/supplier-returns/draft
  - [ ] POST /api/v1/transactions/{id}/post

Phase 10 — imports
  - [ ] GET /api/v1/imports
  - [ ] GET /api/v1/imports/{id}
  - [ ] POST /api/v1/imports
  - [ ] POST /api/v1/imports/{id}/commit
  - [ ] POST /api/v1/imports/{id}/map
  - [ ] POST /api/v1/imports/{id}/rollback
