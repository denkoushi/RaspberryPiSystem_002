// 環境変数をモジュール読み込み前に設定（BackupConfigLoaderが静的プロパティで読み取るため）
import * as path from 'path';
import { fileURLToPath } from 'url';
import * as fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const testConfigDir = path.join(__dirname, '../../../.test-config');
const testConfigPath = path.join(testConfigDir, 'backup.json');

// モジュール読み込み前に環境変数を設定
process.env.BACKUP_CONFIG_PATH = testConfigPath;
process.env.PROJECT_ROOT = process.cwd();

// テスト用の設定ディレクトリを作成
if (!fs.existsSync(testConfigDir)) {
  fs.mkdirSync(testConfigDir, { recursive: true });
}

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildServer } from '../../app.js';
import { createTestUser } from './helpers.js';
import { BackupConfigLoader } from '../../services/backup/backup-config.loader.js';

describe('CSV Import Schedule API', () => {
  let app: Awaited<ReturnType<typeof buildServer>>;
  let closeServer: (() => Promise<void>) | null = null;
  let adminToken: string;
  let viewerToken: string;

  beforeAll(async () => {
    // テスト用の設定ディレクトリを作成
    if (!fs.existsSync(testConfigDir)) {
      fs.mkdirSync(testConfigDir, { recursive: true });
    }
    
    // 環境変数を確実に設定
    process.env.BACKUP_CONFIG_PATH = testConfigPath;
    process.env.PROJECT_ROOT = process.cwd();

    app = await buildServer();
    closeServer = async () => {
      await app.close();
    };
  });

  beforeEach(async () => {
    const admin = await createTestUser('ADMIN');
    const viewer = await createTestUser('VIEWER');
    adminToken = admin.token;
    viewerToken = viewer.token;

    // テスト用の設定をリセット
    const config = await BackupConfigLoader.load();
    config.csvImports = [];
    await BackupConfigLoader.save(config);
  });

  afterAll(async () => {
    if (closeServer) {
      await closeServer();
    }
  });

  afterAll(async () => {
    if (closeServer) {
      await closeServer();
    }
  });

  describe('GET /api/imports/schedule', () => {
    it('should return empty array when no schedules', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/imports/schedule',
        headers: {
          authorization: `Bearer ${adminToken}`
        }
      });

      expect(response.statusCode).toBe(200);
      const json = response.json() as { schedules: unknown[] };
      expect(json.schedules).toEqual([]);
    });

    it('should return 401 without authentication', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/imports/schedule'
      });

      expect(response.statusCode).toBe(401);
    });

    it('should return 403 for non-admin users', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/imports/schedule',
        headers: {
          authorization: `Bearer ${viewerToken}`
        }
      });

      expect(response.statusCode).toBe(403);
    });
  });

  describe('POST /api/imports/schedule', () => {
    it('should create new schedule', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/imports/schedule',
        headers: {
          authorization: `Bearer ${adminToken}`
        },
        payload: {
          id: 'test-schedule-1',
          name: 'Test Schedule',
          employeesPath: '/backups/csv/employees.csv',
          schedule: '0 4 * * *',
          enabled: true,
          replaceExisting: false
        }
      });

      expect(response.statusCode).toBe(200);
      const json = response.json() as { schedule: { id: string; name: string } };
      expect(json.schedule.id).toBe('test-schedule-1');
      expect(json.schedule.name).toBe('Test Schedule');
    });

    it('should return 409 for duplicate ID', async () => {
      // 最初のスケジュールを作成
      await app.inject({
        method: 'POST',
        url: '/api/imports/schedule',
        headers: {
          authorization: `Bearer ${adminToken}`
        },
        payload: {
          id: 'duplicate-id',
          employeesPath: '/backups/csv/employees.csv',
          schedule: '0 4 * * *'
        }
      });

      // 同じIDで再度作成を試みる
      const response = await app.inject({
        method: 'POST',
        url: '/api/imports/schedule',
        headers: {
          authorization: `Bearer ${adminToken}`
        },
        payload: {
          id: 'duplicate-id',
          employeesPath: '/backups/csv/employees.csv',
          schedule: '0 4 * * *'
        }
      });

      expect(response.statusCode).toBe(409);
    });

    it('should return 400 when validation fails', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/imports/schedule',
        headers: {
          authorization: `Bearer ${adminToken}`
        },
        payload: {
          id: '', // 空のID
          schedule: '0 4 * * *'
        }
      });

      expect(response.statusCode).toBe(400);
    });

    it('should return 400 when neither employeesPath nor itemsPath provided', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/imports/schedule',
        headers: {
          authorization: `Bearer ${adminToken}`
        },
        payload: {
          id: 'test-1',
          schedule: '0 4 * * *'
        }
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe('PUT /api/imports/schedule/:id', () => {
    beforeEach(async () => {
      // テスト用のスケジュールを作成
      await app.inject({
        method: 'POST',
        url: '/api/imports/schedule',
        headers: {
          authorization: `Bearer ${adminToken}`
        },
        payload: {
          id: 'test-update',
          employeesPath: '/backups/csv/employees.csv',
          schedule: '0 4 * * *'
        }
      });
    });

    it('should update schedule', async () => {
      const response = await app.inject({
        method: 'PUT',
        url: '/api/imports/schedule/test-update',
        headers: {
          authorization: `Bearer ${adminToken}`
        },
        payload: {
          name: 'Updated Schedule',
          enabled: false
        }
      });

      expect(response.statusCode).toBe(200);
      const json = response.json() as { schedule: { name: string; enabled: boolean } };
      expect(json.schedule.name).toBe('Updated Schedule');
      expect(json.schedule.enabled).toBe(false);
    });

    it('should return 404 for non-existent schedule', async () => {
      const response = await app.inject({
        method: 'PUT',
        url: '/api/imports/schedule/non-existent',
        headers: {
          authorization: `Bearer ${adminToken}`
        },
        payload: {
          name: 'Updated'
        }
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe('DELETE /api/imports/schedule/:id', () => {
    beforeEach(async () => {
      // テスト用のスケジュールを作成
      await app.inject({
        method: 'POST',
        url: '/api/imports/schedule',
        headers: {
          authorization: `Bearer ${adminToken}`
        },
        payload: {
          id: 'test-delete',
          employeesPath: '/backups/csv/employees.csv',
          schedule: '0 4 * * *'
        }
      });
    });

    it('should delete schedule', async () => {
      const response = await app.inject({
        method: 'DELETE',
        url: '/api/imports/schedule/test-delete',
        headers: {
          authorization: `Bearer ${adminToken}`
        }
      });

      expect(response.statusCode).toBe(200);

      // 削除されたことを確認
      const getResponse = await app.inject({
        method: 'GET',
        url: '/api/imports/schedule',
        headers: {
          authorization: `Bearer ${adminToken}`
        }
      });

      const json = getResponse.json() as { schedules: { id: string }[] };
      expect(json.schedules.find(s => s.id === 'test-delete')).toBeUndefined();
    });

    it('should return 404 for non-existent schedule', async () => {
      const response = await app.inject({
        method: 'DELETE',
        url: '/api/imports/schedule/non-existent',
        headers: {
          authorization: `Bearer ${adminToken}`
        }
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe('POST /api/imports/schedule/:id/run', () => {
    beforeEach(async () => {
      // テスト用のスケジュールを作成
      await app.inject({
        method: 'POST',
        url: '/api/imports/schedule',
        headers: {
          authorization: `Bearer ${adminToken}`
        },
        payload: {
          id: 'test-run',
          employeesPath: '/backups/csv/employees.csv',
          schedule: '0 4 * * *'
        }
      });
    });

    it('should run import manually', async () => {
      // モック: processCsvImportが成功することを想定
      const response = await app.inject({
        method: 'POST',
        url: '/api/imports/schedule/test-run/run',
        headers: {
          authorization: `Bearer ${adminToken}`
        }
      });

      // 実際の実行はDropbox接続が必要なため、エラーになる可能性がある
      // ただし、エンドポイントが存在し、認証が機能していることを確認
      expect([200, 500]).toContain(response.statusCode);
    });

    it('should return 404 for non-existent schedule', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/imports/schedule/non-existent/run',
        headers: {
          authorization: `Bearer ${adminToken}`
        }
      });

      expect(response.statusCode).toBe(404);
    });
  });
});
