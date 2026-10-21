import { describe, expect, it } from 'vitest';

import { backupQueryKeys } from './backup';

describe('backupQueryKeys', () => {
  it('preserves fixed keys and invalidation prefixes', () => {
    expect(backupQueryKeys.historyAll).toEqual(['backup-history']);
    expect(backupQueryKeys.csvImportSchedulesAll).toEqual(['csv-import-schedules']);
    expect(backupQueryKeys.importHistoryAll).toEqual(['import-history']);
    expect(backupQueryKeys.recentImportHistory).toEqual(['import-history', 'recent']);
    expect(backupQueryKeys.configAll).toEqual(['backup-config']);
    expect(backupQueryKeys.csvImportSubjectPatternsAll).toEqual(['csv-import-subject-patterns']);
    expect(backupQueryKeys.csvImportConfigsAll).toEqual(['csv-import-configs']);
    expect(backupQueryKeys.configHealthAll).toEqual(['backup-config-health']);
    expect(backupQueryKeys.targetTemplatesAll).toEqual(['backup-target-templates']);
    expect(backupQueryKeys.gmailConfigAll).toEqual(['gmail-config']);
  });

  it('preserves history filters including omitted and empty filters', () => {
    const filters = { targetKind: 'database', startDate: '2026-10-01', endDate: '2026-10-19', offset: 0, limit: 20 };
    expect(backupQueryKeys.history(filters)).toEqual(['backup-history', filters]);
    expect(backupQueryKeys.history({})).toEqual(['backup-history', {}]);
    expect(backupQueryKeys.history(undefined)).toEqual(['backup-history', undefined]);
    expect(backupQueryKeys.history()).toEqual(['backup-history', undefined]);
    expect(backupQueryKeys.history({ targetKind: '' })).toEqual(['backup-history', { targetKind: '' }]);
  });

  it('preserves history IDs including empty strings', () => {
    expect(backupQueryKeys.historyById('backup-1')).toEqual(['backup-history', 'backup-1']);
    expect(backupQueryKeys.historyById('')).toEqual(['backup-history', '']);
  });

  it('preserves subject pattern argument order and optional values', () => {
    expect(backupQueryKeys.csvImportSubjectPatterns('csvDashboards', 'dashboard-1')).toEqual(
      ['csv-import-subject-patterns', 'csvDashboards', 'dashboard-1']
    );
    expect(backupQueryKeys.csvImportSubjectPatterns()).toEqual(['csv-import-subject-patterns', undefined, undefined]);
    expect(backupQueryKeys.csvImportSubjectPatterns(undefined, undefined)).toEqual(
      ['csv-import-subject-patterns', undefined, undefined]
    );
    expect(backupQueryKeys.csvImportSubjectPatterns('employees')).toEqual(['csv-import-subject-patterns', 'employees', undefined]);
    expect(backupQueryKeys.csvImportSubjectPatterns(undefined, 'dashboard-1')).toEqual(
      ['csv-import-subject-patterns', undefined, 'dashboard-1']
    );
    expect(backupQueryKeys.csvImportSubjectPatterns('csvDashboards', '')).toEqual(['csv-import-subject-patterns', 'csvDashboards', '']);
    expect(backupQueryKeys.csvImportSubjectPatterns('employees', null)).toEqual(['csv-import-subject-patterns', 'employees', null]);
  });

  it('preserves singular CSV import config keys', () => {
    expect(backupQueryKeys.csvImportConfig('employees')).toEqual(['csv-import-config', 'employees']);
    expect(backupQueryKeys.csvImportConfig('items')).toEqual(['csv-import-config', 'items']);
    expect(backupQueryKeys.csvImportConfig('measuringInstruments')).toEqual(['csv-import-config', 'measuringInstruments']);
    expect(backupQueryKeys.csvImportConfig('riggingGears')).toEqual(['csv-import-config', 'riggingGears']);
    expect(backupQueryKeys.csvImportConfig('machines')).toEqual(['csv-import-config', 'machines']);
  });

  it('preserves config history parameters including omitted and empty parameters', () => {
    const params = { offset: 0, limit: 20 };
    expect(backupQueryKeys.configHistory(params)).toEqual(['backup-config-history', params]);
    expect(backupQueryKeys.configHistory({})).toEqual(['backup-config-history', {}]);
    expect(backupQueryKeys.configHistory(undefined)).toEqual(['backup-config-history', undefined]);
    expect(backupQueryKeys.configHistory()).toEqual(['backup-config-history', undefined]);
  });

  it('preserves config history IDs including omitted and empty IDs', () => {
    expect(backupQueryKeys.configHistoryById('config-1')).toEqual(['backup-config-history', 'config-1']);
    expect(backupQueryKeys.configHistoryById('')).toEqual(['backup-config-history', '']);
    expect(backupQueryKeys.configHistoryById(undefined)).toEqual(['backup-config-history', undefined]);
    expect(backupQueryKeys.configHistoryById()).toEqual(['backup-config-history', undefined]);
  });
});
