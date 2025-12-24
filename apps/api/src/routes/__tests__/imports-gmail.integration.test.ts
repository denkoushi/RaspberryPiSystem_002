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
            refreshToken: 'dummy-refresh-token',
            subjectPattern: '^\\[Pi5 Backup\\] (employees|items)-\\d{8}\\.csv$',
            labelName: 'Pi5/Processed'
          }
        }
      })),
      save: vi.fn(async () => {})
    }
  };
});

// モック: GmailStorageProvider → listとdownloadでCSVを返す
const mockList = vi.fn(async (): Promise<Array<{ path: string; sizeBytes?: number; modifiedAt?: Date }>> => {
  const emp = (Date.now() % 10000).toString().padStart(4, '0');
  const item = `TO${(Date.now() % 10000).toString().padStart(4, '0')}`;
  return [
    { path: `msg-employees-${emp}:att-employees-${emp}`, sizeBytes: 100 },
    { path: `msg-items-${item}:att-items-${item}`, sizeBytes: 100 }
  ];
});

const mockDownload = vi.fn(async (path: string): Promise<Buffer> => {
  if (path.includes('employees')) {
    const emp = (Date.now() % 10000).toString().padStart(4, '0');
    return Buffer.from(`employeeCode,displayName\n${emp},Emp-${emp}`);
  }
  if (path.includes('items')) {
    const item = `TO${(Date.now() % 10000).toString().padStart(4, '0')}`;
    return Buffer.from(`itemCode,name\n${item},Item-${item}`);
  }
  throw new Error(`unexpected path: ${path}`);
});

const mockMarkAsProcessed = vi.fn(async (): Promise<void> => {});

vi.mock('../../services/backup/storage/gmail-storage.provider.js', () => {
  class MockGmailStorageProvider {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    constructor(_options: any) {}
    // eslint-disable-next-line class-methods-use-this
    async list(_path: string) {
      return mockList();
    }
    // eslint-disable-next-line class-methods-use-this
    async download(path: string): Promise<Buffer> {
      return mockDownload(path);
    }
    // eslint-disable-next-line class-methods-use-this
    async markAsProcessed(_messageId: string): Promise<void> {
      return mockMarkAsProcessed();
    }
  }
  return { GmailStorageProvider: MockGmailStorageProvider };
});

// モック: GmailApiClient → getMessageで件名を返す
vi.mock('../../services/backup/gmail-api.client.js', () => {
  const mockGetMessage = vi.fn(async (messageId: string) => {
    if (messageId.includes('employees')) {
      return {
        id: messageId,
        threadId: 'thread1',
        labelIds: ['UNREAD'],
        snippet: 'Test',
        payload: {
          headers: [
            { name: 'Subject', value: '[Pi5 Backup] employees-20251224.csv' }
          ],
          parts: []
        }
      };
    }
    if (messageId.includes('items')) {
      return {
        id: messageId,
        threadId: 'thread2',
        labelIds: ['UNREAD'],
        snippet: 'Test',
        payload: {
          headers: [
            { name: 'Subject', value: '[Pi5 Backup] items-20251224.csv' }
          ],
          parts: []
        }
      };
    }
    return {
      id: messageId,
      threadId: 'thread3',
      labelIds: ['UNREAD'],
      snippet: 'Test',
      payload: {
        headers: [
          { name: 'Subject', value: 'Other Subject' }
        ],
        parts: []
      }
    };
  });

  return {
    GmailApiClient: vi.fn(() => ({
      getMessage: mockGetMessage
    }))
  };
});

describe('POST /api/imports/master/from-gmail', () => {
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
    vi.clearAllMocks();
  });

  afterAll(async () => {
    if (closeServer) {
      await closeServer();
    }
  });

  afterEach(async () => {
    // テストデータをクリーンアップ
    await prisma.loan.deleteMany();
    await prisma.transaction.deleteMany();
    await prisma.item.deleteMany();
    await prisma.employee.deleteMany();
  });

  it('should import from Gmail attachments (employees + items)', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/imports/master/from-gmail',
      headers: {
        authorization: `Bearer ${adminToken}`
      },
      payload: {}
    });

    expect(response.statusCode).toBe(200);
    const json = response.json() as { 
      summary: Record<string, { processed: number; created: number; updated: number }>; 
      source: string;
      processedMessageCount?: number;
    };
    expect(json.source).toBe('gmail');
    expect(json.summary.employees?.processed).toBeGreaterThan(0);
    expect(json.summary.items?.processed).toBeGreaterThan(0);
    expect(json.processedMessageCount).toBeGreaterThan(0);
  });

  it('should return message when no emails found', async () => {
    mockList.mockResolvedValueOnce([]);

    const response = await app.inject({
      method: 'POST',
      url: '/api/imports/master/from-gmail',
      headers: {
        authorization: `Bearer ${adminToken}`
      },
      payload: {}
    });

    expect(response.statusCode).toBe(200);
    const json = response.json() as { 
      summary: Record<string, unknown>; 
      source: string;
      message?: string;
    };
    expect(json.source).toBe('gmail');
    expect(json.message).toContain('該当するメールが見つかりませんでした');
  });

  it('should mark messages as processed after import', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/imports/master/from-gmail',
      headers: {
        authorization: `Bearer ${adminToken}`
      },
      payload: {}
    });

    expect(response.statusCode).toBe(200);
    // markAsProcessedが呼ばれたことを確認
    expect(mockMarkAsProcessed).toHaveBeenCalled();
  });

  it('should require admin authentication', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/imports/master/from-gmail',
      payload: {}
    });

    expect(response.statusCode).toBe(401);
  });
});
