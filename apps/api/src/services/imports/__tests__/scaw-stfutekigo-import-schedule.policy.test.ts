import { describe, expect, it } from 'vitest';
import { ensureScawStfutekigoCsvImportSchedule } from '../scaw-stfutekigo-import-schedule.policy.js';
import {
  SCAW_STFUTEKIGO_CSV_IMPORT_SCHEDULE_CRON,
  SCAW_STFUTEKIGO_CSV_IMPORT_SCHEDULE_ID,
  buildDefaultScawStfutekigoCsvImportSchedule,
} from '../system-csv-import-schedule-builtin-rows.js';
import { SCAW_STFUTEKIGO_DASHBOARD_ID } from '../../scaw-stfutekigo/constants.js';
import type { BackupConfig } from '../../backup/backup-config.js';

describe('scawSTFUTEKIGO fixed import schedule', () => {
  it('uses the fixed 10:35 Gmail route', () => {
    const row = buildDefaultScawStfutekigoCsvImportSchedule();
    expect(row.id).toBe(SCAW_STFUTEKIGO_CSV_IMPORT_SCHEDULE_ID);
    expect(row.schedule).toBe(SCAW_STFUTEKIGO_CSV_IMPORT_SCHEDULE_CRON);
    expect(row.enabled).toBe(true);
    expect(row.targets).toEqual([{ type: 'csvDashboards', source: SCAW_STFUTEKIGO_DASHBOARD_ID }]);
    expect(row.provider).toBe('gmail');
  });

  it('repairs a missing fixed schedule without adding a duplicate', () => {
    const config: BackupConfig = { storage: { provider: 'local', options: {} }, targets: [], csvImports: [] };
    const first = ensureScawStfutekigoCsvImportSchedule(config);
    const second = ensureScawStfutekigoCsvImportSchedule(first.config);
    expect(first.repaired).toBe(true);
    expect(second.repaired).toBe(false);
    expect(second.config.csvImports?.filter((row) => row.id === SCAW_STFUTEKIGO_CSV_IMPORT_SCHEDULE_ID)).toHaveLength(1);
  });
});
