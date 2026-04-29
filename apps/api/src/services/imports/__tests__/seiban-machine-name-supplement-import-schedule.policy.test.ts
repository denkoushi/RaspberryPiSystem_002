import { describe, expect, it } from 'vitest';
import type { BackupConfig } from '../../backup/backup-config.js';
import {
  buildDefaultSeibanMachineNameSupplementCsvImportSchedule,
  ensureSeibanMachineNameSupplementCsvImportSchedule,
  SEIBAN_MACHINE_NAME_SUPPLEMENT_CSV_IMPORT_SCHEDULE_CRON,
  SEIBAN_MACHINE_NAME_SUPPLEMENT_CSV_IMPORT_SCHEDULE_ID,
} from '../seiban-machine-name-supplement-import-schedule.policy.js';
import { PRODUCTION_SCHEDULE_SEIBAN_MACHINE_NAME_SUPPLEMENT_DASHBOARD_ID } from '../../production-schedule/constants.js';

describe('seiban-machine-name-supplement-import-schedule.policy', () => {
  it('ensure adds default schedule when missing', () => {
    const input: BackupConfig = { storage: { provider: 'local', options: {} }, targets: [], csvImports: [] };
    const { config, repaired } = ensureSeibanMachineNameSupplementCsvImportSchedule(input);
    expect(repaired).toBe(true);
    const row = config.csvImports?.find((s) => s.id === SEIBAN_MACHINE_NAME_SUPPLEMENT_CSV_IMPORT_SCHEDULE_ID);
    expect(row).toBeDefined();
    expect(row?.provider).toBe('gmail');
    expect(row?.schedule).toBe(SEIBAN_MACHINE_NAME_SUPPLEMENT_CSV_IMPORT_SCHEDULE_CRON);
    expect(row?.enabled).toBe(false);
    expect(row?.targets).toEqual([
      { type: 'csvDashboards', source: PRODUCTION_SCHEDULE_SEIBAN_MACHINE_NAME_SUPPLEMENT_DASHBOARD_ID },
    ]);
  });

  it('ensure repairs wrong provider or targets', () => {
    const input: BackupConfig = {
      storage: { provider: 'local', options: {} },
      targets: [],
      csvImports: [
        {
          id: SEIBAN_MACHINE_NAME_SUPPLEMENT_CSV_IMPORT_SCHEDULE_ID,
          name: 'x',
          provider: 'dropbox',
          targets: [{ type: 'csvDashboards', source: 'wrong-uuid' }],
          schedule: SEIBAN_MACHINE_NAME_SUPPLEMENT_CSV_IMPORT_SCHEDULE_CRON,
          enabled: true,
          replaceExisting: false,
          autoBackupAfterImport: { enabled: false, targets: ['csv'] },
        },
      ],
    };
    const { config, repaired } = ensureSeibanMachineNameSupplementCsvImportSchedule(input);
    expect(repaired).toBe(true);
    const row = config.csvImports?.find((s) => s.id === SEIBAN_MACHINE_NAME_SUPPLEMENT_CSV_IMPORT_SCHEDULE_ID);
    expect(row?.provider).toBe('gmail');
    expect(row?.targets).toEqual([
      { type: 'csvDashboards', source: PRODUCTION_SCHEDULE_SEIBAN_MACHINE_NAME_SUPPLEMENT_DASHBOARD_ID },
    ]);
  });

  it('ensure repairs replaceExisting and missing auto backup defaults', () => {
    const input: BackupConfig = {
      storage: { provider: 'local', options: {} },
      targets: [],
      csvImports: [
        {
          id: SEIBAN_MACHINE_NAME_SUPPLEMENT_CSV_IMPORT_SCHEDULE_ID,
          name: 'x',
          provider: 'gmail',
          targets: [{ type: 'csvDashboards', source: PRODUCTION_SCHEDULE_SEIBAN_MACHINE_NAME_SUPPLEMENT_DASHBOARD_ID }],
          schedule: SEIBAN_MACHINE_NAME_SUPPLEMENT_CSV_IMPORT_SCHEDULE_CRON,
          enabled: true,
          replaceExisting: true,
        },
      ],
    };
    const { config, repaired } = ensureSeibanMachineNameSupplementCsvImportSchedule(input);
    expect(repaired).toBe(true);
    const row = config.csvImports?.find((s) => s.id === SEIBAN_MACHINE_NAME_SUPPLEMENT_CSV_IMPORT_SCHEDULE_ID);
    expect(row?.replaceExisting).toBe(false);
    expect(row?.autoBackupAfterImport).toEqual({ enabled: false, targets: ['csv'] });
  });

  it('buildDefault uses stable id and cron', () => {
    const row = buildDefaultSeibanMachineNameSupplementCsvImportSchedule();
    expect(row.id).toBe(SEIBAN_MACHINE_NAME_SUPPLEMENT_CSV_IMPORT_SCHEDULE_ID);
    expect(row.schedule).toBe(SEIBAN_MACHINE_NAME_SUPPLEMENT_CSV_IMPORT_SCHEDULE_CRON);
  });

  it('ensure preserves valid custom schedule when structural fields match', () => {
    const customCron = '10 5 * * 1';
    const input: BackupConfig = {
      storage: { provider: 'local', options: {} },
      targets: [],
      csvImports: [
        {
          id: SEIBAN_MACHINE_NAME_SUPPLEMENT_CSV_IMPORT_SCHEDULE_ID,
          name: 'x',
          provider: 'gmail',
          targets: [{ type: 'csvDashboards', source: PRODUCTION_SCHEDULE_SEIBAN_MACHINE_NAME_SUPPLEMENT_DASHBOARD_ID }],
          schedule: customCron,
          enabled: false,
          replaceExisting: false,
          autoBackupAfterImport: { enabled: false, targets: ['csv'] },
        },
      ],
    };
    const { config, repaired } = ensureSeibanMachineNameSupplementCsvImportSchedule(input);
    expect(repaired).toBe(false);
    expect(config.csvImports?.[0]?.schedule).toBe(customCron);
  });
});
