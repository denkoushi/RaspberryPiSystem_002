import { validate as validateCron } from 'node-cron';

import type { BackupConfig } from '../backup/backup-config.js';
import {
  extractIntervalMinutes,
  MIN_CSV_IMPORT_INTERVAL_MINUTES,
} from './import-schedule-policy.js';
import type { CsvImportScheduleRow } from './system-csv-import-schedule-builtin-rows.js';
import { resolveSystemCsvImportDefaultBuilder } from './system-csv-import-schedule-builtin-rows.js';

function coerceSystemCsvImportScheduleCronValue(schedule: string | undefined, defaultCron: string): string {
  if (!schedule || !schedule.trim()) {
    return defaultCron;
  }
  const trimmed = schedule.trim();
  if (!validateCron(trimmed)) {
    return defaultCron;
  }
  const interval = extractIntervalMinutes(trimmed);
  if (interval !== null && interval < MIN_CSV_IMPORT_INTERVAL_MINUTES) {
    return defaultCron;
  }
  return trimmed;
}

function csvImportSchedulePersistenceShapeEqual(a: CsvImportScheduleRow, b: CsvImportScheduleRow): boolean {
  return (
    a.provider === b.provider &&
    a.schedule === b.schedule &&
    a.replaceExisting === b.replaceExisting &&
    JSON.stringify(a.targets ?? []) === JSON.stringify(b.targets ?? []) &&
    JSON.stringify(a.autoBackupAfterImport ?? null) === JSON.stringify(b.autoBackupAfterImport ?? null)
  );
}

/**
 * システム予約スケジュール行を永続化用に正規化する。
 * - provider / targets / replaceExisting はデフォルト定義へ揃える
 * - schedule は有効かつ最小間隔を満たす場合は保持、そうでなければデフォルトへ
 * - 予約IDでない行は無変更
 */
export function normalizeSystemCsvImportRowForPersistence(row: CsvImportScheduleRow): CsvImportScheduleRow {
  const build = resolveSystemCsvImportDefaultBuilder(row.id);
  if (!build) {
    return row;
  }
  const base = build();
  const schedule = coerceSystemCsvImportScheduleCronValue(row.schedule, base.schedule);
  return {
    ...row,
    provider: base.provider,
    targets: base.targets,
    replaceExisting: base.replaceExisting,
    autoBackupAfterImport: row.autoBackupAfterImport ?? base.autoBackupAfterImport,
    schedule,
  };
}

/**
 * backup.json の csvImports に特定のシステム予約行を1件保証する（重複除去・欠損補完・正規化）。
 */
export function ensureSystemCsvImportScheduleInBackupConfig(
  config: BackupConfig,
  scheduleId: string,
  buildDefault: () => CsvImportScheduleRow
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

  const idRows = deduped.filter((r) => r.id === scheduleId);
  if (idRows.length > 1) {
    const without = deduped.filter((r) => r.id !== scheduleId);
    deduped.length = 0;
    deduped.push(...without, idRows[0]!);
    repaired = true;
  }

  const canonical = buildDefault();
  const idx = deduped.findIndex((r) => r.id === scheduleId);
  if (idx === -1) {
    deduped.push(canonical);
    return { config: { ...config, csvImports: deduped }, repaired: true };
  }

  const current = deduped[idx]!;
  const fixed = normalizeSystemCsvImportRowForPersistence(current);
  if (!csvImportSchedulePersistenceShapeEqual(current, fixed)) {
    deduped[idx] = fixed;
    repaired = true;
  }

  return { config: { ...config, csvImports: deduped }, repaired };
}
