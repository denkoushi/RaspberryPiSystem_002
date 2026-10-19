import type {
  listPartMeasurementTemplateCandidates,
  listSelfInspectionInvalidations,
  listSelfInspectionRecordApprovals,
  listSelfInspectionSessions,
  SelfInspectionReductionPeriodDays,
} from '../client';

export const selfInspectionQueryKeys = {
  sessionsAll: ['self-inspection-sessions'] as const,
  sessions: (params?: Parameters<typeof listSelfInspectionSessions>[0]) =>
    ['self-inspection-sessions', params] as const,
  sessionAll: ['self-inspection-session'] as const,
  sessionEntriesAll: (sessionId: string | null | undefined) =>
    ['self-inspection-session', sessionId] as const,
  session: (sessionId: string | null | undefined, entryIndex?: number) =>
    ['self-inspection-session', sessionId, entryIndex ?? null] as const,
  inspectorSessionAll: ['self-inspection-inspector-session'] as const,
  inspectorSessionEntriesAll: (sessionId: string) =>
    ['self-inspection-inspector-session', sessionId] as const,
  inspectorSession: (sessionId: string | null | undefined, entryIndex?: number) =>
    ['self-inspection-inspector-session', sessionId, entryIndex ?? null] as const,
  invalidationsAll: ['self-inspection-invalidations'] as const,
  invalidations: (params?: Parameters<typeof listSelfInspectionInvalidations>[0]) =>
    ['self-inspection-invalidations', params] as const,
  invalidationAll: ['self-inspection-invalidation'] as const,
  invalidation: (id: string | null | undefined) => ['self-inspection-invalidation', id] as const,
  outOfToleranceReviewsAll: ['self-inspection-out-of-tolerance-reviews'] as const,
  registrationPolicyAll: ['self-inspection-registration-policy'] as const,
  recordApprovalsAll: ['self-inspection-record-approvals'] as const,
  recordApprovals: (params?: Parameters<typeof listSelfInspectionRecordApprovals>[0]) =>
    ['self-inspection-record-approvals', params] as const,
  recordApprovalSessionAll: ['self-inspection-record-approval-session'] as const,
  recordApprovalSession: (sessionId: string | null | undefined) =>
    ['self-inspection-record-approval-session', sessionId] as const,
  nonconformities: (normalizedPartNumber: string) =>
    ['self-inspection', 'nonconformities', normalizedPartNumber] as const,
  reductionInsightsAll: ['self-inspection-reduction', 'insights'] as const,
  reductionInsights: (periodDays: SelfInspectionReductionPeriodDays) =>
    ['self-inspection-reduction', 'insights', periodDays] as const,
  reductionSettingsAll: ['self-inspection-reduction', 'settings'] as const,
  partMeasurementTemplateCandidates: (params: Parameters<typeof listPartMeasurementTemplateCandidates>[0] | null) =>
    ['part-measurement-template-candidates', params] as const,
};
