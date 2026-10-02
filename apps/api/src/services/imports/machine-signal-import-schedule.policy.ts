import type { BackupConfig } from '../backup/backup-config.js';
import { MACHINE_SIGNAL_GMAIL_SUBJECT } from '../gmail/gmail-subject-reservation.policy.js';

export const MACHINE_SIGNAL_GMAIL_CSV_IMPORT_SCHEDULE_ID = 'machine-signal-gmail';
/**
 * 日報メールは1日1通で、届く時刻が決まっていないので毎時確認する。
 * ほかの Gmail 取り込みと重ならず、次の取り込みまで3分空く47分を既定にする。
 */
export const MACHINE_SIGNAL_GMAIL_CSV_IMPORT_SCHEDULE_CRON = '47 * * * *';

type CsvImportScheduleRow = NonNullable<BackupConfig['csvImports']>[number];

/** CSV取込の一覧に、設備稼働ログ（信号灯センサーの日報メール）の行が無ければ足す。 */
export function ensureMachineSignalGmailCsvImportSchedule(config: BackupConfig): {
  config: BackupConfig;
  repaired: boolean;
} {
  const schedules = config.csvImports ?? [];
  const alreadyConfigured = schedules.some(
    (schedule) =>
      schedule.id === MACHINE_SIGNAL_GMAIL_CSV_IMPORT_SCHEDULE_ID ||
      schedule.targets?.some((target) => target.type === 'machineSignalGmail'),
  );
  if (alreadyConfigured) return { config, repaired: false };

  const gmail = config.storage.options?.gmail;
  const schedule: CsvImportScheduleRow = {
    id: MACHINE_SIGNAL_GMAIL_CSV_IMPORT_SCHEDULE_ID,
    name: '設備稼働ログ（信号灯の日報）取込',
    provider: 'gmail',
    targets: [{ type: 'machineSignalGmail', source: MACHINE_SIGNAL_GMAIL_SUBJECT }],
    schedule: MACHINE_SIGNAL_GMAIL_CSV_IMPORT_SCHEDULE_CRON,
    // Gmail を連携していない環境（開発機など）では、毎時の失敗を出さないよう止めた状態で足す。
    enabled: Boolean(gmail?.refreshToken && gmail.clientId),
    replaceExisting: false,
    autoBackupAfterImport: { enabled: false, targets: ['csv'] },
  };

  return {
    config: { ...config, csvImports: [...schedules, schedule] },
    repaired: true,
  };
}
