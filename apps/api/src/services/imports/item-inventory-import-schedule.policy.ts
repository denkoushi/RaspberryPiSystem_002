import type { BackupConfig } from '../backup/backup-config.js';
import { ITEM_INVENTORY_GMAIL_SUBJECT_TOKENS } from '../gmail/gmail-subject-reservation.policy.js';

export const ITEM_INVENTORY_GMAIL_CSV_IMPORT_SCHEDULE_ID = 'item-inventory-gmail';
export const ITEM_INVENTORY_GMAIL_CSV_IMPORT_SCHEDULE_CRON = '*/5 * * * *';

type CsvImportScheduleRow = NonNullable<BackupConfig['csvImports']>[number];

export function ensureItemInventoryGmailCsvImportSchedule(config: BackupConfig): {
  config: BackupConfig;
  repaired: boolean;
} {
  const schedules = config.csvImports ?? [];
  const alreadyConfigured = schedules.some(
    (schedule) =>
      schedule.id === ITEM_INVENTORY_GMAIL_CSV_IMPORT_SCHEDULE_ID ||
      schedule.targets?.some((target) => target.type === 'itemInventoryGmail'),
  );
  if (alreadyConfigured) return { config, repaired: false };

  const legacy = config.itemInventoryGmailIngest;
  const schedule: CsvImportScheduleRow = {
    id: ITEM_INVENTORY_GMAIL_CSV_IMPORT_SCHEDULE_ID,
    name: 'Raspberry Pi在庫写真メール取込',
    provider: 'gmail',
    targets: [{
      type: 'itemInventoryGmail',
      source: ITEM_INVENTORY_GMAIL_SUBJECT_TOKENS[0],
    }],
    schedule: ITEM_INVENTORY_GMAIL_CSV_IMPORT_SCHEDULE_CRON,
    enabled: legacy?.enabled ?? false,
    replaceExisting: false,
    autoBackupAfterImport: { enabled: false, targets: ['csv'] },
    ...(legacy?.fromEmail?.trim()
      ? { metadata: { itemInventoryFromEmail: legacy.fromEmail.trim() } }
      : {}),
  };

  return {
    config: { ...config, csvImports: [...schedules, schedule] },
    repaired: true,
  };
}
