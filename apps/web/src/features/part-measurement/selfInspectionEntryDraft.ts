import { statusForPoint, templateItemToDrawingPoint } from './inspection-drawing';
import { toleranceBoundsFromPoint } from './inspection-drawing/markerNumbering';
import { listSelfInspectionEntrySlots } from './selfInspectionEntrySlots';

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
    const bounds = toleranceBoundsFromPoint(point);
    if ('error' in bounds) return true;
    return statusForPoint(point.testValue, bounds.lowerLimit, bounds.upperLimit) === 'ng';
  });
}

export const SELF_INSPECTION_ENTRY_INDEX_PAGE_SIZE = 48;

export function selfInspectionEntryPageCount(slots: { entryIndex: number }[]): number {
  return Math.max(1, Math.ceil(slots.length / SELF_INSPECTION_ENTRY_INDEX_PAGE_SIZE));
}

export function selfInspectionEntryPageCountForSession(
  session: Pick<
    SelfInspectionSessionDetailDto,
    'selfInspectionMode' | 'plannedQuantity' | 'expectedEntryCount' | 'requiredEntryCount'
  >
): number {
  return selfInspectionEntryPageCount(listSelfInspectionEntrySlots(session));
}

export function selfInspectionEntrySlotsForPage(
  session: SelfInspectionSessionDetailDto,
  page: number
): ReturnType<typeof listSelfInspectionEntrySlots> {
  const slots = listSelfInspectionEntrySlots(session);
  const pageCount = selfInspectionEntryPageCount(slots);
  const safePage = Math.min(Math.max(0, page), pageCount - 1);
  const start = safePage * SELF_INSPECTION_ENTRY_INDEX_PAGE_SIZE;
  return slots.slice(start, start + SELF_INSPECTION_ENTRY_INDEX_PAGE_SIZE);
}

/** slot 配列上の位置からページ番号を求める（first_last の last など entryIndex が大きい場合用） */
export function selfInspectionEntryPageForEntryIndex(
  session: Pick<
    SelfInspectionSessionDetailDto,
    'selfInspectionMode' | 'plannedQuantity' | 'expectedEntryCount' | 'requiredEntryCount'
  >,
  entryIndex: number
): number {
  const slots = listSelfInspectionEntrySlots(session);
  const slotIndex = slots.findIndex((slot) => slot.entryIndex === entryIndex);
  if (slotIndex < 0) return 0;
  return Math.floor(slotIndex / SELF_INSPECTION_ENTRY_INDEX_PAGE_SIZE);
}
