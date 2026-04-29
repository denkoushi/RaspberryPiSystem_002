import type { BackupConfig } from '../backup/backup-config.js';
import { buildDefaultFkojunstCsvImportSchedule, FKOJUNST_CSV_IMPORT_SCHEDULE_ID } from './system-csv-import-schedule-builtin-rows.js';
import {
  ensureSystemCsvImportScheduleInBackupConfig,
  normalizeSystemCsvImportRowForPersistence,
} from './system-csv-import-schedule-invariants.js';

export {
  FKOJUNST_CSV_IMPORT_SCHEDULE_CRON,
  FKOJUNST_CSV_IMPORT_SCHEDULE_ID,
  buildDefaultFkojunstCsvImportSchedule,
} from './system-csv-import-schedule-builtin-rows.js';

type CsvImportScheduleRow = NonNullable<BackupConfig['csvImports']>[number];

/**
 * 固定スケジュールについて provider / targets / replaceExisting を不変条件に合わせる。
 * 有効な cron（最小間隔含む）は保持する。name / enabled / retryConfig 等も維持。
 */
export function applyFkojunstImportScheduleInvariants(schedule: CsvImportScheduleRow): CsvImportScheduleRow {
  return normalizeSystemCsvImportRowForPersistence(schedule);
}

/**
 * backup.json の csvImports に FKOJUNST 用 Gmail スケジュールを1件保証する。
 * - 無ければ追加
 * - あれば不変条件を満たすよう修正
 * - 同一IDの重複行があれば1件に正規化
 */
export function ensureFkojunstCsvImportSchedule(config: BackupConfig): { config: BackupConfig; repaired: boolean } {
  return ensureSystemCsvImportScheduleInBackupConfig(
    config,
    FKOJUNST_CSV_IMPORT_SCHEDULE_ID,
    buildDefaultFkojunstCsvImportSchedule
  );
}
