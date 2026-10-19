import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { purgeLeaderboardBoardCacheForScheduleRow } from '../../features/kiosk/leaderOrderBoard/cache/purgeLeaderboardBoardCacheForScheduleRow';
import { patchSelfInspectionSessionCachesAfterEntrySave } from '../../features/part-measurement/mergeSelfInspectionSessionAfterEntrySave';
import {
  isSelfInspectionSessionSeedPending,
  resolveSelfInspectionSessionPlaceholderData,
  resolveSelfInspectionUnsavedEntryInitialData
} from '../../features/part-measurement/selfInspectionSessionPlaceholder';
import {
  resolveOrCreateSelfInspectionSession,
  listSelfInspectionSessions,
  listSelfInspectionOutOfToleranceReviews,
  listSelfInspectionRecordApprovals,
  getSelfInspectionRecordApprovalSession,
  getSelfInspectionSession,
  getSelfInspectionInspectorMeasurementSession,
  createSelfInspectionEntry,
  updateSelfInspectionEntry,
  upsertSelfInspectionDraftEntry,
  createSelfInspectionInspectorEntry,
  updateSelfInspectionInspectorEntry,
  saveSelfInspectionInspectorJudgements,
  completeSelfInspectionSession,
  approveSelfInspectionOutOfToleranceReview,
  approveSelfInspectionRecordApproval,
  getSelfInspectionRegistrationPolicy,
  updateSelfInspectionRegistrationPolicy,
  resolveSelfInspectionRecordApprovalApprover,
  authenticateSelfInspectionMeasurementActor,
  verifyKioskSelfInspectionRecordApprovalAccessPassword,
  resetSelfInspectionSession,
  invalidateSelfInspectionItem,
  listSelfInspectionInvalidations,
  getSelfInspectionInvalidation
} from '../client';
import { productionScheduleQueryKeys } from '../queryKeys/productionSchedule';
import { selfInspectionQueryKeys } from '../queryKeys/selfInspection';

import type { SelfInspectionSessionDetailDto, SelfInspectionStatus } from '../../features/part-measurement/types';

export function useSelfInspectionSessions(
  params?: {
    productNo?: string;
    resourceCd?: string;
    processGroup?: 'cutting' | 'grinding';
    status?: SelfInspectionStatus;
  },
  options?: { enabled?: boolean; pauseRefetch?: boolean; refetchIntervalMs?: number | false }
) {
  const interval =
    options?.pauseRefetch ? false : (options?.refetchIntervalMs !== undefined ? options.refetchIntervalMs : 30000);
  return useQuery({
    queryKey: selfInspectionQueryKeys.sessions(params),
    queryFn: () => listSelfInspectionSessions(params),
    placeholderData: (previousData) => previousData,
    refetchInterval: interval,
    enabled: options?.enabled ?? true
  });
}

export function useSelfInspectionInvalidations(
  params?: Parameters<typeof listSelfInspectionInvalidations>[0],
  options?: { enabled?: boolean; refetchIntervalMs?: number | false }
) {
  return useQuery({
    queryKey: selfInspectionQueryKeys.invalidations(params),
    queryFn: () => listSelfInspectionInvalidations(params),
    refetchInterval: options?.refetchIntervalMs ?? 30000,
    enabled: options?.enabled ?? true
  });
}

export function useSelfInspectionInvalidation(
  id: string | null | undefined,
  options?: { enabled?: boolean }
) {
  return useQuery({
    queryKey: selfInspectionQueryKeys.invalidation(id),
    queryFn: () => getSelfInspectionInvalidation(id!),
    enabled: Boolean(id) && (options?.enabled ?? true)
  });
}

export function useInvalidateSelfInspectionItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: Parameters<typeof invalidateSelfInspectionItem>[0]) =>
      invalidateSelfInspectionItem(payload),
    onSuccess: async (invalidation) => {
      void queryClient.invalidateQueries({ queryKey: selfInspectionQueryKeys.sessionsAll });
      void queryClient.invalidateQueries({ queryKey: selfInspectionQueryKeys.sessionAll });
      void queryClient.invalidateQueries({ queryKey: selfInspectionQueryKeys.inspectorSessionAll });
      void queryClient.invalidateQueries({ queryKey: selfInspectionQueryKeys.recordApprovalsAll });
      void queryClient.invalidateQueries({ queryKey: selfInspectionQueryKeys.recordApprovalSessionAll });
      void queryClient.invalidateQueries({ queryKey: selfInspectionQueryKeys.invalidationsAll });
      void queryClient.invalidateQueries({ queryKey: selfInspectionQueryKeys.invalidationAll });
      void queryClient.invalidateQueries({ queryKey: selfInspectionQueryKeys.outOfToleranceReviewsAll });
      // 永続snapshotを先に破棄し、直後の再取得が削除前キャッシュをhydrateしないようにする。
      await purgeLeaderboardBoardCacheForScheduleRow(invalidation.scheduleRowId);
      void queryClient.invalidateQueries({ queryKey: productionScheduleQueryKeys.scheduleAll });
    }
  });
}

