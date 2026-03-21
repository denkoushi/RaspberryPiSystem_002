import { useCallback, useEffect, useRef, useState } from 'react';

const CLOSE_DELAY_MS = 320;

export type KioskTopEdgeHeaderRevealHandlers = {
  isVisible: boolean;
  onHotZoneEnter: () => void;
  onHeaderMouseEnter: () => void;
  onHeaderMouseLeave: () => void;
};

/**
 * 手動順番などで最上段ヘッダーをデフォルト非表示にし、上端ホバーで表示する。
 * マウス操作前提（タッチは未対応）。
 */
export function useKioskTopEdgeHeaderReveal(enabled: boolean): KioskTopEdgeHeaderRevealHandlers {
  const [isVisible, setIsVisible] = useState(false);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearCloseTimer = useCallback(() => {
    if (closeTimerRef.current !== null) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);

  const open = useCallback(() => {
    clearCloseTimer();
    setIsVisible(true);
  }, [clearCloseTimer]);

  const scheduleClose = useCallback(() => {
    clearCloseTimer();
    closeTimerRef.current = setTimeout(() => {
      closeTimerRef.current = null;
      setIsVisible(false);
    }, CLOSE_DELAY_MS);
  }, [clearCloseTimer]);

  useEffect(() => {
    if (!enabled) {
      clearCloseTimer();
      setIsVisible(false);
      return;
    }
    return () => {
      clearCloseTimer();
    };
  }, [enabled, clearCloseTimer]);

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

  const onHotZoneEnter = useCallback(() => {
    if (!enabled) return;
    open();
  }, [enabled, open]);

  const onHeaderMouseEnter = useCallback(() => {
    if (!enabled) return;
    open();
  }, [enabled, open]);

  const onHeaderMouseLeave = useCallback(() => {
    if (!enabled) return;
    scheduleClose();
  }, [enabled, scheduleClose]);

  return {
    isVisible,
    onHotZoneEnter,
    onHeaderMouseEnter,
    onHeaderMouseLeave
  };
}
