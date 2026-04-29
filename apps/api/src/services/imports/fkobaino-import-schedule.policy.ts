import type { BackupConfig } from '../backup/backup-config.js';
import { buildDefaultFkobainoCsvImportSchedule, FKOBAINO_CSV_IMPORT_SCHEDULE_ID } from './system-csv-import-schedule-builtin-rows.js';
import {
  ensureSystemCsvImportScheduleInBackupConfig,
  normalizeSystemCsvImportRowForPersistence,
} from './system-csv-import-schedule-invariants.js';

export {
  FKOBAINO_CSV_IMPORT_SCHEDULE_CRON,
  FKOBAINO_CSV_IMPORT_SCHEDULE_ID,
  buildDefaultFkobainoCsvImportSchedule,
} from './system-csv-import-schedule-builtin-rows.js';

type CsvImportScheduleRow = NonNullable<BackupConfig['csvImports']>[number];

export function applyFkobainoImportScheduleInvariants(schedule: CsvImportScheduleRow): CsvImportScheduleRow {
  return normalizeSystemCsvImportRowForPersistence(schedule);
}

export function ensureFkobainoCsvImportSchedule(config: BackupConfig): { config: BackupConfig; repaired: boolean } {
  return ensureSystemCsvImportScheduleInBackupConfig(
    config,
    FKOBAINO_CSV_IMPORT_SCHEDULE_ID,
    buildDefaultFkobainoCsvImportSchedule
  );
}
