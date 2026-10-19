import type { BackupConfig } from '../backup/backup-config.js';
import {
  buildDefaultScawStfutekigoCsvImportSchedule,
  SCAW_STFUTEKIGO_CSV_IMPORT_SCHEDULE_ID,
} from './system-csv-import-schedule-builtin-rows.js';
import {
  ensureSystemCsvImportScheduleInBackupConfig,
  normalizeSystemCsvImportRowForPersistence,
} from './system-csv-import-schedule-invariants.js';

export { SCAW_STFUTEKIGO_CSV_IMPORT_SCHEDULE_CRON, SCAW_STFUTEKIGO_CSV_IMPORT_SCHEDULE_ID } from './system-csv-import-schedule-builtin-rows.js';

type CsvImportScheduleRow = NonNullable<BackupConfig['csvImports']>[number];

export function applyScawStfutekigoImportScheduleInvariants(schedule: CsvImportScheduleRow): CsvImportScheduleRow {
  return normalizeSystemCsvImportRowForPersistence(schedule);
}

export function ensureScawStfutekigoCsvImportSchedule(config: BackupConfig): { config: BackupConfig; repaired: boolean } {
  return ensureSystemCsvImportScheduleInBackupConfig(
    config,
    SCAW_STFUTEKIGO_CSV_IMPORT_SCHEDULE_ID,
    buildDefaultScawStfutekigoCsvImportSchedule
  );
}
