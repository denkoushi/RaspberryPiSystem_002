import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  getBackupHistory,
  getBackupHistoryById,
  restoreFromDropbox,
  restoreDryRun,
  getCsvImportSchedules,
  getRecentCsvImportHistory,
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
import { backupQueryKeys } from '../queryKeys/backup';

export function useBackupHistory(filters?: BackupHistoryFilters) {
  return useQuery({
    queryKey: backupQueryKeys.history(filters),
    queryFn: () => getBackupHistory(filters)
  });
}

export function useBackupHistoryById(id: string) {
  return useQuery({
    queryKey: backupQueryKeys.historyById(id),
    queryFn: () => getBackupHistoryById(id),
    enabled: !!id
  });
}

export function useRestoreFromDropbox() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (request: RestoreFromDropboxRequest) => restoreFromDropbox(request),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: backupQueryKeys.historyAll });
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
    queryKey: backupQueryKeys.csvImportSchedulesAll,
    queryFn: getCsvImportSchedules
  });
}

export function useRecentCsvImportHistory() {
  return useQuery({
    queryKey: backupQueryKeys.recentImportHistory,
    queryFn: () => getRecentCsvImportHistory(),
    staleTime: 60_000
  });
}

// バックアップ設定関連のフック

export function useBackupConfig() {
  return useQuery({
    queryKey: backupQueryKeys.configAll,
    queryFn: getBackupConfig
  });
}

export function useCsvImportSubjectPatterns(importType?: CsvImportSubjectPatternType, dashboardId?: string) {
  return useQuery({
    queryKey: backupQueryKeys.csvImportSubjectPatterns(importType, dashboardId),
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
      queryClient.invalidateQueries({ queryKey: backupQueryKeys.csvImportSubjectPatternsAll });
    }
  });

  const update = useMutation({
    mutationFn: (payload: {
      id: string;
      data: Partial<Pick<CsvImportSubjectPattern, 'pattern' | 'priority' | 'enabled'>>;
    }) => updateCsvImportSubjectPattern(payload.id, payload.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: backupQueryKeys.csvImportSubjectPatternsAll });
    }
  });

  const remove = useMutation({
    mutationFn: (id: string) => deleteCsvImportSubjectPattern(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: backupQueryKeys.csvImportSubjectPatternsAll });
    }
  });

  const reorder = useMutation({
    mutationFn: (payload: { importType: CsvImportSubjectPatternType; dashboardId?: string | null; orderedIds: string[] }) =>
      reorderCsvImportSubjectPatterns(payload),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: backupQueryKeys.csvImportSubjectPatterns(variables.importType, variables.dashboardId) });
      queryClient.invalidateQueries({ queryKey: backupQueryKeys.csvImportSubjectPatternsAll });
    }
  });

  return { create, update, remove, reorder };
}

export function useCsvImportConfigs() {
  return useQuery({
    queryKey: backupQueryKeys.csvImportConfigsAll,
    queryFn: getCsvImportConfigs
  });
}

export function useCsvImportConfig(importType: CsvImportConfigType) {
  return useQuery({
    queryKey: backupQueryKeys.csvImportConfig(importType),
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
      await queryClient.invalidateQueries({ queryKey: backupQueryKeys.csvImportConfig(config.importType) });
      await queryClient.invalidateQueries({ queryKey: backupQueryKeys.csvImportConfigsAll });
    }
  });

  return { upsert };
}

export function useBackupConfigHealth() {
  return useQuery({
    queryKey: backupQueryKeys.configHealthAll,
    queryFn: getBackupConfigHealth,
    refetchInterval: 60000 // 1分ごとに自動更新
  });
}

export function useBackupTargetTemplates() {
  return useQuery({
    queryKey: backupQueryKeys.targetTemplatesAll,
    queryFn: getBackupTargetTemplates
  });
}

export function useBackupConfigHistory(params?: { offset?: number; limit?: number }) {
  return useQuery({
    queryKey: backupQueryKeys.configHistory(params),
    queryFn: () => getBackupConfigHistory(params)
  });
}

