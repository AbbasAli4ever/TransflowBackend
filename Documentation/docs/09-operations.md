# Operations and Deployment

This document defines how the system is deployed, monitored, and maintained in production. Follow these steps for repeatable and safe releases.

## Environments

- Local: Docker Postgres + local API
- Staging: AWS App Runner + RDS
- Production: AWS App Runner + RDS

## Deployment Process

1. Run database migrations
2. Build backend container
3. Deploy to App Runner
4. Run smoke tests
5. Verify logs and metrics

## Database Migrations

- Prisma migrations are the source of truth
- Each migration must be reviewed and applied in staging first
- Rollback via down migration or point-in-time restore

## Monitoring

- App Runner logs to CloudWatch
- Track: request rate, error rate, p95 latency
- Track DB: connections, slow queries, replication lag (if any)

## Backup and Restore

- RDS automated backups enabled
- Weekly verification of backups
- Quarterly restore drill

## Disaster Recovery

- Restore from latest snapshot
- Re-deploy backend container
- Validate balances using canonical queries

## Runbook Checks

- Health endpoint returns 200
- Auth login works
- Create purchase and sale smoke test
- Check balances and stock queries
