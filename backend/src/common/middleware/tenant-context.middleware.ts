import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { setContext } from '../request-context';

@Injectable()
export class TenantContextMiddleware implements NestMiddleware {
  constructor(private jwtService: JwtService, private config: ConfigService) {}

  async use(req: Request, _res: Response, next: NextFunction) {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return next();
    }

    const token = authHeader.replace('Bearer ', '').trim();
    if (!token) {
      return next();
    }

    try {
      const secret = this.config.get<string>('auth.jwtSecret');
      const payload = await this.jwtService.verifyAsync(token, { secret });
      if (payload?.tenantId) {
        setContext({
          tenantId: payload.tenantId,
          userId: payload.userId,
          userEmail: payload.email,
          userRole: payload.role,
        });
      }
    } catch (error) {
      // Ignore token errors here; JwtAuthGuard will handle authentication.
    }

    return next();
  }
}
