import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildServer } from '../../app.js';
import { prisma } from '../../lib/prisma.js';
import {
  createAuthHeader,
  createImportTestToken,
  createTestEmployee,
  createTestItem,
  createTestLoan,
  createTestUser,
  reserveUnusedImportEmployeeCode,
  reserveUnusedImportItemCode,
} from './helpers.js';
import FormData from 'form-data';
import { Readable } from 'stream';
import { promisify } from 'util';
import { pipeline } from 'stream/promises';

process.env.DATABASE_URL ??= 'postgresql://postgres:postgres@localhost:5432/borrow_return';
process.env.JWT_ACCESS_SECRET ??= 'test-access-secret-1234567890';
process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret-1234567890';

/**
 * FormDataをBufferに変換するヘルパー関数
 */
async function formDataToBuffer(formData: FormData): Promise<{ buffer: Buffer; headers: Record<string, string> }> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const headers = formData.getHeaders();
    
    // FormDataはReadableストリームなので、データイベントで読み込む
    formData.on('data', (chunk: Buffer | string) => {
      // chunkが文字列の場合はBufferに変換
      if (typeof chunk === 'string') {
        chunks.push(Buffer.from(chunk));
      } else {
        chunks.push(chunk);
      }
    });
    
    formData.on('end', () => {
      const buffer = Buffer.concat(chunks);
      resolve({ buffer, headers });
    });
    
    formData.on('error', (err: Error) => {
      reject(err);
    });
    
    // ストリームを読み込む（pipeやresumeで開始）
    formData.resume();
  });
}

