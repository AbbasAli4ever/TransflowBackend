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
 * Clean all data from database tables while preserving schema.
 * Uses TRUNCATE ... CASCADE for atomicity and FK-safety.
 * RESTART IDENTITY resets auto-increment sequences.
 * Adding new tables to the schema does NOT require updating this function.
 */
export async function cleanDatabase() {
  const client = getTestPrismaClient();
  await client.$executeRaw`
    TRUNCATE TABLE
      import_rows,
      import_batches,
      allocations,
      payment_entries,
      ledger_entries,
      inventory_movements,
      transaction_lines,
      transactions,
      document_sequences,
      payment_accounts,
      product_variants,
      products,
      status_change_logs,
      customers,
      suppliers,
      refresh_tokens,
      users,
      tenants
    RESTART IDENTITY CASCADE
  `;
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
