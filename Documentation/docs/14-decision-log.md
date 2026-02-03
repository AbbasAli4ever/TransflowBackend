# Decision Log

This log records major architectural and product decisions so future contributors understand the “why.”

## 2026-02-01

- **Weighted Average Costing (V1)**
  - Reason: simpler than FIFO and fits wholesale workflows.
- **Single-currency PKR (V1)**
  - Reason: avoids conversion complexity and aligns with target market.
- **Append-only entries**
  - Reason: auditability and accounting integrity.
- **Stack: NestJS + Prisma + Postgres + Next.js**
  - Reason: stable, fast-to-ship, and good developer ergonomics.
- **Strict returns (must link to original line)**
  - Reason: prevents over-returns and keeps audit trail clean.
