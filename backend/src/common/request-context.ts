import { AsyncLocalStorage } from 'async_hooks';

export type RequestContext = {
  requestId: string;
  tenantId?: string;
  userId?: string;
  userEmail?: string;
  userRole?: string;
};

const asyncLocalStorage = new AsyncLocalStorage<RequestContext>();

export function runWithContext(context: RequestContext, callback: () => void) {
  asyncLocalStorage.run(context, callback);
}

export function getContext(): RequestContext | undefined {
  return asyncLocalStorage.getStore();
}

export function setContext(values: Partial<RequestContext>) {
  const store = asyncLocalStorage.getStore();
  if (!store) {
    return;
  }
  Object.assign(store, values);
}
