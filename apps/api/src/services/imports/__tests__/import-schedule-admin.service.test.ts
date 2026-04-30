import { describe, expect, it, vi } from 'vitest';

import { ApiError } from '../../../lib/errors.js';
import type { BackupConfig } from '../../backup/backup-config.js';
import { GmailReauthRequiredError } from '../../backup/gmail-oauth.service.js';
import { ImportScheduleAdminService } from '../import-schedule-admin.service.js';
import { FKOJUNST_CSV_IMPORT_SCHEDULE_CRON, FKOJUNST_CSV_IMPORT_SCHEDULE_ID } from '../fkojunst-import-schedule.policy.js';
import { PRODUCTION_SCHEDULE_FKOJUNST_DASHBOARD_ID } from '../../production-schedule/constants.js';
import { SEIBAN_MACHINE_NAME_SUPPLEMENT_CSV_IMPORT_SCHEDULE_ID } from '../seiban-machine-name-supplement-import-schedule.policy.js';
import { CUSTOMER_SCAW_CSV_IMPORT_SCHEDULE_ID } from '../customer-scaw-import-schedule.policy.js';

function createBaseConfig(): BackupConfig {
  return {
    storage: { provider: 'local', options: {} },
    targets: [],
    csvImports: [],
    retention: { days: 30 },
    csvImportSubjectPatterns: {
      employees: [],
      items: [],
      measuringInstruments: [],
      riggingGears: [],
      machines: [],
      productionActualHours: [],
    },
    csvImportHistory: {
      retentionDays: 90,
      cleanupSchedule: '0 2 * * *',
    },
    restoreFromDropbox: {
      enabled: false,
      verifyIntegrity: true,
    },
  };
}

