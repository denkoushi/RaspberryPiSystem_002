import type { BackupConfig } from '../backup/backup-config.js';
import { PRODUCTION_SCHEDULE_FKOJUNST_STATUS_MAIL_DASHBOARD_ID } from '../production-schedule/constants.js';

/** Gmail 経由で FKOJUNST_Status CsvDashboard を定期取り込みする固定スケジュールID */
export const FKOJUNST_STATUS_MAIL_CSV_IMPORT_SCHEDULE_ID =
  'csv-import-productionschedule-fkojunst-status-mail';

/** 1日1回・1:05 JST（他 Gmail 取込と分離。runner は Asia/Tokyo） */
export const FKOJUNST_STATUS_MAIL_CSV_IMPORT_SCHEDULE_CRON = '5 1 * * *';

type CsvImportScheduleRow = NonNullable<BackupConfig['csvImports']>[number];

export function buildDefaultFkojunstStatusMailCsvImportSchedule(): CsvImportScheduleRow {
  return {
    id: FKOJUNST_STATUS_MAIL_CSV_IMPORT_SCHEDULE_ID,
    name: 'ProductionSchedule_FKOJUNST_Status (Gmail)',
    provider: 'gmail',
    targets: [{ type: 'csvDashboards', source: PRODUCTION_SCHEDULE_FKOJUNST_STATUS_MAIL_DASHBOARD_ID }],
    schedule: FKOJUNST_STATUS_MAIL_CSV_IMPORT_SCHEDULE_CRON,
    enabled: false,
    replaceExisting: false,
    autoBackupAfterImport: { enabled: false, targets: ['csv'] },
  };
}

export function applyFkojunstStatusMailImportScheduleInvariants(
  schedule: CsvImportScheduleRow
): CsvImportScheduleRow {
  if (schedule.id !== FKOJUNST_STATUS_MAIL_CSV_IMPORT_SCHEDULE_ID) {
    return schedule;
  }
  const base = buildDefaultFkojunstStatusMailCsvImportSchedule();
  return {
    ...schedule,
    provider: base.provider,
    targets: base.targets,
    schedule: base.schedule,
    replaceExisting: base.replaceExisting,
    autoBackupAfterImport: schedule.autoBackupAfterImport ?? base.autoBackupAfterImport,
  };
}

export function ensureFkojunstStatusMailCsvImportSchedule(config: BackupConfig): {
  config: BackupConfig;
  repaired: boolean;
} {
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

  const rows = deduped.filter((r) => r.id === FKOJUNST_STATUS_MAIL_CSV_IMPORT_SCHEDULE_ID);
  if (rows.length > 1) {
    const without = deduped.filter((r) => r.id !== FKOJUNST_STATUS_MAIL_CSV_IMPORT_SCHEDULE_ID);
    deduped.length = 0;
    deduped.push(...without, rows[0]!);
    repaired = true;
  }

  const canonical = buildDefaultFkojunstStatusMailCsvImportSchedule();
  const idx = deduped.findIndex((r) => r.id === FKOJUNST_STATUS_MAIL_CSV_IMPORT_SCHEDULE_ID);
  if (idx === -1) {
    deduped.push(canonical);
    return { config: { ...config, csvImports: deduped }, repaired: true };
  }

  const current = deduped[idx]!;
  const fixed = applyFkojunstStatusMailImportScheduleInvariants(current);
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
