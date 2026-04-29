import { describe, expect, it } from 'vitest';
import type { BackupConfig } from '../../backup/backup-config.js';
import {
  buildDefaultFkojunstCsvImportSchedule,
  ensureFkojunstCsvImportSchedule,
  FKOJUNST_CSV_IMPORT_SCHEDULE_ID,
  FKOJUNST_CSV_IMPORT_SCHEDULE_CRON,
} from '../fkojunst-import-schedule.policy.js';
import { PRODUCTION_SCHEDULE_FKOJUNST_DASHBOARD_ID } from '../../production-schedule/constants.js';

describe('fkojunst-import-schedule.policy', () => {
  it('ensure adds default schedule when missing', () => {
    const input: BackupConfig = { storage: { provider: 'local', options: {} }, targets: [], csvImports: [] };
    const { config, repaired } = ensureFkojunstCsvImportSchedule(input);
    expect(repaired).toBe(true);
    const row = config.csvImports?.find((s) => s.id === FKOJUNST_CSV_IMPORT_SCHEDULE_ID);
    expect(row).toBeDefined();
    expect(row?.provider).toBe('gmail');
    expect(row?.schedule).toBe(FKOJUNST_CSV_IMPORT_SCHEDULE_CRON);
    expect(row?.targets).toEqual([
      { type: 'csvDashboards', source: PRODUCTION_SCHEDULE_FKOJUNST_DASHBOARD_ID },
    ]);
  });

  it('ensure repairs wrong provider or targets', () => {
    const input: BackupConfig = {
      storage: { provider: 'local', options: {} },
      targets: [],
      csvImports: [
        {
          id: FKOJUNST_CSV_IMPORT_SCHEDULE_ID,
          name: 'x',
          provider: 'dropbox',
          targets: [{ type: 'csvDashboards', source: 'wrong-uuid' }],
          schedule: FKOJUNST_CSV_IMPORT_SCHEDULE_CRON,
          enabled: true,
          replaceExisting: false,
          autoBackupAfterImport: { enabled: false, targets: ['csv'] },
        },
      ],
    };
    const { config, repaired } = ensureFkojunstCsvImportSchedule(input);
    expect(repaired).toBe(true);
    const row = config.csvImports?.find((s) => s.id === FKOJUNST_CSV_IMPORT_SCHEDULE_ID);
    expect(row?.provider).toBe('gmail');
    expect(row?.targets).toEqual([
      { type: 'csvDashboards', source: PRODUCTION_SCHEDULE_FKOJUNST_DASHBOARD_ID },
    ]);
  });

  it('ensure repairs replaceExisting and missing auto backup defaults', () => {
    const input: BackupConfig = {
      storage: { provider: 'local', options: {} },
      targets: [],
      csvImports: [
        {
          id: FKOJUNST_CSV_IMPORT_SCHEDULE_ID,
          name: 'x',
          provider: 'gmail',
          targets: [{ type: 'csvDashboards', source: PRODUCTION_SCHEDULE_FKOJUNST_DASHBOARD_ID }],
          schedule: FKOJUNST_CSV_IMPORT_SCHEDULE_CRON,
          enabled: true,
          replaceExisting: true,
        },
      ],
    };
    const { config, repaired } = ensureFkojunstCsvImportSchedule(input);
    expect(repaired).toBe(true);
    const row = config.csvImports?.find((s) => s.id === FKOJUNST_CSV_IMPORT_SCHEDULE_ID);
    expect(row?.replaceExisting).toBe(false);
    expect(row?.autoBackupAfterImport).toEqual({ enabled: false, targets: ['csv'] });
  });

  it('buildDefault uses stable id and cron', () => {
    const row = buildDefaultFkojunstCsvImportSchedule();
    expect(row.id).toBe(FKOJUNST_CSV_IMPORT_SCHEDULE_ID);
    expect(row.schedule).toBe('0 0 * * *');
  });

  it('ensure preserves valid custom schedule when structural fields match', () => {
    const customCron = '20 3 * * *';
    const input: BackupConfig = {
      storage: { provider: 'local', options: {} },
      targets: [],
      csvImports: [
        {
          id: FKOJUNST_CSV_IMPORT_SCHEDULE_ID,
          name: 'x',
          provider: 'gmail',
          targets: [{ type: 'csvDashboards', source: PRODUCTION_SCHEDULE_FKOJUNST_DASHBOARD_ID }],
          schedule: customCron,
          enabled: true,
          replaceExisting: false,
          autoBackupAfterImport: { enabled: false, targets: ['csv'] },
        },
      ],
    };
    const { config, repaired } = ensureFkojunstCsvImportSchedule(input);
    expect(repaired).toBe(false);
    expect(config.csvImports?.[0]?.schedule).toBe(customCron);
  });
});
