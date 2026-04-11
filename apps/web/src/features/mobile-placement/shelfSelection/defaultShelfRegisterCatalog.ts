import type { ShelfAreaId, ShelfAxisOption, ShelfLineId } from './shelfSelectionTypes';

/** エリア（西・中央・東） */
export const SHELF_AREA_OPTIONS: readonly ShelfAxisOption<ShelfAreaId>[] = [
  { id: 'west', label: '西' },
  { id: 'central', label: '中央' },
  { id: 'east', label: '東' }
];

/** 列（北・中央・南） */
export const SHELF_LINE_OPTIONS: readonly ShelfAxisOption<ShelfLineId>[] = [
  { id: 'north', label: '北' },
  { id: 'central', label: '中央' },
  { id: 'south', label: '南' }
];

/** 番号の上限（本番はマスタ/API に置き換え） */
export const SHELF_SLOT_MAX = 99;

/**
 * 使用済み番号（ダミー）。本番は API から取得。
 * キー: `${areaId}:${lineId}`
 */
export function getOccupiedSlotsForCell(areaId: ShelfAreaId, lineId: ShelfLineId): readonly number[] {
  const key = `${areaId}:${lineId}`;
  const mock: Record<string, number[]> = {
    'west:north': [3, 7, 11, 14],
    'west:central': [5],
    'west:south': [],
    'central:north': [1],
    'central:central': [2, 4],
    'central:south': [],
    'east:north': [],
    'east:central': [8],
    'east:south': [9, 10]
  };
  return mock[key] ?? [];
}
