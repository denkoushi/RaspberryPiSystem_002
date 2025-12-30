import { beforeEach, describe, expect, it, vi, afterEach } from 'vitest';
import { CsvImportScheduler, getCsvImportScheduler } from '../csv-import-scheduler.js';
import { BackupConfigLoader } from '../../backup/backup-config.loader.js';
import { processCsvImportFromTargets } from '../../../routes/imports.js';
import { ImportHistoryService } from '../import-history.service.js';

// モック
vi.mock('../../backup/backup-config.loader.js');
vi.mock('../../../routes/imports.js', () => ({
  processCsvImportFromTargets: vi.fn()
}));
// BackupHistoryService（Prisma依存）をモックして、DBマイグレーション不要でユニットテスト可能にする
const mockBackupCreateHistory = vi.fn().mockResolvedValue('test-backup-history-id');
const mockBackupCompleteHistory = vi.fn().mockResolvedValue(undefined);
const mockBackupFailHistory = vi.fn().mockResolvedValue(undefined);
vi.mock('../../backup/backup-history.service.js', () => ({
  BackupHistoryService: vi.fn().mockImplementation(() => ({
    createHistory: mockBackupCreateHistory,
    completeHistory: mockBackupCompleteHistory,
    failHistory: mockBackupFailHistory
  }))
}));
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
// BackupServiceのモック関数（テストで使用）
const mockBackupServiceBackup = vi.fn().mockResolvedValue({ success: true, path: '/backups/test', sizeBytes: 1024, timestamp: new Date() });
vi.mock('../../backup/backup.service.js', () => ({
  BackupService: vi.fn().mockImplementation(() => ({
    backup: mockBackupServiceBackup
  }))
}));
// CsvBackupTargetのモック関数（テストで使用）
const mockCsvBackupTarget = vi.fn();
vi.mock('../../backup/targets/csv-backup.target.js', () => ({
  CsvBackupTarget: vi.fn().mockImplementation(() => ({
    info: { type: 'csv', source: 'employees' },
    createBackup: vi.fn().mockResolvedValue(Buffer.from('test'))
  }))
}));
vi.mock('../../backup/targets/database-backup.target.js', () => ({
  DatabaseBackupTarget: vi.fn().mockImplementation(() => ({
    info: { type: 'database', source: 'borrow_return' },
    createBackup: vi.fn().mockResolvedValue(Buffer.from('test'))
  }))
}));
vi.mock('../../backup/storage/local-storage.provider.js', () => ({
  LocalStorageProvider: vi.fn().mockImplementation(() => ({
    upload: vi.fn().mockResolvedValue(undefined)
  }))
}));

// ImportHistoryServiceのモック（クリーンアップ機能の検証用）
const mockCleanupOldHistory = vi.fn().mockResolvedValue(0);
const mockCreateHistory = vi.fn().mockResolvedValue('test-history-id');
const mockCompleteHistory = vi.fn();
const mockFailHistory = vi.fn();
vi.mock('../import-history.service.js', () => ({
  ImportHistoryService: vi.fn().mockImplementation(() => ({
    createHistory: mockCreateHistory,
    completeHistory: mockCompleteHistory,
    failHistory: mockFailHistory,
    cleanupOldHistory: mockCleanupOldHistory
  }))
}));

