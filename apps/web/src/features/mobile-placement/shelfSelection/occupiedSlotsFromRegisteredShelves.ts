import type { ShelfAreaId, ShelfLineId } from './shelfSelectionTypes';
import type { RegisteredShelfEntryDto } from '../registeredShelves/types';

/**
 * 登録済み棚一覧から、指定セル（エリア×列）で既に使われている番号スロットを返す。
 */
export function getOccupiedSlotsForRegisteredShelves(
  shelves: readonly RegisteredShelfEntryDto[],
  areaId: ShelfAreaId,
  lineId: ShelfLineId
): Set<number> {
  const set = new Set<number>();
  for (const s of shelves) {
    if (s.isStructured && s.areaId === areaId && s.lineId === lineId && typeof s.slot === 'number') {
      set.add(s.slot);
    }
  }
  return set;
}
