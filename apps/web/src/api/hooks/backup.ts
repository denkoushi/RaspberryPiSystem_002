import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  getBackupHistory,
  getBackupHistoryById,
  restoreFromDropbox,
  restoreDryRun,
  getCsvImportSchedules,
  createCsvImportSchedule,
  updateCsvImportSchedule,
  deleteCsvImportSchedule,
  runCsvImportSchedule,
  getBackupConfig,
  updateBackupConfig,
  addBackupTarget,
  updateBackupTarget,
  deleteBackupTarget,
  runBackup,
  getBackupConfigHealth,
  getBackupConfigHistory,
  getBackupConfigHistoryById,
  getBackupTargetTemplates,
  addBackupTargetFromTemplate,
  getCsvImportSubjectPatterns,
  createCsvImportSubjectPattern,
  updateCsvImportSubjectPattern,
  deleteCsvImportSubjectPattern,
  reorderCsvImportSubjectPatterns,
  getCsvImportConfigs,
  getCsvImportConfig,
  upsertCsvImportConfig,
  getGmailConfig,
  updateGmailConfig,
  deleteGmailConfig,
  getGmailOAuthAuthorizeUrl,
  refreshGmailToken,
  type BackupHistoryFilters,
  type RestoreFromDropboxRequest,
  type BackupTarget,
  type RunBackupRequest,
  type GmailConfigUpdateRequest,
  type CsvImportSubjectPatternType,
  type CsvImportSubjectPattern,
  type CsvImportConfigType,
  type CsvImportColumnDefinition,
  type CsvImportStrategy
} from '../backup';

export function useBackupHistory(filters?: BackupHistoryFilters) {
  return useQuery({
    queryKey: ['backup-history', filters],
    queryFn: () => getBackupHistory(filters)
  });
}

export function useBackupHistoryById(id: string) {
  return useQuery({
    queryKey: ['backup-history', id],
    queryFn: () => getBackupHistoryById(id),
    enabled: !!id
  });
}

export function useRestoreFromDropbox() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (request: RestoreFromDropboxRequest) => restoreFromDropbox(request),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['backup-history'] });
    }
  });
}

export function useRestoreDryRun() {
  return useMutation({
    mutationFn: (request: Parameters<typeof restoreDryRun>[0]) => restoreDryRun(request)
  });
}

// CSVインポートスケジュールフック

export function useCsvImportSchedules() {
  return useQuery({
    queryKey: ['csv-import-schedules'],
    queryFn: getCsvImportSchedules
  });
}

// バックアップ設定関連のフック

export function useBackupConfig() {
  return useQuery({
    queryKey: ['backup-config'],
    queryFn: getBackupConfig
  });
}

export function useCsvImportSubjectPatterns(importType?: CsvImportSubjectPatternType, dashboardId?: string) {
  return useQuery({
    queryKey: ['csv-import-subject-patterns', importType, dashboardId],
    queryFn: () => getCsvImportSubjectPatterns(importType, dashboardId)
  });
}

export function useCsvImportSubjectPatternMutations() {
  const queryClient = useQueryClient();
  const create = useMutation({
    mutationFn: (payload: {
      importType: CsvImportSubjectPatternType;
      dashboardId?: string | null;
      pattern: string;
      priority?: number;
      enabled?: boolean;
    }) => createCsvImportSubjectPattern(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['csv-import-subject-patterns'] });
    }
  });

  const update = useMutation({
    mutationFn: (payload: {
      id: string;
      data: Partial<Pick<CsvImportSubjectPattern, 'pattern' | 'priority' | 'enabled'>>;
    }) => updateCsvImportSubjectPattern(payload.id, payload.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['csv-import-subject-patterns'] });
    }
  });

  const remove = useMutation({
    mutationFn: (id: string) => deleteCsvImportSubjectPattern(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['csv-import-subject-patterns'] });
    }
  });

  const reorder = useMutation({
    mutationFn: (payload: { importType: CsvImportSubjectPatternType; dashboardId?: string | null; orderedIds: string[] }) =>
      reorderCsvImportSubjectPatterns(payload),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['csv-import-subject-patterns', variables.importType, variables.dashboardId] });
      queryClient.invalidateQueries({ queryKey: ['csv-import-subject-patterns'] });
    }
  });

  return { create, update, remove, reorder };
}

export function useCsvImportConfigs() {
  return useQuery({
    queryKey: ['csv-import-configs'],
    queryFn: getCsvImportConfigs
  });
}

export function useCsvImportConfig(importType: CsvImportConfigType) {
  return useQuery({
    queryKey: ['csv-import-config', importType],
    queryFn: () => getCsvImportConfig(importType),
  });
}

