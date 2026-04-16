import type { BackupConfig } from '../backup/backup-config.js';
import { PRODUCTION_SCHEDULE_FKOJUNST_DASHBOARD_ID } from '../production-schedule/constants.js';

/** Gmail 経由で FKOJUNST CsvDashboard を定期取り込みする固定スケジュールID */
export const FKOJUNST_CSV_IMPORT_SCHEDULE_ID = 'csv-import-productionschedule-fkojunst';

/** 1日1回・深夜（Asia/Tokyo 想定の calendar 起動は CsvImportScheduler 側） */
export const FKOJUNST_CSV_IMPORT_SCHEDULE_CRON = '0 0 * * *';

type CsvImportScheduleRow = NonNullable<BackupConfig['csvImports']>[number];

export function buildDefaultFkojunstCsvImportSchedule(): CsvImportScheduleRow {
  return {
    id: FKOJUNST_CSV_IMPORT_SCHEDULE_ID,
    name: 'ProductionSchedule_FKOJUNST (Gmail)',
    provider: 'gmail',
    targets: [{ type: 'csvDashboards', source: PRODUCTION_SCHEDULE_FKOJUNST_DASHBOARD_ID }],
    schedule: FKOJUNST_CSV_IMPORT_SCHEDULE_CRON,
    enabled: true,
    replaceExisting: false,
    autoBackupAfterImport: { enabled: false, targets: ['csv'] },
  };
}

/**
 * 固定スケジュールについて provider / targets / cron を不変条件に合わせる。
 * name / enabled / retryConfig / metadata は呼び出し側の値を維持する。
 */
export function applyFkojunstImportScheduleInvariants(schedule: CsvImportScheduleRow): CsvImportScheduleRow {
  if (schedule.id !== FKOJUNST_CSV_IMPORT_SCHEDULE_ID) {
    return schedule;
  }
  const base = buildDefaultFkojunstCsvImportSchedule();
  return {
    ...schedule,
    provider: base.provider,
    targets: base.targets,
    schedule: base.schedule,
    replaceExisting: base.replaceExisting,
    autoBackupAfterImport: schedule.autoBackupAfterImport ?? base.autoBackupAfterImport,
  };
}

/**
 * backup.json の csvImports に FKOJUNST 用 Gmail スケジュールを1件保証する。
 * - 無ければ追加
 * - あれば不変条件を満たすよう修正
 * - 同一IDの重複行があれば1件に正規化
 */
export function ensureFkojunstCsvImportSchedule(config: BackupConfig): { config: BackupConfig; repaired: boolean } {
  const incoming = [...(config.csvImports ?? [])];
  const seen = new Set<string>();
  const deduped: CsvImportScheduleRow[] = [];
  let repaired = false;

  for (const row of incoming) {
    if (seen.has(row.id)) {
      repaired = true;
      continue;
    }
    seen.add(row.id);
    deduped.push(row);
  }

  const fkRows = deduped.filter((r) => r.id === FKOJUNST_CSV_IMPORT_SCHEDULE_ID);
  if (fkRows.length > 1) {
    const without = deduped.filter((r) => r.id !== FKOJUNST_CSV_IMPORT_SCHEDULE_ID);
    deduped.length = 0;
    deduped.push(...without, fkRows[0]!);
    repaired = true;
  }

  const canonical = buildDefaultFkojunstCsvImportSchedule();
  const idx = deduped.findIndex((r) => r.id === FKOJUNST_CSV_IMPORT_SCHEDULE_ID);
  if (idx === -1) {
    deduped.push(canonical);
    return { config: { ...config, csvImports: deduped }, repaired: true };
  }

  const current = deduped[idx]!;
  const fixed = applyFkojunstImportScheduleInvariants(current);
  const same =
    current.provider === fixed.provider &&
    current.schedule === fixed.schedule &&
    current.replaceExisting === fixed.replaceExisting &&
    JSON.stringify(current.targets ?? []) === JSON.stringify(fixed.targets ?? []) &&
    JSON.stringify(current.autoBackupAfterImport ?? null) === JSON.stringify(fixed.autoBackupAfterImport ?? null);
  if (!same) {
    deduped[idx] = fixed;
    repaired = true;
  }

  return { config: { ...config, csvImports: deduped }, repaired };
}
