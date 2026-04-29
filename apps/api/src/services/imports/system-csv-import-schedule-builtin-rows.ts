import type { BackupConfig } from '../backup/backup-config.js';
import {
  PRODUCTION_SCHEDULE_FKOBAINO_DASHBOARD_ID,
  PRODUCTION_SCHEDULE_FKOJUNST_DASHBOARD_ID,
  PRODUCTION_SCHEDULE_FKOJUNST_STATUS_MAIL_DASHBOARD_ID,
  PRODUCTION_SCHEDULE_SEIBAN_MACHINE_NAME_SUPPLEMENT_DASHBOARD_ID,
} from '../production-schedule/constants.js';

export type CsvImportScheduleRow = NonNullable<BackupConfig['csvImports']>[number];

/** Gmail 経由で FKOJUNST CsvDashboard を定期取り込みする固定スケジュールID */
export const FKOJUNST_CSV_IMPORT_SCHEDULE_ID = 'csv-import-productionschedule-fkojunst';

/** 1日1回・深夜（Asia/Tokyo 想定の calendar 起動は CsvImportScheduler 側） */
export const FKOJUNST_CSV_IMPORT_SCHEDULE_CRON = '0 0 * * *';

/** Gmail 経由で FKOJUNST_Status CsvDashboard を定期取り込みする固定スケジュールID */
export const FKOJUNST_STATUS_MAIL_CSV_IMPORT_SCHEDULE_ID =
  'csv-import-productionschedule-fkojunst-status-mail';

/** 1日1回・1:05 JST（他 Gmail 取込と分離。runner は Asia/Tokyo） */
export const FKOJUNST_STATUS_MAIL_CSV_IMPORT_SCHEDULE_CRON = '5 1 * * *';

/** Gmail 経由で FKOBAINO CsvDashboard を定期取り込みする固定スケジュールID */
export const FKOBAINO_CSV_IMPORT_SCHEDULE_ID = 'csv-import-purchase-order-fkobaino';

/** 日曜 6:25 JST 相当の cron（他 Gmail 取込と分が被らないよう空きを取る想定） */
export const FKOBAINO_CSV_IMPORT_SCHEDULE_CRON = '25 6 * * 0';

/** Gmail 経由で FHINMEI_MH_SH CsvDashboard を定期取り込みする固定スケジュールID */
export const SEIBAN_MACHINE_NAME_SUPPLEMENT_CSV_IMPORT_SCHEDULE_ID =
  'csv-import-seiban-machine-name-supplement';

/** 日曜 6:15（Asia/Tokyo 想定の calendar 起動は CsvImportScheduler 側） */
export const SEIBAN_MACHINE_NAME_SUPPLEMENT_CSV_IMPORT_SCHEDULE_CRON = '15 6 * * 0';

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

/** システム予約スケジュールID → デフォルト行ビルダー（拡張時はここに追加） */
export const SYSTEM_CSV_IMPORT_SCHEDULE_DEFAULT_BUILDERS: Record<string, () => CsvImportScheduleRow> = {
  [FKOJUNST_CSV_IMPORT_SCHEDULE_ID]: buildDefaultFkojunstCsvImportSchedule,
  [FKOJUNST_STATUS_MAIL_CSV_IMPORT_SCHEDULE_ID]: buildDefaultFkojunstStatusMailCsvImportSchedule,
  [FKOBAINO_CSV_IMPORT_SCHEDULE_ID]: buildDefaultFkobainoCsvImportSchedule,
  [SEIBAN_MACHINE_NAME_SUPPLEMENT_CSV_IMPORT_SCHEDULE_ID]: buildDefaultSeibanMachineNameSupplementCsvImportSchedule,
};

export function resolveSystemCsvImportDefaultBuilder(
  id: string
): (() => CsvImportScheduleRow) | null {
  return SYSTEM_CSV_IMPORT_SCHEDULE_DEFAULT_BUILDERS[id] ?? null;
}
