import type { BackupConfig } from '../backup/backup-config.js';
import {
  buildDefaultCustomerScawCsvImportSchedule,
  CUSTOMER_SCAW_CSV_IMPORT_SCHEDULE_ID,
} from './system-csv-import-schedule-builtin-rows.js';
import {
  ensureSystemCsvImportScheduleInBackupConfig,
  normalizeSystemCsvImportRowForPersistence,
} from './system-csv-import-schedule-invariants.js';

export {
  CUSTOMER_SCAW_CSV_IMPORT_SCHEDULE_CRON,
  CUSTOMER_SCAW_CSV_IMPORT_SCHEDULE_ID,
  buildDefaultCustomerScawCsvImportSchedule,
} from './system-csv-import-schedule-builtin-rows.js';

type CsvImportScheduleRow = NonNullable<BackupConfig['csvImports']>[number];

export function applyCustomerScawImportScheduleInvariants(schedule: CsvImportScheduleRow): CsvImportScheduleRow {
  return normalizeSystemCsvImportRowForPersistence(schedule);
}

export function ensureCustomerScawCsvImportSchedule(
  config: BackupConfig
): { config: BackupConfig; repaired: boolean } {
  return ensureSystemCsvImportScheduleInBackupConfig(
    config,
    CUSTOMER_SCAW_CSV_IMPORT_SCHEDULE_ID,
    buildDefaultCustomerScawCsvImportSchedule
  );
}
