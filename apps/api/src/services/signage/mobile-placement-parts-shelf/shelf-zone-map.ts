import type { RegisteredShelfEntry } from '../../mobile-placement/mobile-placement-registered-shelves.service.js';

export type PartsShelfZoneId =
  | 'nw'
  | 'n'
  | 'ne'
  | 'w'
  | 'c'
  | 'e'
  | 'sw'
  | 's'
  | 'se';

/** 棚ゾーンの表示ラベル（プレビューHTMLと同一の言い回し） */
export const PARTS_SHELF_ZONE_DIR_LABEL: Record<PartsShelfZoneId, string> = {
  nw: '北・西',
  n: '北・中央',
  ne: '北・東',
  w: '中央・西',
  c: '中央・中央',
  e: '中央・東',
  sw: '南・西',
  s: '南・中央',
  se: '南・東',
};

/**
 * `parseStructuredShelfCode` の areaId / lineId から 3×3 のゾーンIDへ。
 * 構造化できない棚は null。
 */
export function shelfEntryToZoneId(entry: Omit<RegisteredShelfEntry, 'shelfCodeRaw'>): PartsShelfZoneId | null {
  if (!entry.isStructured || !entry.areaId || !entry.lineId) {
    return null;
  }
  const { areaId, lineId } = entry;
  if (areaId === 'west' && lineId === 'north') return 'nw';
  if (areaId === 'central' && lineId === 'north') return 'n';
  if (areaId === 'east' && lineId === 'north') return 'ne';
  if (areaId === 'west' && lineId === 'central') return 'w';
  if (areaId === 'central' && lineId === 'central') return 'c';
  if (areaId === 'east' && lineId === 'central') return 'e';
  if (areaId === 'west' && lineId === 'south') return 'sw';
  if (areaId === 'central' && lineId === 'south') return 's';
  if (areaId === 'east' && lineId === 'south') return 'se';
  return null;
}
