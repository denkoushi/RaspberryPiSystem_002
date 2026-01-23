import { describe, expect, it, vi } from 'vitest';
import { CsvImportAutoBackupService } from '../csv-import-auto-backup.service.js';
import type { BackupConfig } from '../../backup/backup-config.js';
import type { StorageProvider } from '../../backup/storage/storage-provider.interface.js';

describe('CsvImportAutoBackupService', () => {
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
      verifier: { verify: () => ({ hash: 'hash-1' }) },
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
    expect(createBackup).toHaveBeenCalled();
    expect(backup).toHaveBeenCalled();
    expect(createHistory).toHaveBeenCalled();
    expect(completeHistory).toHaveBeenCalled();
    expect(failHistory).not.toHaveBeenCalled();

    expect(capturedOnTokenUpdate).toBeTypeOf('function');
    await capturedOnTokenUpdate?.('new-token');
    expect(load).toHaveBeenCalled();
    expect(save).toHaveBeenCalled();
  });
});

