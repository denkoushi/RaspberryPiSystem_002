import { describe, expect, it } from 'vitest';

import { ensureRiggingSlingsInspectionCsvImportSchedule } from '../slings-inspection-import-schedule.policy.js';
import {
  RIGGING_SLINGS_INSPECTION_CSV_IMPORT_SCHEDULE_CRON,
  RIGGING_SLINGS_INSPECTION_CSV_IMPORT_SCHEDULE_ID,
} from '../system-csv-import-schedule-builtin-rows.js';
import { RIGGING_SLINGS_INSPECTION_POWERAPPS_DASHBOARD_ID } from '../../rigging/constants.js';
import type { BackupConfig } from '../../backup/backup-config.js';

describe('ensureRiggingSlingsInspectionCsvImportSchedule', () => {
  it('backup.json に吊具点検 PowerApps 用 Gmail スケジュールを保証する', () => {
    const config: BackupConfig = {
      storage: { provider: 'local', options: {} },
      targets: [],
      csvImports: [],
    };
    const { config: next } = ensureRiggingSlingsInspectionCsvImportSchedule(config);
    const row = next.csvImports?.find((s) => s.id === RIGGING_SLINGS_INSPECTION_CSV_IMPORT_SCHEDULE_ID);
    expect(row).toBeDefined();
    expect(row?.schedule).toBe(RIGGING_SLINGS_INSPECTION_CSV_IMPORT_SCHEDULE_CRON);
    expect(row?.enabled).toBe(false);
    expect(row?.targets).toEqual([
      { type: 'csvDashboards', source: RIGGING_SLINGS_INSPECTION_POWERAPPS_DASHBOARD_ID },
    ]);
  });
});
