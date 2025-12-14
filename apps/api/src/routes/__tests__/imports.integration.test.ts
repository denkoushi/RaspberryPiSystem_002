import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildServer } from '../../app.js';
import { createAuthHeader, createTestEmployee, createTestItem, createTestLoan, createTestUser } from './helpers.js';
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
  let testCounter = 0;

  /**
   * テスト用の一意なIDを生成するヘルパー関数
   * 4桁の数字（1000-9999）を返す
   */
  function generateTestId(offset: number): number {
    testCounter++;
    // タイムスタンプとカウンターを使用して一意なIDを生成
    const timestamp = Date.now() % 10000;
    const base = 1000 + ((timestamp + testCounter * 100 + offset) % 9000);
    return base;
  }

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
    const emp = String(generateTestId(1)).padStart(4, '0');
    const csvContent = `employeeCode,displayName\n${emp},Test Employee`;
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

  it('should import employees CSV successfully', async () => {
    const formData = new FormData();
    const emp1 = String(generateTestId(10)).padStart(4, '0');
    const emp2 = String(generateTestId(11)).padStart(4, '0');
    // nfcTagUidも一意にするため、タイムスタンプとカウンターを使用
    const uniqueTag1 = `TAG${Date.now()}${testCounter}001`;
    const uniqueTag2 = `TAG${Date.now()}${testCounter}002`;
    const csvContent = `employeeCode,displayName,nfcTagUid,department,contact,status\n${emp1},Test Employee 1,${uniqueTag1},Dept1,Contact1,ACTIVE\n${emp2},Test Employee 2,${uniqueTag2},Dept2,Contact2,ACTIVE`;
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
    const item1Num = generateTestId(20);
    const item2Num = generateTestId(21);
    const item1 = `TO${String(item1Num).padStart(4, '0')}`;
    const item2 = `TO${String(item2Num).padStart(4, '0')}`;
    // nfcTagUidも一意にするため、タイムスタンプとカウンターを使用
    const uniqueTag1 = `TAG${Date.now()}${testCounter}001`;
    const uniqueTag2 = `TAG${Date.now()}${testCounter}002`;
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
    const emp = String(generateTestId(30)).padStart(4, '0');
    const item = `TO${String(generateTestId(31)).padStart(4, '0')}`;
    const employeesCsv = `employeeCode,displayName\n${emp},Test Employee 3`;
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
    const empCode = String(generateTestId(40)).padStart(4, '0');
    await createTestEmployee({ employeeCode: empCode, displayName: 'Original Name' });

    const formData = new FormData();
    const csvContent = `employeeCode,displayName\n${empCode},Updated Name`;
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
    const csvContent = 'employeeCode,displayName\nINVALID,Test Employee';
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
    const emp1 = String(generateTestId(50)).padStart(4, '0');
    const emp2 = String(generateTestId(51)).padStart(4, '0');
    // 意図的に同じnfcTagUidを使用して重複エラーをテスト
    const duplicateTag = `DUPLICATE_TAG_${Date.now()}`;
    const csvContent = `employeeCode,displayName,nfcTagUid\n${emp1},Test Employee 1,${duplicateTag}\n${emp2},Test Employee 2,${duplicateTag}`;
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
    const emp = String(generateTestId(60)).padStart(4, '0');
    const item = `TO${String(generateTestId(61)).padStart(4, '0')}`;
    // 意図的に同じnfcTagUidを使用して重複エラーをテスト
    const sharedTag = `SHARED_TAG_${Date.now()}`;
    const employeesCsv = `employeeCode,displayName,nfcTagUid\n${emp},Test Employee,${sharedTag}`;
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
    expect(body.message).toContain('従業員とアイテムで同じnfcTagUidが使用されています');
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
    const empOld = String(generateTestId(80)).padStart(4, '0');
    const empNew = String(generateTestId(90)).padStart(4, '0');
    await createTestEmployee({ employeeCode: empOld, displayName: 'Original Employee' });

    const formData = new FormData();
    const csvContent = `employeeCode,displayName\n${empNew},New Employee`;
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
