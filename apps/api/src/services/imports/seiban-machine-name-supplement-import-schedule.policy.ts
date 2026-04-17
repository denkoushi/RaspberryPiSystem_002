import type { BackupConfig } from '../backup/backup-config.js';
import { PRODUCTION_SCHEDULE_SEIBAN_MACHINE_NAME_SUPPLEMENT_DASHBOARD_ID } from '../production-schedule/constants.js';

/** Gmail 経由で FHINMEI_MH_SH CsvDashboard を定期取り込みする固定スケジュールID */
export const SEIBAN_MACHINE_NAME_SUPPLEMENT_CSV_IMPORT_SCHEDULE_ID =
  'csv-import-seiban-machine-name-supplement';

/** 日曜 6:15（Asia/Tokyo 想定の calendar 起動は CsvImportScheduler 側） */
export const SEIBAN_MACHINE_NAME_SUPPLEMENT_CSV_IMPORT_SCHEDULE_CRON = '15 6 * * 0';

type CsvImportScheduleRow = NonNullable<BackupConfig['csvImports']>[number];

export function buildDefaultSeibanMachineNameSupplementCsvImportSchedule(): CsvImportScheduleRow {
  return {
    id: SEIBAN_MACHINE_NAME_SUPPLEMENT_CSV_IMPORT_SCHEDULE_ID,
    name: 'ProductionSchedule_SeibanMachineNameSupplement (Gmail, FHINMEI_MH_SH)',
    provider: 'gmail',
    targets: [{ type: 'csvDashboards', source: PRODUCTION_SCHEDULE_SEIBAN_MACHINE_NAME_SUPPLEMENT_DASHBOARD_ID }],
    schedule: SEIBAN_MACHINE_NAME_SUPPLEMENT_CSV_IMPORT_SCHEDULE_CRON,
    enabled: false,
    replaceExisting: false,
    autoBackupAfterImport: { enabled: false, targets: ['csv'] },
  };
}

/**
 * 固定スケジュールについて provider / targets / cron を不変条件に合わせる。
 * name / enabled / retryConfig / metadata は呼び出し側の値を維持する。
 */
export function applySeibanMachineNameSupplementImportScheduleInvariants(
  schedule: CsvImportScheduleRow
): CsvImportScheduleRow {
  if (schedule.id !== SEIBAN_MACHINE_NAME_SUPPLEMENT_CSV_IMPORT_SCHEDULE_ID) {
    return schedule;
  }
  const base = buildDefaultSeibanMachineNameSupplementCsvImportSchedule();
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
 * backup.json の csvImports に FHINMEI_MH_SH 用 Gmail スケジュールを1件保証する。
 * - 無ければ追加
 * - あれば不変条件を満たすよう修正
 * - 同一IDの重複行があれば1件に正規化
 */
export function ensureSeibanMachineNameSupplementCsvImportSchedule(
  config: BackupConfig
): { config: BackupConfig; repaired: boolean } {
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

  const fixedRows = deduped.filter((r) => r.id === SEIBAN_MACHINE_NAME_SUPPLEMENT_CSV_IMPORT_SCHEDULE_ID);
  if (fixedRows.length > 1) {
    const without = deduped.filter((r) => r.id !== SEIBAN_MACHINE_NAME_SUPPLEMENT_CSV_IMPORT_SCHEDULE_ID);
    deduped.length = 0;
    deduped.push(...without, fixedRows[0]!);
    repaired = true;
  }

  const canonical = buildDefaultSeibanMachineNameSupplementCsvImportSchedule();
  const idx = deduped.findIndex((r) => r.id === SEIBAN_MACHINE_NAME_SUPPLEMENT_CSV_IMPORT_SCHEDULE_ID);
  if (idx === -1) {
    deduped.push(canonical);
    return { config: { ...config, csvImports: deduped }, repaired: true };
  }

  const current = deduped[idx]!;
  const fixed = applySeibanMachineNameSupplementImportScheduleInvariants(current);
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
