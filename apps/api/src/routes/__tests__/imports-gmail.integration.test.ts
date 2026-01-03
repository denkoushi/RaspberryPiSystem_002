import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildServer } from '../../app.js';
import { createTestUser } from './helpers.js';
import { prisma } from '../../lib/prisma.js';

// モック: BackupConfigLoader → Gmail設定を返す
vi.mock('../../services/backup/backup-config.loader.js', () => {
  return {
    BackupConfigLoader: {
      load: vi.fn(async () => ({
        storage: {
          provider: 'gmail',
          options: {
            accessToken: 'dummy-token',
            clientId: 'dummy-client-id',
            clientSecret: 'dummy-client-secret',
            subjectPattern: '[Pi5 CSV Import]',
            fromEmail: 'powerautomate@example.com'
          }
        }
      })),
      save: vi.fn(async () => {})
    }
  };
});

// モック: GmailStorageProvider → downloadでCSVを返す
const mockDownload = vi.fn(async (path: string): Promise<Buffer> => {
  if (path.includes('employees') || path.toLowerCase().includes('employee')) {
    const emp = (Date.now() % 10000).toString().padStart(4, '0');
    return Buffer.from(`employeeCode,lastName,firstName\n${emp},Emp,${emp}`);
  }
  if (path.includes('items') || path.toLowerCase().includes('item')) {
    const item = `TO${(Date.now() % 10000).toString().padStart(4, '0')}`;
    return Buffer.from(`itemCode,name\n${item},Item-${item}`);
  }
  throw new Error(`unexpected path: ${path}`);
});

const mockList = vi.fn(async (): Promise<Array<{ path: string; sizeBytes?: number; modifiedAt?: Date }>> => {
  return [
    { path: '[Pi5 CSV Import] employees', sizeBytes: 100, modifiedAt: new Date() },
    { path: '[Pi5 CSV Import] items', sizeBytes: 100, modifiedAt: new Date() }
  ];
});

vi.mock('../../services/backup/storage/gmail-storage.provider.js', () => {
  class MockGmailStorageProvider {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    constructor(_options: any) {}
    // eslint-disable-next-line class-methods-use-this
    async download(path: string): Promise<Buffer> {
      return mockDownload(path);
    }
    // eslint-disable-next-line class-methods-use-this
    async list(_path: string): Promise<Array<{ path: string; sizeBytes?: number; modifiedAt?: Date }>> {
      return mockList();
    }
    // eslint-disable-next-line class-methods-use-this
    async upload(_file: Buffer, _path: string): Promise<void> {
      throw new Error('GmailStorageProvider does not support upload');
    }
    // eslint-disable-next-line class-methods-use-this
    async delete(_path: string): Promise<void> {
      throw new Error('GmailStorageProvider does not support delete');
    }
  }
  return { GmailStorageProvider: MockGmailStorageProvider };
});

describe('POST /api/imports/master/from-dropbox (Gmail provider)', () => {
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
    mockDownload.mockClear();
    mockList.mockClear();
  });

  afterAll(async () => {
    if (closeServer) {
      await closeServer();
    }
  });

  afterEach(async () => {
    // テストデータをクリーンアップ
    await prisma.loan.deleteMany({});
    await prisma.transaction.deleteMany({});
    await prisma.item.deleteMany({});
    await prisma.employee.deleteMany({});
  });

  it('should return 400 when neither employeesPath nor itemsPath is provided', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/imports/master/from-dropbox',
      headers: {
        authorization: `Bearer ${adminToken}`
      },
      payload: {}
    });

    expect(response.statusCode).toBe(400);
  });

  it('should import from Gmail using subject pattern (employees + items)', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/imports/master/from-dropbox',
      headers: {
        authorization: `Bearer ${adminToken}`
      },
      payload: {
        employeesPath: '[Pi5 CSV Import] employees',
        itemsPath: '[Pi5 CSV Import] items',
        replaceExisting: false
      }
    });

    expect(response.statusCode).toBe(200);
    const json = response.json() as { summary: Record<string, { processed: number; created: number; updated: number }>; source: string };
    expect(json).toHaveProperty('summary');
    expect(json.summary).toHaveProperty('employees');
    expect(json.summary).toHaveProperty('items');
    expect(json.summary.employees.processed).toBeGreaterThan(0);
    expect(json.summary.items.processed).toBeGreaterThan(0);

    // GmailStorageProviderのdownloadが呼ばれたことを確認
    expect(mockDownload).toHaveBeenCalledWith('[Pi5 CSV Import] employees');
    expect(mockDownload).toHaveBeenCalledWith('[Pi5 CSV Import] items');
  });

  it('should import only employees from Gmail', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/imports/master/from-dropbox',
      headers: {
        authorization: `Bearer ${adminToken}`
      },
      payload: {
        employeesPath: '[Pi5 CSV Import] employees',
        replaceExisting: false
      }
    });

    expect(response.statusCode).toBe(200);
    const json = response.json() as { summary: Record<string, { processed: number; created: number; updated: number }> };
    expect(json.summary).toHaveProperty('employees');
    expect(json.summary).not.toHaveProperty('items');
    expect(mockDownload).toHaveBeenCalledWith('[Pi5 CSV Import] employees');
    expect(mockDownload).not.toHaveBeenCalledWith(expect.stringContaining('items'));
  });

  it('should import only items from Gmail', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/imports/master/from-dropbox',
      headers: {
        authorization: `Bearer ${adminToken}`
      },
      payload: {
        itemsPath: '[Pi5 CSV Import] items',
        replaceExisting: false
      }
    });

    expect(response.statusCode).toBe(200);
    const json = response.json() as { summary: Record<string, { processed: number; created: number; updated: number }> };
    expect(json.summary).toHaveProperty('items');
    expect(json.summary).not.toHaveProperty('employees');
    expect(mockDownload).toHaveBeenCalledWith('[Pi5 CSV Import] items');
    expect(mockDownload).not.toHaveBeenCalledWith(expect.stringContaining('employees'));
  });

  it('should handle replaceExisting=true', async () => {
    // 既存データを作成
    await prisma.employee.create({
      data: {
        employeeCode: '0001',
        displayName: 'Existing Employee'
      }
    });
    await prisma.item.create({
      data: {
        itemCode: 'TO0001',
        name: 'Existing Item'
      }
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/imports/master/from-dropbox',
      headers: {
        authorization: `Bearer ${adminToken}`
      },
      payload: {
        employeesPath: '[Pi5 CSV Import] employees',
        itemsPath: '[Pi5 CSV Import] items',
        replaceExisting: true
      }
    });

    expect(response.statusCode).toBe(200);
    const json = response.json() as { summary: Record<string, { processed: number; created: number; updated: number }> };
    expect(json.summary.employees.processed).toBeGreaterThan(0);
    expect(json.summary.items.processed).toBeGreaterThan(0);
  });
});

