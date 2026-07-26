import { BOTTOM_RIGHT_KIOSK_HEADER_REVEAL_HOT_ZONE } from '../features/kiosk/kioskHeaderRevealHotZone';

import { useKioskEdgeHeaderReveal, type KioskEdgeHeaderRevealHandlers } from './useKioskEdgeHeaderReveal';

export type KioskBottomRightHeaderRevealHandlers = KioskEdgeHeaderRevealHandlers;

/** 右下24×24pxホットゾーン（キオスク沉浸式ヘッダー現行正本）。 */
export const BOTTOM_RIGHT_KIOSK_HEADER_REVEAL_CONFIG = BOTTOM_RIGHT_KIOSK_HEADER_REVEAL_HOT_ZONE;

/**
 * 沉浸式キオスクで最下段ヘッダーを既定非表示にし、右下24×24pxホバーで下から表示する。
 */
export function useKioskBottomRightHeaderReveal(
  enabled: boolean
): KioskBottomRightHeaderRevealHandlers {
  return useKioskEdgeHeaderReveal(enabled, BOTTOM_RIGHT_KIOSK_HEADER_REVEAL_CONFIG);
}
