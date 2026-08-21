import type { Prisma, PartMeasurementProcessGroup } from '@prisma/client';

import type { SelfInspectionRecordApprovalState } from './serialization.js';

export const SELF_INSPECTION_RECORD_APPROVAL_SCOPE_COMPLETED_RECORDS = 'completed_records' as const;

export type SelfInspectionRecordApprovalScope =
  typeof SELF_INSPECTION_RECORD_APPROVAL_SCOPE_COMPLETED_RECORDS;

export type SelfInspectionRecordApprovalFilterQuery = {
  productNo?: string;
  resourceCd?: string;
  processGroup?: PartMeasurementProcessGroup;
  state?: 'active' | SelfInspectionRecordApprovalState;
  scope?: SelfInspectionRecordApprovalScope;
};

function normalizeFilterText(value: string | null | undefined): string {
  return (value ?? '').trim();
}

/**
 * Build the persistence predicate for record-approval list queries.
 *
 * This deliberately contains no database access or response-state calculation. The
 * state calculation remains in serialization because it depends on the loaded
 * template and entries, while this module owns the SQL-level candidate set.
 */
export function buildSelfInspectionRecordApprovalWhere(
  query: SelfInspectionRecordApprovalFilterQuery
): Prisma.SelfInspectionSessionWhereInput {
  const productNo = normalizeFilterText(query.productNo);
  const resourceCd = normalizeFilterText(query.resourceCd);

  const baseWhere: Prisma.SelfInspectionSessionWhereInput = {
    invalidatedAt: null,
    recordApprovalRequiredAt: { not: null },
    ...(productNo ? { productNo: { contains: productNo, mode: 'insensitive' } } : {}),
    ...(resourceCd ? { resourceCd: { equals: resourceCd, mode: 'insensitive' } } : {}),
    ...(query.processGroup ? { processGroup: query.processGroup } : {})
  };

  if (query.scope === SELF_INSPECTION_RECORD_APPROVAL_SCOPE_COMPLETED_RECORDS) {
    return {
      ...baseWhere,
      OR: [
        { recordApproval: { isNot: null } },
        {
          decisionWorkflow: 'INSPECTOR_FINAL_JUDGEMENT',
          completedAt: { not: null }
        }
      ]
    };
  }

  const state = query.state ?? 'active';
  const completionWhere: Prisma.SelfInspectionSessionWhereInput =
    state === 'approved'
      ? { recordApproval: { isNot: null } }
      : state === 'completed'
        ? {
            decisionWorkflow: 'INSPECTOR_FINAL_JUDGEMENT',
            completedAt: { not: null }
          }
        : {
            completedAt: null,
            OR: [
              { decisionWorkflow: 'INSPECTOR_FINAL_JUDGEMENT' },
              { decisionWorkflow: null, recordApproval: { is: null } },
              {
                decisionWorkflow: 'LEGACY_RECORD_APPROVAL',
                recordApproval: { is: null }
              }
            ]
          };

  return { ...baseWhere, ...completionWhere };
}
