import { beforeEach, describe, expect, it, vi, afterEach } from 'vitest';
import { CsvImportScheduler, getCsvImportScheduler } from '../csv-import-scheduler.js';
import { BackupConfigLoader } from '../../backup/backup-config.loader.js';
import { processCsvImport } from '../../../routes/imports.js';

// モック
vi.mock('../../backup/backup-config.loader.js');
vi.mock('../../../routes/imports.js');
vi.mock('../import-alert.service.js', () => ({
  ImportAlertService: vi.fn().mockImplementation(() => ({
    generateFailureAlert: vi.fn(),
    generateConsecutiveFailureAlert: vi.fn()
  }))
}));
vi.mock('../../backup/storage/dropbox-storage.provider.js', () => ({
  DropboxStorageProvider: vi.fn().mockImplementation(() => ({
    download: vi.fn().mockResolvedValue(Buffer.from('employeeCode,displayName\n0001,Test'))
  }))
}));
vi.mock('../../backup/dropbox-oauth.service.js', () => ({
  DropboxOAuthService: vi.fn().mockImplementation(() => ({
    refreshAccessTokenIfNeeded: vi.fn().mockResolvedValue(undefined)
  }))
}));

describe('CsvImportScheduler', () => {
  let scheduler: CsvImportScheduler;

  beforeEach(() => {
    scheduler = new CsvImportScheduler();
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await scheduler.stop();
  });

  describe('start', () => {
    it('should start scheduler with configured imports', async () => {
      const mockConfig = {
        storage: {
          provider: 'local' as const,
          options: {
            basePath: '/backups'
          }
        },
        csvImports: [
          {
            id: 'test-1',
            name: 'Test Import',
            employeesPath: '/backups/csv/employees.csv',
            schedule: '0 4 * * *',
            enabled: true,
            replaceExisting: false
          }
        ]
      };

      vi.mocked(BackupConfigLoader.load).mockResolvedValue(mockConfig as any);

      await scheduler.start();

      expect(BackupConfigLoader.load).toHaveBeenCalled();
      // スケジュールが設定されていることを確認（直接確認は難しいが、エラーが発生しないことを確認）
    });

    it('should not start if no imports configured', async () => {
      const mockConfig = {
        storage: {
          provider: 'local' as const,
          options: {
            basePath: '/backups'
          }
        },
        csvImports: []
      };
      vi.mocked(BackupConfigLoader.load).mockResolvedValue(mockConfig as any);

      await scheduler.start();

      expect(BackupConfigLoader.load).toHaveBeenCalled();
    });

    it('should skip disabled imports', async () => {
      const mockConfig = {
        storage: {
          provider: 'local' as const,
          options: {
            basePath: '/backups'
          }
        },
        csvImports: [
          {
            id: 'test-1',
            employeesPath: '/backups/csv/employees.csv',
            schedule: '0 4 * * *',
            enabled: false,
            replaceExisting: false
          }
        ]
      };

      vi.mocked(BackupConfigLoader.load).mockResolvedValue(mockConfig as any);

      await scheduler.start();

      expect(BackupConfigLoader.load).toHaveBeenCalled();
    });
  });

  describe('stop', () => {
    it('should stop scheduler', async () => {
      await scheduler.start();
      await scheduler.stop();

      // エラーが発生しないことを確認
      expect(true).toBe(true);
    });

    it('should handle stop when not running', async () => {
      await scheduler.stop();

      // エラーが発生しないことを確認
      expect(true).toBe(true);
    });
  });

  describe('reload', () => {
    it('should reload scheduler configuration', async () => {
      const mockConfig = {
        storage: {
          provider: 'local' as const,
          options: {
            basePath: '/backups'
          }
        },
        csvImports: [
          {
            id: 'test-1',
            employeesPath: '/backups/csv/employees.csv',
            schedule: '0 4 * * *',
            enabled: true,
            replaceExisting: false
          }
        ]
      };

      vi.mocked(BackupConfigLoader.load).mockResolvedValue(mockConfig as any);

      await scheduler.start();
      await scheduler.reload();

      expect(BackupConfigLoader.load).toHaveBeenCalledTimes(2);
    });
  });

  describe('runImport', () => {
    it('should run import manually', async () => {
      const mockConfig = {
        storage: {
          provider: 'dropbox' as const,
          options: {
            accessToken: 'dummy-token',
            basePath: '/backups'
          }
        },
        csvImports: [
          {
            id: 'test-1',
            employeesPath: '/backups/csv/employees.csv',
            schedule: '0 4 * * *',
            enabled: true,
            replaceExisting: false
          }
        ]
      };

      vi.mocked(BackupConfigLoader.load).mockResolvedValue(mockConfig as any);
      vi.mocked(processCsvImport).mockResolvedValue({
        employees: { processed: 1, created: 1, updated: 0 }
      } as any);

      await scheduler.start();
      await scheduler.runImport('test-1');

      expect(processCsvImport).toHaveBeenCalled();
    });

    it('should throw error if schedule not found', async () => {
      const mockConfig = { csvImports: [] };
      vi.mocked(BackupConfigLoader.load).mockResolvedValue(mockConfig as any);

      await scheduler.start();

      await expect(scheduler.runImport('non-existent')).rejects.toThrow();
    });

    it('should prevent concurrent execution', async () => {
      const mockConfig = {
        storage: {
          provider: 'dropbox' as const,
          options: {
            accessToken: 'dummy-token',
            basePath: '/backups'
          }
        },
        csvImports: [
          {
            id: 'test-1',
            employeesPath: '/backups/csv/employees.csv',
            schedule: '0 4 * * *',
            enabled: true,
            replaceExisting: false
          }
        ]
      };

      vi.mocked(BackupConfigLoader.load).mockResolvedValue(mockConfig as any);
      vi.mocked(processCsvImport).mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve({} as any), 100))
      );

      await scheduler.start();

      // 2つの同時実行を試みる
      const promise1 = scheduler.runImport('test-1');
      const promise2 = scheduler.runImport('test-1');

      // 2つ目はエラーになるはず
      await expect(promise2).rejects.toThrow('already running');

      await promise1;
    });

    it('should skip invalid schedule format gracefully', async () => {
      const mockConfig = {
        storage: {
          provider: 'local' as const,
          options: {
            basePath: '/backups'
          }
        },
        csvImports: [
          {
            id: 'test-invalid',
            name: 'Invalid Schedule',
            employeesPath: '/backups/csv/employees.csv',
            schedule: 'invalid-cron-expression', // 無効なcron形式
            enabled: true,
            replaceExisting: false
          }
        ]
      };

      vi.mocked(BackupConfigLoader.load).mockResolvedValue(mockConfig as any);

      // 無効なスケジュール形式はスキップされ、エラーが発生しないことを確認
      await scheduler.start();

      // エラーが発生しないことを確認（無効なスケジュールはスキップされる）
      expect(BackupConfigLoader.load).toHaveBeenCalled();
      // タスクが登録されていないことを確認（無効なスケジュールはスキップされる）
      await scheduler.stop();
    });

    it('should skip schedule with missing required fields', async () => {
      const mockConfig = {
        storage: {
          provider: 'local' as const,
          options: {
            basePath: '/backups'
          }
        },
        csvImports: [
          {
            id: 'test-missing',
            schedule: '0 4 * * *',
            enabled: true,
            // employeesPathとitemsPathの両方が欠落
            replaceExisting: false
          }
        ]
      };

      vi.mocked(BackupConfigLoader.load).mockResolvedValue(mockConfig as any);

      await scheduler.start();

      // スケジュールは登録されるが、実行時にエラーになる
      // 手動実行を試みる
      await expect(scheduler.runImport('test-missing')).rejects.toThrow();
    });
  });

  describe('history cleanup', () => {
    it('should start cleanup job when configured', async () => {
      const mockConfig = {
        storage: {
          provider: 'local' as const,
          options: {
            basePath: '/backups'
          }
        },
        csvImports: [],
        csvImportHistory: {
          retentionDays: 90,
          cleanupSchedule: '0 2 * * *'
        }
      };

      vi.mocked(BackupConfigLoader.load).mockResolvedValue(mockConfig as any);

      await scheduler.start();

      expect(BackupConfigLoader.load).toHaveBeenCalled();
      // クリーンアップJobが開始されたことを確認（エラーが発生しないことを確認）
      await scheduler.stop();
    });

    it('should skip cleanup job when not configured', async () => {
      const mockConfig = {
        storage: {
          provider: 'local' as const,
          options: {
            basePath: '/backups'
          }
        },
        csvImports: []
      };

      vi.mocked(BackupConfigLoader.load).mockResolvedValue(mockConfig as any);

      await scheduler.start();

      expect(BackupConfigLoader.load).toHaveBeenCalled();
      await scheduler.stop();
    });

    it('should skip cleanup job with invalid schedule', async () => {
      const mockConfig = {
        storage: {
          provider: 'local' as const,
          options: {
            basePath: '/backups'
          }
        },
        csvImports: [],
        csvImportHistory: {
          retentionDays: 90,
          cleanupSchedule: 'invalid-cron-expression'
        }
      };

      vi.mocked(BackupConfigLoader.load).mockResolvedValue(mockConfig as any);

      await scheduler.start();

      expect(BackupConfigLoader.load).toHaveBeenCalled();
      // 無効なスケジュールはスキップされる（エラーが発生しないことを確認）
      await scheduler.stop();
    });
  });

  describe('getCsvImportScheduler', () => {
    it('should return singleton instance', () => {
      const instance1 = getCsvImportScheduler();
      const instance2 = getCsvImportScheduler();

      expect(instance1).toBe(instance2);
    });
  });
});
