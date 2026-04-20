import type { BackupConfig } from '../backup/backup-config.js';
import { PRODUCTION_SCHEDULE_FKOBAINO_DASHBOARD_ID } from '../production-schedule/constants.js';

/** Gmail 経由で FKOBAINO CsvDashboard を定期取り込みする固定スケジュールID */
export const FKOBAINO_CSV_IMPORT_SCHEDULE_ID = 'csv-import-purchase-order-fkobaino';

/** 日曜 6:25 JST 相当の cron（他 Gmail 取込と分が被らないよう空きを取る想定） */
export const FKOBAINO_CSV_IMPORT_SCHEDULE_CRON = '25 6 * * 0';

type CsvImportScheduleRow = NonNullable<BackupConfig['csvImports']>[number];

export function buildDefaultFkobainoCsvImportSchedule(): CsvImportScheduleRow {
  return {
    id: FKOBAINO_CSV_IMPORT_SCHEDULE_ID,
    name: 'PurchaseOrder_FKOBAINO (Gmail)',
    provider: 'gmail',
    targets: [{ type: 'csvDashboards', source: PRODUCTION_SCHEDULE_FKOBAINO_DASHBOARD_ID }],
    schedule: FKOBAINO_CSV_IMPORT_SCHEDULE_CRON,
    enabled: false,
    replaceExisting: false,
    autoBackupAfterImport: { enabled: false, targets: ['csv'] },
  };
}

export function applyFkobainoImportScheduleInvariants(schedule: CsvImportScheduleRow): CsvImportScheduleRow {
  if (schedule.id !== FKOBAINO_CSV_IMPORT_SCHEDULE_ID) {
    return schedule;
  }
  const base = buildDefaultFkobainoCsvImportSchedule();
  return {
    ...schedule,
    provider: base.provider,
    targets: base.targets,
    schedule: base.schedule,
    replaceExisting: base.replaceExisting,
    autoBackupAfterImport: schedule.autoBackupAfterImport ?? base.autoBackupAfterImport,
  };
}

export function ensureFkobainoCsvImportSchedule(config: BackupConfig): { config: BackupConfig; repaired: boolean } {
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

  const fkRows = deduped.filter((r) => r.id === FKOBAINO_CSV_IMPORT_SCHEDULE_ID);
  if (fkRows.length > 1) {
    const without = deduped.filter((r) => r.id !== FKOBAINO_CSV_IMPORT_SCHEDULE_ID);
    deduped.length = 0;
    deduped.push(...without, fkRows[0]!);
    repaired = true;
  }

  const canonical = buildDefaultFkobainoCsvImportSchedule();
  const idx = deduped.findIndex((r) => r.id === FKOBAINO_CSV_IMPORT_SCHEDULE_ID);
  if (idx === -1) {
    deduped.push(canonical);
    return { config: { ...config, csvImports: deduped }, repaired: true };
  }

  const current = deduped[idx]!;
  const fixed = applyFkobainoImportScheduleInvariants(current);
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
