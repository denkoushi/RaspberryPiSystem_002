import {
  isSelfInspectionEntryDraftDirty,
  listDirtySelfInspectionEntryIndices
} from './selfInspectionEntryDraft';
import { isSelfInspectionSavedEntryRegistrationComplete } from './selfInspectionEntryRegistration';
import { areRequiredSelfInspectionSlotsFilled, listSelfInspectionEntrySlots } from './selfInspectionEntrySlots';
import {
  buildEntryDrawingPoints,
  findFirstPendingPointId,
  resolvePointInputStatus,
  type SelfInspectionGuideMode
} from './selfInspectionGuidedFocus';

import type { SelfInspectionSessionDetailDto } from './types';

export type SelfInspectionActionReason =
  | 'read_only'
  | 'saving'
  | 'completing'
  | 'no_changes'
  | 'incomplete_values'
  | 'invalid_value'
  | 'ng_value'
  | 'tolerance_error'
  | 'missing_required_entries'
  | 'pending_review'
  | 'record_approval_required'
  | 'unsaved_changes'
  | 'already_guided'
  | 'no_pending_points_unsaved'
  | 'no_pending_points_saved'
  | 'missing_employee_registration'
  | 'missing_registration'
  | 'incomplete_employee_registration'
  | 'incomplete_registration'
  | 'canvas_not_ready'
  | 'session_employee_gate';

export type SelfInspectionActionState = {
  enabled: boolean;
  reason: SelfInspectionActionReason | null;
};

export type SelfInspectionSessionActionContext = {
  session: SelfInspectionSessionDetailDto;
  selectedEntryIndex: number;
  draftValuesByEntryIndex: Record<number, Record<string, string>>;
  savedDraftByEntryIndex: Record<number, Record<string, string>>;
  isSessionReadOnly: boolean;
  isSavingEntry: boolean;
  isCompletingSession: boolean;
  isDrawingCanvasReady: boolean;
  guideMode: SelfInspectionGuideMode;
  guideActionsEnabled: boolean;
  entryRegistrationReady: boolean;
  entryRegistrationDirty: boolean;
  requireMeasuringInstrumentTag: boolean;
  sessionEmployeeGateReady: boolean;
  outOfToleranceAcknowledgedByEntryIndex?: Record<number, Record<string, boolean>>;
};

function disabledState(reason: SelfInspectionActionReason): SelfInspectionActionState {
  return { enabled: false, reason };
}

function enabledState(): SelfInspectionActionState {
  return { enabled: true, reason: null };
}

/** 現在入力件ドラフトの保存ブロック理由（測定点単位・優先順固定） */
export function resolveCurrentEntryDraftSaveBlockReason(
  session: SelfInspectionSessionDetailDto,
  draft: Record<string, string>,
  outOfToleranceAcknowledgedByPointId: Record<string, boolean> = {}
): SelfInspectionActionReason | null {
  const points = buildEntryDrawingPoints(session, draft);
  let hasEmpty = false;
  let hasInvalid = false;
  let hasNg = false;
  let hasToleranceError = false;

  for (const point of points) {
    const status = resolvePointInputStatus(point);
    if (status === 'ok') continue;
    if (status === 'empty') {
      hasEmpty = true;
      continue;
    }
    if (status === 'invalid') {
      hasInvalid = true;
      continue;
    }
    if (status === 'ng') {
      if (point.valueKind === 'judgement') {
        continue;
      }
      if (outOfToleranceAcknowledgedByPointId[point.id] === true) {
        continue;
      }
      hasNg = true;
      continue;
    }
    if (status === 'tolerance_error') {
      hasToleranceError = true;
    }
  }

  if (hasToleranceError) return 'tolerance_error';
  if (hasNg) return 'ng_value';
  if (hasInvalid) return 'invalid_value';
  if (hasEmpty) return 'incomplete_values';
  return null;
}

/** セッション内に未保存ドラフトがあるか（リセット警告・完了判定と共有） */
export function hasDirtySelfInspectionDrafts(
  session: SelfInspectionSessionDetailDto,
  draftValuesByEntryIndex: Record<number, Record<string, string>>,
  savedDraftByEntryIndex: Record<number, Record<string, string>>
): boolean {
  return (
    listDirtySelfInspectionEntryIndices(session, draftValuesByEntryIndex, savedDraftByEntryIndex).length > 0
  );
}

export function resolveSelfInspectionSaveActionState(
  context: SelfInspectionSessionActionContext
): SelfInspectionActionState {
  if (context.isSessionReadOnly) return disabledState('read_only');
  if (!context.sessionEmployeeGateReady) return disabledState('session_employee_gate');
  if (context.isSavingEntry) return disabledState('saving');
  if (context.isCompletingSession) return disabledState('completing');

  const draft = context.draftValuesByEntryIndex[context.selectedEntryIndex];
  if (!draft) return disabledState('incomplete_values');

  const valuesDirty = isSelfInspectionEntryDraftDirty(
    context.session,
    context.selectedEntryIndex,
    draft,
    context.savedDraftByEntryIndex[context.selectedEntryIndex]
  );

  if (!valuesDirty && !context.entryRegistrationDirty) {
    return disabledState('no_changes');
  }

  const draftBlockReason = resolveCurrentEntryDraftSaveBlockReason(
    context.session,
    draft,
    context.outOfToleranceAcknowledgedByEntryIndex?.[context.selectedEntryIndex] ?? {}
  );
  if (draftBlockReason) return disabledState(draftBlockReason);

  if (!context.entryRegistrationReady) {
    return disabledState(context.requireMeasuringInstrumentTag ? 'missing_registration' : 'missing_employee_registration');
  }

  return enabledState();
}

