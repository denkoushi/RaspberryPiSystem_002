import type { BackupConfig } from '../backup/backup-config.js';
import {
  buildDefaultFkojunstStatusMailCsvImportSchedule,
  FKOJUNST_STATUS_MAIL_CSV_IMPORT_SCHEDULE_ID,
} from './system-csv-import-schedule-builtin-rows.js';
import {
  ensureSystemCsvImportScheduleInBackupConfig,
  normalizeSystemCsvImportRowForPersistence,
} from './system-csv-import-schedule-invariants.js';

export {
  FKOJUNST_STATUS_MAIL_CSV_IMPORT_SCHEDULE_CRON,
  FKOJUNST_STATUS_MAIL_CSV_IMPORT_SCHEDULE_ID,
  buildDefaultFkojunstStatusMailCsvImportSchedule,
} from './system-csv-import-schedule-builtin-rows.js';

type CsvImportScheduleRow = NonNullable<BackupConfig['csvImports']>[number];

export function applyFkojunstStatusMailImportScheduleInvariants(
  schedule: CsvImportScheduleRow
): CsvImportScheduleRow {
  return normalizeSystemCsvImportRowForPersistence(schedule);
}

export function ensureFkojunstStatusMailCsvImportSchedule(config: BackupConfig): {
  config: BackupConfig;
  repaired: boolean;
} {
  return ensureSystemCsvImportScheduleInBackupConfig(
    config,
    FKOJUNST_STATUS_MAIL_CSV_IMPORT_SCHEDULE_ID,
    buildDefaultFkojunstStatusMailCsvImportSchedule
  );
}
