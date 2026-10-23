import type { BackupHistoryFilters, CsvImportConfigType, CsvImportSubjectPatternType } from '../backup';

export const backupQueryKeys = {
  historyAll: ['backup-history'] as const,
  history: (filters?: BackupHistoryFilters) => ['backup-history', filters] as const,
  historyById: (id: string) => ['backup-history', id] as const,
  csvImportSchedulesAll: ['csv-import-schedules'] as const,
  importHistoryAll: ['import-history'] as const,
  recentImportHistory: ['import-history', 'recent'] as const,
  configAll: ['backup-config'] as const,
  csvImportSubjectPatternsAll: ['csv-import-subject-patterns'] as const,
  csvImportSubjectPatterns: (importType?: CsvImportSubjectPatternType, dashboardId?: string | null) =>
    ['csv-import-subject-patterns', importType, dashboardId] as const,
  csvImportConfigsAll: ['csv-import-configs'] as const,
  csvImportConfig: (importType: CsvImportConfigType) => ['csv-import-config', importType] as const,
  configHealthAll: ['backup-config-health'] as const,
  targetTemplatesAll: ['backup-target-templates'] as const,
  configHistory: (params?: { offset?: number; limit?: number }) => ['backup-config-history', params] as const,
  configHistoryById: (id?: string) => ['backup-config-history', id] as const,
  gmailConfigAll: ['gmail-config'] as const,
};