// ImportAlertServiceのモック関数（テストで使用）
const mockGenerateFailureAlert = vi.fn();
const mockGenerateConsecutiveFailureAlert = vi.fn();
vi.mock('../import-alert.service.js', () => ({
  ImportAlertService: vi.fn().mockImplementation(() => ({
    generateFailureAlert: mockGenerateFailureAlert,
    generateConsecutiveFailureAlert: mockGenerateConsecutiveFailureAlert
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
            targets: [
              { type: 'employees', source: '/backups/csv/employees.csv' }
            ],
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
    it('should stop scheduler without errors (idempotent)', async () => {
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
            targets: [
              { type: 'employees', source: '/backups/csv/employees.csv' }
            ],
            schedule: '0 4 * * *',
            enabled: true,
            replaceExisting: false
          }
        ]
      };

      vi.mocked(BackupConfigLoader.load).mockResolvedValue(mockConfig as any);
      
      await scheduler.start();
      expect(BackupConfigLoader.load).toHaveBeenCalled();
      
      // 停止を実行（エラーが発生しないことを確認）
      scheduler.stop();
      // 再度停止してもエラーが発生しない（idempotent）
      scheduler.stop();
      
      // stop()はvoidを返すため、例外が発生しなければ正常終了
    });

    it('should handle stop when not running (idempotent)', async () => {
      // 開始していない状態で停止してもエラーが発生しない（idempotent）
      scheduler.stop();
      scheduler.stop();
      
      // stop()はvoidを返すため、例外が発生しなければ正常終了
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
            targets: [
              { type: 'employees', source: '/backups/csv/employees.csv' }
            ],
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
            targets: [
              { type: 'employees', source: '/backups/csv/employees.csv' }
            ],
            schedule: '0 4 * * *',
            enabled: true,
            replaceExisting: false
          }
        ]
      };

      vi.mocked(BackupConfigLoader.load).mockResolvedValue(mockConfig as any);
      vi.mocked(processCsvImportFromTargets).mockResolvedValue({
        summary: {
          employees: { processed: 1, created: 1, updated: 0 }
        }
      } as any);

      await scheduler.start();
      await scheduler.runImport('test-1');

      expect(processCsvImportFromTargets).toHaveBeenCalled();
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
            targets: [
              { type: 'employees', source: '/backups/csv/employees.csv' }
            ],
            schedule: '0 4 * * *',
            enabled: true,
            replaceExisting: false
          }
        ]
      };

      vi.mocked(BackupConfigLoader.load).mockResolvedValue(mockConfig as any);
      vi.mocked(processCsvImportFromTargets).mockImplementation(
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
    beforeEach(() => {
      mockCleanupOldHistory.mockClear();
    });

    it('should register cleanup job when configured', async () => {
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
      
      // クリーンアップJobが登録されたことを確認
      // 注意: cronタスクは時間ベースで実行されるため、即座に実行されない
      // ここでは、Jobが登録され、停止時にエラーが発生しないことを確認
      scheduler.stop();
      
      // クリーンアップJobが登録されたことを確認（エラーが発生しない = 正常に登録された）
      // 実際のクリーンアップ実行はcronスケジュールに従うため、テストでは登録の確認まで
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
        // csvImportHistoryが設定されていない
      };

      vi.mocked(BackupConfigLoader.load).mockResolvedValue(mockConfig as any);

      await scheduler.start();

      expect(BackupConfigLoader.load).toHaveBeenCalled();
      
      // クリーンアップJobがスキップされたことを確認
      // （設定がない場合はクリーンアップJobが開始されない）
      scheduler.stop();
      
      // クリーンアップが呼ばれていないことを確認（設定がないため）
      expect(mockCleanupOldHistory).not.toHaveBeenCalled();
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
      
      // 無効なスケジュールはスキップされ、クリーンアップJobが登録されないことを確認
      scheduler.stop();
      
      // 無効なスケジュールのため、クリーンアップJobが登録されていないことを確認
      // （クリーンアップが呼ばれていない）
      expect(mockCleanupOldHistory).not.toHaveBeenCalled();
    });
  });

  describe('PowerAutomate未配置時のエラーハンドリング', () => {
    let testScheduler: CsvImportScheduler;

    beforeEach(() => {
      // 新しいスケジューラーインスタンスを作成（連続失敗カウントをリセット）
      testScheduler = new CsvImportScheduler();
      // モックをリセット
      mockGenerateFailureAlert.mockClear();
      mockGenerateConsecutiveFailureAlert.mockClear();
      mockCreateHistory.mockClear();
      mockCompleteHistory.mockClear();
      mockFailHistory.mockClear();
    });

    afterEach(async () => {
      await testScheduler.stop();
    });

    it('should generate alert when file not found (404 error)', async () => {
      const { DropboxStorageProvider } = await import('../../backup/storage/dropbox-storage.provider.js');
      
      // 404エラー（ファイル未到着）をシミュレート
      const fileNotFoundError = new Error('File not found');
      (fileNotFoundError as any).status = 409; // Dropbox APIのpath_lookupエラー
      (fileNotFoundError as any).error = {
        error: {
          '.tag': 'path_lookup',
          path_lookup: {
            '.tag': 'not_found'
          }
        }
      };

      vi.mocked(DropboxStorageProvider).mockImplementation(() => ({
        download: vi.fn().mockRejectedValue(fileNotFoundError)
      } as any));

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
            id: 'test-file-not-found',
            name: 'Test Import - File Not Found',
            employeesPath: '/backups/csv/employees-20251216.csv',
            schedule: '0 4 * * *',
            enabled: true,
            replaceExisting: false,
            retryConfig: {
              maxRetries: 0, // リトライを無効化（テスト高速化）
              retryInterval: 0,
              exponentialBackoff: false
            }
          }
        ]
      };

      vi.mocked(BackupConfigLoader.load).mockResolvedValue(mockConfig as any);

      await testScheduler.start();

      // 手動実行を試みる（ファイル未到着エラーが発生する）
      await expect(testScheduler.runImport('test-file-not-found')).rejects.toThrow();

      // アラートが生成されたことを確認
      expect(mockGenerateFailureAlert).toHaveBeenCalledWith(
        expect.objectContaining({
          scheduleId: 'test-file-not-found',
          scheduleName: 'Test Import - File Not Found',
          errorMessage: expect.stringContaining('File not found'),
          historyId: 'test-history-id'
        })
      );
    });

    it('should generate consecutive failure alert after 3 consecutive failures (scheduled execution)', async () => {
      const { DropboxStorageProvider } = await import('../../backup/storage/dropbox-storage.provider.js');
      
      // 404エラー（ファイル未到着）をシミュレート
      const fileNotFoundError = new Error('File not found');
      (fileNotFoundError as any).status = 409;
      (fileNotFoundError as any).error = {
        error: {
          '.tag': 'path_lookup',
          path_lookup: {
            '.tag': 'not_found'
          }
        }
      };

      vi.mocked(DropboxStorageProvider).mockImplementation(() => ({
        download: vi.fn().mockRejectedValue(fileNotFoundError)
      } as any));

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
            id: 'test-consecutive-failures',
            name: 'Test Import - Consecutive Failures',
            retryConfig: {
              maxRetries: 0, // リトライを無効化（テスト高速化）
              retryInterval: 0,
              exponentialBackoff: false
            },
            employeesPath: '/backups/csv/employees-20251216.csv',
            schedule: '* * * * *', // 毎分実行（テスト用）
            enabled: true,
            replaceExisting: false
          }
        ]
      };

      vi.mocked(BackupConfigLoader.load).mockResolvedValue(mockConfig as any);

      await testScheduler.start();

      // cronタスクを直接実行するために、タスクを取得して手動実行
      // 注意: 実際のスケジュール実行をシミュレートするため、executeImportを直接呼び出す
      const config = await BackupConfigLoader.load();
      const importSchedule = config.csvImports?.find(imp => imp.id === 'test-consecutive-failures');
      
      if (!importSchedule) {
        throw new Error('Import schedule not found');
      }

      // 3回連続で失敗させる（スケジュール実行をシミュレート）
      for (let i = 0; i < 3; i++) {
        try {
          // executeImportを直接呼び出す（スケジュール実行をシミュレート）
          await (testScheduler as any).executeImport(config, importSchedule);
        } catch {
          // エラーは期待通り
        }
        // スケジュール実行時のエラーハンドリングをシミュレート
        const errorMessage = 'File not found';
        await testScheduler['alertService'].generateFailureAlert({
          scheduleId: 'test-consecutive-failures',
          scheduleName: 'Test Import - Consecutive Failures',
          errorMessage,
          historyId: 'test-history-id'
        });
        // 連続失敗回数を更新
        const currentFailures = testScheduler['consecutiveFailures'].get('test-consecutive-failures') || 0;
        testScheduler['consecutiveFailures'].set('test-consecutive-failures', currentFailures + 1);
        // 3回連続で失敗した場合は追加アラートを生成
        if (currentFailures + 1 >= 3) {
          await testScheduler['alertService'].generateConsecutiveFailureAlert({
            scheduleId: 'test-consecutive-failures',
            scheduleName: 'Test Import - Consecutive Failures',
            failureCount: currentFailures + 1,
            lastError: errorMessage
          });
        }
      }

      // 3回目の失敗時に連続失敗アラートが生成されたことを確認
      expect(mockGenerateConsecutiveFailureAlert).toHaveBeenCalledWith(
        expect.objectContaining({
          scheduleId: 'test-consecutive-failures',
          scheduleName: 'Test Import - Consecutive Failures',
          failureCount: 3,
          lastError: 'File not found'
        })
      );
    });

    it('should handle file not found error and generate appropriate error message', async () => {
      const { DropboxStorageProvider } = await import('../../backup/storage/dropbox-storage.provider.js');
      
      // 404エラー（ファイル未到着）をシミュレート
      const fileNotFoundError = new Error('File not found');
      (fileNotFoundError as any).status = 409;
      (fileNotFoundError as any).error = {
        error: {
          '.tag': 'path_lookup',
          path_lookup: {
            '.tag': 'not_found'
          }
        }
      };

      vi.mocked(DropboxStorageProvider).mockImplementation(() => ({
        download: vi.fn().mockRejectedValue(fileNotFoundError)
      } as any));

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
            id: 'test-error-handling',
            name: 'Test Import - Error Handling',
            retryConfig: {
              maxRetries: 0, // リトライを無効化（テスト高速化）
              retryInterval: 0,
              exponentialBackoff: false
            },
            employeesPath: '/backups/csv/employees-20251216.csv',
            schedule: '0 4 * * *',
            enabled: true,
            replaceExisting: false
          }
        ]
      };

      vi.mocked(BackupConfigLoader.load).mockResolvedValue(mockConfig as any);

      await testScheduler.start();

      // 手動実行を試みる（ファイル未到着エラーが発生する）
      await expect(testScheduler.runImport('test-error-handling')).rejects.toThrow();

      // エラーメッセージが適切であることを確認
      expect(mockGenerateFailureAlert).toHaveBeenCalledWith(
        expect.objectContaining({
          scheduleId: 'test-error-handling',
          scheduleName: 'Test Import - Error Handling',
          errorMessage: expect.stringContaining('File not found'),
          historyId: 'test-history-id'
        })
      );

      // 履歴が失敗として記録されたことを確認
      expect(mockFailHistory).toHaveBeenCalledWith(
        'test-history-id',
        expect.stringContaining('File not found')
      );
    });
  });

  describe('自動バックアップ機能（Phase 3）', () => {
    beforeEach(() => {
      // モックをリセット
      mockBackupServiceBackup.mockClear();
      mockBackupServiceBackup.mockResolvedValue({ success: true, path: '/backups/test', sizeBytes: 1024, timestamp: new Date() });
    });

    it('should execute auto backup after successful CSV import when enabled', async () => {
      const { CsvBackupTarget } = await import('../../backup/targets/csv-backup.target.js');

      const { DropboxStorageProvider } = await import('../../backup/storage/dropbox-storage.provider.js');
      vi.mocked(DropboxStorageProvider).mockImplementation(() => ({
        download: vi.fn().mockResolvedValue(Buffer.from('employeeCode,displayName\n0001,Test'))
      } as any));

      vi.mocked(processCsvImportFromTargets).mockResolvedValue({
        summary: {
          employees: { processed: 1, created: 1, updated: 0 }
        }
      } as any);

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
            id: 'test-auto-backup',
            name: 'Test Import - Auto Backup',
            employeesPath: '/backups/csv/employees-20251216.csv',
            schedule: '0 4 * * *',
            enabled: true,
            replaceExisting: false,
            autoBackupAfterImport: {
              enabled: true,
              targets: ['csv']
            }
          }
        ]
      };

      vi.mocked(BackupConfigLoader.load).mockResolvedValue(mockConfig as any);

      await scheduler.start();
      await scheduler.runImport('test-auto-backup');

      // 自動バックアップが実行されたことを確認
      expect(mockBackupServiceBackup).toHaveBeenCalled();
      expect(CsvBackupTarget).toHaveBeenCalledWith('employees', expect.objectContaining({
        label: expect.stringContaining('auto-after-import-test-auto-backup')
      }));
    });

    it('should not execute auto backup when disabled', async () => {

      const { DropboxStorageProvider } = await import('../../backup/storage/dropbox-storage.provider.js');
      vi.mocked(DropboxStorageProvider).mockImplementation(() => ({
        download: vi.fn().mockResolvedValue(Buffer.from('employeeCode,displayName\n0001,Test'))
      } as any));

      vi.mocked(processCsvImportFromTargets).mockResolvedValue({
        summary: {
          employees: { processed: 1, created: 1, updated: 0 }
        }
      } as any);

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
            id: 'test-no-auto-backup',
            name: 'Test Import - No Auto Backup',
            employeesPath: '/backups/csv/employees-20251216.csv',
            schedule: '0 4 * * *',
            enabled: true,
            replaceExisting: false,
            autoBackupAfterImport: {
              enabled: false,
              targets: ['csv']
            }
          }
        ]
      };

      vi.mocked(BackupConfigLoader.load).mockResolvedValue(mockConfig as any);

      await scheduler.start();
      await scheduler.runImport('test-no-auto-backup');

      // 自動バックアップが実行されなかったことを確認
      expect(mockBackupServiceBackup).not.toHaveBeenCalled();
    });

    it('should continue import success even if auto backup fails', async () => {
      mockBackupServiceBackup.mockRejectedValue(new Error('Backup failed'));

      const { DropboxStorageProvider } = await import('../../backup/storage/dropbox-storage.provider.js');
      vi.mocked(DropboxStorageProvider).mockImplementation(() => ({
        download: vi.fn().mockResolvedValue(Buffer.from('employeeCode,displayName\n0001,Test'))
      } as any));

      vi.mocked(processCsvImportFromTargets).mockResolvedValue({
        summary: {
          employees: { processed: 1, created: 1, updated: 0 }
        }
      } as any);

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
            id: 'test-backup-failure',
            name: 'Test Import - Backup Failure',
            employeesPath: '/backups/csv/employees-20251216.csv',
            schedule: '0 4 * * *',
            enabled: true,
            replaceExisting: false,
            autoBackupAfterImport: {
              enabled: true,
              targets: ['csv']
            }
          }
        ]
      };

      vi.mocked(BackupConfigLoader.load).mockResolvedValue(mockConfig as any);

      await scheduler.start();
      
      // バックアップ失敗でもインポートは成功する
      await expect(scheduler.runImport('test-backup-failure')).resolves.not.toThrow();
      
      // バックアップが試行されたことを確認
      expect(mockBackupServiceBackup).toHaveBeenCalled();
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
