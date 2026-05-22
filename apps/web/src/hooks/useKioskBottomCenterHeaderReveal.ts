import { BOTTOM_CENTER_KIOSK_HEADER_REVEAL_HOT_ZONE } from '../features/kiosk/kioskHeaderRevealHotZone';

import { useKioskEdgeHeaderReveal, type KioskEdgeHeaderRevealHandlers } from './useKioskEdgeHeaderReveal';

export type KioskBottomCenterHeaderRevealHandlers = KioskEdgeHeaderRevealHandlers;

/** 下端・中央1/3 ホットゾーン（キオスク沉浸式ヘッダー現行正本）。 */
export const BOTTOM_CENTER_KIOSK_HEADER_REVEAL_CONFIG = BOTTOM_CENTER_KIOSK_HEADER_REVEAL_HOT_ZONE;

/**
 * 沉浸式キオスクで最下段ヘッダーを既定非表示にし、下辺中央1/3ホバーで下から表示する。
 */
export function useKioskBottomCenterHeaderReveal(
  enabled: boolean
): KioskBottomCenterHeaderRevealHandlers {
  return useKioskEdgeHeaderReveal(enabled, BOTTOM_CENTER_KIOSK_HEADER_REVEAL_CONFIG);
}
