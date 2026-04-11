/**
 * 配膳スマホ（mobile-placement）機能の公開境界。
 * ページ以外から再利用する場合はここ経由で import する。
 */
export { useMobilePlacementPageState } from './useMobilePlacementPageState';
export type { MobilePlacementScanField, SlipColumnVariant } from './types';
export { MP_PLACEHOLDER_ORDER, MP_PLACEHOLDER_PART } from './constants';
export type { ShelfZoneCatalog, ShelfZoneDefinition, ShelfZoneId } from './shelfZones';
export { DEFAULT_SHELF_ZONE_CATALOG, buildPrefixedShelfCodes, flattenShelfCodes } from './shelfZones';
