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

/** 番号の上限 */
export const SHELF_SLOT_MAX = 99;
