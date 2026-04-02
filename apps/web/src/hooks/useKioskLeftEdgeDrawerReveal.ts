import { useCallback, useEffect, useMemo } from 'react';

import { useTimedHoverReveal } from './useTimedHoverReveal';

/** 上端ホバー（`useKioskTopEdgeHeaderReveal` の `clientY < 14`）と同じ 14px 帯を左端に適用 */
export const KIOSK_LEFT_EDGE_HOT_ZONE_PX = 14;

const LEFT_EDGE_HOT_PX = KIOSK_LEFT_EDGE_HOT_ZONE_PX;

export type KioskLeftEdgeDrawerRevealOptions = {
  /** true の間はホバーに依存せずドロワーを展開（詳細シート表示中のタッチ／カレンダー操作向け） */
  keepOpen?: boolean;
};

export type KioskLeftEdgeDrawerRevealHandlers = {
  isVisible: boolean;
  onHotZoneEnter: () => void;
  onDrawerMouseEnter: () => void;
  onDrawerMouseLeave: () => void;
};

/**
 * キオスク左ドロワー: 画面左端 14px 以内の mousemove で開き、パネル leave で遅延閉じる（`useTimedHoverReveal` と同型）。
 * `keepOpen` 時は leave しても閉じない（第2シート操作中に第1列が閉じるのを防ぐ）。
 */
export function useKioskLeftEdgeDrawerReveal(
  enabled: boolean,
  options?: KioskLeftEdgeDrawerRevealOptions
): KioskLeftEdgeDrawerRevealHandlers {
  const keepOpen = options?.keepOpen ?? false;
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

  const onDrawerMouseLeave = useCallback(() => {
    if (keepOpen) return;
    onHeaderMouseLeave();
  }, [keepOpen, onHeaderMouseLeave]);

  const effectiveVisible = useMemo(() => keepOpen || isVisible, [keepOpen, isVisible]);

  return {
    isVisible: effectiveVisible,
    onHotZoneEnter,
    onDrawerMouseEnter: onHeaderMouseEnter,
    onDrawerMouseLeave
  };
}
