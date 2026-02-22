import { registerAs } from '@nestjs/config';

export default registerAs('app', () => ({
  port: parseInt(process.env.PORT ?? '3000', 10),
  apiPrefix: process.env.API_PREFIX ?? 'api/v1',
  corsOrigin: process.env.CORS_ORIGIN,
  rateLimitWindowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS ?? '900000', 10),
  rateLimitMaxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS ?? '100', 10),
  logLevel: process.env.LOG_LEVEL ?? 'info',
  logFormat: process.env.LOG_FORMAT ?? 'json',
  nodeEnv: process.env.NODE_ENV ?? 'development',
  defaultTimezone: process.env.DEFAULT_TIMEZONE ?? 'Asia/Karachi',
}));
