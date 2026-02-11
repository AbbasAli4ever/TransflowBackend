import { PrismaClient } from '@prisma/client';
import { execSync } from 'child_process';

let prisma: PrismaClient;

/**
 * Initialize test database connection
 */
export function getTestPrismaClient(): PrismaClient {
  if (!prisma) {
    prisma = new PrismaClient({
      datasources: {
        db: {
          url: process.env.DATABASE_URL_TEST || process.env.DATABASE_URL,
        },
      },
    });
  }
  return prisma;
}

/**
 * Clean all data from database tables while preserving schema
 */
export async function cleanDatabase() {
  const client = getTestPrismaClient();

  // Delete in correct order to respect foreign key constraints
  await client.importRow.deleteMany();
  await client.importBatch.deleteMany();
  await client.allocation.deleteMany();
  await client.paymentEntry.deleteMany();
  await client.ledgerEntry.deleteMany();
  await client.inventoryMovement.deleteMany();
  await client.transactionLine.deleteMany();
  await client.transaction.deleteMany();
  await client.paymentAccount.deleteMany();
  await client.product.deleteMany();
  await client.customer.deleteMany();
  await client.supplier.deleteMany();
  await client.user.deleteMany();
  await client.tenant.deleteMany();
}

/**
 * Run migrations on test database
 */
export function runMigrations() {
  try {
    execSync('npx prisma migrate deploy', {
      env: {
        ...process.env,
        DATABASE_URL: process.env.DATABASE_URL_TEST || process.env.DATABASE_URL,
      },
      stdio: 'inherit',
    });
  } catch (error) {
    console.error('Migration failed:', error);
    throw error;
  }
}

/**
 * Disconnect from database
 */
export async function disconnectDatabase() {
  if (prisma) {
    await prisma.$disconnect();
  }
}

/**
 * Setup test database (run before all tests)
 */
export async function setupTestDatabase() {
  runMigrations();
  await cleanDatabase();
}

/**
 * Teardown test database (run after all tests)
 */
export async function teardownTestDatabase() {
  await cleanDatabase();
  await disconnectDatabase();
}
