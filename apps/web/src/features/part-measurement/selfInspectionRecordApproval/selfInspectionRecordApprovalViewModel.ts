import {
  kioskSelfInspectionInspectorSessionPath,
  kioskSelfInspectionSessionPath
} from '../selfInspectionRoutes';

export { formatDateTime } from '../selfInspectionListFormatters';

import type {
  SelfInspectionItemInvalidationState,
  SelfInspectionRecordApprovalSessionListItemDto,
  SelfInspectionRecordApprovalSessionDetailDto,
  SelfInspectionRecordApprovalState
} from '../types';

/** The three views exposed by the kiosk record-review toolbar. */
export type SelfInspectionRecordApprovalFilter =
  | 'active'
  | 'completed_records'
  | 'invalidated';

export const SELF_INSPECTION_RECORD_APPROVAL_FILTERS: ReadonlyArray<{
  value: SelfInspectionRecordApprovalFilter;
  label: string;
}> = [
  { value: 'active', label: '未完了' },
  { value: 'completed_records', label: '完了記録' },
  { value: 'invalidated', label: '削除履歴' }
];

/**
 * Keep the query model separate from the hook. The API layer owns the exact
 * transport shape; the page only decides which list scope the user selected.
 */
export type SelfInspectionRecordApprovalListParams = {
  state?: 'active';
  scope?: 'completed_records';
  productNo?: string;
  resourceCd?: string;
};

export function buildSelfInspectionRecordApprovalListParams(
  filter: SelfInspectionRecordApprovalFilter,
  productNo: string,
  resourceCd: string
): SelfInspectionRecordApprovalListParams {
  const params: SelfInspectionRecordApprovalListParams = {
    productNo: productNo.trim() || undefined,
    resourceCd: resourceCd.trim() || undefined
  };

  if (filter === 'completed_records') {
    params.scope = 'completed_records';
  } else {
    // The invalidation view still keeps the ordinary list query warm. This
    // makes switching back to 未完了 instantaneous while invalidations load.
    params.state = 'active';
  }

  return params;
}

export function stateLabel(state: SelfInspectionRecordApprovalState): string {
  switch (state) {
    case 'approved':
      return '承認済み';
    case 'approvable':
      return '承認可能';
    case 'finalization_ready':
      return '最終確定可能';
    case 'final_judgement_pending':
      return '最終判定待ち';
    case 'registration_incomplete':
      return '点検不足';
    case 'inspector_measurement_pending':
      return '検査員待ち';
    case 'completed':
      return '完了済み';
    case 'input_incomplete':
    default:
      return '入力途中';
  }
}

/** Keep an operator-facing intent beside the state badge in every card. */
export function stateIntentLabel(state: SelfInspectionRecordApprovalState): string {
  switch (state) {
    case 'input_incomplete':
      return '作業者の入力を続けてください';
    case 'inspector_measurement_pending':
      return '検査員の再測定を待っています';
    case 'registration_incomplete':
      return '使用前点検をそろえてください';
    case 'final_judgement_pending':
      return '検査員の最終判定を待っています';
    case 'finalization_ready':
      return '検査員画面から確定できます';
    case 'approvable':
      return '承認者を確認して完了できます';
    case 'approved':
      return '承認済みの記録です';
    case 'completed':
      return '完了した記録です';
    default:
      return '';
  }
}

export function stateClassName(state: SelfInspectionRecordApprovalState): string {
  switch (state) {
    case 'approved':
    case 'completed':
      return 'bg-slate-500/35 text-white/80';
    case 'approvable':
    case 'finalization_ready':
    case 'registration_incomplete':
    case 'inspector_measurement_pending':
    case 'final_judgement_pending':
    case 'input_incomplete':
    default:
      return 'bg-amber-400/25 text-amber-100';
  }
}

export const INVALIDATION_STATE_LABELS: Record<SelfInspectionItemInvalidationState, string> = {
  NOT_STARTED: '未開始',
  IN_PROGRESS: '入力中',
  REVIEW_PENDING: '承認待ち',
  COMPLETED: '完了',
  APPROVED: '承認済み'
};

export function formatParticipantNames(names: string[] | null | undefined): string {
  if (!names || names.length === 0) return '未登録';
  return names.join('、');
}

export function formatInstrumentUsageLabel(usage: {
  measuringInstrumentManagementNumberSnapshot: string;
  measuringInstrumentNameSnapshot: string;
}): string {
  return `${usage.measuringInstrumentManagementNumberSnapshot} ${usage.measuringInstrumentNameSnapshot}`;
}

export function inspectorJudgementLabel(status: string | null): string {
  if (status === 'NOT_EVALUATED') return '未判定';
  return status ?? '-';
}

export function readApiErrorMessage(error: unknown, fallback: string): string {
  if (typeof error === 'object' && error !== null && 'response' in error) {
    const message = (error as { response?: { data?: { message?: unknown } } }).response?.data?.message;
    if (typeof message === 'string' && message.trim().length > 0) return message;
  }
  return fallback;
}

export function getInspectorWorkflowAction(
  session: SelfInspectionRecordApprovalSessionDetailDto | null
): { href: string; label: string } | null {
  if (!session || session.decisionWorkflow !== 'INSPECTOR_FINAL_JUDGEMENT') return null;
  switch (session.recordApprovalState) {
    case 'input_incomplete':
      return {
        href: kioskSelfInspectionSessionPath(session.id),
        label: '作業者入力へ'
      };
    case 'registration_incomplete':
      return session.inspectorIncompleteRegistrationEntryCount > 0
        ? {
            href: kioskSelfInspectionInspectorSessionPath(session.id),
            label: '検査員点検へ'
          }
        : {
            href: kioskSelfInspectionSessionPath(session.id),
            label: '作業者点検へ'
          };
    case 'inspector_measurement_pending':
      return {
        href: kioskSelfInspectionInspectorSessionPath(session.id),
        label: '検査員測定へ'
      };
    case 'final_judgement_pending':
      return {
        href: kioskSelfInspectionInspectorSessionPath(session.id),
        label: '最終判定へ'
      };
    case 'finalization_ready':
      return {
        href: kioskSelfInspectionInspectorSessionPath(session.id),
        label: '最終確定へ'
      };
    default:
      return null;
  }
}

export function hasTruncatedResults(truncated: boolean | undefined): boolean {
  return truncated === true;
}

export function truncatedResultsMessage(): string {
  return '200件超のため、先頭200件を表示しています。製造orderまたは資源CDで絞り込んでください。';
}

export type RecordApprovalListCardModel = Pick<
  SelfInspectionRecordApprovalSessionListItemDto,
  'id' | 'productNo' | 'recordApprovalState'
>;
