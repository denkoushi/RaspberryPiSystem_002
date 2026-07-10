import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { purgeLeaderboardBoardCacheForScheduleRow } from '../../features/kiosk/leaderOrderBoard/cache/purgeLeaderboardBoardCacheForScheduleRow';
import { patchSelfInspectionSessionCachesAfterEntrySave } from '../../features/part-measurement/mergeSelfInspectionSessionAfterEntrySave';
import { resolveSelfInspectionSessionPlaceholderData } from '../../features/part-measurement/selfInspectionSessionPlaceholder';
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
  completeSelfInspectionSession,
  approveSelfInspectionOutOfToleranceReview,
  approveSelfInspectionRecordApproval,
  getSelfInspectionRegistrationPolicy,
  updateSelfInspectionRegistrationPolicy,
  resolveSelfInspectionRecordApprovalApprover,
  verifyKioskSelfInspectionRecordApprovalAccessPassword,
  resetSelfInspectionSession
} from '../client';

import type { SelfInspectionStatus } from '../../features/part-measurement/types';

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
    queryKey: ['self-inspection-sessions', params],
    queryFn: () => listSelfInspectionSessions(params),
    placeholderData: (previousData) => previousData,
    refetchInterval: interval,
    enabled: options?.enabled ?? true
  });
}

export function useSelfInspectionOutOfToleranceReviews(options?: { enabled?: boolean; refetchIntervalMs?: number | false }) {
  return useQuery({
    queryKey: ['self-inspection-out-of-tolerance-reviews'],
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
    queryKey: ['self-inspection-registration-policy'],
    queryFn: () => getSelfInspectionRegistrationPolicy(),
    refetchInterval: options?.refetchIntervalMs ?? 30000,
    enabled: options?.enabled ?? true
  });
}

export function useUpdateSelfInspectionRegistrationPolicy() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: { requireMeasuringInstrumentTag: boolean }) =>
      updateSelfInspectionRegistrationPolicy(payload),
    onSuccess: (policy) => {
      queryClient.setQueryData(['self-inspection-registration-policy'], policy);
      void queryClient.invalidateQueries({ queryKey: ['self-inspection-registration-policy'] });
      void queryClient.invalidateQueries({ queryKey: ['self-inspection-record-approvals'] });
      void queryClient.invalidateQueries({ queryKey: ['self-inspection-record-approval-session'] });
      void queryClient.invalidateQueries({ queryKey: ['self-inspection-session'] });
      void queryClient.invalidateQueries({ queryKey: ['self-inspection-sessions'] });
      void queryClient.invalidateQueries({ queryKey: ['kiosk-production-schedule', 'leaderboard-decorations'] });
      void queryClient.invalidateQueries({ queryKey: ['kiosk-production-schedule'] });
    }
  });
}

export function useSelfInspectionRecordApprovals(
  params?: Parameters<typeof listSelfInspectionRecordApprovals>[0],
  options?: { enabled?: boolean; refetchIntervalMs?: number | false }
) {
  return useQuery({
    queryKey: ['self-inspection-record-approvals', params],
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
    queryKey: ['self-inspection-record-approval-session', sessionId],
    queryFn: () => getSelfInspectionRecordApprovalSession(sessionId!),
    refetchInterval: options?.refetchIntervalMs ?? false,
    enabled: Boolean(sessionId) && (options?.enabled ?? true)
  });
}

function selfInspectionSessionQueryKey(sessionId: string, entryIndex?: number) {
  return ['self-inspection-session', sessionId, entryIndex ?? null] as const;
}

function selfInspectionInspectorSessionQueryKey(sessionId: string, entryIndex?: number) {
  return ['self-inspection-inspector-session', sessionId, entryIndex ?? null] as const;
}

export function useSelfInspectionSession(
  sessionId?: string | null,
  options?: { enabled?: boolean; entryIndex?: number }
) {
  const entryIndex = options?.entryIndex;
  return useQuery({
    queryKey: selfInspectionSessionQueryKey(sessionId!, entryIndex),
    queryFn: () => getSelfInspectionSession(sessionId!, { entryIndex }),
    placeholderData: (previousData) => resolveSelfInspectionSessionPlaceholderData(previousData, sessionId),
    enabled: (options?.enabled ?? true) && Boolean(sessionId)
  });
}

