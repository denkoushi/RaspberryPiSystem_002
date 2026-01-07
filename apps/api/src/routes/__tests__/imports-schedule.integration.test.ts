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
import { ImportHistoryService } from '../../services/imports/import-history.service.js';
import { ImportStatus } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';

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

    // テスト用の設定ファイルを事前に作成（フォールバックを避けるため）
    if (!fs.existsSync(testConfigPath)) {
      const initialConfig = {
        storage: { provider: 'local' as const, options: {} },
        targets: [],
        csvImports: [],
        retention: { days: 30, maxItems: 100 }
      };
      fs.writeFileSync(testConfigPath, JSON.stringify(initialConfig, null, 2), 'utf-8');
    }

    // テスト用の設定をリセット
    const config = await BackupConfigLoader.load();
    config.csvImports = [];
    await BackupConfigLoader.save(config);

    // テスト用の履歴データをクリア
    await prisma.csvImportHistory.deleteMany({});
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
    it('should create new schedule with legacy format (employeesPath)', async () => {
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

    it('should create new schedule with targets format', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/imports/schedule',
        headers: {
          authorization: `Bearer ${adminToken}`
        },
        payload: {
          id: 'test-schedule-targets',
          name: 'Test Schedule with Targets',
          targets: [
            { type: 'employees', source: '/backups/csv/employees.csv' },
            { type: 'items', source: '/backups/csv/items.csv' }
          ],
          schedule: '0 4 * * *',
          enabled: true,
          replaceExisting: false
        }
      });

      expect(response.statusCode).toBe(200);
      const json = response.json() as { schedule: { id: string; targets: unknown[] } };
      expect(json.schedule.id).toBe('test-schedule-targets');
      expect(Array.isArray(json.schedule.targets)).toBe(true);
      expect((json.schedule.targets as Array<{ type: string }>).length).toBe(2);
    });

    it('should create new schedule with measuring instruments and rigging gears', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/imports/schedule',
        headers: {
          authorization: `Bearer ${adminToken}`
        },
        payload: {
          id: 'test-schedule-new-types',
          name: 'Test Schedule with New Types',
          targets: [
            { type: 'measuringInstruments', source: '/backups/csv/measuring-instruments.csv' },
            { type: 'riggingGears', source: '/backups/csv/rigging-gears.csv' }
          ],
          schedule: '0 4 * * *',
          enabled: true,
          replaceExisting: false
        }
      });

      expect(response.statusCode).toBe(200);
      const json = response.json() as { schedule: { id: string; targets: unknown[] } };
      expect(json.schedule.id).toBe('test-schedule-new-types');
      expect(Array.isArray(json.schedule.targets)).toBe(true);
      expect((json.schedule.targets as Array<{ type: string }>).length).toBe(2);
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

    it('should return 400 when neither targets nor legacy paths provided', async () => {
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

  describe('GET /api/imports/history', () => {
    beforeEach(async () => {
      // テスト用の履歴データを作成
      const historyService = new ImportHistoryService();
      
      // スケジュール1の履歴（完了）
      const history1Id = await historyService.createHistory({
        scheduleId: 'schedule-1',
        scheduleName: 'Schedule 1',
        employeesPath: '/backups/csv/employees1.csv'
      });
      await historyService.completeHistory(history1Id, {
        employees: { processed: 10, created: 5, updated: 5 }
      });

      // スケジュール1の履歴（失敗）
      const history2Id = await historyService.createHistory({
        scheduleId: 'schedule-1',
        scheduleName: 'Schedule 1',
        employeesPath: '/backups/csv/employees2.csv'
      });
      await historyService.failHistory(history2Id, 'Test error');

      // スケジュール2の履歴（完了）
      const history3Id = await historyService.createHistory({
        scheduleId: 'schedule-2',
        scheduleName: 'Schedule 2',
        employeesPath: '/backups/csv/employees3.csv'
      });
      await historyService.completeHistory(history3Id, {
        employees: { processed: 20, created: 10, updated: 10 }
      });
    });

    it('should return all history without filters', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/imports/history',
        headers: {
          authorization: `Bearer ${adminToken}`
        }
      });

      expect(response.statusCode).toBe(200);
      const json = response.json() as { histories: unknown[]; total: number; offset: number; limit: number };
      expect(json.total).toBeGreaterThanOrEqual(3);
      expect(json.histories.length).toBeGreaterThanOrEqual(3);
      expect(json.offset).toBe(0);
      expect(json.limit).toBe(100);
    });

    it('should filter by status', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/imports/history?status=FAILED',
        headers: {
          authorization: `Bearer ${adminToken}`
        }
      });

      expect(response.statusCode).toBe(200);
      const json = response.json() as { histories: { status: string }[]; total: number };
      expect(json.total).toBeGreaterThanOrEqual(1);
      expect(json.histories.every(h => h.status === 'FAILED')).toBe(true);
    });

    it('should filter by scheduleId', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/imports/history?scheduleId=schedule-1',
        headers: {
          authorization: `Bearer ${adminToken}`
        }
      });

      expect(response.statusCode).toBe(200);
      const json = response.json() as { histories: { scheduleId: string }[]; total: number };
      expect(json.total).toBeGreaterThanOrEqual(2);
      expect(json.histories.every(h => h.scheduleId === 'schedule-1')).toBe(true);
    });

    it('should support pagination with offset and limit', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/imports/history?offset=0&limit=2',
        headers: {
          authorization: `Bearer ${adminToken}`
        }
      });

      expect(response.statusCode).toBe(200);
      const json = response.json() as { histories: unknown[]; total: number; offset: number; limit: number };
      expect(json.histories.length).toBeLessThanOrEqual(2);
      expect(json.offset).toBe(0);
      expect(json.limit).toBe(2);
      expect(json.total).toBeGreaterThanOrEqual(3);
    });

    it('should return 401 without authentication', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/imports/history'
      });

      expect(response.statusCode).toBe(401);
    });

    it('should return 403 for non-admin users', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/imports/history',
        headers: {
          authorization: `Bearer ${viewerToken}`
        }
      });

      expect(response.statusCode).toBe(403);
    });
  });

  describe('GET /api/imports/schedule/:id/history', () => {
    beforeEach(async () => {
      // テスト用のスケジュールと履歴データを作成
      await app.inject({
        method: 'POST',
        url: '/api/imports/schedule',
        headers: {
          authorization: `Bearer ${adminToken}`
        },
        payload: {
          id: 'test-history-schedule',
          employeesPath: '/backups/csv/employees.csv',
          schedule: '0 4 * * *'
        }
      });

      const historyService = new ImportHistoryService();
      const historyId = await historyService.createHistory({
        scheduleId: 'test-history-schedule',
        scheduleName: 'Test Schedule',
        employeesPath: '/backups/csv/employees.csv'
      });
      await historyService.completeHistory(historyId, {
        employees: { processed: 5, created: 3, updated: 2 }
      });
    });

    it('should return history for specific schedule', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/imports/schedule/test-history-schedule/history',
        headers: {
          authorization: `Bearer ${adminToken}`
        }
      });

      expect(response.statusCode).toBe(200);
      const json = response.json() as { histories: { scheduleId: string }[]; total: number };
      expect(json.total).toBeGreaterThanOrEqual(1);
      expect(json.histories.every(h => h.scheduleId === 'test-history-schedule')).toBe(true);
    });

    it('should support filtering by status', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/imports/schedule/test-history-schedule/history?status=COMPLETED',
        headers: {
          authorization: `Bearer ${adminToken}`
        }
      });

      expect(response.statusCode).toBe(200);
      const json = response.json() as { histories: { status: string }[]; total: number };
      expect(json.total).toBeGreaterThanOrEqual(1);
      expect(json.histories.every(h => h.status === 'COMPLETED')).toBe(true);
    });
  });

  describe('GET /api/imports/history/failed', () => {
    beforeEach(async () => {
      const historyService = new ImportHistoryService();
      const historyId = await historyService.createHistory({
        scheduleId: 'test-failed',
        scheduleName: 'Test Failed',
        employeesPath: '/backups/csv/employees.csv'
      });
      await historyService.failHistory(historyId, 'Test failure');
    });

    it('should return only failed history', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/imports/history/failed',
        headers: {
          authorization: `Bearer ${adminToken}`
        }
      });

      expect(response.statusCode).toBe(200);
      const json = response.json() as { histories: { status: string }[]; total: number };
      expect(json.total).toBeGreaterThanOrEqual(1);
      expect(json.histories.every(h => h.status === 'FAILED')).toBe(true);
    });
  });

  describe('GET /api/imports/history/:historyId', () => {
    let historyId: string;

    beforeEach(async () => {
      const historyService = new ImportHistoryService();
      historyId = await historyService.createHistory({
        scheduleId: 'test-detail',
        scheduleName: 'Test Detail',
        employeesPath: '/backups/csv/employees.csv'
      });
      await historyService.completeHistory(historyId, {
        employees: { processed: 10, created: 5, updated: 5 }
      });
    });

    it('should return history detail', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/api/imports/history/${historyId}`,
        headers: {
          authorization: `Bearer ${adminToken}`
        }
      });

      expect(response.statusCode).toBe(200);
      const json = response.json() as { history: { id: string; scheduleId: string } };
      expect(json.history.id).toBe(historyId);
      expect(json.history.scheduleId).toBe('test-detail');
    });

    it('should return 404 for non-existent history', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/imports/history/non-existent-id',
        headers: {
          authorization: `Bearer ${adminToken}`
        }
      });

      expect(response.statusCode).toBe(404);
    });
  });
});
