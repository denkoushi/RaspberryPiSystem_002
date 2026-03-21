import { useEffect } from 'react';

import { useTimedHoverReveal } from './useTimedHoverReveal';

export type KioskTopEdgeHeaderRevealHandlers = {
  isVisible: boolean;
  onHotZoneEnter: () => void;
  onHeaderMouseEnter: () => void;
  onHeaderMouseLeave: () => void;
};

/**
 * 沉浸式キオスク（`usesKioskImmersiveLayout` が true のルート）で最上段ヘッダーを既定非表示にし、上端ホバーで表示する。
 * マウス操作前提（タッチは未対応）。
 */
export function useKioskTopEdgeHeaderReveal(enabled: boolean): KioskTopEdgeHeaderRevealHandlers {
  const { open, ...handlers } = useTimedHoverReveal(enabled);

  useEffect(() => {
    if (!enabled) return;

    const onMove = (e: MouseEvent) => {
      if (e.clientY < 14) {
        open();
      }
    };
    window.addEventListener('mousemove', onMove);
    return () => window.removeEventListener('mousemove', onMove);
  }, [enabled, open]);

  return handlers;
}
