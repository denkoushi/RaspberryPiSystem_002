import type { BackupConfig } from '../backup/backup-config.js';
import {
  buildDefaultRiggingSlingsInspectionCsvImportSchedule,
  RIGGING_SLINGS_INSPECTION_CSV_IMPORT_SCHEDULE_ID,
} from './system-csv-import-schedule-builtin-rows.js';
import {
  ensureSystemCsvImportScheduleInBackupConfig,
  normalizeSystemCsvImportRowForPersistence,
} from './system-csv-import-schedule-invariants.js';

export {
  RIGGING_SLINGS_INSPECTION_CSV_IMPORT_SCHEDULE_CRON,
  RIGGING_SLINGS_INSPECTION_CSV_IMPORT_SCHEDULE_ID,
  buildDefaultRiggingSlingsInspectionCsvImportSchedule,
} from './system-csv-import-schedule-builtin-rows.js';

type CsvImportScheduleRow = NonNullable<BackupConfig['csvImports']>[number];

export function applyRiggingSlingsInspectionImportScheduleInvariants(
  schedule: CsvImportScheduleRow
): CsvImportScheduleRow {
  return normalizeSystemCsvImportRowForPersistence(schedule);
}

export function ensureRiggingSlingsInspectionCsvImportSchedule(
  config: BackupConfig
): { config: BackupConfig; repaired: boolean } {
  return ensureSystemCsvImportScheduleInBackupConfig(
    config,
    RIGGING_SLINGS_INSPECTION_CSV_IMPORT_SCHEDULE_ID,
    buildDefaultRiggingSlingsInspectionCsvImportSchedule
  );
}
