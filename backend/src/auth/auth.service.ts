import { ConflictException, ForbiddenException, UnauthorizedException, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { hash, compare } from 'bcrypt';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';

const PASSWORD_SALT_ROUNDS = 12;

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
    private config: ConfigService,
  ) {}

  async register(dto: RegisterDto) {
    const existing = await this.prisma.user.findFirst({
      where: {
        email: { equals: dto.email.toLowerCase(), mode: 'insensitive' },
      },
    });

    if (existing) {
      throw new ConflictException('Email already exists');
    }

    const passwordHash = await hash(dto.password, PASSWORD_SALT_ROUNDS);

    const result = await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
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

    const tokens = await this.generateTokens(result.user);

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
      throw new UnauthorizedException('Invalid credentials');
    }

    if (user.status !== 'ACTIVE') {
      throw new ForbiddenException('Account inactive');
    }

    if (user.tenant.status !== 'ACTIVE') {
      throw new ForbiddenException('Tenant inactive');
    }

    const valid = await compare(dto.password, user.passwordHash);
    if (!valid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    const tokens = await this.generateTokens(user);

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

    const refreshToken = await this.jwt.signAsync(payload, {
      secret: refreshSecret,
      expiresIn: refreshExpires as any,
    });

    return { accessToken, refreshToken };
  }
}
