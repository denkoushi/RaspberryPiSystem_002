/**
 * GET /api/mobile-placement/registered-shelves の `shelves[]` 要素（サーバ契約と一致）
 */
export type RegisteredShelfEntryDto = {
  shelfCodeRaw: string;
  isStructured: boolean;
  machineName?: string;
  direction?: '東' | '西' | '南' | '北';
  areaId?: 'west' | 'central' | 'east';
  lineId?: 'north' | 'central' | 'south';
  slot?: number;
  tier?: number;
  displayLabel?: string | null;
  photoUpdatedAt?: string | null;
  macroZoneId?: string | null;
};
