import { describe, expect, it, vi } from 'vitest';
import { CsvImportExecutionService } from '../csv-import-execution.service.js';
import { ActualHoursImportOrchestratorService } from '../../production-schedule/actual-hours/actual-hours-import-orchestrator.service.js';
import type { StorageProvider } from '../../backup/storage/storage-provider.interface.js';
import type { BackupConfig } from '../../backup/backup-config.js';

describe('CsvImportExecutionService', () => {
  it('should throw when provider is not gmail/dropbox', async () => {
    const svc = new CsvImportExecutionService({
      // ここは呼ばれない想定だが、念のため差し替え
      storageProviderFactory: { createFromConfig: vi.fn() as any },
      configStore: { load: vi.fn(), save: vi.fn() },
      createCsvImportSourceService: () => ({ downloadMasterCsv: vi.fn() } as any),
      createCsvDashboardImportService: () => ({ ingestTargets: vi.fn() } as any),
      createCsvImportConfigService: () => ({ getEffectiveConfig: vi.fn().mockResolvedValue(null) } as any),
      processCsvImportFromTargets: vi.fn() as any,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });

    const config = {
      storage: { provider: 'local', options: {} },
      csvImports: [],
    } as unknown as BackupConfig;

    await expect(
      svc.execute({
        config,
        importSchedule: {
          id: 'x',
          name: 'x',
          enabled: true,
          schedule: '0 0 * * *',
          provider: 'local' as any,
          targets: [{ type: 'employees', source: '/path.csv' }],
        } as any,
        skipRetry: true,
      })
    ).rejects.toThrow(/requires Dropbox or Gmail/);
  });

  it('should use injected deps and process master + dashboard targets', async () => {
    const load = vi.fn().mockResolvedValue({
      storage: { provider: 'dropbox', options: { dropbox: { accessToken: 't' } } },
      csvImports: [],
    });
    const save = vi.fn().mockResolvedValue(undefined);

    let capturedOnTokenUpdate: ((token: string) => Promise<void>) | undefined;
    const storageProvider: StorageProvider = {
      upload: vi.fn(),
      download: vi.fn(),
      delete: vi.fn(),
      list: vi.fn(),
    };

    const createFromConfig = vi.fn(async (_config, _protocol, _host, onTokenUpdate) => {
      capturedOnTokenUpdate = onTokenUpdate;
      return storageProvider;
    });

    const ingestTargets = vi.fn().mockResolvedValue({
      dashboardA: { rowsProcessed: 10, rowsAdded: 1, rowsSkipped: 9 },
    });

    const downloadMasterCsv = vi.fn().mockResolvedValue({
      buffer: Buffer.from('employeeCode,lastName,firstName\n0001,A,B', 'utf-8'),
      resolvedSource: 'resolved-pattern',
    });

    const processCsvImportFromTargets = vi.fn().mockResolvedValue({
      summary: { employees: { processed: 1, created: 1, updated: 0 } },
    });

    const svc = new CsvImportExecutionService({
      configStore: { load, save },
      storageProviderFactory: { createFromConfig },
      createCsvDashboardImportService: () => ({ ingestTargets } as any),
      createCsvImportSourceService: () => ({ downloadMasterCsv } as any),
      createCsvImportConfigService: () => ({ getEffectiveConfig: vi.fn().mockResolvedValue(null) } as any),
      processCsvImportFromTargets: processCsvImportFromTargets as any,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });

    const config = {
      storage: { provider: 'dropbox', options: { dropbox: { accessToken: 't' } } },
      csvImports: [],
    } as unknown as BackupConfig;

    const summary = await svc.execute({
      config,
      importSchedule: {
        id: 'sched-1',
        name: 'Schedule 1',
        enabled: true,
        schedule: '0 0 * * *',
        provider: 'gmail',
        replaceExisting: false,
        targets: [
          { type: 'csvDashboards', source: 'dashboardA' },
          { type: 'employees', source: 'legacy-pattern' },
        ],
      } as any,
      skipRetry: true,
    });

    expect(createFromConfig).toHaveBeenCalled();
    expect(ingestTargets).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'gmail',
        storageProvider,
        dashboardIds: ['dashboardA'],
      })
    );
    expect(downloadMasterCsv).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'gmail',
        storageProvider,
        target: { type: 'employees', source: 'legacy-pattern' },
      })
    );
    expect(processCsvImportFromTargets).toHaveBeenCalled();
    expect(summary).toEqual({
      employees: { processed: 1, created: 1, updated: 0 },
      csvDashboards: { dashboardA: { rowsProcessed: 10, rowsAdded: 1, rowsSkipped: 9 } },
    });

    // token update callback should update config store
    expect(capturedOnTokenUpdate).toBeTypeOf('function');
    await capturedOnTokenUpdate?.('new-token');
    expect(load).toHaveBeenCalled();
    expect(save).toHaveBeenCalled();
  });

  it('should execute productionActualHours target and include canonical summary', async () => {
    const storageProvider: StorageProvider = {
      upload: vi.fn(),
      download: vi.fn(),
      delete: vi.fn(),
      list: vi.fn(),
    };
    const createFromConfig = vi.fn().mockResolvedValue(storageProvider);
    const importFromCsvSpy = vi
      .spyOn(ActualHoursImportOrchestratorService.prototype, 'importFromCsv')
      .mockResolvedValue({
        rowsProcessed: 3,
        rowsInserted: 2,
        rowsIgnored: 1,
        sourceRows: 2,
        candidateKeys: 2,
        canonicalCreated: 1,
        canonicalUpdated: 1,
        canonicalSkipped: 0,
      });
    const rebuildFeaturesSpy = vi
      .spyOn(ActualHoursImportOrchestratorService.prototype, 'rebuildFeatures')
      .mockResolvedValue({
        totalRows: 2,
        totalRawRows: 2,
        excludedRecentRows: 0,
        excludedOutlierRows: 0,
        excludedPreFlaggedRows: 0,
        featureKeyCount: 2,
      });

    const downloadMasterCsv = vi.fn().mockResolvedValue({
      buffer: Buffer.from('csv'),
      resolvedSource: 'subject-pattern',
    });

    const svc = new CsvImportExecutionService({
      storageProviderFactory: { createFromConfig },
      configStore: { load: vi.fn(), save: vi.fn() },
      createCsvImportSourceService: () => ({ downloadMasterCsv } as any),
      createCsvDashboardImportService: () => ({ ingestTargets: vi.fn() } as any),
      createCsvImportConfigService: () => ({ getEffectiveConfig: vi.fn().mockResolvedValue(null) } as any),
      processCsvImportFromTargets: vi.fn() as any,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });

    const config = {
      storage: { provider: 'gmail', options: { gmail: { refreshToken: 'x' } } },
      csvImports: [],
    } as unknown as BackupConfig;

    const summary = await svc.execute({
      config,
      importSchedule: {
        id: 'sched-actual-hours',
        name: 'actual-hours',
        enabled: true,
        schedule: '0 0 * * *',
        provider: 'gmail',
        metadata: { locationKey: 'TestLocation' },
        targets: [{ type: 'productionActualHours', source: '実績工数CSV' }],
      } as any,
      skipRetry: true,
    });

    expect(downloadMasterCsv).toHaveBeenCalledTimes(1);
    expect(importFromCsvSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceScheduleId: 'sched-actual-hours',
        locationKey: 'TestLocation',
      })
    );
    expect(rebuildFeaturesSpy).toHaveBeenCalledWith({ locationKey: 'TestLocation' });
    expect(summary).toEqual({
      csvDashboards: {},
      productionActualHours: {
        rowsProcessed: 3,
        rowsInserted: 2,
        rowsIgnored: 1,
        sourceRows: 2,
        candidateKeys: 2,
        canonicalCreated: 1,
        canonicalUpdated: 1,
        canonicalSkipped: 0,
        totalRows: 2,
        totalRawRows: 2,
        excludedRecentRows: 0,
        excludedOutlierRows: 0,
        excludedPreFlaggedRows: 0,
        featureKeyCount: 2,
      },
    });

    importFromCsvSpy.mockRestore();
    rebuildFeaturesSpy.mockRestore();
  });
});

