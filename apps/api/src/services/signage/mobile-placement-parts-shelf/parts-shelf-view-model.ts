import type { PartsShelfZoneId } from './shelf-zone-map.js';

export type PartsShelfRowVm = {
  serial5: string;
  partName: string;
  machine10: string;
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
