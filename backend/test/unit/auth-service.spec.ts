import { AuthService } from '../../src/auth/auth.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { hash, compare } from 'bcrypt';

// Mock bcrypt
jest.mock('bcrypt');
const mockedHash = hash as jest.MockedFunction<typeof hash>;
const mockedCompare = compare as jest.MockedFunction<typeof compare>;

describe('AuthService (Unit)', () => {
  let service: AuthService;
  let prisma: any;
  let jwtService: any;
  let configService: any;

  beforeEach(() => {
    // Create mocked dependencies with proper Jest mocks
    prisma = {
      user: {
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      tenant: {
        create: jest.fn(),
      },
      refreshToken: {
        create: jest.fn().mockResolvedValue({}),
        findUnique: jest.fn(),
        updateMany: jest.fn(),
      },
      // handles both callback form (register) and array form (login)
      $transaction: jest.fn().mockImplementation((arg: any) => {
        if (typeof arg === 'function') return arg({ tenant: { create: jest.fn() }, user: { create: jest.fn() } });
        return Promise.all(arg.map((op: any) => (typeof op?.then === 'function' ? op : Promise.resolve(op))));
      }),
    };

    jwtService = {
      signAsync: jest.fn(),
      verifyAsync: jest.fn(),
    };

    configService = {
      get: jest.fn((key: string) => {
        if (key === 'auth.jwtRefreshSecret') return 'refresh-secret-key';
        if (key === 'auth.jwtRefreshExpiration') return '7d';
        return undefined;
      }),
    };

    service = new AuthService(
      prisma as any,
      jwtService as any,
      configService as any,
    );

    // Reset mocks
    jest.clearAllMocks();
  });

  describe('register', () => {
    const validRegisterDto = {
      tenantName: 'Test Business',
      fullName: 'John Doe',
      email: 'john@example.com',
      password: 'Test123!',
    };

    it('should successfully register a new tenant and user', async () => {
      mockedHash.mockResolvedValue('hashed-password-123' as never);

      const mockTenant = { id: 'tenant-1', name: 'Test Business' };
      const mockUser = {
        id: 'user-1',
        tenantId: 'tenant-1',
        fullName: 'John Doe',
        email: 'john@example.com',
        role: 'OWNER',
      };

      prisma.$transaction.mockImplementation(async (callback: any) => {
        const txMock = {
          tenant: { create: jest.fn().mockResolvedValue(mockTenant) },
          user: { create: jest.fn().mockResolvedValue(mockUser) },
        };
        return callback(txMock);
      });

      prisma.refreshToken = { create: jest.fn().mockResolvedValue({}) };

      jwtService.signAsync
        .mockResolvedValueOnce('access-token-123')
        .mockResolvedValueOnce('refresh-token-456');

      const result = await service.register(validRegisterDto);

      expect(mockedHash).toHaveBeenCalledWith('Test123!', 12);
      expect(result).toHaveProperty('accessToken', 'access-token-123');
      expect(result).toHaveProperty('refreshToken', 'refresh-token-456');
      expect(result.user).toEqual({
        id: 'user-1',
        tenantId: 'tenant-1',
        fullName: 'John Doe',
        email: 'john@example.com',
        role: 'OWNER',
      });
    });

    it('should throw ConflictException when email already exists', async () => {
      const p2002 = Object.assign(new Error('Unique constraint'), { code: 'P2002' });
      prisma.$transaction.mockRejectedValue(p2002);
      mockedHash.mockResolvedValue('hashed' as never);

      await expect(service.register(validRegisterDto)).rejects.toThrow(ConflictException);
      await expect(service.register(validRegisterDto)).rejects.toThrow('Registration failed');
    });

    it('should trim tenant name and full name', async () => {
      mockedHash.mockResolvedValue('hashed' as never);

      let capturedTenantData: any;
      let capturedUserData: any;

      prisma.$transaction.mockImplementation(async (callback: any) => {
        const txMock = {
          tenant: {
            create: jest.fn().mockImplementation((data: any) => {
              capturedTenantData = data.data;
              return Promise.resolve({ id: 'tenant-1', ...data.data });
            }),
          },
          user: {
            create: jest.fn().mockImplementation((data: any) => {
              capturedUserData = data.data;
              return Promise.resolve({ id: 'user-1', ...data.data });
            }),
          },
        };
        return callback(txMock);
      });

      prisma.refreshToken = { create: jest.fn().mockResolvedValue({}) };
      jwtService.signAsync.mockResolvedValue('token' as never);

      await service.register({
        tenantName: '  Test Business  ',
        fullName: '  John Doe  ',
        email: 'john@example.com',
        password: 'Test123!',
      });

      expect(capturedTenantData.name).toBe('Test Business');
      expect(capturedUserData.fullName).toBe('John Doe');
    });
  });

  describe('login', () => {
    const validLoginDto = {
      email: 'john@example.com',
      password: 'Test123!',
    };

    const mockUser = {
      id: 'user-1',
      tenantId: 'tenant-1',
      fullName: 'John Doe',
      email: 'john@example.com',
      passwordHash: 'hashed-password',
      role: 'OWNER',
      status: 'ACTIVE',
      tenant: {
        id: 'tenant-1',
        name: 'Test Business',
        baseCurrency: 'PKR',
        timezone: 'Asia/Karachi',
        status: 'ACTIVE',
      },
    };

    it('should successfully login with valid credentials', async () => {
      prisma.user.findFirst.mockResolvedValue(mockUser as any);
      mockedCompare.mockResolvedValue(true as never);
      prisma.$transaction.mockImplementation((arr: any[]) =>
        Promise.all(arr.map((op: any) => (typeof op?.then === 'function' ? op : Promise.resolve(op)))),
      );
      prisma.refreshToken = { create: jest.fn().mockResolvedValue({}) };

      jwtService.signAsync
        .mockResolvedValueOnce('access-token')
        .mockResolvedValueOnce('refresh-token');

      const result = await service.login(validLoginDto);

      expect(result).toHaveProperty('accessToken', 'access-token');
      expect(result).toHaveProperty('refreshToken', 'refresh-token');
      expect(result.user.tenant).toEqual({
        id: 'tenant-1',
        name: 'Test Business',
        baseCurrency: 'PKR',
        timezone: 'Asia/Karachi',
      });
    });

    it('should throw UnauthorizedException when user does not exist', async () => {
      prisma.user.findFirst.mockResolvedValue(null);

      await expect(service.login(validLoginDto)).rejects.toThrow(UnauthorizedException);
      await expect(service.login(validLoginDto)).rejects.toThrow('Authentication failed');
    });

    it('should throw UnauthorizedException when password is incorrect', async () => {
      prisma.user.findFirst.mockResolvedValue({ ...mockUser, passwordHash: 'hashed-password' } as any);
      mockedCompare.mockResolvedValue(false as never);

      await expect(service.login(validLoginDto)).rejects.toThrow(UnauthorizedException);
      await expect(service.login(validLoginDto)).rejects.toThrow('Authentication failed');
    });

    it('should throw UnauthorizedException when user status is inactive', async () => {
      prisma.user.findFirst.mockResolvedValue({ ...mockUser, status: 'INACTIVE' } as any);

      await expect(service.login(validLoginDto)).rejects.toThrow(UnauthorizedException);
      await expect(service.login(validLoginDto)).rejects.toThrow('Authentication failed');
    });

    it('should throw UnauthorizedException when tenant status is inactive', async () => {
      prisma.user.findFirst.mockResolvedValue({
        ...mockUser,
        tenant: { ...mockUser.tenant, status: 'SUSPENDED' },
      } as any);

      await expect(service.login(validLoginDto)).rejects.toThrow(UnauthorizedException);
      await expect(service.login(validLoginDto)).rejects.toThrow('Authentication failed');
    });

    it('should handle case-insensitive email login', async () => {
      prisma.user.findFirst.mockResolvedValue(mockUser as any);
      mockedCompare.mockResolvedValue(true as never);
      prisma.$transaction.mockImplementation((arr: any[]) =>
        Promise.all(arr.map((op: any) => (typeof op?.then === 'function' ? op : Promise.resolve(op)))),
      );
      prisma.refreshToken = { create: jest.fn().mockResolvedValue({}) };
      jwtService.signAsync.mockResolvedValue('token' as never);

      await service.login({ email: 'JOHN@EXAMPLE.COM', password: 'Test123!' });

      expect(prisma.user.findFirst).toHaveBeenCalledWith({
        where: {
          email: { equals: 'john@example.com', mode: 'insensitive' },
        },
        include: { tenant: true },
      });
    });
  });

  describe('Token Generation', () => {
    it('should generate both access and refresh tokens', async () => {
      const mockUser = {
        id: 'user-1',
        tenantId: 'tenant-1',
        email: 'john@example.com',
        passwordHash: 'hashed',
        role: 'OWNER',
        status: 'ACTIVE',
        tenant: {
          id: 'tenant-1',
          name: 'Test Business',
          baseCurrency: 'PKR',
          timezone: 'Asia/Karachi',
          status: 'ACTIVE',
        },
      };

      prisma.user.findFirst.mockResolvedValue(mockUser as any);
      mockedCompare.mockResolvedValue(true as never);
      prisma.$transaction.mockImplementation((arr: any[]) =>
        Promise.all(arr.map((op: any) => (typeof op?.then === 'function' ? op : Promise.resolve(op)))),
      );
      prisma.refreshToken = { create: jest.fn().mockResolvedValue({}) };

      jwtService.signAsync
        .mockResolvedValueOnce('access-token-abc')
        .mockResolvedValueOnce('refresh-token-xyz');

      const result = await service.login({
        email: 'john@example.com',
        password: 'Test123!',
      });

      expect(jwtService.signAsync).toHaveBeenCalledTimes(2);
      expect(jwtService.signAsync).toHaveBeenNthCalledWith(1, {
        userId: 'user-1',
        tenantId: 'tenant-1',
        email: 'john@example.com',
        role: 'OWNER',
      });

      expect(jwtService.signAsync).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          userId: 'user-1',
          tenantId: 'tenant-1',
          email: 'john@example.com',
          role: 'OWNER',
          jti: expect.any(String),
        }),
        {
          secret: 'refresh-secret-key',
          expiresIn: '7d',
        },
      );
    });
  });
});
