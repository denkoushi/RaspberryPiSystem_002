import { buildSelfInspectionEntryDraft, isSelfInspectionEntryDraftDirty } from './selfInspectionEntryDraft';

import type { SelfInspectionSessionDetailDto } from './types';

export function buildSelfInspectionDraftBoundKey(
  session: SelfInspectionSessionDetailDto | undefined,
  entryIndex: number
): string | null {
  if (!session?.id) return null;
  const focused = session.focusedEntry;
  if (focused?.entryIndex === entryIndex) {
    return `${session.id}:${entryIndex}:${focused.updatedAt}`;
  }
  const entry = session.entries.find((row) => row.entryIndex === entryIndex);
  if (entry) {
    return `${session.id}:${entryIndex}:${entry.updatedAt}`;
  }
  return `${session.id}:${entryIndex}:empty`;
}

export function isSelfInspectionEntryIndexSavedOnServer(
  session: SelfInspectionSessionDetailDto,
  entryIndex: number
): boolean {
  return session.entries.some((entry) => entry.entryIndex === entryIndex);
}

export function canRebindSelfInspectionEntryDraft(input: {
  session: SelfInspectionSessionDetailDto;
  entryIndex: number;
  isPlaceholderData: boolean;
  draftValuesByEntryIndex: Record<number, Record<string, string>>;
  savedDraftByEntryIndex: Record<number, Record<string, string>>;
}): boolean {
  if (input.isPlaceholderData) return false;
  // 未保存 entry は API が focusedEntry: null を返す。保存済みは entries から baseline を組み立てる。
  // entry 切替中の誤束ねは isPlaceholderData で防ぐ。

  const draft = input.draftValuesByEntryIndex[input.entryIndex];
  const saved = input.savedDraftByEntryIndex[input.entryIndex];
  if (draft && saved) {
    return !isSelfInspectionEntryDraftDirty(input.session, input.entryIndex, draft, saved);
  }
  return true;
}

export function createSelfInspectionEntryDraftBinding(
  session: SelfInspectionSessionDetailDto,
  entryIndex: number
): {
  draft: Record<string, string>;
  saved: Record<string, string>;
  boundKey: string;
} {
  const draft = buildSelfInspectionEntryDraft(session, entryIndex);
  const boundKey = buildSelfInspectionDraftBoundKey(session, entryIndex) ?? `${session.id}:${entryIndex}:empty`;
  return {
    draft,
    saved: { ...draft },
    boundKey
  };
}

/**
 * dirty draft を上書きせず、guided 起動に必要な boundKey だけ同期する。
 * 保存後の自動遷移で以前触った未保存 entry に戻るケース向け。
 */
export function resolveSelfInspectionDraftBoundKeySyncWithoutRebind(input: {
  session: SelfInspectionSessionDetailDto;
  entryIndex: number;
  isPlaceholderData: boolean;
  draftBoundKey: string | null;
  draftValuesByEntryIndex: Record<number, Record<string, string>>;
  savedDraftByEntryIndex: Record<number, Record<string, string>>;
}): string | null {
  if (input.isPlaceholderData) return null;
  if (
    canRebindSelfInspectionEntryDraft({
      session: input.session,
      entryIndex: input.entryIndex,
      isPlaceholderData: input.isPlaceholderData,
      draftValuesByEntryIndex: input.draftValuesByEntryIndex,
      savedDraftByEntryIndex: input.savedDraftByEntryIndex
    })
  ) {
    return null;
  }
  const currentKey = buildSelfInspectionDraftBoundKey(input.session, input.entryIndex);
  if (!currentKey) return null;
  if (input.draftValuesByEntryIndex[input.entryIndex] === undefined) return null;
  if (input.draftBoundKey === currentKey) return null;
  return currentKey;
}
