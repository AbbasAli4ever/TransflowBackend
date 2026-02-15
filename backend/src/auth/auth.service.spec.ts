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
      refreshToken: {
        create: jest.fn(),
        findUnique: jest.fn(),
        updateMany: jest.fn(),
      },
      $transaction: jest.fn(),
    };

    jwt = {
      signAsync: jest.fn(async () => 'token'),
      verifyAsync: jest.fn(),
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

  it('register throws on duplicate email (P2002 from DB constraint)', async () => {
    const p2002 = Object.assign(new Error('Unique constraint'), { code: 'P2002' });
    prisma.$transaction.mockRejectedValue(p2002);

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
    prisma.refreshToken.create.mockResolvedValue({});

    const result = await service.register({
      tenantName: 'Tenant',
      fullName: 'User',
      email: 'user@example.com',
      password: 'Password1',
    });

    expect(result.user.email).toBe('user@example.com');
    expect(jwt.signAsync).toHaveBeenCalled();
  });

  it('login rejects with Authentication failed when user not found', async () => {
    prisma.user.findFirst.mockResolvedValue(null as any);

    await expect(
      service.login({ email: 'user@example.com', password: 'bad' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('login rejects with Authentication failed for invalid password', async () => {
    prisma.user.findFirst.mockResolvedValue({
      id: 'user-1', tenantId: 'tenant-1', email: 'user@example.com',
      passwordHash: 'hashed', status: 'ACTIVE', role: 'OWNER',
      tenant: { id: 'tenant-1', status: 'ACTIVE' },
    } as any);

    await expect(
      service.login({ email: 'user@example.com', password: 'wrong-password' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('login rejects with Authentication failed for inactive user', async () => {
    prisma.user.findFirst.mockResolvedValue({
      id: 'user-1', tenantId: 'tenant-1', email: 'user@example.com',
      passwordHash: 'hashed', status: 'INACTIVE', role: 'OWNER',
      tenant: { id: 'tenant-1', status: 'ACTIVE' },
    } as any);

    await expect(
      service.login({ email: 'user@example.com', password: 'valid-password' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  describe('refresh', () => {
    it('rejects invalid JWT signature', async () => {
      jwt.verifyAsync.mockRejectedValue(new Error('invalid token'));
      await expect(service.refresh('bad-token')).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('rejects revoked token', async () => {
      jwt.verifyAsync.mockResolvedValue({ userId: 'u1', tenantId: 't1', email: 'e', role: 'OWNER' });
      prisma.refreshToken.findUnique.mockResolvedValue({ revokedAt: new Date(), expiresAt: new Date(Date.now() + 1000) });
      await expect(service.refresh('valid-but-revoked')).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('issues new access token for valid token', async () => {
      jwt.verifyAsync.mockResolvedValue({ userId: 'u1', tenantId: 't1', email: 'e', role: 'OWNER' });
      prisma.refreshToken.findUnique.mockResolvedValue({ revokedAt: null, expiresAt: new Date(Date.now() + 86400000) });
      const result = await service.refresh('valid-token');
      expect(result.accessToken).toBe('token');
    });
  });

  describe('logout', () => {
    it('revokes the refresh token', async () => {
      prisma.refreshToken.updateMany.mockResolvedValue({ count: 1 });
      await service.logout('some-token');
      expect(prisma.refreshToken.updateMany).toHaveBeenCalled();
    });
  });
});
