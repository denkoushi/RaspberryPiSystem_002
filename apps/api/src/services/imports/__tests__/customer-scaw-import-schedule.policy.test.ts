import { describe, expect, it } from 'vitest';

import { ensureCustomerScawCsvImportSchedule } from '../customer-scaw-import-schedule.policy.js';
import {
  CUSTOMER_SCAW_CSV_IMPORT_SCHEDULE_CRON,
  CUSTOMER_SCAW_CSV_IMPORT_SCHEDULE_ID,
} from '../system-csv-import-schedule-builtin-rows.js';
import { PRODUCTION_SCHEDULE_CUSTOMER_SCAW_DASHBOARD_ID } from '../../production-schedule/constants.js';
import type { BackupConfig } from '../../backup/backup-config.js';

describe('ensureCustomerScawCsvImportSchedule', () => {
  it('backup.json に CustomerSCAW 用 Gmail スケジュールを保証する', () => {
    const config: BackupConfig = {
      storage: { provider: 'local', options: {} },
      targets: [],
      csvImports: [],
    };
    const { config: next } = ensureCustomerScawCsvImportSchedule(config);
    const row = next.csvImports?.find((s) => s.id === CUSTOMER_SCAW_CSV_IMPORT_SCHEDULE_ID);
    expect(row).toBeDefined();
    expect(row?.schedule).toBe(CUSTOMER_SCAW_CSV_IMPORT_SCHEDULE_CRON);
    expect(row?.enabled).toBe(true);
    expect(row?.targets).toEqual([
      { type: 'csvDashboards', source: PRODUCTION_SCHEDULE_CUSTOMER_SCAW_DASHBOARD_ID },
    ]);
  });
});
