import type { RegisteredShelfEntryDto } from './types';
import type { ShelfAreaId, ShelfLineId } from '../shelfSelection/shelfSelectionTypes';


/**
 * エリア・列が揃ったとき、構造化棚番のみを絞り込む。
 * 非構造化（例: TEMP-A）は返さない（呼び出し側で「その他」表示に回す）。
 */
export function filterStructuredShelvesByAreaLine(
  shelves: readonly RegisteredShelfEntryDto[],
  areaId: ShelfAreaId,
  lineId: ShelfLineId
): RegisteredShelfEntryDto[] {
  return shelves.filter(
    (s) =>
      s.isStructured === true &&
      s.areaId === areaId &&
      s.lineId === lineId &&
      typeof s.slot === 'number'
  );
}

export function listUnstructuredShelves(shelves: readonly RegisteredShelfEntryDto[]): RegisteredShelfEntryDto[] {
  return shelves.filter((s) => !s.isStructured);
}
