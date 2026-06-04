import {
  isSelfInspectionEntryDraftDirty,
  listDirtySelfInspectionEntryIndices
} from './selfInspectionEntryDraft';
import {
  areRequiredSelfInspectionSlotsFilled,
  listSelfInspectionEntrySlots
} from './selfInspectionEntrySlots';
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
  | 'unsaved_changes'
  | 'already_guided'
  | 'no_pending_points_unsaved'
  | 'no_pending_points_saved'
  | 'canvas_not_ready';

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
  draft: Record<string, string>
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
  if (context.isSavingEntry) return disabledState('saving');
  if (context.isCompletingSession) return disabledState('completing');

  const draft = context.draftValuesByEntryIndex[context.selectedEntryIndex];
  if (!draft) return disabledState('incomplete_values');

  if (
    !isSelfInspectionEntryDraftDirty(
      context.session,
      context.selectedEntryIndex,
      draft,
      context.savedDraftByEntryIndex[context.selectedEntryIndex]
    )
  ) {
    return disabledState('no_changes');
  }

  const draftBlockReason = resolveCurrentEntryDraftSaveBlockReason(context.session, draft);
  if (draftBlockReason) return disabledState(draftBlockReason);

  return enabledState();
}

export function resolveSelfInspectionCompleteActionState(
  context: SelfInspectionSessionActionContext
): SelfInspectionActionState {
  if (context.isSessionReadOnly) return disabledState('read_only');
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
  if (context.isSavingEntry) return disabledState('saving');
  if (context.isCompletingSession) return disabledState('completing');
  if (!context.isDrawingCanvasReady || !context.guideActionsEnabled) {
    return disabledState('canvas_not_ready');
  }
  if (context.guideMode === 'guided') return disabledState('already_guided');

  const draft = context.draftValuesByEntryIndex[context.selectedEntryIndex];
  if (!draft) return disabledState('no_pending_points_saved');

  const points = buildEntryDrawingPoints(context.session, draft);
  const pendingPointId = findFirstPendingPointId(points, context.session.template.items);
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

/** 完了ボタン用: 不足している required slot 件数（補助表示） */
export function countMissingRequiredSelfInspectionSlots(session: SelfInspectionSessionDetailDto): number {
  const required = listSelfInspectionEntrySlots(session);
  const present = new Set(session.entries.map((entry) => entry.entryIndex));
  return required.filter((slot) => !present.has(slot.entryIndex)).length;
}
