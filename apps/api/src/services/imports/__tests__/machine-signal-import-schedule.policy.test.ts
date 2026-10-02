import { describe, expect, it } from 'vitest';

import type { BackupConfig } from '../../backup/backup-config.js';
import {
  ensureMachineSignalGmailCsvImportSchedule,
  MACHINE_SIGNAL_GMAIL_CSV_IMPORT_SCHEDULE_ID,
} from '../machine-signal-import-schedule.policy.js';

const baseConfig = {
  storage: { provider: 'gmail', options: { gmail: { clientId: 'id', refreshToken: 'token' } } },
  csvImports: [],
} as unknown as BackupConfig;

describe('ensureMachineSignalGmailCsvImportSchedule', () => {
  it('adds the hourly machine signal row once, enabled, with the reserved subject', () => {
    const first = ensureMachineSignalGmailCsvImportSchedule(baseConfig);

    expect(first.repaired).toBe(true);
    expect(first.config.csvImports).toEqual([
      expect.objectContaining({
        id: MACHINE_SIGNAL_GMAIL_CSV_IMPORT_SCHEDULE_ID,
        provider: 'gmail',
        schedule: '47 * * * *',
        enabled: true,
        targets: [{ type: 'machineSignalGmail', source: 'AirGridFlexSignal' }],
      }),
    ]);

    const second = ensureMachineSignalGmailCsvImportSchedule(first.config);
    expect(second.repaired).toBe(false);
    expect(second.config.csvImports).toHaveLength(1);
  });

  it('adds the row switched off where Gmail is not connected', () => {
    const result = ensureMachineSignalGmailCsvImportSchedule({
      storage: { provider: 'local', options: {} },
      csvImports: [],
    } as unknown as BackupConfig);
    expect(result.config.csvImports?.[0]).toMatchObject({ id: MACHINE_SIGNAL_GMAIL_CSV_IMPORT_SCHEDULE_ID, enabled: false });
  });

  it('keeps a row the admin changed, including a different time or a disabled state', () => {
    const edited = {
      ...baseConfig,
      csvImports: [
        {
          id: MACHINE_SIGNAL_GMAIL_CSV_IMPORT_SCHEDULE_ID,
          name: '設備稼働',
          provider: 'gmail',
          schedule: '17 6 * * *',
          enabled: false,
          targets: [{ type: 'machineSignalGmail', source: 'AirGridFlexSignal' }],
        },
      ],
    } as unknown as BackupConfig;

    const result = ensureMachineSignalGmailCsvImportSchedule(edited);

    expect(result.repaired).toBe(false);
    expect(result.config).toBe(edited);
  });
});
