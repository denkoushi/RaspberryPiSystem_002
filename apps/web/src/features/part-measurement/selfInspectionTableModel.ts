import { normalizeMachineName } from '../kiosk/productionSchedule/machineName';

import {
  formatSelfInspectionDateTime,
  formatSelfInspectionParticipantLabel,
  formatSelfInspectionResourceLabel,
  formatSelfInspectionResourceName
} from './selfInspectionListFormatters';
import {
  KIOSK_SELF_INSPECTION_RECORD_APPROVALS_PATH,
  kioskSelfInspectionInspectorSessionPath,
  kioskSelfInspectionRecordConfirmationPath,
  kioskSelfInspectionSessionPath
} from './selfInspectionRoutes';
import { presentSelfInspectionWipCard } from './selfInspectionWipCardPresentation';

import type {
  PartMeasurementProcessGroup,
  SelfInspectionItemInvalidationTargetDto,
  SelfInspectionSessionSummaryDto,
  SelfInspectionStatus
} from './types';

export type SelfInspectionCandidateDisplaySource = {
  id: string;
  productNo: string;
  fseiban: string;
  resourceCd: string;
  fhincd: string;
  fhinmei: string;
  machineName: string | null;
  updatedAt: string | null;
  processGroup: PartMeasurementProcessGroup;
  selfInspectionTemplateId: string;
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
  fseiban: string | null;
  machineName: string | null;
  fhinmei: string;
  resourceCd: string;
  resourceLabel: string;
  updatedAt: string | null;
  statusLabel: string;
  statusTone: 'neutral' | 'attention' | 'danger';
  intentLabel: string;
  metadataPrimaryLine: string;
  metadataSecondaryLine: string;
  detailLine: string;
  progressLine: string;
  invalidationTarget: SelfInspectionItemInvalidationTargetDto;
};

export function normalizeSelfInspectionMachineName(
  value: string | null | undefined
): string | null {
  const normalized = normalizeMachineName(value, {
    // The card owns clipping so its title and accessible name retain the full value.
    maxChars: value?.length ?? 0
  });
  return normalized || null;
}

