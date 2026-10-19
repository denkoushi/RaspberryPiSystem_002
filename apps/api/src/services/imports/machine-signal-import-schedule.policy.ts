import type { BackupConfig } from '../backup/backup-config.js';
import { MACHINE_SIGNAL_GMAIL_SUBJECT } from '../gmail/gmail-subject-reservation.policy.js';

/** CSV取込の一覧で、設備稼働ログ（信号灯センサーの日報メール）の行に使う id。 */
export const MACHINE_SIGNAL_GMAIL_CSV_IMPORT_SCHEDULE_ID = 'machine-signal-gmail';
/**
 * 日報メールは1日1通で、届く時刻が決まっていないので毎時確認する（メールが無ければ検索1回だけ）。
 * ほかの Gmail 取り込みと重ならず、次の取り込みまで3分空く47分を既定にする。
 */
export const MACHINE_SIGNAL_GMAIL_CSV_IMPORT_SCHEDULE_CRON = '47 * * * *';

type CsvImportScheduleRow = NonNullable<BackupConfig['csvImports']>[number];

/** CSV取込の一覧にある、設備稼働ログの行（取込種別 machineSignalGmail を含む行）。無ければ undefined。 */
export function findMachineSignalGmailCsvImportSchedule(config: BackupConfig): CsvImportScheduleRow | undefined {
  return (config.csvImports ?? []).find(
    (schedule) =>
      schedule.id === MACHINE_SIGNAL_GMAIL_CSV_IMPORT_SCHEDULE_ID ||
      schedule.targets?.some((target) => target.type === 'machineSignalGmail'),
  );
}

/**
 * CSV取込の一覧に、設備稼働ログの行が無ければ足す。管理者が時刻や有効・無効を変えた行は触らない。
 * この種別を読めない版（1d755105 より前）へ戻すと backup.json の検証に失敗するので、
 * 行を足すのは、読める版が本番に入ったあとに限る。
 */
export function ensureMachineSignalGmailCsvImportSchedule(config: BackupConfig): {
  config: BackupConfig;
  repaired: boolean;
} {
  if (findMachineSignalGmailCsvImportSchedule(config)) return { config, repaired: false };

  const gmail = config.storage.options?.gmail;
  const schedule: CsvImportScheduleRow = {
    id: MACHINE_SIGNAL_GMAIL_CSV_IMPORT_SCHEDULE_ID,
    // 時刻表の画面は、日本語の名前をそのまま表示する。
    name: '設備稼働',
    provider: 'gmail',
    targets: [{ type: 'machineSignalGmail', source: MACHINE_SIGNAL_GMAIL_SUBJECT }],
    schedule: MACHINE_SIGNAL_GMAIL_CSV_IMPORT_SCHEDULE_CRON,
    // Gmail を連携していない環境（開発機など）では、毎時の失敗を出さないよう止めた状態で足す。
    enabled: Boolean(gmail?.refreshToken && gmail.clientId),
    replaceExisting: false,
    autoBackupAfterImport: { enabled: false, targets: ['csv'] },
  };

  return {
    config: { ...config, csvImports: [...(config.csvImports ?? []), schedule] },
    repaired: true,
  };
}
