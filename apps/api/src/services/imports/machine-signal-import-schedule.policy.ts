import type { BackupConfig } from '../backup/backup-config.js';

/** CSV取込の一覧で、設備稼働ログ（信号灯センサーの日報メール）の行に使う id。 */
export const MACHINE_SIGNAL_GMAIL_CSV_IMPORT_SCHEDULE_ID = 'machine-signal-gmail';

type CsvImportScheduleRow = NonNullable<BackupConfig['csvImports']>[number];

/** CSV取込の一覧にある、設備稼働ログの行（取込種別 machineSignalGmail を含む行）。無ければ undefined。 */
export function findMachineSignalGmailCsvImportSchedule(config: BackupConfig): CsvImportScheduleRow | undefined {
  return (config.csvImports ?? []).find(
    (schedule) =>
      schedule.id === MACHINE_SIGNAL_GMAIL_CSV_IMPORT_SCHEDULE_ID ||
      schedule.targets?.some((target) => target.type === 'machineSignalGmail'),
  );
}
