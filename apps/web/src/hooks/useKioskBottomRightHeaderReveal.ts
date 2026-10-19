import { BOTTOM_RIGHT_KIOSK_HEADER_REVEAL_HOT_ZONE } from '../features/kiosk/kioskHeaderRevealHotZone';

import { useKioskEdgeHeaderReveal, type KioskEdgeHeaderRevealHandlers } from './useKioskEdgeHeaderReveal';

import type { TimedHoverRevealCloseReason } from './useTimedHoverReveal';

export type KioskBottomRightHeaderRevealHandlers = KioskEdgeHeaderRevealHandlers;

/** 右下24×24pxホットゾーン（全キオスクルート共通）。 */
export const BOTTOM_RIGHT_KIOSK_HEADER_REVEAL_CONFIG = BOTTOM_RIGHT_KIOSK_HEADER_REVEAL_HOT_ZONE;

/**
 * 全キオスクルートで下辺ドックを既定非表示にし、右下24×24pxホバーで下から表示する。
 */
export function useKioskBottomRightHeaderReveal(
  enabled: boolean,
  canClose?: (reason: TimedHoverRevealCloseReason) => boolean
): KioskBottomRightHeaderRevealHandlers {
  return useKioskEdgeHeaderReveal(enabled, BOTTOM_RIGHT_KIOSK_HEADER_REVEAL_CONFIG, canClose);
}
