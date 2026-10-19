import type { BackupConfig } from '../backup/backup-config.js';
import { PROCEDURE_MATERIAL_GMAIL_SUBJECT_TOKENS } from '../gmail/gmail-subject-reservation.policy.js';

export const PROCEDURE_MATERIAL_GMAIL_CSV_IMPORT_SCHEDULE_ID = 'procedure-material-gmail';
export const PROCEDURE_MATERIAL_GMAIL_CSV_IMPORT_SCHEDULE_CRON = '*/5 * * * *';

type CsvImportScheduleRow = NonNullable<BackupConfig['csvImports']>[number];

export function ensureProcedureMaterialGmailCsvImportSchedule(config: BackupConfig): {
  config: BackupConfig;
  repaired: boolean;
} {
  const schedules = config.csvImports ?? [];
  const alreadyConfigured = schedules.some(
    (schedule) =>
      schedule.id === PROCEDURE_MATERIAL_GMAIL_CSV_IMPORT_SCHEDULE_ID ||
      schedule.targets?.some((target) => target.type === 'procedureMaterialGmail'),
  );
  if (alreadyConfigured) return { config, repaired: false };

  const legacy = config.procedureMaterialGmailIngest;
  const schedule: CsvImportScheduleRow = {
    id: PROCEDURE_MATERIAL_GMAIL_CSV_IMPORT_SCHEDULE_ID,
    name: '要領書の素材(Gmail)',
    provider: 'gmail',
    targets: [{
      type: 'procedureMaterialGmail',
      source: PROCEDURE_MATERIAL_GMAIL_SUBJECT_TOKENS[0],
    }],
    schedule: PROCEDURE_MATERIAL_GMAIL_CSV_IMPORT_SCHEDULE_CRON,
    enabled: legacy?.enabled ?? false,
    replaceExisting: false,
    autoBackupAfterImport: { enabled: false, targets: ['csv'] },
    ...(legacy?.fromEmail?.trim()
      ? { metadata: { procedureMaterialFromEmail: legacy.fromEmail.trim() } }
      : {}),
  };

  return {
    config: { ...config, csvImports: [...schedules, schedule] },
    repaired: true,
  };
}