export function useSelfInspectionOutOfToleranceReviews(options?: { enabled?: boolean; refetchIntervalMs?: number | false }) {
  return useQuery({
    queryKey: selfInspectionQueryKeys.outOfToleranceReviewsAll,
    queryFn: () => listSelfInspectionOutOfToleranceReviews(),
    refetchInterval: options?.refetchIntervalMs ?? 30000,
    enabled: options?.enabled ?? true
  });
}

export function useSelfInspectionRegistrationPolicy(options?: {
  enabled?: boolean;
  refetchIntervalMs?: number | false;
}) {
  return useQuery({
    queryKey: selfInspectionQueryKeys.registrationPolicyAll,
    queryFn: () => getSelfInspectionRegistrationPolicy(),
    refetchInterval: options?.refetchIntervalMs ?? 30000,
    enabled: options?.enabled ?? true
  });
}

export function useUpdateSelfInspectionRegistrationPolicy() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: Parameters<typeof updateSelfInspectionRegistrationPolicy>[0]) =>
      updateSelfInspectionRegistrationPolicy(payload),
    onSuccess: (policy) => {
      queryClient.setQueryData(selfInspectionQueryKeys.registrationPolicyAll, policy);
      void queryClient.invalidateQueries({ queryKey: selfInspectionQueryKeys.registrationPolicyAll });
      void queryClient.invalidateQueries({ queryKey: selfInspectionQueryKeys.recordApprovalsAll });
      void queryClient.invalidateQueries({ queryKey: selfInspectionQueryKeys.recordApprovalSessionAll });
      void queryClient.invalidateQueries({ queryKey: selfInspectionQueryKeys.sessionAll });
      void queryClient.invalidateQueries({ queryKey: selfInspectionQueryKeys.sessionsAll });
      void queryClient.invalidateQueries({ queryKey: productionScheduleQueryKeys.leaderboardDecorationsAll });
      void queryClient.invalidateQueries({ queryKey: productionScheduleQueryKeys.scheduleAll });
    }
  });
}

export function useSelfInspectionRecordApprovals(
  params?: Parameters<typeof listSelfInspectionRecordApprovals>[0],
  options?: { enabled?: boolean; refetchIntervalMs?: number | false }
) {
  return useQuery({
    queryKey: selfInspectionQueryKeys.recordApprovals(params),
    queryFn: () => listSelfInspectionRecordApprovals(params),
    refetchInterval: options?.refetchIntervalMs ?? 30000,
    enabled: options?.enabled ?? true
  });
}

export function useSelfInspectionRecordApprovalSession(
  sessionId: string | null | undefined,
  options?: { enabled?: boolean; refetchIntervalMs?: number | false }
) {
  return useQuery({
    queryKey: selfInspectionQueryKeys.recordApprovalSession(sessionId),
    queryFn: () => getSelfInspectionRecordApprovalSession(sessionId!),
    refetchInterval: options?.refetchIntervalMs ?? false,
    enabled: Boolean(sessionId) && (options?.enabled ?? true)
  });
}

export function useSelfInspectionSession(
  sessionId?: string | null,
  options?: { enabled?: boolean; entryIndex?: number }
) {
  const queryClient = useQueryClient();
  const entryIndex = options?.entryIndex;
  const resolveUnsavedEntryInitial = () =>
    resolveSelfInspectionUnsavedEntryInitialData(
      queryClient
        .getQueryCache()
        .findAll({ queryKey: selfInspectionQueryKeys.sessionEntriesAll(sessionId) })
        .map((query) => ({
          data: query.state.data as SelfInspectionSessionDetailDto | undefined,
          updatedAt: query.state.dataUpdatedAt
        })),
      sessionId,
      entryIndex
    );
  const queryKey = selfInspectionQueryKeys.session(sessionId!, entryIndex);
  const query = useQuery({
    queryKey,
    queryFn: () => getSelfInspectionSession(sessionId!, { entryIndex }),
    initialData: () => resolveUnsavedEntryInitial()?.data,
    // 元キャッシュの取得時刻を引き継ぎ、staleとしてマウント時に裏で再取得させる。
    initialDataUpdatedAt: () => resolveUnsavedEntryInitial()?.updatedAt,
    placeholderData: (previousData) => resolveSelfInspectionSessionPlaceholderData(previousData, sessionId),
    enabled: (options?.enabled ?? true) && Boolean(sessionId)
  });
  const isSeedPending =
    !query.isPlaceholderData && isSelfInspectionSessionSeedPending(queryClient.getQueryState(queryKey));
  return { ...query, isSeedPending };
}

