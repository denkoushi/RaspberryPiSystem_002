import {
  KIOSK_SELF_INSPECTION_RECORD_APPROVALS_PATH,
  kioskSelfInspectionInspectorSessionPath,
  kioskSelfInspectionSessionPath
} from './selfInspectionRoutes';
import { presentSelfInspectionWipCard } from './selfInspectionWipCardPresentation';

import type { SelfInspectionSessionSummaryDto, SelfInspectionStatus } from './types';

export type SelfInspectionCandidateDisplaySource = {
  id: string;
  productNo: string;
  fseiban: string;
  resourceCd: string;
  fhincd: string;
  fhinmei: string;
  plannedQuantity: number | null;
  status: SelfInspectionStatus | null;
};

export type SelfInspectionFilterSource = {
  productNo: string;
  fseiban: string | null;
  resourceCd: string;
  fhincd: string;
  fhinmei: string;
};

export type SelfInspectionFilterOption = {
  value: string;
  label: string;
  searchText: string;
};

type SelfInspectionTableRowBase = {
  id: string;
  productNo: string;
  resourceCd: string;
  statusLabel: string;
  statusTone: 'danger' | 'info' | 'warning';
  detailLine: string;
  progressLine: string;
};

export type SelfInspectionTableRow =
  | (SelfInspectionTableRowBase & {
      kind: 'session';
      action: { kind: 'link'; href: string; label: string };
    })
  | (SelfInspectionTableRowBase & {
      kind: 'candidate';
      action: { kind: 'button'; label: string };
    });

export function selfInspectionStatusLabel(status: SelfInspectionStatus | null): string {
  if (status === 'completed') return '完了';
  if (status === 'review_pending') return '承認待ち';
  if (status === 'in_progress') return '入力中';
  return '未開始';
}

export function splitIntoBalancedPanes<T>(items: readonly T[], paneCount: number): T[][] {
  const normalizedPaneCount = Math.max(1, Math.floor(paneCount));
  const baseSize = Math.floor(items.length / normalizedPaneCount);
  const remainder = items.length % normalizedPaneCount;
  const panes: T[][] = [];
  let offset = 0;

  for (let index = 0; index < normalizedPaneCount; index += 1) {
    const size = baseSize + (index < remainder ? 1 : 0);
    panes.push(items.slice(offset, offset + size));
    offset += size;
  }
  return panes;
}

export function buildProductFilterOptions(
  rows: readonly SelfInspectionFilterSource[]
): SelfInspectionFilterOption[] {
  const seen = new Set<string>();
  const options: SelfInspectionFilterOption[] = [];
  for (const row of rows) {
    const value = row.productNo.trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    const parts = [
      value,
      row.fseiban?.trim() && `製番 ${row.fseiban.trim()}`,
      row.fhincd.trim() && `品番 ${row.fhincd.trim()}`,
      row.resourceCd.trim() && `資源 ${row.resourceCd.trim()}`
    ].filter(Boolean) as string[];
    const label = parts.join(' / ');
    options.push({ value, label, searchText: `${label} ${row.fhinmei}`.toLocaleLowerCase() });
  }
  return options;
}

export function buildResourceFilterOptions(
  rows: readonly SelfInspectionFilterSource[]
): SelfInspectionFilterOption[] {
  const seen = new Set<string>();
  const options: SelfInspectionFilterOption[] = [];
  for (const row of rows) {
    const value = row.resourceCd.trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    options.push({ value, label: value, searchText: value.toLocaleLowerCase() });
  }
  return options;
}

export function presentSelfInspectionSessionRow(
  session: SelfInspectionSessionSummaryDto
): SelfInspectionTableRow {
  const inspectorState = session.inspectorMeasurementState;
  const inspectorActive =
    Boolean(session.inspectorRemeasurementRequiredAt) &&
    (inspectorState === 'pending' ||
      inspectorState === 'in_progress' ||
      (inspectorState === 'complete' &&
        session.decisionWorkflow === 'INSPECTOR_FINAL_JUDGEMENT')) &&
    !session.completedAt;
  const inspectorComplete =
    Boolean(session.inspectorRemeasurementRequiredAt) && inspectorState === 'complete';
  const action = inspectorActive
    ? { kind: 'link' as const, href: kioskSelfInspectionInspectorSessionPath(session.id), label: '検査員測定' }
    : inspectorComplete &&
        session.recordApprovalRequiredAt &&
        session.decisionWorkflow === 'LEGACY_RECORD_APPROVAL'
      ? { kind: 'link' as const, href: KIOSK_SELF_INSPECTION_RECORD_APPROVALS_PATH, label: '記録確認' }
      : { kind: 'link' as const, href: kioskSelfInspectionSessionPath(session.id), label: '再開' };
  const card = presentSelfInspectionWipCard({
    productNo: session.productNo,
    fhincd: session.fhincd,
    fhinmei: session.fhinmei,
    resourceCd: session.resourceCd,
    plannedQuantity: session.plannedQuantity,
    fseiban: session.fseiban,
    completedEntryCount: session.completedEntryCount,
    requiredEntryCount: session.requiredEntryCount,
    participantEmployeeNames: session.participantEmployeeNames ?? []
  });

  return {
    kind: 'session',
    id: session.id,
    productNo: session.productNo,
    resourceCd: session.resourceCd,
    statusLabel: inspectorActive
      ? inspectorComplete ? '最終判定待ち' : '検査員待ち'
      : inspectorComplete && session.recordApprovalRequiredAt
        ? '最終判定待ち'
        : selfInspectionStatusLabel(session.status),
    statusTone:
      session.status === 'review_pending' || inspectorActive || inspectorComplete ? 'danger' : 'warning',
    detailLine: `製番 ${session.fseiban || '—'} / 品番 ${session.fhincd || '—'} ${session.fhinmei || ''}`.trim(),
    progressLine:
      inspectorActive || inspectorComplete
        ? `氏名 ${card.participantNamesLine} / 指示数 ${session.plannedQuantity} / 検査員 ${session.inspectorCompletedRequiredEntryCount}/${session.inspectorRequiredEntryCount} 件`
        : `氏名 ${card.participantNamesLine} / 指示数 ${session.plannedQuantity} / 進捗 ${card.progressLine}`,
    action
  };
}

export function presentSelfInspectionCandidateRow(
  candidate: SelfInspectionCandidateDisplaySource
): SelfInspectionTableRow {
  return {
    kind: 'candidate',
    id: candidate.id,
    productNo: candidate.productNo,
    resourceCd: candidate.resourceCd,
    statusLabel: selfInspectionStatusLabel(candidate.status),
    statusTone: 'info',
    detailLine: `製番 ${candidate.fseiban || '—'} / 品番 ${candidate.fhincd || '—'} ${candidate.fhinmei || ''}`.trim(),
    progressLine: `指示数 ${candidate.plannedQuantity ?? '—'}`,
    action: { kind: 'button', label: '検査方法を選択' }
  };
}