describe('POST /api/imports/master', () => {
  let app: Awaited<ReturnType<typeof buildServer>>;
  let closeServer: (() => Promise<void>) | null = null;
  let adminToken: string;

  beforeAll(async () => {
    app = await buildServer();
    closeServer = async () => {
      await app.close();
    };
  });

  beforeEach(async () => {
    const admin = await createTestUser('ADMIN');
    adminToken = admin.token;
  });

  afterAll(async () => {
    if (closeServer) {
      await closeServer();
    }
  });

  it('should return 401 without authentication', async () => {
    const formData = new FormData();
    const emp = await reserveUnusedImportEmployeeCode();
    const csvContent = `employeeCode,lastName,firstName\n${emp},Test,Employee`;
    formData.append('employees', Buffer.from(csvContent), {
      filename: 'employees.csv',
      contentType: 'text/csv',
    });

    const { buffer, headers } = await formDataToBuffer(formData);

    const response = await app.inject({
      method: 'POST',
      url: '/api/imports/master',
      payload: buffer,
      headers,
    });

    expect(response.statusCode).toBe(401);
  });

  it('should return 403 for non-admin user', async () => {
    const manager = await createTestUser('MANAGER');
    const formData = new FormData();
    const emp = await reserveUnusedImportEmployeeCode();
    const csvContent = `employeeCode,lastName,firstName\n${emp},Test,Employee`;
    formData.append('employees', Buffer.from(csvContent), {
      filename: 'employees.csv',
      contentType: 'text/csv',
    });

    const { buffer, headers } = await formDataToBuffer(formData);

    const response = await app.inject({
      method: 'POST',
      url: '/api/imports/master',
      payload: buffer,
      headers: {
        ...headers,
        ...createAuthHeader(manager.token),
      },
    });

    expect(response.statusCode).toBe(403);
    const body = response.json();
    expect(body.message).toContain('操作権限がありません');
  });

  it('should import employees CSV successfully', async () => {
    const formData = new FormData();
    const emp1 = await reserveUnusedImportEmployeeCode();
    const emp2 = await reserveUnusedImportEmployeeCode();
    const uniqueTag1 = createImportTestToken('TAG-EMP');
    const uniqueTag2 = createImportTestToken('TAG-EMP');
    const csvContent = `employeeCode,lastName,firstName,nfcTagUid,department,status\n${emp1},Test,Employee1,${uniqueTag1},Dept1,ACTIVE\n${emp2},Test,Employee2,${uniqueTag2},Dept2,ACTIVE`;
    formData.append('employees', Buffer.from(csvContent), {
      filename: 'employees.csv',
      contentType: 'text/csv',
    });

    const { buffer, headers } = await formDataToBuffer(formData);

    const response = await app.inject({
      method: 'POST',
      url: '/api/imports/master',
      payload: buffer,
      headers: {
        ...headers,
        ...createAuthHeader(adminToken),
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toHaveProperty('summary');
    expect(body.summary).toHaveProperty('employees');
    expect(body.summary.employees.processed).toBe(2);
    expect(body.summary.employees.created).toBe(2);
    expect(body.summary.employees.updated).toBe(0);
  });

  it('should import items CSV successfully', async () => {
    const formData = new FormData();
    const item1 = await reserveUnusedImportItemCode();
    const item2 = await reserveUnusedImportItemCode();
    const uniqueTag1 = createImportTestToken('TAG-ITEM');
    const uniqueTag2 = createImportTestToken('TAG-ITEM');
    const csvContent = `itemCode,name,nfcTagUid,category,storageLocation,status,notes\n${item1},Test Item 1,${uniqueTag1},Category1,Location1,AVAILABLE,Notes1\n${item2},Test Item 2,${uniqueTag2},Category2,Location2,AVAILABLE,Notes2`;
    formData.append('items', Buffer.from(csvContent), {
      filename: 'items.csv',
      contentType: 'text/csv',
    });

    const { buffer, headers } = await formDataToBuffer(formData);

    const response = await app.inject({
      method: 'POST',
      url: '/api/imports/master',
      payload: buffer,
      headers: {
        ...headers,
        ...createAuthHeader(adminToken),
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toHaveProperty('summary');
    expect(body.summary).toHaveProperty('items');
    expect(body.summary.items.processed).toBe(2);
    // 新規作成または更新のいずれかが発生することを確認（テスト間でデータが残る可能性があるため）
    const totalProcessed = body.summary.items.created + body.summary.items.updated;
    expect(totalProcessed).toBe(2);
  });

  it('should import both employees and items CSV simultaneously', async () => {
    const formData = new FormData();
    const emp = await reserveUnusedImportEmployeeCode();
    const item = await reserveUnusedImportItemCode();
    const employeesCsv = `employeeCode,lastName,firstName\n${emp},Test,Employee3`;
    const itemsCsv = `itemCode,name\n${item},Test Item 3`;
    formData.append('employees', Buffer.from(employeesCsv), {
      filename: 'employees.csv',
      contentType: 'text/csv',
    });
    formData.append('items', Buffer.from(itemsCsv), {
      filename: 'items.csv',
      contentType: 'text/csv',
    });

    const { buffer, headers } = await formDataToBuffer(formData);

    const response = await app.inject({
      method: 'POST',
      url: '/api/imports/master',
      payload: buffer,
      headers: {
        ...headers,
        ...createAuthHeader(adminToken),
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toHaveProperty('summary');
    expect(body.summary).toHaveProperty('employees');
    expect(body.summary).toHaveProperty('items');
    expect(body.summary.employees.processed).toBe(1);
    expect(body.summary.items.processed).toBe(1);
  });

  it('should update existing employees when employeeCode matches', async () => {
    // 既存の従業員を作成
    const empCode = await reserveUnusedImportEmployeeCode();
    await createTestEmployee({ employeeCode: empCode, displayName: 'Original Name' });

    const formData = new FormData();
    const csvContent = `employeeCode,lastName,firstName\n${empCode},Updated,Name`;
    formData.append('employees', Buffer.from(csvContent), {
      filename: 'employees.csv',
      contentType: 'text/csv',
    });

    const { buffer, headers } = await formDataToBuffer(formData);

    const response = await app.inject({
      method: 'POST',
      url: '/api/imports/master',
      payload: buffer,
      headers: {
        ...headers,
        ...createAuthHeader(adminToken),
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.summary.employees.processed).toBe(1);
    expect(body.summary.employees.created).toBe(0);
    expect(body.summary.employees.updated).toBe(1);
  });

  it('should return 400 for invalid employeeCode format', async () => {
    const formData = new FormData();
    const csvContent = 'employeeCode,lastName,firstName\nINVALID,Test,Employee';
    formData.append('employees', Buffer.from(csvContent), {
      filename: 'employees.csv',
      contentType: 'text/csv',
    });

    const { buffer, headers } = await formDataToBuffer(formData);

    const response = await app.inject({
      method: 'POST',
      url: '/api/imports/master',
      payload: buffer,
      headers: {
        ...headers,
        ...createAuthHeader(adminToken),
      },
    });

    expect(response.statusCode).toBe(400);
    const body = response.json();
    expect(body.message).toContain('社員コードは数字4桁');
  });

  it('should return 400 for invalid itemCode format', async () => {
    const formData = new FormData();
    const csvContent = 'itemCode,name\nINVALID,Test Item';
    formData.append('items', Buffer.from(csvContent), {
      filename: 'items.csv',
      contentType: 'text/csv',
    });

    const { buffer, headers } = await formDataToBuffer(formData);

    const response = await app.inject({
      method: 'POST',
      url: '/api/imports/master',
      payload: buffer,
      headers: {
        ...headers,
        ...createAuthHeader(adminToken),
      },
    });

    expect(response.statusCode).toBe(400);
    const body = response.json();
    expect(body.message).toContain('管理番号はTO + 数字4桁');
  });

  it('should return 400 for duplicate nfcTagUid within CSV', async () => {
    const formData = new FormData();
    const emp1 = await reserveUnusedImportEmployeeCode();
    const emp2 = await reserveUnusedImportEmployeeCode();
    // 意図的に同じnfcTagUidを使用して重複エラーをテスト
    const duplicateTag = createImportTestToken('DUPLICATE-TAG');
    const csvContent = `employeeCode,lastName,firstName,nfcTagUid\n${emp1},Test,Employee1,${duplicateTag}\n${emp2},Test,Employee2,${duplicateTag}`;
    formData.append('employees', Buffer.from(csvContent), {
      filename: 'employees.csv',
      contentType: 'text/csv',
    });

    const { buffer, headers } = await formDataToBuffer(formData);

    const response = await app.inject({
      method: 'POST',
      url: '/api/imports/master',
      payload: buffer,
      headers: {
        ...headers,
        ...createAuthHeader(adminToken),
      },
    });

    expect(response.statusCode).toBe(400);
    const body = response.json();
    expect(body.message).toContain('CSV内でnfcTagUidが重複');
  });

  it('should return 400 for duplicate nfcTagUid between employees and items', async () => {
    const formData = new FormData();
    const emp = await reserveUnusedImportEmployeeCode();
    const item = await reserveUnusedImportItemCode();
    // 意図的に同じnfcTagUidを使用して重複エラーをテスト
    const sharedTag = createImportTestToken('SHARED-TAG');
    const employeesCsv = `employeeCode,lastName,firstName,nfcTagUid\n${emp},Test,Employee,${sharedTag}`;
    const itemsCsv = `itemCode,name,nfcTagUid\n${item},Test Item,${sharedTag}`;
    formData.append('employees', Buffer.from(employeesCsv), {
      filename: 'employees.csv',
      contentType: 'text/csv',
    });
    formData.append('items', Buffer.from(itemsCsv), {
      filename: 'items.csv',
      contentType: 'text/csv',
    });

    const { buffer, headers } = await formDataToBuffer(formData);

    const response = await app.inject({
      method: 'POST',
      url: '/api/imports/master',
      payload: buffer,
      headers: {
        ...headers,
        ...createAuthHeader(adminToken),
      },
    });

    expect(response.statusCode).toBe(400);
    const body = response.json();
    expect(body.message).toContain('異なるタイプ間でタグUIDが重複しています');
  });

  it('should return 400 when no CSV files are uploaded', async () => {
    const formData = new FormData();

    const { buffer, headers } = await formDataToBuffer(formData);

    const response = await app.inject({
      method: 'POST',
      url: '/api/imports/master',
      payload: buffer,
      headers: {
        ...headers,
        ...createAuthHeader(adminToken),
      },
    });

    expect(response.statusCode).toBe(400);
    const body = response.json();
    expect(body.message).toContain('employees.csv もしくは items.csv をアップロードしてください');
  });

  it('should handle replaceExisting=true correctly', async () => {
    // 既存の従業員を作成
    const empOld = await reserveUnusedImportEmployeeCode();
    const empNew = await reserveUnusedImportEmployeeCode();
    await createTestEmployee({ employeeCode: empOld, displayName: 'Original Employee' });
    await createTestEmployee({ employeeCode: empNew, displayName: 'Replace Candidate' });

    const formData = new FormData();
    const csvContent = `employeeCode,lastName,firstName\n${empNew},New,Employee`;
    formData.append('employees', Buffer.from(csvContent), {
      filename: 'employees.csv',
      contentType: 'text/csv',
    });
    formData.append('replaceExisting', 'true');

    const { buffer, headers } = await formDataToBuffer(formData);

    const response = await app.inject({
      method: 'POST',
      url: '/api/imports/master',
      payload: buffer,
      headers: {
        ...headers,
        ...createAuthHeader(adminToken),
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.summary.employees.processed).toBe(1);
    expect(body.summary.employees.created).toBe(1);
    // 既存の従業員は削除され、新しい従業員が作成される
  });
});

describe('POST /api/imports/master/:type', () => {
  let app: Awaited<ReturnType<typeof buildServer>>;
  let closeServer: (() => Promise<void>) | null = null;
  let adminToken: string;
  beforeAll(async () => {
    app = await buildServer();
    closeServer = async () => {
      await app.close();
    };
  });

  beforeEach(async () => {
    const admin = await createTestUser('ADMIN');
    adminToken = admin.token;
  });

  afterAll(async () => {
    if (closeServer) {
      await closeServer();
    }
  });

  it('should return 401 without authentication', async () => {
    const formData = new FormData();
    const emp = await reserveUnusedImportEmployeeCode();
    const csvContent = `employeeCode,lastName,firstName\n${emp},Test,Employee`;
    formData.append('file', Buffer.from(csvContent), {
      filename: 'employees.csv',
      contentType: 'text/csv',
    });

    const { buffer, headers } = await formDataToBuffer(formData);

    const response = await app.inject({
      method: 'POST',
      url: '/api/imports/master/employees',
      payload: buffer,
      headers,
    });

    expect(response.statusCode).toBe(401);
  });

  it('should import employees CSV successfully', async () => {
    const formData = new FormData();
    const emp = await reserveUnusedImportEmployeeCode();
    const csvContent = `employeeCode,lastName,firstName\n${emp},Test,Employee`;
    formData.append('file', Buffer.from(csvContent), {
      filename: 'employees.csv',
      contentType: 'text/csv',
    });
    formData.append('replaceExisting', 'false');

    const { buffer, headers } = await formDataToBuffer(formData);

    const response = await app.inject({
      method: 'POST',
      url: '/api/imports/master/employees',
      payload: buffer,
      headers: {
        ...headers,
        ...createAuthHeader(adminToken),
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.summary).toHaveProperty('employees');
    expect(body.summary.employees.processed).toBe(1);
    expect(body.summary.employees.created).toBe(1);
  });

  it('should import items CSV successfully', async () => {
    const formData = new FormData();
    const itemCode = await reserveUnusedImportItemCode();
    const csvContent = `itemCode,name\n${itemCode},Test Item`;
    formData.append('file', Buffer.from(csvContent), {
      filename: 'items.csv',
      contentType: 'text/csv',
    });
    formData.append('replaceExisting', 'false');

    const { buffer, headers } = await formDataToBuffer(formData);

    const response = await app.inject({
      method: 'POST',
      url: '/api/imports/master/items',
      payload: buffer,
      headers: {
        ...headers,
        ...createAuthHeader(adminToken),
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.summary).toHaveProperty('items');
    expect(body.summary.items.processed).toBe(1);
    expect(body.summary.items.created).toBe(1);
  });

  it('should import measuring instruments CSV successfully', async () => {
    const formData = new FormData();
    const mgmtNum = createImportTestToken('MI-TEST');
    const csvContent = `managementNumber,name,department\n${mgmtNum},Test Instrument,品質管理部`;
    formData.append('file', Buffer.from(csvContent), {
      filename: 'measuring-instruments.csv',
      contentType: 'text/csv',
    });
    formData.append('replaceExisting', 'false');

    const { buffer, headers } = await formDataToBuffer(formData);

    const response = await app.inject({
      method: 'POST',
      url: '/api/imports/master/measuring-instruments',
      payload: buffer,
      headers: {
        ...headers,
        ...createAuthHeader(adminToken),
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.summary).toHaveProperty('measuringInstruments');
    expect(body.summary.measuringInstruments.processed).toBe(1);
    expect(body.summary.measuringInstruments.created).toBe(1);
  });

  it('should import rigging gears CSV successfully', async () => {
    const formData = new FormData();
    const mgmtNum = createImportTestToken('RG-TEST');
    const csvContent = `managementNumber,name,usableYears\n${mgmtNum},Test Rigging,10`;
    formData.append('file', Buffer.from(csvContent), {
      filename: 'rigging-gears.csv',
      contentType: 'text/csv',
    });
    formData.append('replaceExisting', 'false');

    const { buffer, headers } = await formDataToBuffer(formData);

    const response = await app.inject({
      method: 'POST',
      url: '/api/imports/master/rigging-gears',
      payload: buffer,
      headers: {
        ...headers,
        ...createAuthHeader(adminToken),
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.summary).toHaveProperty('riggingGears');
    expect(body.summary.riggingGears.processed).toBe(1);
    expect(body.summary.riggingGears.created).toBe(1);
  });

  it('should return 400 for invalid type', async () => {
    const formData = new FormData();
    const csvContent = `employeeCode,lastName,firstName\n0001,Test,Employee`;
    formData.append('file', Buffer.from(csvContent), {
      filename: 'employees.csv',
      contentType: 'text/csv',
    });

    const { buffer, headers } = await formDataToBuffer(formData);

    const response = await app.inject({
      method: 'POST',
      url: '/api/imports/master/invalidType',
      payload: buffer,
      headers: {
        ...headers,
        ...createAuthHeader(adminToken),
      },
    });

    expect(response.statusCode).toBe(400);
    const body = response.json();
    expect(body.message).toContain('無効なデータタイプ');
  });

  it('should return 400 when file is missing', async () => {
    const formData = new FormData();
    formData.append('replaceExisting', 'false');

    const { buffer, headers } = await formDataToBuffer(formData);

    const response = await app.inject({
      method: 'POST',
      url: '/api/imports/master/employees',
      payload: buffer,
      headers: {
        ...headers,
        ...createAuthHeader(adminToken),
      },
    });

    expect(response.statusCode).toBe(400);
    const body = response.json();
    expect(body.message).toContain('CSVファイルがアップロードされていません');
  });
});