export function useSelfInspectionInspectorMeasurementSession(
  sessionId?: string | null,
  options?: { enabled?: boolean; entryIndex?: number }
) {
  const entryIndex = options?.entryIndex;
  return useQuery({
    queryKey: selfInspectionQueryKeys.inspectorSession(sessionId!, entryIndex),
    queryFn: () => getSelfInspectionInspectorMeasurementSession(sessionId!, { entryIndex }),
    placeholderData: (previousData) => resolveSelfInspectionSessionPlaceholderData(previousData, sessionId),
    enabled: (options?.enabled ?? true) && Boolean(sessionId)
  });
}

export function useResolveSelfInspectionSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: Parameters<typeof resolveOrCreateSelfInspectionSession>[0]) => resolveOrCreateSelfInspectionSession(body),
    onSuccess: (session) => {
      void queryClient.invalidateQueries({ queryKey: selfInspectionQueryKeys.sessionsAll });
      void queryClient.invalidateQueries({ queryKey: selfInspectionQueryKeys.sessionEntriesAll(session.id) });
    }
  });
}

export function useAuthenticateSelfInspectionMeasurementActor() {
  return useMutation({
    mutationFn: ({
      sessionId,
      body
    }: {
      sessionId: string;
      body: Parameters<typeof authenticateSelfInspectionMeasurementActor>[1];
    }) => authenticateSelfInspectionMeasurementActor(sessionId, body)
  });
}

export function useCreateSelfInspectionEntry() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ sessionId, body }: { sessionId: string; body: Parameters<typeof createSelfInspectionEntry>[1] }) =>
      createSelfInspectionEntry(sessionId, body),
    onSuccess: (entry, variables) => {
      patchSelfInspectionSessionCachesAfterEntrySave(queryClient, variables.sessionId, entry);
      void queryClient.invalidateQueries({ queryKey: selfInspectionQueryKeys.inspectorSessionEntriesAll(variables.sessionId) });
      void queryClient.invalidateQueries({ queryKey: selfInspectionQueryKeys.sessionsAll });
    }
  });
}

export function useUpsertSelfInspectionDraftEntry() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      sessionId,
      body
    }: {
      sessionId: string;
      body: Parameters<typeof upsertSelfInspectionDraftEntry>[1];
    }) => upsertSelfInspectionDraftEntry(sessionId, body),
    onSuccess: (entry, variables) => {
      patchSelfInspectionSessionCachesAfterEntrySave(queryClient, variables.sessionId, entry);
      void queryClient.invalidateQueries({ queryKey: selfInspectionQueryKeys.inspectorSessionEntriesAll(variables.sessionId) });
    }
  });
}

export function useUpdateSelfInspectionEntry() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      sessionId,
      entryId,
      body
    }: {
      sessionId: string;
      entryId: string;
      body: Parameters<typeof updateSelfInspectionEntry>[2];
    }) => updateSelfInspectionEntry(sessionId, entryId, body),
    onSuccess: (entry, variables) => {
      patchSelfInspectionSessionCachesAfterEntrySave(queryClient, variables.sessionId, entry);
      void queryClient.invalidateQueries({ queryKey: selfInspectionQueryKeys.inspectorSessionEntriesAll(variables.sessionId) });
      void queryClient.invalidateQueries({ queryKey: selfInspectionQueryKeys.sessionsAll });
    }
  });
}

export function useCreateSelfInspectionInspectorEntry() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      sessionId,
      body
    }: {
      sessionId: string;
      body: Parameters<typeof createSelfInspectionInspectorEntry>[1];
    }) => createSelfInspectionInspectorEntry(sessionId, body),
    onSuccess: (_entry, variables) => {
      void queryClient.invalidateQueries({ queryKey: selfInspectionQueryKeys.inspectorSessionEntriesAll(variables.sessionId) });
      void queryClient.invalidateQueries({ queryKey: selfInspectionQueryKeys.recordApprovalsAll });
      void queryClient.invalidateQueries({ queryKey: selfInspectionQueryKeys.recordApprovalSession(variables.sessionId) });
      void queryClient.invalidateQueries({ queryKey: selfInspectionQueryKeys.sessionsAll });
    }
  });
}

export function useUpdateSelfInspectionInspectorEntry() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      sessionId,
      entryId,
      body
    }: {
      sessionId: string;
      entryId: string;
      body: Parameters<typeof updateSelfInspectionInspectorEntry>[2];
    }) => updateSelfInspectionInspectorEntry(sessionId, entryId, body),
    onSuccess: (_entry, variables) => {
      void queryClient.invalidateQueries({ queryKey: selfInspectionQueryKeys.inspectorSessionEntriesAll(variables.sessionId) });
      void queryClient.invalidateQueries({ queryKey: selfInspectionQueryKeys.recordApprovalsAll });
      void queryClient.invalidateQueries({ queryKey: selfInspectionQueryKeys.recordApprovalSession(variables.sessionId) });
      void queryClient.invalidateQueries({ queryKey: selfInspectionQueryKeys.sessionsAll });
    }
  });
}

