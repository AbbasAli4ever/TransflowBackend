import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import {
  cleanDatabase,
  setupTestDatabase,
  teardownTestDatabase,
  getTestPrismaClient,
} from '../helpers/test-database';
import { createTestApp } from '../helpers/test-utils';

describe('Auth API (Integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    await setupTestDatabase();
    app = await createTestApp({ imports: [AppModule] });
    prisma = getTestPrismaClient() as any;
  });

  beforeEach(async () => {
    await cleanDatabase();
  });

  afterAll(async () => {
    await teardownTestDatabase();
    await app.close();
  });

  describe('POST /api/v1/auth/register', () => {
    const validRegistration = {
      tenantName: 'Test Business Inc',
      fullName: 'John Doe',
      email: 'john@example.com',
      password: 'Test123!',
    };

    it('should successfully register a new tenant and user', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send(validRegistration)
        .expect(201);

      // Verify response structure
      expect(response.body).toHaveProperty('accessToken');
      expect(response.body).toHaveProperty('refreshToken');
      expect(response.body).toHaveProperty('user');
      expect(response.body.user).toHaveProperty('id');
      expect(response.body.user).toHaveProperty('tenantId');
      expect(response.body.user.email).toBe('john@example.com');
      expect(response.body.user.fullName).toBe('John Doe');
      expect(response.body.user.role).toBe('OWNER');

      // Verify tokens are valid JWTs
      expect(response.body.accessToken).toMatch(/^[\w-]+\.[\w-]+\.[\w-]+$/);
      expect(response.body.refreshToken).toMatch(/^[\w-]+\.[\w-]+\.[\w-]+$/);

      // Verify password hash is NOT returned
      expect(response.body.user).not.toHaveProperty('passwordHash');
      expect(response.body.user).not.toHaveProperty('password');

      // Verify database records created
      const user = await prisma.user.findUnique({
        where: { id: response.body.user.id },
        include: { tenant: true },
      });

      expect(user).toBeDefined();
      expect(user!.email).toBe('john@example.com');
      expect(user!.fullName).toBe('John Doe');
      expect(user!.tenant.name).toBe('Test Business Inc');
      expect(user!.passwordHash).toBeDefined();
      expect(user!.passwordHash).not.toBe('Test123!'); // Should be hashed
    });

    it('should create tenant with default values', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send(validRegistration)
        .expect(201);

      const tenant = await prisma.tenant.findUnique({
        where: { id: response.body.user.tenantId },
      });

      expect(tenant).toBeDefined();
      expect(tenant!.baseCurrency).toBe('PKR');
      expect(tenant!.timezone).toBe('Asia/Karachi');
      expect(tenant!.status).toBe('ACTIVE');
    });

    it('should reject duplicate email', async () => {
      // First registration succeeds
      await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send(validRegistration)
        .expect(201);

      // Second registration with same email fails
      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send(validRegistration)
        .expect(409);

      expect(response.body.message).toContain('Email already exists');
    });

    it('should reject duplicate email (case-insensitive)', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send(validRegistration)
        .expect(201);

      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({
          ...validRegistration,
          email: 'JOHN@EXAMPLE.COM',
          tenantName: 'Different Business',
        })
        .expect(409);

      expect(response.body.message).toContain('Email already exists');
    });

    describe('Validation', () => {
      it('should reject missing tenantName', async () => {
        const response = await request(app.getHttpServer())
          .post('/api/v1/auth/register')
          .send({
            fullName: 'John Doe',
            email: 'john@example.com',
            password: 'Test123!',
          })
          .expect(400);

        expect(response.body.errors).toEqual(
          expect.arrayContaining([expect.objectContaining({ field: 'tenantName' })]),
        );
      });

      it('should reject missing fullName', async () => {
        const response = await request(app.getHttpServer())
          .post('/api/v1/auth/register')
          .send({
            tenantName: 'Test Business',
            email: 'john@example.com',
            password: 'Test123!',
          })
          .expect(400);

        expect(response.body.errors).toEqual(
          expect.arrayContaining([expect.objectContaining({ field: 'fullName' })]),
        );
      });

      it('should reject invalid email format', async () => {
        const response = await request(app.getHttpServer())
          .post('/api/v1/auth/register')
          .send({
            ...validRegistration,
            email: 'invalid-email',
          })
          .expect(400);

        expect(response.body.errors).toEqual(
          expect.arrayContaining([expect.objectContaining({ field: 'email' })]),
        );
      });

      it('should reject weak password (too short)', async () => {
        const response = await request(app.getHttpServer())
          .post('/api/v1/auth/register')
          .send({
            ...validRegistration,
            password: 'Test1',
          })
          .expect(400);

        expect(response.body.errors).toEqual(
          expect.arrayContaining([expect.objectContaining({ field: 'password' })]),
        );
      });

      it('should reject password without uppercase', async () => {
        const response = await request(app.getHttpServer())
          .post('/api/v1/auth/register')
          .send({
            ...validRegistration,
            password: 'test123!',
          })
          .expect(400);
      });

      it('should reject password without lowercase', async () => {
        const response = await request(app.getHttpServer())
          .post('/api/v1/auth/register')
          .send({
            ...validRegistration,
            password: 'TEST123!',
          })
          .expect(400);
      });

      it('should reject password without number', async () => {
        const response = await request(app.getHttpServer())
          .post('/api/v1/auth/register')
          .send({
            ...validRegistration,
            password: 'TestPass!',
          })
          .expect(400);
      });
    });
  });

  describe('POST /api/v1/auth/login', () => {
    const userCredentials = {
      email: 'john@example.com',
      password: 'Test123!',
    };

    beforeEach(async () => {
      // Register a user for login tests
      await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({
          tenantName: 'Test Business',
          fullName: 'John Doe',
          ...userCredentials,
        });
    });

    it('should successfully login with valid credentials', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send(userCredentials)
        .expect(200);

      expect(response.body).toHaveProperty('accessToken');
      expect(response.body).toHaveProperty('refreshToken');
      expect(response.body).toHaveProperty('user');
      expect(response.body.user.email).toBe('john@example.com');
      expect(response.body.user.tenant).toBeDefined();
      expect(response.body.user.tenant.name).toBe('Test Business');
    });

    it('should update lastLoginAt timestamp', async () => {
      const loginResponse = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send(userCredentials)
        .expect(200);

      const user = await prisma.user.findUnique({
        where: { id: loginResponse.body.user.id },
      });

      expect(user!.lastLoginAt).toBeDefined();
      expect(user!.lastLoginAt).toBeInstanceOf(Date);
    });

    it('should reject login with invalid email', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({
          email: 'nonexistent@example.com',
          password: 'Test123!',
        })
        .expect(401);

      expect(response.body.message).toContain('Invalid credentials');
    });

    it('should reject login with invalid password', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({
          email: 'john@example.com',
          password: 'WrongPassword123!',
        })
        .expect(401);

      expect(response.body.message).toContain('Invalid credentials');
    });

    it('should handle case-insensitive email login', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({
          email: 'JOHN@EXAMPLE.COM',
          password: 'Test123!',
        })
        .expect(200);

      expect(response.body.user.email).toBe('john@example.com');
    });

    it('should reject login for inactive user', async () => {
      const loginResponse = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send(userCredentials);

      // Deactivate user
      await prisma.user.update({
        where: { id: loginResponse.body.user.id },
        data: { status: 'INACTIVE' },
      });

      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send(userCredentials)
        .expect(403);

      expect(response.body.message).toContain('Account inactive');
    });

    it('should reject login for inactive tenant', async () => {
      const loginResponse = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send(userCredentials);

      // Deactivate tenant
      await prisma.tenant.update({
        where: { id: loginResponse.body.user.tenantId },
        data: { status: 'SUSPENDED' },
      });

      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send(userCredentials)
        .expect(403);

      expect(response.body.message).toContain('Tenant inactive');
    });
  });

  describe('Transaction Integrity', () => {
    it('should create both tenant and user atomically', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({
          tenantName: 'Atomic Test',
          fullName: 'Test User',
          email: 'atomic@example.com',
          password: 'Test123!',
        })
        .expect(201);

      // Verify both records exist
      const user = await prisma.user.findUnique({
        where: { id: response.body.user.id },
        include: { tenant: true },
      });

      expect(user).toBeDefined();
      expect(user!.tenant).toBeDefined();
      expect(user!.tenantId).toBe(user!.tenant.id);
    });

    it('should rollback both on failure', async () => {
      // This test verifies transaction rollback behavior
      // In a real scenario, you might mock a database error
      // For now, we verify that if registration fails, nothing is created

      const initialUserCount = await prisma.user.count();
      const initialTenantCount = await prisma.tenant.count();

      // Try to register with invalid data (duplicate email)
      await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({
          tenantName: 'Test',
          fullName: 'Test',
          email: 'test@example.com',
          password: 'Test123!',
        })
        .expect(201);

      await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({
          tenantName: 'Test2',
          fullName: 'Test2',
          email: 'test@example.com',
          password: 'Test123!',
        })
        .expect(409);

      // Verify counts - only one set should be created
      const finalUserCount = await prisma.user.count();
      const finalTenantCount = await prisma.tenant.count();

      expect(finalUserCount).toBe(initialUserCount + 1);
      expect(finalTenantCount).toBe(initialTenantCount + 1);
    });
  });
});
