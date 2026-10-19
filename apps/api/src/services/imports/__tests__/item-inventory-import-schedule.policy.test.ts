import { describe, expect, it } from 'vitest';

import type { BackupConfig } from '../../backup/backup-config.js';
import {
  ensureItemInventoryGmailCsvImportSchedule,
  ITEM_INVENTORY_GMAIL_CSV_IMPORT_SCHEDULE_ID,
} from '../item-inventory-import-schedule.policy.js';

describe('item inventory Gmail import schedule policy', () => {
  it('migrates the legacy intake settings into the shared schedule list', () => {
    const config = {
      storage: { provider: 'local', options: {} },
      targets: [],
      csvImports: [],
      itemInventoryGmailIngest: {
        enabled: true,
        subjectTokens: ['[legacy-inventory-subject]'],
        fromEmail: 'inventory@example.com',
      },
    } as BackupConfig;

    const first = ensureItemInventoryGmailCsvImportSchedule(config);
    const schedule = first.config.csvImports?.find((row) => row.id === ITEM_INVENTORY_GMAIL_CSV_IMPORT_SCHEDULE_ID);

    expect(first.repaired).toBe(true);
    expect(schedule).toMatchObject({
      provider: 'gmail',
      enabled: true,
      schedule: '*/5 * * * *',
      targets: [{ type: 'itemInventoryGmail', source: '[ItemlistRaspi-photo]' }],
      metadata: { itemInventoryFromEmail: 'inventory@example.com' },
    });

    const second = ensureItemInventoryGmailCsvImportSchedule(first.config);
    expect(second.repaired).toBe(false);
    expect(second.config.csvImports?.filter((row) => row.id === ITEM_INVENTORY_GMAIL_CSV_IMPORT_SCHEDULE_ID)).toHaveLength(1);
  });
});
