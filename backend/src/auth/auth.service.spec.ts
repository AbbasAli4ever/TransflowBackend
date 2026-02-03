import { AuthService } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { ConflictException, UnauthorizedException } from '@nestjs/common';

jest.mock('bcrypt', () => ({
  hash: jest.fn(async () => 'hashed-password'),
  compare: jest.fn(async (value: string) => value === 'valid-password'),
}));

describe('AuthService', () => {
  let service: AuthService;
  let prisma: any;
  let jwt: any;
  let config: any;

  beforeEach(() => {
    prisma = {
      user: {
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      tenant: {
        create: jest.fn(),
      },
      $transaction: jest.fn(),
    };

    jwt = {
      signAsync: jest.fn(async () => 'token'),
    };

    config = {
      get: jest.fn((key: string) => {
        if (key === 'auth.jwtRefreshSecret') return 'refresh-secret';
        if (key === 'auth.jwtRefreshExpiration') return '7d';
        return undefined;
      }),
    };

    service = new AuthService(prisma as PrismaService, jwt as JwtService, config as ConfigService);
  });

  it('register throws on duplicate email', async () => {
    prisma.user.findFirst.mockResolvedValue({ id: 'user-1' } as any);

    await expect(
      service.register({
        tenantName: 'Tenant',
        fullName: 'User',
        email: 'user@example.com',
        password: 'Password1',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('register creates tenant and user', async () => {
    prisma.user.findFirst.mockResolvedValue(null as any);

    const txMock = {
      tenant: {
        create: jest.fn().mockResolvedValue({ id: 'tenant-1', name: 'Tenant' }),
      },
      user: {
        create: jest.fn().mockResolvedValue({
          id: 'user-1',
          tenantId: 'tenant-1',
          fullName: 'User',
          email: 'user@example.com',
          role: 'OWNER',
        }),
      },
    } as any;

    prisma.$transaction.mockImplementation(async (fn: any) => fn(txMock));

    const result = await service.register({
      tenantName: 'Tenant',
      fullName: 'User',
      email: 'user@example.com',
      password: 'Password1',
    });

    expect(result.user.email).toBe('user@example.com');
    expect(jwt.signAsync).toHaveBeenCalled();
  });

  it('login rejects invalid credentials', async () => {
    prisma.user.findFirst.mockResolvedValue(null as any);

    await expect(
      service.login({ email: 'user@example.com', password: 'bad' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
