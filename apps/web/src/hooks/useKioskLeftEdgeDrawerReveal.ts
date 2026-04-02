import { useEffect } from 'react';

import { useTimedHoverReveal } from './useTimedHoverReveal';

/** 上端ホバー（`useKioskTopEdgeHeaderReveal` の `clientY < 14`）と同じ 14px 帯を左端に適用 */
const LEFT_EDGE_HOT_PX = 14;

export type KioskLeftEdgeDrawerRevealHandlers = {
  isVisible: boolean;
  onHotZoneEnter: () => void;
  onDrawerMouseEnter: () => void;
  onDrawerMouseLeave: () => void;
};

/**
 * キオスク左ドロワー: 画面左端 14px 以内の mousemove で開き、パネル leave で遅延閉じる（`useTimedHoverReveal` と同型）。
 */
export function useKioskLeftEdgeDrawerReveal(enabled: boolean): KioskLeftEdgeDrawerRevealHandlers {
  const { open, isVisible, onHotZoneEnter, onHeaderMouseEnter, onHeaderMouseLeave } =
    useTimedHoverReveal(enabled);

  useEffect(() => {
    if (!enabled) return;

    const onMove = (e: MouseEvent) => {
      if (e.clientX < LEFT_EDGE_HOT_PX) {
        open();
      }
    };
    window.addEventListener('mousemove', onMove);
    return () => window.removeEventListener('mousemove', onMove);
  }, [enabled, open]);

  return {
    isVisible,
    onHotZoneEnter,
    onDrawerMouseEnter: onHeaderMouseEnter,
    onDrawerMouseLeave: onHeaderMouseLeave
  };
}
