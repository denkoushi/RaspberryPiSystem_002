/**
 * GET /api/mobile-placement/registered-shelves の `shelves[]` 要素（サーバ契約と一致）
 */
export type RegisteredShelfEntryDto = {
  shelfCodeRaw: string;
  isStructured: boolean;
  areaId?: 'west' | 'central' | 'east';
  lineId?: 'north' | 'central' | 'south';
  slot?: number;
};
