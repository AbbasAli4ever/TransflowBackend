import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { getContext } from '../request-context';

export const Tenant = createParamDecorator((data: unknown, ctx: ExecutionContext) => {
  const store = getContext();
  if (store?.tenantId) {
    return store.tenantId;
  }

  const request = ctx.switchToHttp().getRequest();
  return request?.user?.tenantId;
});