describe('ImportScheduleAdminService', () => {
  it('listSchedules: 固定の製番→機種名補完スケジュールを自動補完して保存する', async () => {
    const config = createBaseConfig();
    const store = {
      load: vi.fn(async () => config),
      save: vi.fn(async () => {}),
    };
    const scheduler = { reload: vi.fn(async () => {}), runImport: vi.fn(async () => ({})) };
    const service = new ImportScheduleAdminService(store, () => scheduler);

    const schedules = await service.listSchedules();

    expect(schedules.some((row) => row.id === SEIBAN_MACHINE_NAME_SUPPLEMENT_CSV_IMPORT_SCHEDULE_ID)).toBe(true);
    expect(schedules.some((row) => row.id === CUSTOMER_SCAW_CSV_IMPORT_SCHEDULE_ID)).toBe(true);
    expect(store.save).toHaveBeenCalledOnce();
    expect(scheduler.reload).toHaveBeenCalledOnce();
  });

  it('createSchedule: 重複IDは409を返す', async () => {
    const config = createBaseConfig();
    config.csvImports = [
      {
        id: 'duplicate-id',
        schedule: '0 4 * * *',
        enabled: true,
        replaceExisting: false,
        autoBackupAfterImport: { enabled: false, targets: ['csv'] },
      },
    ];

    const store = {
      load: vi.fn(async () => config),
      save: vi.fn(async () => {}),
    };
    const scheduler = { reload: vi.fn(async () => {}), runImport: vi.fn(async () => ({})) };
    const service = new ImportScheduleAdminService(store, () => scheduler);

    await expect(
      service.createSchedule({
        id: 'duplicate-id',
        schedule: '0 5 * * *',
      })
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it('updateSchedule: 存在しないIDは404を返す', async () => {
    const store = {
      load: vi.fn(async () => createBaseConfig()),
      save: vi.fn(async () => {}),
    };
    const scheduler = { reload: vi.fn(async () => {}), runImport: vi.fn(async () => ({})) };
    const service = new ImportScheduleAdminService(store, () => scheduler);

    await expect(
      service.updateSchedule('missing-id', { enabled: false })
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('updateSchedule: システム予約IDでも有効なcronは上書きされず保持される', async () => {
    const customCron = '45 2 * * *';
    const config = createBaseConfig();
    config.csvImports = [
      {
        id: FKOJUNST_CSV_IMPORT_SCHEDULE_ID,
        name: 'FKOJUNST',
        provider: 'gmail',
        targets: [{ type: 'csvDashboards', source: PRODUCTION_SCHEDULE_FKOJUNST_DASHBOARD_ID }],
        schedule: FKOJUNST_CSV_IMPORT_SCHEDULE_CRON,
        enabled: true,
        replaceExisting: false,
        autoBackupAfterImport: { enabled: false, targets: ['csv'] },
      },
    ];
    const store = {
      load: vi.fn(async () => config),
      save: vi.fn(async () => {}),
    };
    const scheduler = { reload: vi.fn(async () => {}), runImport: vi.fn(async () => ({})) };
    const service = new ImportScheduleAdminService(store, () => scheduler);

    const { schedule: updated } = await service.updateSchedule(FKOJUNST_CSV_IMPORT_SCHEDULE_ID, {
      schedule: customCron,
    });

    expect(updated.schedule).toBe(customCron);
    expect(store.save).toHaveBeenCalled();
    const lastSaved = store.save.mock.calls.at(-1)![0] as BackupConfig;
    expect(lastSaved.csvImports?.find((s) => s.id === FKOJUNST_CSV_IMPORT_SCHEDULE_ID)?.schedule).toBe(
      customCron
    );
  });

  it('runSchedule: 実行中エラーは409へ変換する', async () => {
    const config = createBaseConfig();
    config.csvImports = [
      {
        id: 'run-id',
        schedule: '0 4 * * *',
        enabled: true,
        replaceExisting: false,
        autoBackupAfterImport: { enabled: false, targets: ['csv'] },
      },
    ];
    const store = {
      load: vi.fn(async () => config),
      save: vi.fn(async () => {}),
    };
    const scheduler = {
      reload: vi.fn(async () => {}),
      runImport: vi.fn(async () => {
        throw new Error('CSV import is already running: run-id');
      }),
    };
    const service = new ImportScheduleAdminService(store, () => scheduler);

    await expect(
      service.runSchedule('run-id', { requestId: 'req-1' })
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it('runSchedule: Gmail再認可エラーは401へ変換する', async () => {
    const config = createBaseConfig();
    config.csvImports = [
      {
        id: 'run-id',
        schedule: '0 4 * * *',
        enabled: true,
        replaceExisting: false,
        autoBackupAfterImport: { enabled: false, targets: ['csv'] },
      },
    ];
    const store = {
      load: vi.fn(async () => config),
      save: vi.fn(async () => {}),
    };
    const scheduler = {
      reload: vi.fn(async () => {}),
      runImport: vi.fn(async () => {
        throw new GmailReauthRequiredError('invalid_grant');
      }),
    };
    const service = new ImportScheduleAdminService(store, () => scheduler);

    await expect(
      service.runSchedule('run-id', { requestId: 'req-2' })
    ).rejects.toMatchObject({ statusCode: 401 });
  });

  it('runSchedule: 予期しない例外は500へ変換する', async () => {
    const config = createBaseConfig();
    config.csvImports = [
      {
        id: 'run-id',
        schedule: '0 4 * * *',
        enabled: true,
        replaceExisting: false,
        autoBackupAfterImport: { enabled: false, targets: ['csv'] },
      },
    ];
    const store = {
      load: vi.fn(async () => config),
      save: vi.fn(async () => {}),
    };
    const scheduler = {
      reload: vi.fn(async () => {}),
      runImport: vi.fn(async () => {
        throw new Error('unexpected failure');
      }),
    };
    const service = new ImportScheduleAdminService(store, () => scheduler);

    await expect(
      service.runSchedule('run-id', { requestId: 'req-3' })
    ).rejects.toMatchObject({ statusCode: 500 });
  });

  it('runSchedule: ApiErrorはそのまま再送出する', async () => {
    const config = createBaseConfig();
    config.csvImports = [
      {
        id: 'run-id',
        schedule: '0 4 * * *',
        enabled: true,
        replaceExisting: false,
        autoBackupAfterImport: { enabled: false, targets: ['csv'] },
      },
    ];
    const original = new ApiError(422, 'validation failed');
    const store = {
      load: vi.fn(async () => config),
      save: vi.fn(async () => {}),
    };
    const scheduler = {
      reload: vi.fn(async () => {}),
      runImport: vi.fn(async () => {
        throw original;
      }),
    };
    const service = new ImportScheduleAdminService(store, () => scheduler);

    await expect(service.runSchedule('run-id', { requestId: 'req-4' })).rejects.toBe(original);
  });

  it('deleteSchedule: 固定の製番→機種名補完スケジュールは400を返す', async () => {
    const store = {
      load: vi.fn(async () => createBaseConfig()),
      save: vi.fn(async () => {}),
    };
    const scheduler = { reload: vi.fn(async () => {}), runImport: vi.fn(async () => ({})) };
    const service = new ImportScheduleAdminService(store, () => scheduler);

    await expect(service.deleteSchedule(SEIBAN_MACHINE_NAME_SUPPLEMENT_CSV_IMPORT_SCHEDULE_ID)).rejects.toMatchObject({
      statusCode: 400,
    });
  });

  it('deleteSchedule: 固定の CustomerSCAW スケジュールは400を返す', async () => {
    const store = {
      load: vi.fn(async () => createBaseConfig()),
      save: vi.fn(async () => {}),
    };
    const scheduler = { reload: vi.fn(async () => {}), runImport: vi.fn(async () => ({})) };
    const service = new ImportScheduleAdminService(store, () => scheduler);

    await expect(service.deleteSchedule(CUSTOMER_SCAW_CSV_IMPORT_SCHEDULE_ID)).rejects.toMatchObject({
      statusCode: 400,
    });
  });
});
