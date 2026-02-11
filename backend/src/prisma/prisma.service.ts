import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

// NOTE: Prisma v5+ removed $use middleware. Tenant scoping is enforced at:
//   1. HTTP layer — TenantScopeGuard validates JWT tenantId on every request
//   2. Service layer — each service method must include tenantId in WHERE clauses
// Phase 2: consider Prisma Client Extensions ($extends) for query-level auto-scoping.

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
