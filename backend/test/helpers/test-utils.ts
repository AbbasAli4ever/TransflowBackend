import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import authConfig from '../../src/config/auth.config';
import databaseConfig from '../../src/config/database.config';
import appConfig from '../../src/config/app.config';
import { PrismaService } from '../../src/prisma/prisma.service';
import { getTestPrismaClient } from './test-database';
import { ConfigService } from '@nestjs/config';
import { buildValidationPipe } from '../../src/common/pipes/validation.pipe';

/**
 * Create test application instance with proper configuration
 */
export async function createTestApp(moduleMetadata: any): Promise<INestApplication> {
  const moduleFixture: TestingModule = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({
        isGlobal: true,
        load: [authConfig, databaseConfig, appConfig],
        envFilePath: '.env.test',
      }),
      ...(moduleMetadata.imports || []),
    ],
    controllers: moduleMetadata.controllers || [],
    providers: [
      ...(moduleMetadata.providers || []),
      {
        provide: PrismaService,
        useValue: getTestPrismaClient(),
      },
    ],
  })
    .overrideProvider(PrismaService)
    .useValue(getTestPrismaClient())
    .compile();

  const app = moduleFixture.createNestApplication();

  // Apply global pipes (same as production)
  app.useGlobalPipes(buildValidationPipe());

  const config = app.get(ConfigService);
  app.setGlobalPrefix(config.get<string>('app.apiPrefix') ?? 'api/v1');

  await app.init();
  return app;
}

/**
 * Generate JWT token for testing authenticated requests
 */
export function generateTestJWT(payload: {
  userId: string;
  tenantId: string;
  email: string;
  role: string;
}): string {
  const jwt = require('jsonwebtoken');
  const secret = process.env.JWT_SECRET || 'test-secret';
  return jwt.sign(payload, secret, { expiresIn: '1h' });
}

/**
 * Create authorization header with JWT
 */
export function authHeader(token: string): { Authorization: string } {
  return { Authorization: `Bearer ${token}` };
}

/**
 * Wait for specified milliseconds (use sparingly in tests)
 */
export function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Assert that error response matches expected format
 */
export function assertErrorResponse(
  response: any,
  expectedStatus: number,
  expectedMessagePattern?: string | RegExp,
) {
  expect(response.status).toBe(expectedStatus);
  expect(response.body).toHaveProperty('message');

  if (expectedMessagePattern) {
    if (typeof expectedMessagePattern === 'string') {
      expect(response.body.message).toContain(expectedMessagePattern);
    } else {
      expect(response.body.message).toMatch(expectedMessagePattern);
    }
  }
}
