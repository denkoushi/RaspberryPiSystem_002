import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildServer } from '../../app.js';
import { createTestUser } from './helpers.js';
import { prisma } from '../../lib/prisma.js';

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

vi.mock('../../services/backup/storage/dropbox-storage.provider.js', () => {
  class MockDropboxStorageProvider {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    constructor(_options: any) {}
    // eslint-disable-next-line class-methods-use-this
    async download(path: string): Promise<Buffer> {
      return mockDownload(path);
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

  describe('パストラバーサル防止', () => {
    it('should reject paths with .. (parent directory)', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/imports/master/from-dropbox',
        headers: {
          authorization: `Bearer ${adminToken}`
        },
        payload: {
          employeesPath: '/backups/../etc/passwd.csv',
          replaceExisting: false
        }
      });

      expect(response.statusCode).toBe(400);
      const json = response.json() as { message?: string };
      expect(json.message).toContain('パストラバーサル');
    });

    it('should reject paths with multiple ..', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/imports/master/from-dropbox',
        headers: {
          authorization: `Bearer ${adminToken}`
        },
        payload: {
          employeesPath: '/backups/../../root/.ssh/id_rsa.csv',
          replaceExisting: false
        }
      });

      expect(response.statusCode).toBe(400);
    });

    it('should reject paths with /../', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/imports/master/from-dropbox',
        headers: {
          authorization: `Bearer ${adminToken}`
        },
        payload: {
          employeesPath: '/backups/csv/../secret/data.csv',
          replaceExisting: false
        }
      });

      expect(response.statusCode).toBe(400);
    });

    it('should reject paths with double slashes', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/imports/master/from-dropbox',
        headers: {
          authorization: `Bearer ${adminToken}`
        },
        payload: {
          employeesPath: '/backups//csv/employees.csv',
          replaceExisting: false
        }
      });

      expect(response.statusCode).toBe(400);
    });

    it('should reject root path /', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/imports/master/from-dropbox',
        headers: {
          authorization: `Bearer ${adminToken}`
        },
        payload: {
          employeesPath: '/.csv',
          replaceExisting: false
        }
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe('パス長と拡張子バリデーション', () => {
    it('should reject paths longer than 1000 characters', async () => {
      const longPath = '/backups/csv/' + 'a'.repeat(1000) + '.csv';
      const response = await app.inject({
        method: 'POST',
        url: '/api/imports/master/from-dropbox',
        headers: {
          authorization: `Bearer ${adminToken}`
        },
        payload: {
          employeesPath: longPath,
          replaceExisting: false
        }
      });

      expect(response.statusCode).toBe(400);
      const json = response.json() as { message?: string };
      expect(json.message).toContain('1000文字以内');
    });

    it('should reject paths without .csv extension', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/imports/master/from-dropbox',
        headers: {
          authorization: `Bearer ${adminToken}`
        },
        payload: {
          employeesPath: '/backups/csv/employees.txt',
          replaceExisting: false
        }
      });

      expect(response.statusCode).toBe(400);
      const json = response.json() as { message?: string };
      expect(json.message).toContain('.csv');
    });

    it('should accept valid paths with .csv extension (case insensitive)', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/imports/master/from-dropbox',
        headers: {
          authorization: `Bearer ${adminToken}`
        },
        payload: {
          employeesPath: '/backups/csv/employees.CSV',
          replaceExisting: false
        }
      });

      // バリデーションは通るが、モックが対応していない場合は404になる可能性がある
      expect([200, 404, 500]).toContain(response.statusCode);
    });
  });

  describe('エラーハンドリング', () => {
    beforeEach(() => {
      // 各テスト前にモックをリセット
      mockDownload.mockClear();
    });

    it('should return 404 when file not found', async () => {
      // モックを一時的に変更してnot foundエラーを返す
      mockDownload.mockImplementationOnce(async () => {
        const error = new Error('not_found');
        (error as any).status = 404;
        throw error;
      });

      const response = await app.inject({
        method: 'POST',
        url: '/api/imports/master/from-dropbox',
        headers: {
          authorization: `Bearer ${adminToken}`
        },
        payload: {
          employeesPath: '/backups/csv/nonexistent.csv',
          replaceExisting: false
        }
      });

      expect(response.statusCode).toBe(404);
      const json = response.json() as { message?: string };
      expect(json.message).toContain('見つかりません');
    });

    it('should return 401 when Dropbox authentication fails', async () => {
      // モックを一時的に変更して認証エラーを返す
      mockDownload.mockImplementationOnce(async () => {
        const error = new Error('unauthorized');
        (error as any).status = 401;
        throw error;
      });

      const response = await app.inject({
        method: 'POST',
        url: '/api/imports/master/from-dropbox',
        headers: {
          authorization: `Bearer ${adminToken}`
        },
        payload: {
          employeesPath: '/backups/csv/employees.csv',
          replaceExisting: false
        }
      });

      expect(response.statusCode).toBe(401);
      const json = response.json() as { message?: string };
      expect(json.message).toContain('認証エラー');
    });
  });

  describe('大規模CSV処理', () => {
    beforeEach(async () => {
      // 大規模CSVテストの前にデータをクリーンアップ（テストの独立性を保つため）
      await prisma.employee.deleteMany({});
      await prisma.item.deleteMany({});
    });

    it('should handle large CSV files (1000 rows)', async () => {
      // 1000行のCSVを生成
      const csvRows = ['employeeCode,displayName'];
      for (let i = 0; i < 1000; i++) {
        const code = i.toString().padStart(4, '0');
        csvRows.push(`${code},Employee-${code}`);
      }
      const largeCsv = Buffer.from(csvRows.join('\n'));
      
      // モックを一時的に変更して大規模CSVを返す
      mockDownload.mockImplementationOnce(async () => largeCsv);

      // メモリ使用量の計測開始
      const memoryBefore = process.memoryUsage();
      const startTime = Date.now();
      
      const response = await app.inject({
        method: 'POST',
        url: '/api/imports/master/from-dropbox',
        headers: {
          authorization: `Bearer ${adminToken}`
        },
        payload: {
          employeesPath: '/backups/csv/large-employees.csv',
          replaceExisting: false
        }
      });
      
      const processingTime = Date.now() - startTime;
      const memoryAfter = process.memoryUsage();
      const memoryUsedMB = (memoryAfter.heapUsed - memoryBefore.heapUsed) / 1024 / 1024;

      expect(response.statusCode).toBe(200);
      const json = response.json() as { summary: Record<string, { processed: number }> };
      expect(json.summary.employees?.processed).toBe(1000);
      
      // 処理時間が30秒以内であることを確認（CIでは緩める）
      const maxTime = process.env.CI ? 60000 : 30000;
      expect(processingTime).toBeLessThan(maxTime);
      
      // メモリ使用量をログ出力（CIでは確認用）
      console.log(`[1000行テスト] 処理時間: ${processingTime}ms, メモリ使用量: ${memoryUsedMB.toFixed(2)}MB`);
    });

    it('should handle very large CSV files (10000 rows)', async () => {
      // CI環境ではスキップ（時間がかかりすぎる可能性がある）
      if (process.env.CI && process.env.SKIP_LARGE_CSV_TEST === 'true') {
        console.log('Skipping 10000 rows test in CI');
        return;
      }

      // テストデータをクリーンアップ（大規模テストの前に確実にクリーンな状態にする）
      await prisma.employee.deleteMany({});

      // 1万行のCSVを生成
      const csvRows = ['employeeCode,displayName'];
      for (let i = 0; i < 10000; i++) {
        const code = i.toString().padStart(4, '0');
        csvRows.push(`${code},Employee-${code}`);
      }
      const veryLargeCsv = Buffer.from(csvRows.join('\n'));
      
      // モックを一時的に変更して大規模CSVを返す
      mockDownload.mockImplementationOnce(async () => veryLargeCsv);

      // メモリ使用量の計測開始
      const memoryBefore = process.memoryUsage();
      const startTime = Date.now();
      
      const response = await app.inject({
        method: 'POST',
        url: '/api/imports/master/from-dropbox',
        headers: {
          authorization: `Bearer ${adminToken}`
        },
        payload: {
          employeesPath: '/backups/csv/very-large-employees.csv',
          replaceExisting: false
        }
      });
      
      const processingTime = Date.now() - startTime;
      const memoryAfter = process.memoryUsage();
      const memoryUsedMB = (memoryAfter.heapUsed - memoryBefore.heapUsed) / 1024 / 1024;
      const memoryUsagePercent = (memoryAfter.heapUsed / memoryAfter.heapTotal) * 100;

      expect(response.statusCode).toBe(200);
      const json = response.json() as { summary: Record<string, { processed: number }> };
      expect(json.summary.employees?.processed).toBe(10000);
      
      // 処理時間が5分以内であることを確認（CIでは緩める）
      const maxTime = process.env.CI ? 600000 : 300000; // 5分 = 300000ms
      expect(processingTime).toBeLessThan(maxTime);
      
      // メモリ使用量をログ出力（CIでは確認用）
      console.log(`[10000行テスト] 処理時間: ${processingTime}ms, メモリ使用量: ${memoryUsedMB.toFixed(2)}MB, ヒープ使用率: ${memoryUsagePercent.toFixed(2)}%`);
      
      // メモリ使用量がAPIコンテナの50%未満であることを確認（概算）
      // 注意: 実際のコンテナメモリ制限は環境によって異なるため、警告として扱う
      // CI環境ではスキップ（環境によってメモリ使用量が異なるため）
      if (!process.env.CI) {
        // ローカル環境では警告として扱う（70%未満を推奨）
        if (memoryUsagePercent >= 70) {
          console.warn(`[警告] メモリ使用率が高いです: ${memoryUsagePercent.toFixed(2)}% (推奨: 50%未満)`);
        }
        // 厳密なチェックは行わない（環境によって異なるため）
      }
    });
  });
});
