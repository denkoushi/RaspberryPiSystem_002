import { buildPrefixedShelfCodes } from './buildPrefixedShelfCodes';

import type { ShelfZoneCatalog } from './shelfZoneTypes';

/** 1 ゾーンあたりのダミー棚数（本番は API / マスタに置き換え） */
const SHELVES_PER_ZONE = 18;

/**
 * 既定の棚ゾーン catalog（モック相当）。
 * ページから props で差し替え可能にし、ここへの依存を境界に閉じる。
 */
export const DEFAULT_SHELF_ZONE_CATALOG: ShelfZoneCatalog = {
  zones: [
    {
      id: 'central',
      label: '中央',
      overlayTitle: '中央エリア',
      shelfCodes: buildPrefixedShelfCodes('C', SHELVES_PER_ZONE)
    },
    {
      id: 'east',
      label: '東',
      overlayTitle: '東エリア',
      shelfCodes: buildPrefixedShelfCodes('E', SHELVES_PER_ZONE)
    },
    {
      id: 'west',
      label: '西',
      overlayTitle: '西エリア',
      shelfCodes: buildPrefixedShelfCodes('W', SHELVES_PER_ZONE)
    }
  ]
};
