import { useEffect, useState, type RefObject } from 'react';

const roundHeightPx = (value: number): number => Math.max(0, Math.round(value));

/**
 * 資源カード本文（スクロール親）の利用可能高さを観測する。
 * ResizeObserver 未定義時は初回 layout の clientHeight にフォールバックする。
 */
export function useLeaderBoardGanttBodyHeight(
  elementRef: RefObject<HTMLElement | null>,
  enabled: boolean
): number {
  const [heightPx, setHeightPx] = useState(0);

  useEffect(() => {
    if (!enabled) {
      setHeightPx(0);
      return;
    }

    const element = elementRef.current;
    if (!element) return;

    const applyHeight = (next: number) => {
      const rounded = roundHeightPx(next);
      setHeightPx((prev) => (prev === rounded ? prev : rounded));
    };

    applyHeight(element.clientHeight);

    if (typeof ResizeObserver === 'undefined') {
      return;
    }

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      applyHeight(entry.contentRect.height);
    });

    observer.observe(element);
    return () => observer.disconnect();
  }, [elementRef, enabled]);

  return heightPx;
}
