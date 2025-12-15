import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildServer } from '../../app.js';
import { createTestUser } from './helpers.js';

// モック: BackupConfigLoader → Dropbox設定を返す
vi.mock('../../services/backup/backup-config.loader.js', () => {
  return {
    BackupConfigLoader: {
      load: vi.fn(async () => ({
        storage: {
          provider: 'dropbox',
          options: {
            accessToken: 'dummy-token',
            basePath: '/backups'
          }
        }
      })),
      save: vi.fn(async () => {})
    }
  };
});

// モック: DropboxStorageProvider → downloadでCSVを返す
vi.mock('../../services/backup/storage/dropbox-storage.provider.js', () => {
  class MockDropboxStorageProvider {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    constructor(_options: any) {}
    // eslint-disable-next-line class-methods-use-this
    async download(path: string): Promise<Buffer> {
      if (path.includes('employees')) {
        const emp = (Date.now() % 10000).toString().padStart(4, '0');
        return Buffer.from(`employeeCode,displayName\n${emp},Emp-${emp}`);
      }
      if (path.includes('items')) {
        const item = `TO${(Date.now() % 10000).toString().padStart(4, '0')}`;
        return Buffer.from(`itemCode,name\n${item},Item-${item}`);
      }
      throw new Error(`unexpected path: ${path}`);
    }
  }
  return { DropboxStorageProvider: MockDropboxStorageProvider };
});

describe('POST /api/imports/master/from-dropbox', () => {
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

  it('should import from dropbox paths (employees + items)', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/imports/master/from-dropbox',
      headers: {
        authorization: `Bearer ${adminToken}`
      },
      payload: {
        employeesPath: '/backups/csv/employees-20250101.csv',
        itemsPath: '/backups/csv/items-20250101.csv',
        replaceExisting: false
      }
    });

    expect(response.statusCode).toBe(200);
    const json = response.json() as { summary: Record<string, { processed: number; created: number; updated: number }>; source: string };
    expect(json.source).toBe('dropbox');
    expect(json.summary.employees?.processed).toBeGreaterThan(0);
    expect(json.summary.items?.processed).toBeGreaterThan(0);
  });
});
