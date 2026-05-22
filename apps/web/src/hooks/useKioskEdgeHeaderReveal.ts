import { useCallback, useEffect, useRef } from 'react';

import {
  isPointerInKioskHeaderRevealHotZone,
  type KioskHeaderRevealHotZoneConfig
} from '../features/kiosk/kioskHeaderRevealHotZone';

import { useTimedHoverReveal } from './useTimedHoverReveal';

export type KioskEdgeHeaderRevealHandlers = {
  isVisible: boolean;
  onHotZoneEnter: () => void;
  onHeaderMouseEnter: () => void;
  onHeaderMouseLeave: () => void;
};

/**
 * 沉浸式キオスクヘッダー: エッジホットゾーン + window mousemove で開き、leave 後に遅延で閉じる。
 * マウス操作前提（タッチは未対応）。
 */
export function useKioskEdgeHeaderReveal(
  enabled: boolean,
  hotZone: KioskHeaderRevealHotZoneConfig
): KioskEdgeHeaderRevealHandlers {
  const { open, isVisible, onHeaderMouseEnter: keepHeaderHoverOpen, ...handlers } =
    useTimedHoverReveal(enabled);
  const hotZoneRef = useRef(hotZone);
  hotZoneRef.current = hotZone;

  const onHeaderMouseEnter = useCallback(() => {
    if (!enabled || !isVisible) return;
    keepHeaderHoverOpen();
  }, [enabled, isVisible, keepHeaderHoverOpen]);

  useEffect(() => {
    if (!enabled) return;

    const onMove = (e: MouseEvent) => {
      const hit = isPointerInKioskHeaderRevealHotZone({
        clientX: e.clientX,
        clientY: e.clientY,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        ...hotZoneRef.current
      });
      // 開くのはホットゾーン命中時のみ（ヘッダー全幅の mouseenter では開かない）
      if (hit) {
        open();
      }
    };
    window.addEventListener('mousemove', onMove, { passive: true });
    return () => window.removeEventListener('mousemove', onMove);
  }, [enabled, open]);

  return { ...handlers, isVisible, onHeaderMouseEnter };
}
