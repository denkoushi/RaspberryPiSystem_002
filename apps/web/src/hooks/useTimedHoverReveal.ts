import { useCallback, useEffect, useRef, useState } from 'react';

export const TIMED_HOVER_REVEAL_CLOSE_DELAY_MS = 320;

export type TimedHoverRevealHandlers = {
  isVisible: boolean;
  onHotZoneEnter: () => void;
  onHeaderMouseEnter: () => void;
  onHeaderMouseLeave: () => void;
};

type TimedHoverRevealInternal = TimedHoverRevealHandlers & {
  open: () => void;
};

/**
 * ホットゾーン／パネル hover で開き、leave 後に遅延で閉じる（マウス前提）。
 * ウィンドウ上端の mousemove は含めない（Kiosk ヘッダー用は useKioskTopEdgeHeaderReveal で追加）。
 */
export function useTimedHoverReveal(enabled: boolean): TimedHoverRevealInternal {
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
    }, TIMED_HOVER_REVEAL_CLOSE_DELAY_MS);
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
    onHeaderMouseLeave,
    open
  };
}