export type SelfInspectionTableRow =
  | (SelfInspectionTableRowBase & {
      kind: 'session';
      actions: Array<{
        kind: 'link';
        href: string;
        label: string;
        tone: 'primary' | 'secondary';
      }>;
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

function presentSelfInspectionIntent(input: {
  status: SelfInspectionStatus | null;
  inspectorActive?: boolean;
  inspectorComplete?: boolean;
  recordApprovalRequiredAt?: string | null;
  completedAt?: string | null;
}): string {
  if (input.inspectorActive && !input.inspectorComplete) return '検査員測定を進めてください';
  if (input.inspectorComplete && input.recordApprovalRequiredAt) return '最終判定を確認してください';
  if (input.status === 'review_pending') return '記録確認を進めてください';
  if (input.status === 'completed' || input.completedAt) return '完了した記録です';
  if (input.status === 'in_progress') return '作業者の入力を続けてください';
  return '開始方法を選択してください';
}

function formatSelfInspectionMetadata(input: {
  productNo: string | null | undefined;
  resourceCd: string | null | undefined;
  resourceName: string;
  updatedAt: string | null | undefined;
  progressLabel: string;
  participantLabel: string;
}): { primaryLine: string; secondaryLine: string } {
  const productNo = input.productNo?.trim() || '—';
  const resourceCd = input.resourceCd?.trim() || '—';
  const resourceName = input.resourceName.trim() || '—';
  return {
    primaryLine: [
      `製造order ${productNo}`,
      resourceCd,
      resourceName === resourceCd ? null : resourceName
    ].filter(Boolean).join(' / '),
    secondaryLine: [
      `更新 ${formatSelfInspectionDateTime(input.updatedAt)}`,
      input.progressLabel,
      `作業者 ${input.participantLabel}`
    ].join(' / ')
  };
}

export function presentSelfInspectionSessionRow(
  session: SelfInspectionSessionSummaryDto,
  resourceNameMap: Record<string, readonly string[] | undefined> = {}
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
  const operatorIncomplete = session.completedEntryCount < session.requiredEntryCount;
  const actions: Extract<SelfInspectionTableRow, { kind: 'session' }>['actions'] = [];
  if (operatorIncomplete) {
    actions.push({
      kind: 'link',
      href: kioskSelfInspectionSessionPath(session.id),
      label: '再開',
      tone: inspectorActive && session.completedEntryCount > 0 ? 'secondary' : 'primary'
    });
  }
  if (inspectorActive && session.completedEntryCount > 0) {
    actions.push({
      kind: 'link',
      href: kioskSelfInspectionInspectorSessionPath(session.id),
      label: '検査員測定',
      tone: operatorIncomplete ? 'secondary' : 'primary'
    });
  }
  const hasLegacyRecordApprovalAction =
    inspectorComplete &&
    Boolean(session.recordApprovalRequiredAt) &&
    session.decisionWorkflow === 'LEGACY_RECORD_APPROVAL';
  const hasFinalJudgementRecordAction =
    Boolean(session.recordApprovalRequiredAt) &&
    session.decisionWorkflow === 'INSPECTOR_FINAL_JUDGEMENT';
  if (actions.length === 0 && !session.completedAt && !hasLegacyRecordApprovalAction && !hasFinalJudgementRecordAction) {
    actions.push({
      kind: 'link',
      href: kioskSelfInspectionSessionPath(session.id),
      label: '再開',
      tone: 'primary'
    });
  }
  if (
    inspectorComplete &&
    session.recordApprovalRequiredAt &&
    session.decisionWorkflow === 'LEGACY_RECORD_APPROVAL'
  ) {
    actions.push({
      kind: 'link',
      href: KIOSK_SELF_INSPECTION_RECORD_APPROVALS_PATH,
      label: '記録確認',
      tone: 'secondary'
    });
  }
  if (session.recordApprovalRequiredAt && session.decisionWorkflow === 'INSPECTOR_FINAL_JUDGEMENT') {
    actions.push({
      kind: 'link',
      href: kioskSelfInspectionRecordConfirmationPath(session.id),
      label: '記録確認',
      tone: 'secondary'
    });
  }
  const normalizedActions: typeof actions = actions.map((action, index) => ({
    ...action,
    tone: index === Math.max(0, actions.findIndex((candidate) => candidate.tone === 'primary'))
      ? 'primary'
      : 'secondary'
  }));
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
  const resourceLabel = formatSelfInspectionResourceLabel(session.resourceCd, resourceNameMap);
  const resourceName = formatSelfInspectionResourceName(session.resourceCd, resourceNameMap);
  const participantLabel = formatSelfInspectionParticipantLabel(session.participantEmployeeNames);
  const progressLabel = inspectorActive || inspectorComplete
    ? `進捗 作業者 ${session.completedEntryCount}/${session.requiredEntryCount}件・検査員 ${session.inspectorCompletedRequiredEntryCount}/${session.inspectorRequiredEntryCount}件`
    : `進捗 ${session.completedEntryCount}/${session.requiredEntryCount}件`;
  const metadata = formatSelfInspectionMetadata({
    productNo: session.productNo,
    resourceCd: session.resourceCd,
    resourceName,
    updatedAt: session.updatedAt,
    progressLabel,
    participantLabel
  });

  return {
    kind: 'session',
    id: session.id,
    productNo: session.productNo,
    fseiban: session.fseiban,
    machineName: normalizeSelfInspectionMachineName(session.machineName),
    fhinmei: session.fhinmei,
    resourceCd: session.resourceCd,
    resourceLabel,
    updatedAt: session.updatedAt,
    statusLabel: inspectorActive
      ? inspectorComplete ? '最終判定待ち' : '検査員待ち'
      : inspectorComplete && session.recordApprovalRequiredAt
        ? '最終判定待ち'
        : selfInspectionStatusLabel(session.status),
    statusTone:
      session.status === 'review_pending' || inspectorComplete
        ? 'danger'
        : session.status === 'in_progress' || inspectorActive
          ? 'attention'
          : 'neutral',
    intentLabel: presentSelfInspectionIntent({
      status: session.status,
      inspectorActive,
      inspectorComplete,
      recordApprovalRequiredAt: session.recordApprovalRequiredAt,
      completedAt: session.completedAt
    }),
    metadataPrimaryLine: metadata.primaryLine,
    metadataSecondaryLine: metadata.secondaryLine,
    detailLine: `製番 ${session.fseiban || '—'} / 品番 ${session.fhincd || '—'} ${session.fhinmei || ''}`.trim(),
    progressLine:
      inspectorActive || inspectorComplete
        ? `氏名 ${card.participantNamesLine} / 指示数 ${session.plannedQuantity} / 作業者 ${session.completedEntryCount}/${session.requiredEntryCount}件 / 検査員 ${session.inspectorCompletedRequiredEntryCount}/${session.inspectorRequiredEntryCount}件`
        : `氏名 ${card.participantNamesLine} / 指示数 ${session.plannedQuantity} / 進捗 ${card.progressLine}`,
    invalidationTarget: { kind: 'session', sessionId: session.id },
    actions: normalizedActions
  };
}

export function presentSelfInspectionCandidateRow(
  candidate: SelfInspectionCandidateDisplaySource,
  resourceNameMap: Record<string, readonly string[] | undefined> = {}
): SelfInspectionTableRow {
  const resourceLabel = formatSelfInspectionResourceLabel(candidate.resourceCd, resourceNameMap);
  const resourceName = formatSelfInspectionResourceName(candidate.resourceCd, resourceNameMap);
  const progressLabel = candidate.status === 'in_progress'
    ? `進捗 入力中 / 指示数 ${candidate.plannedQuantity ?? '—'}`
    : `進捗 未開始 / 指示数 ${candidate.plannedQuantity ?? '—'}`;
  const metadata = formatSelfInspectionMetadata({
    productNo: candidate.productNo,
    resourceCd: candidate.resourceCd,
    resourceName,
    updatedAt: candidate.updatedAt,
    progressLabel,
    participantLabel: '—'
  });
  return {
    kind: 'candidate',
    id: candidate.id,
    productNo: candidate.productNo,
    fseiban: candidate.fseiban,
    machineName: normalizeSelfInspectionMachineName(candidate.machineName),
    fhinmei: candidate.fhinmei,
    resourceCd: candidate.resourceCd,
    resourceLabel,
    updatedAt: candidate.updatedAt,
    statusLabel: selfInspectionStatusLabel(candidate.status),
    statusTone: candidate.status === 'in_progress' ? 'attention' : 'neutral',
    intentLabel: presentSelfInspectionIntent({ status: candidate.status }),
    metadataPrimaryLine: metadata.primaryLine,
    metadataSecondaryLine: metadata.secondaryLine,
    detailLine: `製番 ${candidate.fseiban || '—'} / 品番 ${candidate.fhincd || '—'} ${candidate.fhinmei || ''}`.trim(),
    progressLine: `指示数 ${candidate.plannedQuantity ?? '—'}`,
    invalidationTarget: {
      kind: 'schedule_row',
      scheduleRowId: candidate.id,
      templateId: candidate.selfInspectionTemplateId,
      productNo: candidate.productNo,
      processGroup: candidate.processGroup,
      resourceCd: candidate.resourceCd,
      fseiban: candidate.fseiban,
      fhincd: candidate.fhincd,
      fhinmei: candidate.fhinmei
    },
    action: { kind: 'button', label: '検査方法を選択' }
  };
}
