# Non-Functional Requirements (NFRs)

This document defines performance, scalability, reliability, and retention targets. These are requirements, not suggestions.

## Performance Targets

- Posting endpoints (purchase, sale, payments): p95 < 500ms under normal load
- Balance queries: p95 < 300ms
- Dashboard summary: p95 < 700ms
- Statements (date range): p95 < 1s for typical ranges

## Scalability

- V1 target: 1,000 transactions/day per tenant
- Concurrent active users: 20 per tenant
- Support growth to 10,000 transactions/day per tenant without schema change

## Availability

- Uptime target: 99.5% for V1
- Planned maintenance window: weekends

## Data Integrity

- All posted data is append-only
- No loss of posted transactions
- Full rebuild from entries is possible

## Security

- HTTPS only
- JWT auth
- Tenant isolation enforced at query level

## Data Retention

- Posted transactions retained indefinitely
- Import batches retained for 2 years
- Audit logs retained for at least 2 years

## Backup and Recovery

- Automated backups enabled
- Quarterly restore drill

## Observability

- Logs: request, error, auth, posting
- Metrics: latency, error rate, throughput
- Alerts: high error rate, slow queries, DB connection saturation
