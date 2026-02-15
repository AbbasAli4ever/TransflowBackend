import { ConflictException, UnauthorizedException, Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { hash, compare } from 'bcrypt';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { createHash, randomUUID } from 'crypto';

const PASSWORD_SALT_ROUNDS = 12;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
    private config: ConfigService,
  ) {}

  async register(dto: RegisterDto) {
    const passwordHash = await hash(dto.password, PASSWORD_SALT_ROUNDS);

    let result: { tenant: any; user: any };
    try {
      result = await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        const tenant = await tx.tenant.create({
          data: {
            name: dto.tenantName.trim(),
          },
        });

        const user = await tx.user.create({
          data: {
            tenantId: tenant.id,
            fullName: dto.fullName.trim(),
            email: dto.email.toLowerCase(),
            passwordHash,
            role: 'OWNER',
          },
        });

        return { tenant, user };
      });
    } catch (e: any) {
      if (e.code === 'P2002') throw new ConflictException('Email already exists');
      throw e;
    }

    const tokens = await this.generateTokens(result.user);
    await this.storeRefreshToken(result.user.id, result.user.tenantId, tokens.refreshToken);

    return {
      ...tokens,
      user: {
        id: result.user.id,
        tenantId: result.user.tenantId,
        fullName: result.user.fullName,
        email: result.user.email,
        role: result.user.role,
      },
    };
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findFirst({
      where: {
        email: { equals: dto.email.toLowerCase(), mode: 'insensitive' },
      },
      include: { tenant: true },
    });

    if (!user) {
      this.logger.debug(`Login failed: user not found for email ${dto.email}`);
      throw new UnauthorizedException('Authentication failed');
    }

    if (user.status !== 'ACTIVE') {
      this.logger.debug(`Login failed: user ${user.id} is inactive`);
      throw new UnauthorizedException('Authentication failed');
    }

    if (user.tenant.status !== 'ACTIVE') {
      this.logger.debug(`Login failed: tenant ${user.tenantId} is inactive`);
      throw new UnauthorizedException('Authentication failed');
    }

    const valid = await compare(dto.password, user.passwordHash);
    if (!valid) {
      this.logger.debug(`Login failed: invalid password for user ${user.id}`);
      throw new UnauthorizedException('Authentication failed');
    }

    const tokens = await this.generateTokens(user);

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: user.id },
        data: { lastLoginAt: new Date() },
      }),
      this.prisma.refreshToken.create({
        data: this.buildRefreshTokenRecord(user.id, user.tenantId, tokens.refreshToken),
      }),
    ]);

    return {
      ...tokens,
      user: {
        id: user.id,
        tenantId: user.tenantId,
        fullName: user.fullName,
        email: user.email,
        role: user.role,
        tenant: {
          id: user.tenant.id,
          name: user.tenant.name,
          baseCurrency: user.tenant.baseCurrency,
          timezone: user.tenant.timezone,
        },
      },
    };
  }

  async refresh(rawToken: string) {
    const refreshSecret = this.config.get<string>('auth.jwtRefreshSecret') as string;

    let payload: { userId: string; tenantId: string; email: string; role: string };
    try {
      payload = await this.jwt.verifyAsync(rawToken, { secret: refreshSecret });
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const tokenHash = this.hashToken(rawToken);
    const stored = await this.prisma.refreshToken.findUnique({ where: { tokenHash } });

    if (!stored || stored.revokedAt !== null || stored.expiresAt < new Date()) {
      throw new UnauthorizedException('Refresh token is invalid or expired');
    }

    const accessToken = await this.jwt.signAsync({
      userId: payload.userId,
      tenantId: payload.tenantId,
      email: payload.email,
      role: payload.role,
    });

    return { accessToken };
  }

  async logout(rawToken: string) {
    const tokenHash = this.hashToken(rawToken);
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private async generateTokens(user: { id: string; tenantId: string; email: string; role: string }) {
    const payload = {
      userId: user.id,
      tenantId: user.tenantId,
      email: user.email,
      role: user.role,
    };

    const accessToken = await this.jwt.signAsync(payload);
    const refreshSecret = this.config.get<string>('auth.jwtRefreshSecret') as string;
    const refreshExpires = this.config.get<string>('auth.jwtRefreshExpiration') as string;

    const refreshToken = await this.jwt.signAsync(
      { ...payload, jti: randomUUID() },
      { secret: refreshSecret, expiresIn: refreshExpires as any },
    );

    return { accessToken, refreshToken };
  }

  private async storeRefreshToken(userId: string, tenantId: string, rawToken: string) {
    await this.prisma.refreshToken.create({
      data: this.buildRefreshTokenRecord(userId, tenantId, rawToken),
    });
  }

  private buildRefreshTokenRecord(userId: string, tenantId: string, rawToken: string) {
    const refreshExpires = this.config.get<string>('auth.jwtRefreshExpiration') ?? '7d';
    const expiresAt = new Date();
    const match = /^(\d+)([dhms])$/.exec(refreshExpires);
    if (match) {
      const val = parseInt(match[1], 10);
      const unit = match[2];
      if (unit === 'd') expiresAt.setDate(expiresAt.getDate() + val);
      else if (unit === 'h') expiresAt.setHours(expiresAt.getHours() + val);
      else if (unit === 'm') expiresAt.setMinutes(expiresAt.getMinutes() + val);
      else if (unit === 's') expiresAt.setSeconds(expiresAt.getSeconds() + val);
    } else {
      expiresAt.setDate(expiresAt.getDate() + 7);
    }

    return {
      userId,
      tenantId,
      tokenHash: this.hashToken(rawToken),
      expiresAt,
    };
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
