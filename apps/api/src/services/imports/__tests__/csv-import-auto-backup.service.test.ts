import { describe, expect, it, vi } from 'vitest';
import { CsvImportAutoBackupService } from '../csv-import-auto-backup.service.js';
import type { BackupConfig } from '../../backup/backup-config.js';
import { LocalStorageProvider } from '../../backup/storage/local-storage.provider.js';
import type { StorageProvider } from '../../backup/storage/storage-provider.interface.js';

describe('CsvImportAutoBackupService', () => {
  it('creates the default local provider with the factory bound correctly', async () => {
    const backup = vi.fn().mockResolvedValue({ success: true, hash: 'actual-upload-hash' });
    const createBackupService = vi.fn(() => ({ backup }));
    const completeHistory = vi.fn();
    const svc = new CsvImportAutoBackupService({
      backupHistoryService: { createHistory: vi.fn().mockResolvedValue('h'), completeHistory } as any,
      createBackupService,
      createCsvBackupTarget: () => ({ info: { type: 'csv', source: 'employees' }, createBackup: vi.fn() }),
      logger: { info: vi.fn() }
    });
    await svc.execute({
      config: { storage: { provider: 'local' } } as any,
      importSchedule: { id: 'schedule', autoBackupAfterImport: { enabled: true, targets: ['csv'] } } as any,
      importSummary: { employees: { processed: 1, created: 1, updated: 0 } }
    });
    expect(createBackupService).toHaveBeenCalledWith(expect.any(LocalStorageProvider));
    expect(completeHistory).toHaveBeenCalledWith('h', expect.objectContaining({ hash: 'actual-upload-hash', encrypted: true }));
  });

  it.each(['csv', 'database', 'all'] as const)('records failed %s uploads as FAILED, never COMPLETED', async (target) => {
    const createHistory = vi.fn().mockResolvedValue('h-fail');
    const failHistory = vi.fn();
    const completeHistory = vi.fn();
    const createBackup = vi.fn();
    const backupTarget = { info: { type: 'csv', source: 'employees' }, createBackup };
    const svc = new CsvImportAutoBackupService({
      backupHistoryService: { createHistory, failHistory, completeHistory } as any,
      storageProviderFactory: { createFromConfig: vi.fn().mockResolvedValue({}) },
      createBackupService: () => ({ backup: vi.fn().mockResolvedValue({ success: false, error: 'encryption key missing' }) }),
      createCsvBackupTarget: () => backupTarget as any,
      createDatabaseBackupTarget: () => backupTarget as any,
      getDatabaseUrl: () => 'postgresql://dummy',
      logger: { info: vi.fn(), error: vi.fn() }
    });
    await svc.execute({
      config: { storage: { provider: 'local' } } as any,
      importSchedule: { id: 'schedule', autoBackupAfterImport: { enabled: true, targets: [target] } } as any,
      importSummary: { employees: { processed: 1, created: 1, updated: 0 } }
    });
    expect(failHistory).toHaveBeenCalledWith('h-fail', 'encryption key missing');
    expect(completeHistory).not.toHaveBeenCalled();
    expect(createBackup).not.toHaveBeenCalled();
  });

  it('should run csv backup for employees and persist token update', async () => {
    const load = vi.fn().mockResolvedValue({
      storage: { provider: 'gmail', options: { gmail: { accessToken: 'old' } } },
      csvImports: [],
    });
    const save = vi.fn().mockResolvedValue(undefined);

    let capturedOnTokenUpdate: ((token: string) => Promise<void>) | undefined;
    const storageProvider: StorageProvider = {
      upload: vi.fn().mockResolvedValue(undefined),
      download: vi.fn(),
      delete: vi.fn(),
      list: vi.fn(),
    };
    const createFromConfig = vi.fn(async (_config, _protocol, _host, onTokenUpdate) => {
      capturedOnTokenUpdate = onTokenUpdate;
      return storageProvider;
    });

    const backup = vi.fn().mockResolvedValue({
      success: true,
      path: '/backups/test',
      sizeBytes: 123,
      hash: 'hash-1',
      timestamp: new Date(),
    });
    const createBackupService = vi.fn(() => ({ backup }));

    const createBackup = vi.fn().mockResolvedValue(Buffer.from('csv'));
    const createCsvBackupTarget = vi.fn((_source: string, _options: { label: string }) => ({
      info: { type: 'csv', source: 'employees' },
      createBackup,
    }));

    const createHistory = vi.fn().mockResolvedValue('h1');
    const completeHistory = vi.fn().mockResolvedValue(undefined);
    const failHistory = vi.fn().mockResolvedValue(undefined);

    const svc = new CsvImportAutoBackupService({
      backupHistoryService: { createHistory, completeHistory, failHistory } as any,
      configStore: { load, save },
      storageProviderFactory: { createFromConfig } as any,
      createBackupService: createBackupService as any,
      createCsvBackupTarget: createCsvBackupTarget as any,
      createDatabaseBackupTarget: vi.fn() as any,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      getDatabaseUrl: () => 'postgresql://dummy',
    });

    const config = {
      storage: { provider: 'gmail', options: { gmail: { accessToken: 't' } } },
      csvImports: [],
    } as unknown as BackupConfig;

    await svc.execute({
      config,
      importSchedule: {
        id: 'sched-1',
        name: 'Schedule 1',
        enabled: true,
        schedule: '0 0 * * *',
        autoBackupAfterImport: { enabled: true, targets: ['csv'] },
      } as any,
      importSummary: { employees: { processed: 1, created: 1, updated: 0 } },
    });

    expect(createFromConfig).toHaveBeenCalled();
    expect(createCsvBackupTarget).toHaveBeenCalledWith('employees', expect.any(Object));
    expect(createBackup).not.toHaveBeenCalled();
    expect(backup).toHaveBeenCalled();
    expect(createHistory).toHaveBeenCalled();
    expect(completeHistory).toHaveBeenCalledWith('h1', expect.objectContaining({ hash: 'hash-1', encrypted: true }));
    expect(failHistory).not.toHaveBeenCalled();

    expect(capturedOnTokenUpdate).toBeTypeOf('function');
    await capturedOnTokenUpdate?.('new-token');
    expect(load).toHaveBeenCalled();
    expect(save).toHaveBeenCalled();
  });
});