export function useCsvImportConfigMutations() {
  const queryClient = useQueryClient();
  const upsert = useMutation({
    mutationFn: ({
      importType,
      payload
    }: {
      importType: CsvImportConfigType;
      payload: {
        enabled: boolean;
        allowedManualImport: boolean;
        allowedScheduledImport: boolean;
        importStrategy: CsvImportStrategy;
        columnDefinitions: CsvImportColumnDefinition[];
      };
    }) => upsertCsvImportConfig(importType, payload),
    onSuccess: async (config) => {
      await queryClient.invalidateQueries({ queryKey: ['csv-import-config', config.importType] });
      await queryClient.invalidateQueries({ queryKey: ['csv-import-configs'] });
    }
  });

  return { upsert };
}

export function useBackupConfigHealth() {
  return useQuery({
    queryKey: ['backup-config-health'],
    queryFn: getBackupConfigHealth,
    refetchInterval: 60000 // 1分ごとに自動更新
  });
}

export function useBackupTargetTemplates() {
  return useQuery({
    queryKey: ['backup-target-templates'],
    queryFn: getBackupTargetTemplates
  });
}

export function useBackupConfigHistory(params?: { offset?: number; limit?: number }) {
  return useQuery({
    queryKey: ['backup-config-history', params],
    queryFn: () => getBackupConfigHistory(params)
  });
}

export function useBackupConfigHistoryById(id?: string) {
  return useQuery({
    queryKey: ['backup-config-history', id],
    queryFn: () => getBackupConfigHistoryById(id!),
    enabled: Boolean(id)
  });
}

export function useBackupConfigMutations() {
  const queryClient = useQueryClient();
  const updateConfig = useMutation({
    mutationFn: updateBackupConfig,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['backup-config'] });
      queryClient.invalidateQueries({ queryKey: ['backup-config-health'] });
    }
  });
  const addTarget = useMutation({
    mutationFn: addBackupTarget,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['backup-config'] });
      queryClient.invalidateQueries({ queryKey: ['backup-config-health'] });
    }
  });
  const updateTarget = useMutation({
    mutationFn: ({ index, target }: { index: number; target: Partial<BackupTarget> }) =>
      updateBackupTarget(index, target),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['backup-config'] });
      queryClient.invalidateQueries({ queryKey: ['backup-config-health'] });
    }
  });
  const deleteTarget = useMutation({
    mutationFn: (index: number) => deleteBackupTarget(index),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['backup-config'] });
      queryClient.invalidateQueries({ queryKey: ['backup-config-health'] });
    }
  });
  const runBackupMutation = useMutation({
    mutationFn: (request: RunBackupRequest) => runBackup(request),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['backup-history'] });
      queryClient.invalidateQueries({ queryKey: ['backup-config'] });
    }
  });
  const addFromTemplate = useMutation({
    mutationFn: (params: Parameters<typeof addBackupTargetFromTemplate>[0]) => addBackupTargetFromTemplate(params),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['backup-config'] });
      queryClient.invalidateQueries({ queryKey: ['backup-config-health'] });
      queryClient.invalidateQueries({ queryKey: ['backup-target-templates'] });
    }
  });
  return { updateConfig, addTarget, addFromTemplate, updateTarget, deleteTarget, runBackup: runBackupMutation };
}

export function useCsvImportScheduleMutations() {
  const queryClient = useQueryClient();
  const create = useMutation({
    mutationFn: (schedule: Parameters<typeof createCsvImportSchedule>[0]) => createCsvImportSchedule(schedule),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['csv-import-schedules'] })
  });
  const update = useMutation({
    mutationFn: ({ id, schedule }: { id: string; schedule: Parameters<typeof updateCsvImportSchedule>[1] }) =>
      updateCsvImportSchedule(id, schedule),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['csv-import-schedules'] })
  });
  const remove = useMutation({
    mutationFn: (id: string) => deleteCsvImportSchedule(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['csv-import-schedules'] })
  });
  const run = useMutation({
    mutationFn: (id: string) => runCsvImportSchedule(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['csv-import-schedules'] });
      queryClient.invalidateQueries({ queryKey: ['import-history'] });
      queryClient.invalidateQueries({ queryKey: ['backup-history'] });
    }
  });
  return { create, update, remove, run };
}

// Gmail設定関連のフック

export function useGmailConfig() {
  return useQuery({
    queryKey: ['gmail-config'],
    queryFn: getGmailConfig
  });
}

export function useGmailConfigMutations() {
  const queryClient = useQueryClient();
  const update = useMutation({
    mutationFn: (config: GmailConfigUpdateRequest) => updateGmailConfig(config),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['gmail-config'] })
  });
  const remove = useMutation({
    mutationFn: () => deleteGmailConfig(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['gmail-config'] })
  });
  const authorize = useMutation({
    mutationFn: () => getGmailOAuthAuthorizeUrl(),
    onSuccess: (data) => {
      // 認証URLを新しいウィンドウで開く
      window.open(data.authorizationUrl, '_blank', 'width=600,height=700');
    }
  });
  const refresh = useMutation({
    mutationFn: () => refreshGmailToken(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['gmail-config'] })
  });
  return { update, remove, authorize, refresh };
}
