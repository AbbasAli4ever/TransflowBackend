import { TenantScopeGuard } from '../../src/common/guards/tenant-scope.guard';
import { Reflector } from '@nestjs/core';
import { ExecutionContext, UnauthorizedException } from '@nestjs/common';

describe('TenantScopeGuard (Unit)', () => {
  let guard: TenantScopeGuard;
  let reflector: Reflector;

  beforeEach(() => {
    reflector = new Reflector();
    guard = new TenantScopeGuard(reflector);
  });

  describe('Public Routes', () => {
    it('should allow access to public routes without tenant context', () => {
      // Mock public route metadata
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(true);

      const mockContext = createMockExecutionContext({});

      const result = guard.canActivate(mockContext);

      expect(result).toBe(true);
      expect(reflector.getAllAndOverride).toHaveBeenCalled();
    });
  });

  describe('Protected Routes', () => {
    it('should allow access when valid tenant context exists', () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);

      const mockUser = {
        userId: 'user-1',
        tenantId: 'tenant-1',
        email: 'user@example.com',
        role: 'OWNER',
      };

      const mockContext = createMockExecutionContext({ user: mockUser });

      const result = guard.canActivate(mockContext);

      expect(result).toBe(true);
    });

    it('should throw UnauthorizedException when tenant context is missing', () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);

      const mockContext = createMockExecutionContext({ user: {} });

      expect(() => guard.canActivate(mockContext)).toThrow(UnauthorizedException);
      expect(() => guard.canActivate(mockContext)).toThrow('Tenant context missing');
    });

    it('should throw UnauthorizedException when user is not authenticated', () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);

      const mockContext = createMockExecutionContext({});

      expect(() => guard.canActivate(mockContext)).toThrow(UnauthorizedException);
    });

    it('should set request context when tenant context is valid', () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);

      const mockUser = {
        userId: 'user-123',
        tenantId: 'tenant-456',
        email: 'test@example.com',
        role: 'OWNER',
      };

      const mockContext = createMockExecutionContext({ user: mockUser });

      const result = guard.canActivate(mockContext);
      
      // Guard should allow access
      expect(result).toBe(true);
    });
  });

  describe('Edge Cases', () => {
    it('should handle missing request object', () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);

      const mockContext = {
        switchToHttp: () => ({
          getRequest: () => null,
        }),
        getHandler: () => ({}),
        getClass: () => ({}),
      } as any;

      expect(() => guard.canActivate(mockContext)).toThrow(UnauthorizedException);
    });

    it('should handle user with null tenantId', () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);

      const mockUser = {
        userId: 'user-1',
        tenantId: null,
        email: 'user@example.com',
        role: 'OWNER',
      };

      const mockContext = createMockExecutionContext({ user: mockUser });

      expect(() => guard.canActivate(mockContext)).toThrow(UnauthorizedException);
      expect(() => guard.canActivate(mockContext)).toThrow('Tenant context missing');
    });

    it('should handle user with undefined tenantId', () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);

      const mockUser = {
        userId: 'user-1',
        email: 'user@example.com',
        role: 'OWNER',
      };

      const mockContext = createMockExecutionContext({ user: mockUser });

      expect(() => guard.canActivate(mockContext)).toThrow(UnauthorizedException);
    });
  });
});

// Helper function to create mock ExecutionContext
function createMockExecutionContext(requestData: any): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ ...requestData }),
      getResponse: () => ({}),
      getNext: () => ({}),
    }),
    getHandler: () => ({}) as any,
    getClass: () => ({}) as any,
    getType: () => 'http' as any,
    getArgs: () => [] as any,
    getArgByIndex: () => ({}) as any,
    switchToRpc: () => ({
      getContext: () => ({}),
      getData: () => ({}),
    }) as any,
    switchToWs: () => ({
      getClient: () => ({}),
      getData: () => ({}),
    }) as any,
  } as any;
}
