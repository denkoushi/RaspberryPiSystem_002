import { describe, expect, it } from 'vitest';

import { expandGmailScheduleTriggerKeys, extractIntervalMinutes } from '../import-schedule-policy.js';
import { buildDefaultFkobainoCsvImportSchedule } from '../system-csv-import-schedule-builtin-rows.js';
import { ensureSystemCsvImportScheduleInBackupConfig, normalizeSystemCsvImportRowForPersistence } from '../system-csv-import-schedule-invariants.js';

import type { BackupConfig } from '../../backup/backup-config.js';

describe('FKOBAINO daily default', () => {
  it.each(['25 6 * * 0', ' 25 6 * * 0 ', '\t25 6 * * 0\n'])('migrates the trimmed former default %s and persists the repair once', (schedule) => {
    const row = { ...buildDefaultFkobainoCsvImportSchedule(), schedule };
    const config: BackupConfig = { storage: { provider: 'local', options: {} }, targets: [], csvImports: [row] };
    const fixed = ensureSystemCsvImportScheduleInBackupConfig(config, row.id, buildDefaultFkobainoCsvImportSchedule);
    expect(fixed.repaired).toBe(true);
    expect(fixed.config.csvImports?.[0].schedule).toBe('25 6 * * *');
    expect(ensureSystemCsvImportScheduleInBackupConfig(fixed.config, row.id, buildDefaultFkobainoCsvImportSchedule).repaired).toBe(false);
  });
  it.each(['30 6 * * 0', '25 6 * * 1', '0 7 * * *', '25 6 * * SUN', ' 30 6 * * 0 '])('retains trimmed administrator cron %s', (schedule) => {
    const normalized = normalizeSystemCsvImportRowForPersistence({ ...buildDefaultFkobainoCsvImportSchedule(), schedule });
    expect(normalized.schedule).toBe(schedule.trim());
    expect(normalizeSystemCsvImportRowForPersistence(normalized).schedule).toBe(schedule.trim());
  });
  it('satisfies the minimum interval', () => {
    const row = buildDefaultFkobainoCsvImportSchedule();
    expect(row.schedule).toBe('25 6 * * *');
    // Fixed-hour daily cron is outside the minute-repeat restriction.
    expect(extractIntervalMinutes(row.schedule)).toBeNull();
    expect(expandGmailScheduleTriggerKeys(row.schedule)?.size).toBe(7);
    expect(normalizeSystemCsvImportRowForPersistence(row)).toEqual(row);
  });
});
