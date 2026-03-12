import { describe, expect, it, vi } from 'vitest';

import { ApiError } from '../../../lib/errors.js';
import type { BackupConfig } from '../../backup/backup-config.js';
import { GmailReauthRequiredError } from '../../backup/gmail-oauth.service.js';
import { ImportScheduleAdminService } from '../import-schedule-admin.service.js';

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
});
