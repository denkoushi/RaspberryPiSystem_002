import { describe, expect, it } from 'vitest';

import {
  buildSelfInspectionRecordApprovalWhere,
  SELF_INSPECTION_RECORD_APPROVAL_SCOPE_COMPLETED_RECORDS
} from '../record-approval-filter.js';

describe('buildSelfInspectionRecordApprovalWhere', () => {
  it('builds the completed-record scope at the database boundary', () => {
    expect(
      buildSelfInspectionRecordApprovalWhere({
        scope: SELF_INSPECTION_RECORD_APPROVAL_SCOPE_COMPLETED_RECORDS,
        productNo: '  ABC  ',
        resourceCd: ' GR-01 ',
        processGroup: 'GRINDING'
      })
    ).toEqual({
      invalidatedAt: null,
      recordApprovalRequiredAt: { not: null },
      productNo: { contains: 'ABC', mode: 'insensitive' },
      resourceCd: { equals: 'GR-01', mode: 'insensitive' },
      processGroup: 'GRINDING',
      OR: [
        { recordApproval: { isNot: null } },
        { decisionWorkflow: 'INSPECTOR_FINAL_JUDGEMENT', completedAt: { not: null } }
      ]
    });
  });

  it('retains the legacy active predicate when scope is omitted', () => {
    expect(buildSelfInspectionRecordApprovalWhere({ state: 'active' })).toEqual({
      invalidatedAt: null,
      recordApprovalRequiredAt: { not: null },
      completedAt: null,
      OR: [
        { decisionWorkflow: 'INSPECTOR_FINAL_JUDGEMENT' },
        { decisionWorkflow: null, recordApproval: { is: null } },
        { decisionWorkflow: 'LEGACY_RECORD_APPROVAL', recordApproval: { is: null } }
      ]
    });
  });

  it('keeps approved and inspector-completed state predicates distinct', () => {
    expect(buildSelfInspectionRecordApprovalWhere({ state: 'approved' })).toMatchObject({
      recordApproval: { isNot: null }
    });
    expect(buildSelfInspectionRecordApprovalWhere({ state: 'completed' })).toMatchObject({
      decisionWorkflow: 'INSPECTOR_FINAL_JUDGEMENT',
      completedAt: { not: null }
    });
  });
});
