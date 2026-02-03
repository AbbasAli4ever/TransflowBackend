import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient, Prisma } from '@prisma/client';
import { getContext } from '../common/request-context';

const TENANT_SCOPED_MODELS = new Set<Prisma.ModelName>(['User']);

function shouldScopeTenant(model?: Prisma.ModelName) {
  return model ? TENANT_SCOPED_MODELS.has(model) : false;
}

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit() {
    const prismaAny = this as any;
    prismaAny.$use(async (params: any, next: (params: any) => Promise<any>) => {
      if (!params.model || !shouldScopeTenant(params.model)) {
        return next(params);
      }

      const tenantId = getContext()?.tenantId;
      if (!tenantId) {
        return next(params);
      }

      params.args = params.args ?? {};

      if (params.action === 'findMany' || params.action === 'findFirst') {
        params.args.where = { ...(params.args.where ?? {}), tenantId };
      }

      if (params.action === 'updateMany' || params.action === 'deleteMany') {
        params.args.where = { ...(params.args.where ?? {}), tenantId };
      }

      if (params.action === 'update' || params.action === 'delete') {
        params.args.where = { ...(params.args.where ?? {}), tenantId };
      }

      if (params.action === 'create') {
        params.args.data = { ...(params.args.data ?? {}), tenantId };
      }

      return next(params);
    });

    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