export function useSaveSelfInspectionInspectorJudgements() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      sessionId,
      entryId,
      body
    }: {
      sessionId: string;
      entryId: string;
      body: Parameters<typeof saveSelfInspectionInspectorJudgements>[2];
    }) => saveSelfInspectionInspectorJudgements(sessionId, entryId, body),
    onSuccess: (_entry, variables) => {
      void queryClient.invalidateQueries({ queryKey: selfInspectionQueryKeys.inspectorSessionEntriesAll(variables.sessionId) });
      void queryClient.invalidateQueries({ queryKey: selfInspectionQueryKeys.sessionsAll });
    }
  });
}

export function useCompleteSelfInspectionSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (sessionId: string) => completeSelfInspectionSession(sessionId),
    onSuccess: (session) => {
      void queryClient.invalidateQueries({ queryKey: selfInspectionQueryKeys.sessionEntriesAll(session.id) });
      void queryClient.invalidateQueries({ queryKey: selfInspectionQueryKeys.sessionsAll });
    }
  });
}

export function useApproveSelfInspectionOutOfToleranceReview() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ sessionId, comment }: { sessionId: string; comment?: string | null }) =>
      approveSelfInspectionOutOfToleranceReview(sessionId, { comment }),
    onSuccess: (session) => {
      void queryClient.invalidateQueries({ queryKey: selfInspectionQueryKeys.outOfToleranceReviewsAll });
      void queryClient.invalidateQueries({ queryKey: selfInspectionQueryKeys.sessionEntriesAll(session.id) });
      void queryClient.invalidateQueries({ queryKey: selfInspectionQueryKeys.sessionsAll });
      void queryClient.invalidateQueries({ queryKey: productionScheduleQueryKeys.leaderboardDecorationsAll });
      void queryClient.invalidateQueries({ queryKey: productionScheduleQueryKeys.scheduleAll });
    }
  });
}

export function useResolveSelfInspectionRecordApprovalApprover() {
  return useMutation({
    mutationFn: ({ uid }: { uid: string }) => resolveSelfInspectionRecordApprovalApprover(uid)
  });
}

export function useApproveSelfInspectionRecordApproval() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      sessionId,
      approverEmployeeTagUid,
      comment
    }: {
      sessionId: string;
      approverEmployeeTagUid: string;
      comment?: string | null;
    }) => approveSelfInspectionRecordApproval(sessionId, { approverEmployeeTagUid, comment }),
    onSuccess: (session) => {
      void queryClient.invalidateQueries({ queryKey: selfInspectionQueryKeys.recordApprovalsAll });
      void queryClient.invalidateQueries({ queryKey: selfInspectionQueryKeys.recordApprovalSession(session.id) });
      void queryClient.invalidateQueries({ queryKey: selfInspectionQueryKeys.sessionEntriesAll(session.id) });
      void queryClient.invalidateQueries({ queryKey: selfInspectionQueryKeys.sessionsAll });
      void queryClient.invalidateQueries({ queryKey: productionScheduleQueryKeys.leaderboardDecorationsAll });
      void queryClient.invalidateQueries({ queryKey: productionScheduleQueryKeys.scheduleAll });
    }
  });
}

export function useVerifyKioskSelfInspectionRecordApprovalAccessPassword() {
  return useMutation({
    mutationFn: (payload: { password: string }) =>
      verifyKioskSelfInspectionRecordApprovalAccessPassword(payload)
  });
}

export function useResetSelfInspectionSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      sessionId,
      body
    }: {
      sessionId: string;
      body: Parameters<typeof resetSelfInspectionSession>[1];
    }) => resetSelfInspectionSession(sessionId, body),
    onSuccess: async (result, variables) => {
      void queryClient.invalidateQueries({ queryKey: selfInspectionQueryKeys.sessionEntriesAll(variables.sessionId) });
      void queryClient.invalidateQueries({ queryKey: selfInspectionQueryKeys.sessionEntriesAll(result.newSession.id) });
      void queryClient.invalidateQueries({ queryKey: selfInspectionQueryKeys.sessionsAll });
      void queryClient.invalidateQueries({ queryKey: productionScheduleQueryKeys.leaderboardDecorationsAll });
      void queryClient.invalidateQueries({ queryKey: productionScheduleQueryKeys.scheduleAll });
      const scheduleRowId = result.newSession.scheduleRowId;
      if (scheduleRowId) {
        await purgeLeaderboardBoardCacheForScheduleRow(scheduleRowId);
      }
    }
  });
}
