import { statusForPoint, templateItemToDrawingPoint } from './inspection-drawing';

import type { SelfInspectionSessionDetailDto } from './types';

/** 選択中の入力件だけドラフトを組み立てる（全件一括生成を避ける） */
export function buildSelfInspectionEntryDraft(
  session: SelfInspectionSessionDetailDto,
  entryIndex: number
): Record<string, string> {
  const valueSource =
    session.focusedEntry?.entryIndex === entryIndex
      ? session.focusedEntry
      : session.entries.find((entry) => entry.entryIndex === entryIndex && entry.values.length > 0)
        ? session.entries.find((entry) => entry.entryIndex === entryIndex)
        : null;
  return Object.fromEntries(
    session.template.items.map((item) => {
      const existingValue =
        valueSource?.values.find((value) => value.templateItemId === item.id)?.value ?? '';
      return [item.id, existingValue ?? ''];
    })
  );
}

export function areSelfInspectionEntryDraftsEqual(
  left: Record<string, string>,
  right: Record<string, string>,
  templateItemIds: string[]
): boolean {
  return templateItemIds.every((itemId) => (left[itemId] ?? '').trim() === (right[itemId] ?? '').trim());
}

/** 画面上のドラフトが、最後に保存した内容（またはサーバー取得時の初期値）と異なるか */
export function isSelfInspectionEntryDraftDirty(
  session: SelfInspectionSessionDetailDto,
  entryIndex: number,
  draft: Record<string, string>,
  savedDraft?: Record<string, string>
): boolean {
  const templateItemIds = session.template.items.map((item) => item.id);
  const baseline = savedDraft ?? buildSelfInspectionEntryDraft(session, entryIndex);
  return !areSelfInspectionEntryDraftsEqual(draft, baseline, templateItemIds);
}

export function listDirtySelfInspectionEntryIndices(
  session: SelfInspectionSessionDetailDto,
  draftsByEntryIndex: Record<number, Record<string, string>>,
  savedDraftsByEntryIndex: Record<number, Record<string, string>>
): number[] {
  return Object.keys(draftsByEntryIndex)
    .map((key) => Number(key))
    .filter((entryIndex) => {
      const draft = draftsByEntryIndex[entryIndex];
      if (!draft) return false;
      return isSelfInspectionEntryDraftDirty(session, entryIndex, draft, savedDraftsByEntryIndex[entryIndex]);
    })
    .sort((left, right) => left - right);
}

export function selfInspectionEntryDraftHasNg(
  session: SelfInspectionSessionDetailDto,
  draft: Record<string, string>
): boolean {
  return session.template.items.some((item) => {
    const point = templateItemToDrawingPoint(item, draft[item.id] ?? '');
    return statusForPoint(point.testValue, point.lower, point.upper) === 'ng';
  });
}

export const SELF_INSPECTION_ENTRY_INDEX_PAGE_SIZE = 48;

export function selfInspectionEntryPageCount(expectedEntryCount: number): number {
  return Math.max(1, Math.ceil(expectedEntryCount / SELF_INSPECTION_ENTRY_INDEX_PAGE_SIZE));
}

export function selfInspectionEntryIndicesForPage(expectedEntryCount: number, page: number): number[] {
  const pageCount = selfInspectionEntryPageCount(expectedEntryCount);
  const safePage = Math.min(Math.max(0, page), pageCount - 1);
  const start = safePage * SELF_INSPECTION_ENTRY_INDEX_PAGE_SIZE;
  const end = Math.min(expectedEntryCount, start + SELF_INSPECTION_ENTRY_INDEX_PAGE_SIZE);
  return Array.from({ length: Math.max(0, end - start) }, (_, offset) => start + offset);
}
