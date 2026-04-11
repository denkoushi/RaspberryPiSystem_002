/**
 * 配膳スマホ（mobile-placement）機能の公開境界。
 * ページ以外から再利用する場合はここ経由で import する。
 */
export { useMobilePlacementPageState } from './useMobilePlacementPageState';
export type { MobilePlacementScanField, SlipColumnVariant } from './types';
export { MOBILE_PLACEMENT_TEMP_SHELVES, MP_PLACEHOLDER_ORDER, MP_PLACEHOLDER_PART } from './constants';
