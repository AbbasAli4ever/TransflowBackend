import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { getTestPrismaClient, setupTestDatabase, teardownTestDatabase } from '../helpers/test-database';
import { createTestApp } from '../helpers/test-utils';

describe('Health Check Endpoints (Integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    await setupTestDatabase();
    app = await createTestApp({ imports: [AppModule] });
    prisma = getTestPrismaClient() as any;
  });

  afterAll(async () => {
    await teardownTestDatabase();
    await app.close();
  });

  describe('GET /health', () => {
    it('should return 200 OK with health status', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/health')
        .expect(200);

      expect(response.body).toHaveProperty('status');
      expect(response.body).toHaveProperty('info');
      expect(response.body).toHaveProperty('details');
      expect(response.body.status).toBe('ok');
    });

    it('should include database and memory info', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/health')
        .expect(200);

      expect(response.body.info).toHaveProperty('database');
      expect(response.body.info).toHaveProperty('memory');
      expect(response.body.details).toHaveProperty('database');
      expect(response.body.details).toHaveProperty('memory');
    });

    it('should be accessible without authentication', async () => {
      // No Authorization header - should still work
      const response = await request(app.getHttpServer())
        .get('/api/v1/health')
        .expect(200);

      expect(response.body.status).toBe('ok');
    });

    it('should respond quickly (< 100ms)', async () => {
      const start = Date.now();

      await request(app.getHttpServer())
        .get('/api/v1/health')
        .expect(200);

      const duration = Date.now() - start;
      expect(duration).toBeLessThan(100);
    });
  });

  describe('GET /version', () => {
    it('should return version metadata', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/version')
        .expect(200);

      expect(response.body).toHaveProperty('version');
      expect(response.body).toHaveProperty('environment');
      expect(response.body).toHaveProperty('nodeVersion');
    });
  });

  describe('Performance Benchmarks', () => {
    it('health check should respond in < 50ms', async () => {
      const iterations = 10;
      const durations: number[] = [];

      for (let i = 0; i < iterations; i++) {
        const start = Date.now();
        await request(app.getHttpServer()).get('/api/v1/health').expect(200);
        durations.push(Date.now() - start);
      }

      const avgDuration = durations.reduce((a, b) => a + b, 0) / iterations;
      expect(avgDuration).toBeLessThan(50);
    });

    it('version check should respond in < 100ms', async () => {
      const iterations = 5;
      const durations: number[] = [];

      for (let i = 0; i < iterations; i++) {
        const start = Date.now();
        await request(app.getHttpServer()).get('/api/v1/version').expect(200);
        durations.push(Date.now() - start);
      }

      const avgDuration = durations.reduce((a, b) => a + b, 0) / iterations;
      expect(avgDuration).toBeLessThan(100);
    });
  });
});
