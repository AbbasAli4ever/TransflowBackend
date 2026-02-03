# Tech Stack

This document defines the selected stack and hosting for V1.

## Backend

- Node.js + NestJS (REST API)
- Prisma ORM
- class-validator
- Auth: email + password (bcrypt)

## Database

- PostgreSQL (AWS RDS)
- Automated backups + point-in-time recovery

## Frontend

- Next.js
- shadcn/ui + Tailwind
- API client: fetch/axios with typed DTOs

## Hosting (Production)

- AWS App Runner for backend
- AWS RDS for Postgres
- S3 + CloudFront for static assets
- Secrets Manager or App Runner secrets
- CloudWatch for logs

## Development

- Local Docker Postgres
- Optional EC2 for dev
