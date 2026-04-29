import type { BackupConfig } from '../backup/backup-config.js';
import {
  buildDefaultSeibanMachineNameSupplementCsvImportSchedule,
  SEIBAN_MACHINE_NAME_SUPPLEMENT_CSV_IMPORT_SCHEDULE_ID,
} from './system-csv-import-schedule-builtin-rows.js';
import {
  ensureSystemCsvImportScheduleInBackupConfig,
  normalizeSystemCsvImportRowForPersistence,
} from './system-csv-import-schedule-invariants.js';

export {
  SEIBAN_MACHINE_NAME_SUPPLEMENT_CSV_IMPORT_SCHEDULE_CRON,
  SEIBAN_MACHINE_NAME_SUPPLEMENT_CSV_IMPORT_SCHEDULE_ID,
  buildDefaultSeibanMachineNameSupplementCsvImportSchedule,
} from './system-csv-import-schedule-builtin-rows.js';

type CsvImportScheduleRow = NonNullable<BackupConfig['csvImports']>[number];

/**
 * 固定スケジュールについて provider / targets / replaceExisting を不変条件に合わせる。
 * 有効な cron は保持する。name / enabled / retryConfig 等も維持。
 */
export function applySeibanMachineNameSupplementImportScheduleInvariants(
  schedule: CsvImportScheduleRow
): CsvImportScheduleRow {
  return normalizeSystemCsvImportRowForPersistence(schedule);
}

/**
 * backup.json の csvImports に FHINMEI_MH_SH 用 Gmail スケジュールを1件保証する。
 * - 無ければ追加
 * - あれば不変条件を満たすよう修正
 * - 同一IDの重複行があれば1件に正規化
 */
export function ensureSeibanMachineNameSupplementCsvImportSchedule(
  config: BackupConfig
): { config: BackupConfig; repaired: boolean } {
  return ensureSystemCsvImportScheduleInBackupConfig(
    config,
    SEIBAN_MACHINE_NAME_SUPPLEMENT_CSV_IMPORT_SCHEDULE_ID,
    buildDefaultSeibanMachineNameSupplementCsvImportSchedule
  );
}
