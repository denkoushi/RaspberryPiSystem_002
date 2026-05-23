import type { PartsShelfZoneId } from './shelf-zone-map.js';

export type PartsShelfRowVm = {
  serial5: string;
  partName: string;
  machine10: string;
  /** 棚表示名（MobilePlacementShelf.displayLabel） */
  displayLabel: string | null;
  /** 正本棚 ID */
  shelfCodeRaw: string;
};

export type PartsShelfZoneVm = {
  zoneId: PartsShelfZoneId;
  dirLabel: string;
  rows: PartsShelfRowVm[];
  totalCount: number;
  omittedCount: number;
};

export type PartsShelfGridViewModel = {
  zones: PartsShelfZoneVm[];
};
