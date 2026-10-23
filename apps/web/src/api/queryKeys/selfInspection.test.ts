import { describe, expect, it } from 'vitest';

import { selfInspectionQueryKeys } from './selfInspection';

describe('selfInspectionQueryKeys', () => {
  it('preserves parameterless keys and invalidation prefixes', () => {
    expect(selfInspectionQueryKeys.sessionsAll).toEqual(['self-inspection-sessions']);
    expect(selfInspectionQueryKeys.sessionAll).toEqual(['self-inspection-session']);
    expect(selfInspectionQueryKeys.inspectorSessionAll).toEqual(['self-inspection-inspector-session']);
    expect(selfInspectionQueryKeys.invalidationsAll).toEqual(['self-inspection-invalidations']);
    expect(selfInspectionQueryKeys.invalidationAll).toEqual(['self-inspection-invalidation']);
    expect(selfInspectionQueryKeys.outOfToleranceReviewsAll).toEqual(['self-inspection-out-of-tolerance-reviews']);
    expect(selfInspectionQueryKeys.registrationPolicyAll).toEqual(['self-inspection-registration-policy']);
    expect(selfInspectionQueryKeys.recordApprovalsAll).toEqual(['self-inspection-record-approvals']);
    expect(selfInspectionQueryKeys.recordApprovalSessionAll).toEqual(['self-inspection-record-approval-session']);
    expect(selfInspectionQueryKeys.reductionInsightsAll).toEqual(['self-inspection-reduction', 'insights']);
    expect(selfInspectionQueryKeys.reductionSettingsAll).toEqual(['self-inspection-reduction', 'settings']);
  });

  it('preserves sessions parameters including omitted and empty parameters', () => {
    const params = { productNo: 'product-1', resourceCd: 'resource-1', processGroup: 'cutting', status: 'in_progress' } as const;
    expect(selfInspectionQueryKeys.sessions(params)).toEqual(['self-inspection-sessions', params]);
    expect(selfInspectionQueryKeys.sessions({})).toEqual(['self-inspection-sessions', {}]);
    expect(selfInspectionQueryKeys.sessions()).toEqual(['self-inspection-sessions', undefined]);
    expect(selfInspectionQueryKeys.sessions(undefined)).toEqual(['self-inspection-sessions', undefined]);
  });

  it('preserves invalidations parameters including omitted and empty parameters', () => {
    const params = { productNo: 'product-1', resourceCd: 'resource-1' } as const;
    expect(selfInspectionQueryKeys.invalidations(params)).toEqual(['self-inspection-invalidations', params]);
    expect(selfInspectionQueryKeys.invalidations({})).toEqual(['self-inspection-invalidations', {}]);
    expect(selfInspectionQueryKeys.invalidations()).toEqual(['self-inspection-invalidations', undefined]);
    expect(selfInspectionQueryKeys.invalidations(undefined)).toEqual(['self-inspection-invalidations', undefined]);
  });

  it('preserves recordApprovals parameters including omitted and empty parameters', () => {
    const params = { state: 'active', productNo: 'product-1', processGroup: 'grinding' } as const;
    expect(selfInspectionQueryKeys.recordApprovals(params)).toEqual(['self-inspection-record-approvals', params]);
    expect(selfInspectionQueryKeys.recordApprovals({})).toEqual(['self-inspection-record-approvals', {}]);
    expect(selfInspectionQueryKeys.recordApprovals()).toEqual(['self-inspection-record-approvals', undefined]);
    expect(selfInspectionQueryKeys.recordApprovals(undefined)).toEqual(['self-inspection-record-approvals', undefined]);
  });

  it('preserves two-element sessionEntriesAll keys', () => {
    expect(selfInspectionQueryKeys.sessionEntriesAll('session-1')).toEqual(['self-inspection-session', 'session-1']);
    expect(selfInspectionQueryKeys.sessionEntriesAll('')).toEqual(['self-inspection-session', '']);
    expect(selfInspectionQueryKeys.sessionEntriesAll(null)).toEqual(['self-inspection-session', null]);
    expect(selfInspectionQueryKeys.sessionEntriesAll(undefined)).toEqual(['self-inspection-session', undefined]);
  });

  it('preserves two-element invalidation keys', () => {
    expect(selfInspectionQueryKeys.invalidation('session-1')).toEqual(['self-inspection-invalidation', 'session-1']);
    expect(selfInspectionQueryKeys.invalidation('')).toEqual(['self-inspection-invalidation', '']);
    expect(selfInspectionQueryKeys.invalidation(null)).toEqual(['self-inspection-invalidation', null]);
    expect(selfInspectionQueryKeys.invalidation(undefined)).toEqual(['self-inspection-invalidation', undefined]);
  });

  it('preserves two-element recordApprovalSession keys', () => {
    expect(selfInspectionQueryKeys.recordApprovalSession('session-1')).toEqual(['self-inspection-record-approval-session', 'session-1']);
    expect(selfInspectionQueryKeys.recordApprovalSession('')).toEqual(['self-inspection-record-approval-session', '']);
    expect(selfInspectionQueryKeys.recordApprovalSession(null)).toEqual(['self-inspection-record-approval-session', null]);
    expect(selfInspectionQueryKeys.recordApprovalSession(undefined)).toEqual(['self-inspection-record-approval-session', undefined]);
  });

  it('preserves two-element inspectorSessionEntriesAll keys', () => {
    expect(selfInspectionQueryKeys.inspectorSessionEntriesAll('session-1')).toEqual(['self-inspection-inspector-session', 'session-1']);
    expect(selfInspectionQueryKeys.inspectorSessionEntriesAll('')).toEqual(['self-inspection-inspector-session', '']);
  });

  it('preserves three-element session keys and null for omitted indices', () => {
    expect(selfInspectionQueryKeys.session('session-1', 2)).toEqual(['self-inspection-session', 'session-1', 2]);
    expect(selfInspectionQueryKeys.session('session-1', 0)).toEqual(['self-inspection-session', 'session-1', 0]);
    expect(selfInspectionQueryKeys.session('session-1')).toEqual(['self-inspection-session', 'session-1', null]);
    expect(selfInspectionQueryKeys.session('session-1', undefined)).toEqual(['self-inspection-session', 'session-1', null]);
    expect(selfInspectionQueryKeys.session('', 2)).toEqual(['self-inspection-session', '', 2]);
    expect(selfInspectionQueryKeys.session('', 0)).toEqual(['self-inspection-session', '', 0]);
    expect(selfInspectionQueryKeys.session('')).toEqual(['self-inspection-session', '', null]);
    expect(selfInspectionQueryKeys.session('', undefined)).toEqual(['self-inspection-session', '', null]);
    expect(selfInspectionQueryKeys.session(null, 2)).toEqual(['self-inspection-session', null, 2]);
    expect(selfInspectionQueryKeys.session(null, 0)).toEqual(['self-inspection-session', null, 0]);
    expect(selfInspectionQueryKeys.session(null)).toEqual(['self-inspection-session', null, null]);
    expect(selfInspectionQueryKeys.session(null, undefined)).toEqual(['self-inspection-session', null, null]);
    expect(selfInspectionQueryKeys.session(undefined, 2)).toEqual(['self-inspection-session', undefined, 2]);
    expect(selfInspectionQueryKeys.session(undefined, 0)).toEqual(['self-inspection-session', undefined, 0]);
    expect(selfInspectionQueryKeys.session(undefined)).toEqual(['self-inspection-session', undefined, null]);
    expect(selfInspectionQueryKeys.session(undefined, undefined)).toEqual(['self-inspection-session', undefined, null]);
    expect(selfInspectionQueryKeys.session('session-1')).toHaveLength(3);
  });

  it('preserves three-element inspectorSession keys and null for omitted indices', () => {
    expect(selfInspectionQueryKeys.inspectorSession('session-1', 2)).toEqual(['self-inspection-inspector-session', 'session-1', 2]);
    expect(selfInspectionQueryKeys.inspectorSession('session-1', 0)).toEqual(['self-inspection-inspector-session', 'session-1', 0]);
    expect(selfInspectionQueryKeys.inspectorSession('session-1')).toEqual(['self-inspection-inspector-session', 'session-1', null]);
    expect(selfInspectionQueryKeys.inspectorSession('session-1', undefined)).toEqual(['self-inspection-inspector-session', 'session-1', null]);
    expect(selfInspectionQueryKeys.inspectorSession('', 2)).toEqual(['self-inspection-inspector-session', '', 2]);
    expect(selfInspectionQueryKeys.inspectorSession('', 0)).toEqual(['self-inspection-inspector-session', '', 0]);
    expect(selfInspectionQueryKeys.inspectorSession('')).toEqual(['self-inspection-inspector-session', '', null]);
    expect(selfInspectionQueryKeys.inspectorSession('', undefined)).toEqual(['self-inspection-inspector-session', '', null]);
    expect(selfInspectionQueryKeys.inspectorSession(null, 2)).toEqual(['self-inspection-inspector-session', null, 2]);
    expect(selfInspectionQueryKeys.inspectorSession(null, 0)).toEqual(['self-inspection-inspector-session', null, 0]);
    expect(selfInspectionQueryKeys.inspectorSession(null)).toEqual(['self-inspection-inspector-session', null, null]);
    expect(selfInspectionQueryKeys.inspectorSession(null, undefined)).toEqual(['self-inspection-inspector-session', null, null]);
    expect(selfInspectionQueryKeys.inspectorSession(undefined, 2)).toEqual(['self-inspection-inspector-session', undefined, 2]);
    expect(selfInspectionQueryKeys.inspectorSession(undefined, 0)).toEqual(['self-inspection-inspector-session', undefined, 0]);
    expect(selfInspectionQueryKeys.inspectorSession(undefined)).toEqual(['self-inspection-inspector-session', undefined, null]);
    expect(selfInspectionQueryKeys.inspectorSession(undefined, undefined)).toEqual(['self-inspection-inspector-session', undefined, null]);
    expect(selfInspectionQueryKeys.inspectorSession('session-1')).toHaveLength(3);
  });

  it('preserves nonconformity keys', () => {
    expect(selfInspectionQueryKeys.nonconformities('PART-1')).toEqual(['self-inspection', 'nonconformities', 'PART-1']);
    expect(selfInspectionQueryKeys.nonconformities('')).toEqual(['self-inspection', 'nonconformities', '']);
  });

  it('preserves reduction insight periods', () => {
    expect(selfInspectionQueryKeys.reductionInsights(30)).toEqual(['self-inspection-reduction', 'insights', 30]);
    expect(selfInspectionQueryKeys.reductionInsights(90)).toEqual(['self-inspection-reduction', 'insights', 90]);
    expect(selfInspectionQueryKeys.reductionInsights(180)).toEqual(['self-inspection-reduction', 'insights', 180]);
  });

  it('preserves template candidate parameters including null and undefined fields', () => {
    const params = { fhincd: 'PART-1', processGroup: 'cutting', resourceCd: 'resource-1', fkojun: '10', fhinmei: 'Part', q: 'query' } as const;
    expect(selfInspectionQueryKeys.partMeasurementTemplateCandidates(params)).toEqual(['part-measurement-template-candidates', params]);
    const emptyOptional = { fhincd: 'PART-1', processGroup: 'grinding', resourceCd: 'resource-1', fkojun: '', q: undefined } as const;
    expect(selfInspectionQueryKeys.partMeasurementTemplateCandidates(emptyOptional)).toEqual(['part-measurement-template-candidates', emptyOptional]);
    expect(selfInspectionQueryKeys.partMeasurementTemplateCandidates(null)).toEqual(['part-measurement-template-candidates', null]);
  });
});
