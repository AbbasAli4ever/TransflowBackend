import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../../src/app.module';
import {
  cleanDatabase,
  setupTestDatabase,
  teardownTestDatabase,
  getTestPrismaClient,
} from '../helpers/test-database';
import { createTestApp, generateTestJWT, authHeader } from '../helpers/test-utils';
import {
  createTenantWithUser,
  createTestSupplier,
  createTestPaymentAccount,
  createCsvBuffer,
  createXlsxBuffer,
} from '../helpers/test-factories';

describe('Imports (integration)', () => {
  let app: INestApplication;
  let prisma: ReturnType<typeof getTestPrismaClient>;
  let token: string;
  let tenantId: string;
  let userId: string;

  beforeAll(async () => {
    await setupTestDatabase();
    app = await createTestApp({ imports: [AppModule] });
    prisma = getTestPrismaClient();
  });

  afterAll(async () => {
    await teardownTestDatabase();
    await app.close();
  });

  beforeEach(async () => {
    await cleanDatabase();
    const { tenant, user } = await createTenantWithUser(prisma);
    tenantId = tenant.id;
    userId = user.id;
    token = generateTestJWT({ userId, tenantId, email: user.email, role: user.role });
  });

  // ─── Helper: full upload→map→commit pipeline ──────────────────────────────

  async function uploadCsv(
    csvBuffer: Buffer,
    module: string,
    fileName = 'test.csv',
    expectedStatus = 201,
  ) {
    return request(app.getHttpServer())
      .post('/api/v1/imports')
      .set(authHeader(token))
      .attach('file', csvBuffer, { filename: fileName, contentType: 'text/csv' })
      .field('module', module)
      .expect(expectedStatus);
  }

  async function mapColumns(batchId: string, mappings: Record<string, string>, expectedStatus = 200) {
    return request(app.getHttpServer())
      .post(`/api/v1/imports/${batchId}/map`)
      .set(authHeader(token))
      .send({ columnMappings: mappings })
      .expect(expectedStatus);
  }

  async function commitImport(batchId: string, body: object = {}, expectedStatus = 200) {
    return request(app.getHttpServer())
      .post(`/api/v1/imports/${batchId}/commit`)
      .set(authHeader(token))
      .send(body)
      .expect(expectedStatus);
  }

  // ─── Test 1: Upload CSV creates batch with PENDING_MAPPING status ─────────

  it('Upload CSV creates batch with PENDING_MAPPING status', async () => {
    const csv = createCsvBuffer(['Company Name', 'Phone'], [['ABC Suppliers', '+92300-1234567']]);
    const res = await uploadCsv(csv, 'SUPPLIERS');

    expect(res.body.status).toBe('PENDING_MAPPING');
    expect(res.body.module).toBe('SUPPLIERS');
    expect(res.body.totalRows).toBe(1);
    expect(res.body.detectedColumns).toEqual(['Company Name', 'Phone']);
    expect(res.body.requiredFields).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: 'name', required: true })]),
    );
  });

  // ─── Test 2: Upload XLSX creates batch correctly ──────────────────────────

  it('Upload XLSX creates batch correctly', async () => {
    const xlsxBuf = createXlsxBuffer(['name', 'phone'], [['Alpha Shop', '+92301-7654321']]);
    const res = await request(app.getHttpServer())
      .post('/api/v1/imports')
      .set(authHeader(token))
      .attach('file', xlsxBuf, { filename: 'test.xlsx', contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
      .field('module', 'CUSTOMERS')
      .expect(201);

    expect(res.body.status).toBe('PENDING_MAPPING');
    expect(res.body.totalRows).toBe(1);
    expect(res.body.detectedColumns).toContain('name');
  });

  // ─── Test 3: Upload rejects unsupported file type (400) ──────────────────

  it('Upload rejects unsupported file type (400)', async () => {
    const buf = Buffer.from('not a valid file');
    const res = await request(app.getHttpServer())
      .post('/api/v1/imports')
      .set(authHeader(token))
      .attach('file', buf, { filename: 'test.txt', contentType: 'text/plain' })
      .field('module', 'SUPPLIERS')
      .expect(400);

    expect(res.body.message).toMatch(/unsupported file type/i);
  });

  // ─── Test 4: Upload rejects file > 10MB (400) ────────────────────────────

  it('Upload rejects file > 10MB (413)', async () => {
    // Create a buffer just over 10MB; multer's fileSize limit returns 413 Payload Too Large
    const bigBuf = Buffer.alloc(10 * 1024 * 1024 + 1, 'x');
    await request(app.getHttpServer())
      .post('/api/v1/imports')
      .set(authHeader(token))
      .attach('file', bigBuf, { filename: 'big.csv', contentType: 'text/csv' })
      .field('module', 'SUPPLIERS')
      .expect(413);
  });

  // ─── Test 5: Upload rejects unknown module (400) ─────────────────────────

  it('Upload rejects unknown module (400)', async () => {
    const csv = createCsvBuffer(['name'], [['Test']]);
    const res = await request(app.getHttpServer())
      .post('/api/v1/imports')
      .set(authHeader(token))
      .attach('file', csv, { filename: 'test.csv', contentType: 'text/csv' })
      .field('module', 'INVALID_MODULE')
      .expect(400);

    expect(res.body).toHaveProperty('message');
  });

  // ─── Test 6: Upload detects column headers correctly ─────────────────────

  it('Upload detects column headers correctly', async () => {
    const csv = createCsvBuffer(['Company Name', 'Phone Number', 'Address', 'Notes'], [
      ['Supplier A', '123456', '123 Main St', 'note'],
    ]);
    const res = await uploadCsv(csv, 'SUPPLIERS');

    expect(res.body.detectedColumns).toEqual(['Company Name', 'Phone Number', 'Address', 'Notes']);
  });

  // ─── Test 7: Map columns validates required fields mapped ────────────────

  it('Map columns validates required fields are mapped', async () => {
    const csv = createCsvBuffer(['Company Name', 'Phone'], [['Supplier A', '123456']]);
    const uploadRes = await uploadCsv(csv, 'SUPPLIERS');

    // Missing 'name' mapping — should fail
    const mapRes = await request(app.getHttpServer())
      .post(`/api/v1/imports/${uploadRes.body.id}/map`)
      .set(authHeader(token))
      .send({ columnMappings: { phone: 'Phone' } }) // missing 'name'
      .expect(400);

    expect(mapRes.body.message).toMatch(/name/i);
  });

  // ─── Test 8: Map columns rejects if batch not PENDING_MAPPING ────────────

  it('Map columns rejects if batch is not PENDING_MAPPING', async () => {
    const csv = createCsvBuffer(['name'], [['Supplier A']]);
    const uploadRes = await uploadCsv(csv, 'SUPPLIERS');
    const batchId = uploadRes.body.id;

    // Map once — moves to VALIDATED
    await mapColumns(batchId, { name: 'name' });

    // Map again — should fail (status is now VALIDATED)
    const res = await request(app.getHttpServer())
      .post(`/api/v1/imports/${batchId}/map`)
      .set(authHeader(token))
      .send({ columnMappings: { name: 'name' } })
      .expect(400);

    expect(res.body.message).toMatch(/PENDING_MAPPING/);
  });

  // ─── Test 9: Map columns validates each row and reports errors ───────────

  it('Map columns validates each row and reports errors', async () => {
    const csv = createCsvBuffer(['name', 'phone'], [
      ['Valid Supplier', '+92300-1234567'],
      ['', '+92300-1111111'],         // empty name — invalid
      ['Another Valid', ''],
    ]);
    const uploadRes = await uploadCsv(csv, 'SUPPLIERS');
    const batchId = uploadRes.body.id;

    const res = await mapColumns(batchId, { name: 'name', phone: 'phone' });

    expect(res.body.validRows).toBe(2);
    expect(res.body.invalidRows).toBe(1);
    expect(res.body.errors).toHaveLength(1);
    expect(res.body.errors[0].rowNumber).toBe(2);
    expect(res.body.errors[0].field).toBe('name');
  });

  // ─── Test 10: Map columns updates batch to VALIDATED ─────────────────────

  it('Map columns updates batch to VALIDATED', async () => {
    const csv = createCsvBuffer(['name'], [['Supplier A'], ['Supplier B']]);
    const uploadRes = await uploadCsv(csv, 'SUPPLIERS');
    const batchId = uploadRes.body.id;

    const res = await mapColumns(batchId, { name: 'name' });

    expect(res.body.status).toBe('VALIDATED');
    expect(res.body.validRows).toBe(2);
    expect(res.body.invalidRows).toBe(0);
  });

  // ─── Test 11: Commit creates supplier records from valid rows ────────────

  it('Commit creates supplier records from valid rows', async () => {
    const csv = createCsvBuffer(['name', 'phone'], [
      ['Supplier Alpha', '+92300-1234567'],
      ['Supplier Beta', '+92301-7654321'],
    ]);
    const uploadRes = await uploadCsv(csv, 'SUPPLIERS');
    const batchId = uploadRes.body.id;
    await mapColumns(batchId, { name: 'name', phone: 'phone' });

    const res = await commitImport(batchId);

    expect(res.body.status).toBe('COMPLETED');
    expect(res.body.successRows).toBe(2);
    expect(res.body.createdRecords).toHaveLength(2);
    expect(res.body.createdRecords[0].recordType).toBe('SUPPLIER');

    const supplierCount = await prisma.supplier.count({ where: { tenantId } });
    expect(supplierCount).toBe(2);
  });

  // ─── Test 12: Commit creates customer records from valid rows ────────────

  it('Commit creates customer records from valid rows', async () => {
    const csv = createCsvBuffer(['name'], [['Customer One'], ['Customer Two']]);
    const uploadRes = await uploadCsv(csv, 'CUSTOMERS');
    const batchId = uploadRes.body.id;
    await mapColumns(batchId, { name: 'name' });

    const res = await commitImport(batchId);

    expect(res.body.status).toBe('COMPLETED');
    expect(res.body.successRows).toBe(2);
    expect(res.body.createdRecords[0].recordType).toBe('CUSTOMER');

    const count = await prisma.customer.count({ where: { tenantId } });
    expect(count).toBe(2);
  });

  // ─── Test 13: Commit creates product records from valid rows ────────────

  it('Commit creates product records from valid rows', async () => {
    const csv = createCsvBuffer(['name', 'sku'], [['Black Suit', 'SUIT-BLK-001'], ['White Suit', 'SUIT-WHT-001']]);
    const uploadRes = await uploadCsv(csv, 'PRODUCTS');
    const batchId = uploadRes.body.id;
    await mapColumns(batchId, { name: 'name', sku: 'sku' });

    const res = await commitImport(batchId);

    expect(res.body.status).toBe('COMPLETED');
    expect(res.body.successRows).toBe(2);
    expect(res.body.createdRecords[0].recordType).toBe('PRODUCT');

    const count = await prisma.product.count({ where: { tenantId } });
    expect(count).toBe(2);
  });

  // ─── Test 14: Commit skips invalid rows when skipInvalidRows=true ────────

  it('Commit skips invalid rows when skipInvalidRows=true', async () => {
    // Row 2 has a name >255 chars — non-empty line, fails length validation
    const tooLong = 'x'.repeat(256);
    const csv = createCsvBuffer(['name'], [['Valid Supplier'], [tooLong]]);
    const uploadRes = await uploadCsv(csv, 'SUPPLIERS');
    const batchId = uploadRes.body.id;
    await mapColumns(batchId, { name: 'name' });

    const res = await commitImport(batchId, { skipInvalidRows: true });

    expect(res.body.status).toBe('COMPLETED');
    expect(res.body.successRows).toBe(1);
    expect(res.body.skippedRows).toBe(1);

    const count = await prisma.supplier.count({ where: { tenantId } });
    expect(count).toBe(1);
  });

  // ─── Test 15: Commit aborts when skipInvalidRows=false and invalid exist ──

  it('Commit aborts when skipInvalidRows=false and invalid rows exist', async () => {
    const tooLong = 'x'.repeat(256);
    const csv = createCsvBuffer(['name'], [['Valid Supplier'], [tooLong]]);
    const uploadRes = await uploadCsv(csv, 'SUPPLIERS');
    const batchId = uploadRes.body.id;
    await mapColumns(batchId, { name: 'name' });

    const res = await commitImport(batchId, { skipInvalidRows: false }, 400);

    expect(res.body.message).toMatch(/invalid row/i);
  });

  // ─── Test 16: Commit rejects if batch not VALIDATED ──────────────────────

  it('Commit rejects if batch is not VALIDATED', async () => {
    const csv = createCsvBuffer(['name'], [['Supplier A']]);
    const uploadRes = await uploadCsv(csv, 'SUPPLIERS');

    const res = await commitImport(uploadRes.body.id, {}, 400);

    expect(res.body.message).toMatch(/VALIDATED/);
  });

  // ─── Test 17: Commit handles duplicate names (marks row as FAILED) ───────

  it('Commit handles duplicate supplier names (marks row as FAILED)', async () => {
    // Create a supplier with the same name first
    await createTestSupplier(prisma, tenantId, userId, { name: 'Existing Supplier' });

    const csv = createCsvBuffer(['name'], [['Existing Supplier'], ['New Supplier']]);
    const uploadRes = await uploadCsv(csv, 'SUPPLIERS');
    const batchId = uploadRes.body.id;
    await mapColumns(batchId, { name: 'name' });

    const res = await commitImport(batchId);

    expect(res.body.status).toBe('COMPLETED');
    expect(res.body.successRows).toBe(1);
    expect(res.body.failedRows).toBe(1);

    // Only 1 new supplier created (the non-duplicate)
    const count = await prisma.supplier.count({ where: { tenantId } });
    expect(count).toBe(2); // existing + new
  });

  // ─── Test 18: Commit sets createdRecordId on import rows ─────────────────

  it('Commit sets createdRecordId on import rows', async () => {
    const csv = createCsvBuffer(['name'], [['Test Supplier']]);
    const uploadRes = await uploadCsv(csv, 'SUPPLIERS');
    const batchId = uploadRes.body.id;
    await mapColumns(batchId, { name: 'name' });
    await commitImport(batchId);

    const row = await prisma.importRow.findFirst({ where: { importBatchId: batchId } });
    expect(row?.createdRecordId).toBeTruthy();
    expect(row?.createdRecordType).toBe('SUPPLIER');
    expect(row?.status).toBe('SUCCESS');
  });

  // ─── Test 19: Rollback deletes created records when no dependencies ───────

  it('Rollback deletes (inactivates) created records when no dependencies', async () => {
    const csv = createCsvBuffer(['name'], [['Rollback Supplier']]);
    const uploadRes = await uploadCsv(csv, 'SUPPLIERS');
    const batchId = uploadRes.body.id;
    await mapColumns(batchId, { name: 'name' });
    const commitRes = await commitImport(batchId);
    const recordId = commitRes.body.createdRecords[0].recordId;

    const res = await request(app.getHttpServer())
      .post(`/api/v1/imports/${batchId}/rollback`)
      .set(authHeader(token))
      .expect(200);

    expect(res.body.status).toBe('ROLLED_BACK');
    expect(res.body.rolledBackCount).toBe(1);

    const supplier = await prisma.supplier.findUnique({ where: { id: recordId } });
    expect(supplier?.status).toBe('INACTIVE');
  });

  // ─── Test 20: Rollback returns 409 when records have transactions ─────────

  it('Rollback returns 409 when supplier records have transactions', async () => {
    // We'll create a supplier via import, then manually create a transaction for it
    const csv = createCsvBuffer(['name'], [['Supplier With TX']]);
    const uploadRes = await uploadCsv(csv, 'SUPPLIERS');
    const batchId = uploadRes.body.id;
    await mapColumns(batchId, { name: 'name' });
    const commitRes = await commitImport(batchId);
    const supplierId = commitRes.body.createdRecords[0].recordId;

    // Create a transaction referencing this supplier
    await prisma.transaction.create({
      data: {
        tenantId,
        type: 'PURCHASE',
        status: 'DRAFT',
        transactionDate: new Date(),
        supplierId,
        totalAmount: 1000,
      },
    });

    const res = await request(app.getHttpServer())
      .post(`/api/v1/imports/${batchId}/rollback`)
      .set(authHeader(token))
      .expect(409);

    expect(res.body.message).toMatch(/dependencies/i);
  });

  // ─── Test 21: Rollback rejects if batch not COMPLETED ────────────────────

  it('Rollback rejects if batch is not COMPLETED', async () => {
    const csv = createCsvBuffer(['name'], [['Supplier A']]);
    const uploadRes = await uploadCsv(csv, 'SUPPLIERS');

    const res = await request(app.getHttpServer())
      .post(`/api/v1/imports/${uploadRes.body.id}/rollback`)
      .set(authHeader(token))
      .expect(400);

    expect(res.body.message).toMatch(/COMPLETED/);
  });

  // ─── Test 22: Rollback sets batch status to ROLLED_BACK ──────────────────

  it('Rollback sets batch status to ROLLED_BACK', async () => {
    const csv = createCsvBuffer(['name'], [['Supplier X']]);
    const uploadRes = await uploadCsv(csv, 'SUPPLIERS');
    const batchId = uploadRes.body.id;
    await mapColumns(batchId, { name: 'name' });
    await commitImport(batchId);

    await request(app.getHttpServer())
      .post(`/api/v1/imports/${batchId}/rollback`)
      .set(authHeader(token))
      .expect(200);

    const batch = await prisma.importBatch.findUnique({ where: { id: batchId } });
    expect(batch?.status).toBe('ROLLED_BACK');
  });

  // ─── Test 23: List batches with module filter ─────────────────────────────

  it('List batches with module filter', async () => {
    const csv1 = createCsvBuffer(['name'], [['S1']]);
    await uploadCsv(csv1, 'SUPPLIERS');

    const csv2 = createCsvBuffer(['name'], [['C1']]);
    await uploadCsv(csv2, 'CUSTOMERS');

    const res = await request(app.getHttpServer())
      .get('/api/v1/imports?module=SUPPLIERS')
      .set(authHeader(token))
      .expect(200);

    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].module).toBe('SUPPLIERS');
    expect(res.body.total).toBe(1);
  });

  // ─── Test 24: List batches with status filter ─────────────────────────────

  it('List batches with status filter', async () => {
    const csv1 = createCsvBuffer(['name'], [['S1']]);
    await uploadCsv(csv1, 'SUPPLIERS');

    const csv2 = createCsvBuffer(['name'], [['C1']]);
    const res2 = await uploadCsv(csv2, 'CUSTOMERS');
    const batchId = res2.body.id;
    await mapColumns(batchId, { name: 'name' });

    const res = await request(app.getHttpServer())
      .get('/api/v1/imports?status=VALIDATED')
      .set(authHeader(token))
      .expect(200);

    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].status).toBe('VALIDATED');
  });

  // ─── Test 25: Get batch detail includes import rows ───────────────────────

  it('Get batch detail includes import rows', async () => {
    const csv = createCsvBuffer(['name'], [['Supplier A'], ['Supplier B']]);
    const uploadRes = await uploadCsv(csv, 'SUPPLIERS');
    const batchId = uploadRes.body.id;

    const res = await request(app.getHttpServer())
      .get(`/api/v1/imports/${batchId}`)
      .set(authHeader(token))
      .expect(200);

    expect(res.body.id).toBe(batchId);
    expect(res.body.rows).toHaveLength(2);
    expect(res.body.rows[0].rowNumber).toBe(1);
    expect(res.body.rowsPagination.total).toBe(2);
  });

  // ─── Test 26: Tenant isolation ───────────────────────────────────────────

  it('Tenant isolation: cannot access another tenant batch', async () => {
    // Create batch for tenant1
    const csv = createCsvBuffer(['name'], [['Supplier A']]);
    const uploadRes = await uploadCsv(csv, 'SUPPLIERS');
    const batchId = uploadRes.body.id;

    // Create a second tenant
    const { tenant: t2, user: u2 } = await createTenantWithUser(prisma);
    const token2 = generateTestJWT({ userId: u2.id, tenantId: t2.id, email: u2.email, role: u2.role });

    // Tenant 2 tries to access tenant 1's batch
    await request(app.getHttpServer())
      .get(`/api/v1/imports/${batchId}`)
      .set({ Authorization: `Bearer ${token2}` })
      .expect(404);
  });

  // ─── Test 27: OPENING_BALANCES import updates payment account opening balance

  it('OPENING_BALANCES import updates payment account opening balance', async () => {
    const account = await createTestPaymentAccount(prisma, tenantId, userId, {
      name: 'Cash Register',
      type: 'CASH',
      openingBalance: 0,
    });

    const csv = createCsvBuffer(['accountName', 'amount'], [['Cash Register', '50000']]);
    const uploadRes = await uploadCsv(csv, 'OPENING_BALANCES');
    const batchId = uploadRes.body.id;

    const mapRes = await mapColumns(batchId, { accountName: 'accountName', amount: 'amount' });
    expect(mapRes.body.validRows).toBe(1);
    expect(mapRes.body.invalidRows).toBe(0);

    const commitRes = await commitImport(batchId);
    expect(commitRes.body.status).toBe('COMPLETED');
    expect(commitRes.body.successRows).toBe(1);

    const updated = await prisma.paymentAccount.findUnique({ where: { id: account.id } });
    expect(updated?.openingBalance).toBe(50000);
  });

  // ─── Wave 3 — Import Safety ───────────────────────────────────────────────────

  describe('Wave 3 — Task 7.1: TRANSACTIONS module rejected', () => {
    it('rejects upload with module=TRANSACTIONS (400)', async () => {
      const csv = createCsvBuffer(['name'], [['Some Supplier']]);
      await uploadCsv(csv, 'TRANSACTIONS', 'test.csv', 400);
    });
  });

  describe('Wave 3 — Task 7.2: CAS prevents duplicate commit', () => {
    it('concurrent commit on same batch returns one success and one conflict (409)', async () => {
      const csv = createCsvBuffer(['name', 'phone'], [['Unique Supplier A', '+92300-0000001']]);
      const uploadRes = await uploadCsv(csv, 'SUPPLIERS');
      const batchId = uploadRes.body.id;
      await mapColumns(batchId, { name: 'name', phone: 'phone' });

      // Two concurrent commit requests — one must get 200, the other 409
      const commitRequest = () =>
        request(app.getHttpServer())
          .post(`/api/v1/imports/${batchId}/commit`)
          .set(authHeader(token))
          .send({});
      const [r1, r2] = await Promise.all([commitRequest(), commitRequest()]);
      const statuses = [r1.status, r2.status].sort();
      expect(statuses).toContain(200);
      expect(statuses).toContain(409);
    });
  });

  describe('Wave 3 — Task 7.3: Opening balance rollback restores prior value', () => {
    it('rollback restores the original opening balance, not 0', async () => {
      // Account starts at 200000
      const account = await createTestPaymentAccount(prisma, tenantId, userId, {
        name: 'Savings Account',
        type: 'BANK',
        openingBalance: 200000,
      });

      // Import sets it to 500000
      const csv = createCsvBuffer(['accountName', 'amount'], [['Savings Account', '500000']]);
      const uploadRes = await uploadCsv(csv, 'OPENING_BALANCES');
      const batchId = uploadRes.body.id;
      await mapColumns(batchId, { accountName: 'accountName', amount: 'amount' });
      await commitImport(batchId);

      const afterCommit = await prisma.paymentAccount.findUnique({ where: { id: account.id } });
      expect(afterCommit?.openingBalance).toBe(500000);

      // Rollback must restore to 200000, not 0
      await request(app.getHttpServer())
        .post(`/api/v1/imports/${batchId}/rollback`)
        .set(authHeader(token))
        .expect(200);

      const afterRollback = await prisma.paymentAccount.findUnique({ where: { id: account.id } });
      expect(afterRollback?.openingBalance).toBe(200000);
    });
  });
});