export function useBackupConfigHistoryById(id?: string) {
  return useQuery({
    queryKey: backupQueryKeys.configHistoryById(id),
    queryFn: () => getBackupConfigHistoryById(id!),
    enabled: Boolean(id)
  });
}

export function useBackupConfigMutations() {
  const queryClient = useQueryClient();
  const updateConfig = useMutation({
    mutationFn: updateBackupConfig,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: backupQueryKeys.configAll });
      queryClient.invalidateQueries({ queryKey: backupQueryKeys.configHealthAll });
    }
  });
  const addTarget = useMutation({
    mutationFn: addBackupTarget,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: backupQueryKeys.configAll });
      queryClient.invalidateQueries({ queryKey: backupQueryKeys.configHealthAll });
    }
  });
  const updateTarget = useMutation({
    mutationFn: ({ index, target }: { index: number; target: Partial<BackupTarget> }) =>
      updateBackupTarget(index, target),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: backupQueryKeys.configAll });
      queryClient.invalidateQueries({ queryKey: backupQueryKeys.configHealthAll });
    }
  });
  const deleteTarget = useMutation({
    mutationFn: (index: number) => deleteBackupTarget(index),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: backupQueryKeys.configAll });
      queryClient.invalidateQueries({ queryKey: backupQueryKeys.configHealthAll });
    }
  });
  const runBackupMutation = useMutation({
    mutationFn: (request: RunBackupRequest) => runBackup(request),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: backupQueryKeys.historyAll });
      queryClient.invalidateQueries({ queryKey: backupQueryKeys.configAll });
    }
  });
  const addFromTemplate = useMutation({
    mutationFn: (params: Parameters<typeof addBackupTargetFromTemplate>[0]) => addBackupTargetFromTemplate(params),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: backupQueryKeys.configAll });
      queryClient.invalidateQueries({ queryKey: backupQueryKeys.configHealthAll });
      queryClient.invalidateQueries({ queryKey: backupQueryKeys.targetTemplatesAll });
    }
  });
  return { updateConfig, addTarget, addFromTemplate, updateTarget, deleteTarget, runBackup: runBackupMutation };
}

export function useCsvImportScheduleMutations() {
  const queryClient = useQueryClient();
  const create = useMutation({
    mutationFn: (schedule: Parameters<typeof createCsvImportSchedule>[0]) => createCsvImportSchedule(schedule),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: backupQueryKeys.csvImportSchedulesAll })
  });
  const update = useMutation({
    mutationFn: ({ id, schedule }: { id: string; schedule: Parameters<typeof updateCsvImportSchedule>[1] }) =>
      updateCsvImportSchedule(id, schedule),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: backupQueryKeys.csvImportSchedulesAll })
  });
  const remove = useMutation({
    mutationFn: (id: string) => deleteCsvImportSchedule(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: backupQueryKeys.csvImportSchedulesAll })
  });
  const run = useMutation({
    mutationFn: (id: string) => runCsvImportSchedule(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: backupQueryKeys.csvImportSchedulesAll });
      queryClient.invalidateQueries({ queryKey: backupQueryKeys.importHistoryAll });
      queryClient.invalidateQueries({ queryKey: backupQueryKeys.historyAll });
    }
  });
  return { create, update, remove, run };
}

// Gmail設定関連のフック

export function useGmailConfig() {
  return useQuery({
    queryKey: backupQueryKeys.gmailConfigAll,
    queryFn: getGmailConfig
  });
}

export function useGmailConfigMutations() {
  const queryClient = useQueryClient();
  const update = useMutation({
    mutationFn: (config: GmailConfigUpdateRequest) => updateGmailConfig(config),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: backupQueryKeys.gmailConfigAll })
  });
  const remove = useMutation({
    mutationFn: () => deleteGmailConfig(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: backupQueryKeys.gmailConfigAll })
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
    onSuccess: () => queryClient.invalidateQueries({ queryKey: backupQueryKeys.gmailConfigAll })
  });
  return { update, remove, authorize, refresh };
}