export function useSelfInspectionInspectorMeasurementSession(
  sessionId?: string | null,
  options?: { enabled?: boolean; entryIndex?: number }
) {
  const entryIndex = options?.entryIndex;
  return useQuery({
    queryKey: selfInspectionInspectorSessionQueryKey(sessionId!, entryIndex),
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
      void queryClient.invalidateQueries({ queryKey: ['self-inspection-sessions'] });
      void queryClient.invalidateQueries({ queryKey: ['self-inspection-session', session.id] });
    }
  });
}

export function useCreateSelfInspectionEntry() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ sessionId, body }: { sessionId: string; body: Parameters<typeof createSelfInspectionEntry>[1] }) =>
      createSelfInspectionEntry(sessionId, body),
    onSuccess: (entry, variables) => {
      patchSelfInspectionSessionCachesAfterEntrySave(queryClient, variables.sessionId, entry);
      void queryClient.invalidateQueries({ queryKey: ['self-inspection-sessions'] });
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
      void queryClient.invalidateQueries({ queryKey: ['self-inspection-sessions'] });
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
      void queryClient.invalidateQueries({ queryKey: ['self-inspection-inspector-session', variables.sessionId] });
      void queryClient.invalidateQueries({ queryKey: ['self-inspection-record-approvals'] });
      void queryClient.invalidateQueries({ queryKey: ['self-inspection-record-approval-session', variables.sessionId] });
      void queryClient.invalidateQueries({ queryKey: ['self-inspection-sessions'] });
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
      void queryClient.invalidateQueries({ queryKey: ['self-inspection-inspector-session', variables.sessionId] });
      void queryClient.invalidateQueries({ queryKey: ['self-inspection-record-approvals'] });
      void queryClient.invalidateQueries({ queryKey: ['self-inspection-record-approval-session', variables.sessionId] });
      void queryClient.invalidateQueries({ queryKey: ['self-inspection-sessions'] });
    }
  });
}

export function useCompleteSelfInspectionSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (sessionId: string) => completeSelfInspectionSession(sessionId),
    onSuccess: (session) => {
      void queryClient.invalidateQueries({ queryKey: ['self-inspection-session', session.id] });
      void queryClient.invalidateQueries({ queryKey: ['self-inspection-sessions'] });
    }
  });
}

export function useApproveSelfInspectionOutOfToleranceReview() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ sessionId, comment }: { sessionId: string; comment?: string | null }) =>
      approveSelfInspectionOutOfToleranceReview(sessionId, { comment }),
    onSuccess: (session) => {
      void queryClient.invalidateQueries({ queryKey: ['self-inspection-out-of-tolerance-reviews'] });
      void queryClient.invalidateQueries({ queryKey: ['self-inspection-session', session.id] });
      void queryClient.invalidateQueries({ queryKey: ['self-inspection-sessions'] });
      void queryClient.invalidateQueries({ queryKey: ['kiosk-production-schedule', 'leaderboard-decorations'] });
      void queryClient.invalidateQueries({ queryKey: ['kiosk-production-schedule'] });
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
      void queryClient.invalidateQueries({ queryKey: ['self-inspection-record-approvals'] });
      void queryClient.invalidateQueries({ queryKey: ['self-inspection-record-approval-session', session.id] });
      void queryClient.invalidateQueries({ queryKey: ['self-inspection-session', session.id] });
      void queryClient.invalidateQueries({ queryKey: ['self-inspection-sessions'] });
      void queryClient.invalidateQueries({ queryKey: ['kiosk-production-schedule', 'leaderboard-decorations'] });
      void queryClient.invalidateQueries({ queryKey: ['kiosk-production-schedule'] });
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
      void queryClient.invalidateQueries({ queryKey: ['self-inspection-session', variables.sessionId] });
      void queryClient.invalidateQueries({ queryKey: ['self-inspection-session', result.newSession.id] });
      void queryClient.invalidateQueries({ queryKey: ['self-inspection-sessions'] });
      void queryClient.invalidateQueries({ queryKey: ['kiosk-production-schedule', 'leaderboard-decorations'] });
      void queryClient.invalidateQueries({ queryKey: ['kiosk-production-schedule'] });
      const scheduleRowId = result.newSession.scheduleRowId;
      if (scheduleRowId) {
        await purgeLeaderboardBoardCacheForScheduleRow(scheduleRowId);
      }
    }
  });
}