export function resolveSelfInspectionCompleteActionState(
  context: SelfInspectionSessionActionContext
): SelfInspectionActionState {
  if (context.isSessionReadOnly) return disabledState('read_only');
  if (!context.sessionEmployeeGateReady) return disabledState('session_employee_gate');
  if (context.isSavingEntry) return disabledState('saving');
  if (context.isCompletingSession) return disabledState('completing');

  if (
    hasDirtySelfInspectionDrafts(
      context.session,
      context.draftValuesByEntryIndex,
      context.savedDraftByEntryIndex
    )
  ) {
    return disabledState('unsaved_changes');
  }

  if (!areRequiredSelfInspectionSlotsFilled(context.session)) {
    return disabledState('missing_required_entries');
  }

  const requiredSlots = listSelfInspectionEntrySlots(context.session);
  for (const slot of requiredSlots) {
    const saved = context.session.entries.find(
      (entry) => entry.entryIndex === slot.entryIndex && entry.persistenceStatus !== 'draft'
    );
    if (
      !saved ||
      !isSelfInspectionSavedEntryRegistrationComplete(saved, {
        requireMeasuringInstrumentTag: context.requireMeasuringInstrumentTag
      })
    ) {
      return disabledState(
        context.requireMeasuringInstrumentTag ? 'incomplete_registration' : 'incomplete_employee_registration'
      );
    }
  }

  if (context.session.recordApprovalRequiredAt && !context.session.recordApproval) {
    return disabledState('record_approval_required');
  }

  if (context.session.pendingReviewCount > 0) {
    return disabledState('pending_review');
  }

  return enabledState();
}

function resolveNoPendingPointsResumeReason(
  context: SelfInspectionSessionActionContext,
  draft: Record<string, string>
): SelfInspectionActionReason {
  const isDirty = isSelfInspectionEntryDraftDirty(
    context.session,
    context.selectedEntryIndex,
    draft,
    context.savedDraftByEntryIndex[context.selectedEntryIndex]
  );
  return isDirty ? 'no_pending_points_unsaved' : 'no_pending_points_saved';
}

export function resolveSelfInspectionResumeGuideActionState(
  context: SelfInspectionSessionActionContext
): SelfInspectionActionState {
  if (context.isSessionReadOnly) return disabledState('read_only');
  if (!context.sessionEmployeeGateReady) return disabledState('session_employee_gate');
  if (context.isSavingEntry) return disabledState('saving');
  if (context.isCompletingSession) return disabledState('completing');
  if (!context.isDrawingCanvasReady || !context.guideActionsEnabled) {
    return disabledState('canvas_not_ready');
  }
  if (context.guideMode === 'guided') return disabledState('already_guided');

  const draft = context.draftValuesByEntryIndex[context.selectedEntryIndex];
  if (!draft) return disabledState('no_pending_points_saved');

  const points = buildEntryDrawingPoints(context.session, draft);
  const pendingPointId = findFirstPendingPointId(
    points,
    context.session.template.items,
    context.outOfToleranceAcknowledgedByEntryIndex?.[context.selectedEntryIndex] ?? {}
  );
  if (!pendingPointId) {
    return disabledState(resolveNoPendingPointsResumeReason(context, draft));
  }

  return enabledState();
}

export function selfInspectionActionReasonMessage(
  reason: SelfInspectionActionReason | null
): string | null {
  switch (reason) {
    case 'read_only':
      return 'このセッションは読み取り専用です。';
    case 'saving':
      return '保存処理中です。';
    case 'completing':
      return '完了処理中です。';
    case 'session_employee_gate':
      return '氏名NFCタグをスキャンするまで測定できません。';
    case 'no_changes':
      return '保存する変更がありません。';
    case 'incomplete_values':
      return '未入力の測定点があります。すべて入力してから保存してください。';
    case 'invalid_value':
      return '不正な測定値があります。修正してから保存してください。';
    case 'ng_value':
      return '公差外の測定値があるため保存できません。';
    case 'tolerance_error':
      return '基準・公差が未設定の測定点があります。';
    case 'missing_required_entries':
      return '必要な入力件がすべて保存されていません。各入力件を保存してください。';
    case 'pending_review':
      return '公差外の測定値が現場リーダー承認待ちです。';
    case 'record_approval_required':
      return '検査記録確認画面で承認すると自主検査が完了します。';
    case 'missing_employee_registration':
      return '測定者のNFC登録が必要です。';
    case 'missing_registration':
      return '測定者と計測機器の使用前点検が必要です。';
    case 'incomplete_employee_registration':
      return '未登録の測定者がある入力件があります。';
    case 'incomplete_registration':
      return '測定者または計測機器の使用前点検が不足している入力件があります。';
    case 'unsaved_changes':
      return '未保存の入力があります。「入力を保存」してから完了してください。';
    case 'already_guided':
      return 'ガイド稼働中です。手動操作後に再開できます。';
    case 'no_pending_points_unsaved':
      return '未保存の入力があります。「入力を保存」してから再開できます。';
    case 'no_pending_points_saved':
      return 'この入力件に未完了の測定点はありません。';
    case 'canvas_not_ready':
      return '図面の準備ができていません。';
    default:
      return null;
  }
}
