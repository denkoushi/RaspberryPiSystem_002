import { describe, expect, it } from 'vitest';

import type { BackupConfig } from '../../backup/backup-config.js';
import { PRODUCTION_SCHEDULE_FKOJUNST_DASHBOARD_ID } from '../../production-schedule/constants.js';
import {
  FKOJUNST_CSV_IMPORT_SCHEDULE_CRON,
  FKOJUNST_CSV_IMPORT_SCHEDULE_ID,
  buildDefaultFkojunstCsvImportSchedule,
} from '../system-csv-import-schedule-builtin-rows.js';
import {
  ensureSystemCsvImportScheduleInBackupConfig,
  normalizeSystemCsvImportRowForPersistence,
} from '../system-csv-import-schedule-invariants.js';

describe('system-csv-import-schedule-invariants', () => {
  it('normalize: 非システムIDは無変更', () => {
    const row = {
      id: 'custom-schedule',
      schedule: '30 3 * * *',
      enabled: true,
      replaceExisting: false,
      autoBackupAfterImport: { enabled: false, targets: ['csv'] as const },
    };
    expect(normalizeSystemCsvImportRowForPersistence(row as never)).toEqual(row);
  });

  it('normalize: システム行は構造をデフォルトへ・有効な別cronを保持', () => {
    const customCron = '30 4 * * *';
    const row = {
      id: FKOJUNST_CSV_IMPORT_SCHEDULE_ID,
      name: '保留名',
      provider: 'dropbox' as const,
      targets: [{ type: 'csvDashboards' as const, source: 'wrong-id' }],
      schedule: customCron,
      enabled: true,
      replaceExisting: true,
      autoBackupAfterImport: { enabled: true, targets: ['csv'] as const },
    };
    const out = normalizeSystemCsvImportRowForPersistence(row);
    expect(out.schedule).toBe(customCron);
    expect(out.provider).toBe('gmail');
    expect(out.targets).toEqual([
      { type: 'csvDashboards', source: PRODUCTION_SCHEDULE_FKOJUNST_DASHBOARD_ID },
    ]);
    expect(out.replaceExisting).toBe(false);
    expect(out.name).toBe('保留名');
    expect(out.autoBackupAfterImport).toEqual({ enabled: true, targets: ['csv'] });
  });

  it('normalize: 不正cronはデフォルトへ矯正', () => {
    const row = {
      ...buildDefaultFkojunstCsvImportSchedule(),
      schedule: 'not a cron',
    };
    const out = normalizeSystemCsvImportRowForPersistence(row);
    expect(out.schedule).toBe(FKOJUNST_CSV_IMPORT_SCHEDULE_CRON);
  });

  it('normalize: 最小間隔未満のcronはデフォルトへ矯正', () => {
    const row = {
      ...buildDefaultFkojunstCsvImportSchedule(),
      schedule: '*/1 * * * *',
    };
    const out = normalizeSystemCsvImportRowForPersistence(row);
    expect(out.schedule).toBe(FKOJUNST_CSV_IMPORT_SCHEDULE_CRON);
  });

  it('ensureSystemCsvImportScheduleInBackupConfig: 有効な別cronを保持', () => {
    const customCron = '15 2 * * *';
    const input: BackupConfig = {
      storage: { provider: 'local', options: {} },
      targets: [],
      csvImports: [
        {
          id: FKOJUNST_CSV_IMPORT_SCHEDULE_ID,
          name: 'x',
          provider: 'gmail',
          targets: [{ type: 'csvDashboards', source: PRODUCTION_SCHEDULE_FKOJUNST_DASHBOARD_ID }],
          schedule: customCron,
          enabled: true,
          replaceExisting: false,
          autoBackupAfterImport: { enabled: false, targets: ['csv'] },
        },
      ],
    };
    const { config, repaired } = ensureSystemCsvImportScheduleInBackupConfig(
      input,
      FKOJUNST_CSV_IMPORT_SCHEDULE_ID,
      buildDefaultFkojunstCsvImportSchedule
    );
    expect(repaired).toBe(false);
    expect(config.csvImports?.[0]?.schedule).toBe(customCron);
  });
});
