# Deployment Guide

> **Status**: This guide outlines the **planned** deployment strategy for the Finance System.
> **Note**: The actual deployment assets (Dockerfiles, docker-compose configurations, CI/CD pipelines, and backup/restore scripts) for Phase 7d have been **deferred for later implementation**. This guide serves as a blueprint until those assets are created.

---

## 1. Overview

This document provides instructions for building, configuring, and deploying the Finance System backend application using Docker. The recommended approach is to use the provided `Dockerfile` to create a production-ready container image.

## 2. Prerequisites

- Docker installed on the deployment server.
- A running PostgreSQL database instance accessible from the deployment environment.
- A configured `.env` file containing all required environment variables.

---

## 3. Building the Docker Image

Once the `Dockerfile` is present in the `backend/` directory, you can build the production image with the following command:

```bash
# Navigate to the project root
docker build -t finance-system-backend -f backend/Dockerfile .
```

---

## 4. Configuration

The application is configured entirely through environment variables, following the 12-Factor App methodology.

### 4.1. Environment Variables

Create a `.env` file in your deployment directory. You can use `backend/.env.example` as a template.

**Critical Production Variables:**

| Variable | Example Value | Purpose |
|---|---|---|
| `NODE_ENV` | `production` | Enables production optimizations in NestJS. |
| `PORT` | `3000` | The port the application will listen on inside the container. |
| `DATABASE_URL` | `postgresql://user:pass@host:5432/dbname` | Connection string for the PostgreSQL database. |
| `JWT_SECRET` | `a-very-strong-and-long-secret-key` | Secret for signing JWT access tokens. **Must be changed.** |
| `JWT_REFRESH_SECRET` | `another-very-strong-secret-key` | Secret for signing JWT refresh tokens. **Must be changed.** |
| `CORS_ORIGIN` | `https://your-frontend-app.com` | The origin of your frontend application. |

### 4.2. Database Migrations

Before running the application for the first time, or after an update that includes a schema change, you must run the database migrations.

This command should be run in an environment that can connect to the production database:

```bash
# From within the backend directory of the project
DATABASE_URL="<your-production-db-url>" npx prisma migrate deploy
```

In a containerized environment, this is often handled as an `initContainer` in Kubernetes or as a one-off command before the main application container starts.

---

## 5. Running the Application

### 5.1. Using Docker Compose (Recommended)

Once a production-ready `docker-compose.prod.yml` file exists, you can start the application and its database with:

```bash
# Ensure your .env file is present and configured
docker-compose -f docker-compose.prod.yml up -d
```

### 5.2. Using `docker run` (Manual)

If you are not using Docker Compose, you can run the application container manually.

```bash
docker run -d \
  --name finance-backend \
  -p 3000:3000 \
  --env-file ./.env \
  --restart unless-stopped \
  finance-system-backend
```
*This command assumes your `.env` file is in the current directory.*

---

## 6. Health Checks & Monitoring

- **Health Endpoint**: The application exposes a health check endpoint at `GET /api/v1/health`. This can be used by load balancers or container orchestrators to verify the application's status.
- **Logging**: The application outputs structured (JSON) logs to `stdout`. It is expected that a log aggregation service (like CloudWatch, ELK Stack, etc.) will be used to collect, store, and search these logs in a production environment.

---

## 7. Backup and Recovery

Manual backup and restore can be performed using the `pg_dump` and `psql` utilities. Automated backup procedures should be configured.

**To Create a Backup:**
```bash
# Example using pg_dump
pg_dump "YOUR_DATABASE_URL" | gzip > backup-$(date +%F).sql.gz
```

**To Restore from a Backup:**
```bash
# Example using psql
gunzip -c <backup_file>.sql.gz | psql "YOUR_DATABASE_URL"
```

It is highly recommended to use a managed database service that provides automated, point-in-time recovery features.
