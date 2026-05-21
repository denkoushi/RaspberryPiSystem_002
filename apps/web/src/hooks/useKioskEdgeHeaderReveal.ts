import { useEffect, useRef } from 'react';

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
  const { open, ...handlers } = useTimedHoverReveal(enabled);
  const hotZoneRef = useRef(hotZone);
  hotZoneRef.current = hotZone;

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
      if (hit) {
        open();
      }
    };
    window.addEventListener('mousemove', onMove);
    return () => window.removeEventListener('mousemove', onMove);
  }, [enabled, open]);

  return handlers;
}
