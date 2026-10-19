import { useCallback, useEffect, useRef, useState } from 'react';

import { KIOSK_REVEAL_CLOSE_DELAY_MS } from './kioskRevealUi';

/** 既存インポート向け。`KIOSK_REVEAL_CLOSE_DELAY_MS` と常に同一。 */
export const TIMED_HOVER_REVEAL_CLOSE_DELAY_MS = KIOSK_REVEAL_CLOSE_DELAY_MS;

export type TimedHoverRevealHandlers = {
  isVisible: boolean;
  onHotZoneEnter: () => void;
  onHeaderMouseEnter: () => void;
  onHeaderMouseLeave: () => void;
};

type TimedHoverRevealInternal = TimedHoverRevealHandlers & {
  open: () => void;
  close: () => void;
};

/**
 * ホットゾーン／パネル hover で開き、leave 後に遅延で閉じる（マウス前提）。
 * ウィンドウ端の mousemove は含めない（Kiosk ヘッダー用は useKioskEdgeHeaderReveal で追加）。
 */
/** 'timer' は leave 後の自動クローズ、'manual' は Esc や外側クリックなどの明示クローズ。 */
export type TimedHoverRevealCloseReason = 'timer' | 'manual';

export function useTimedHoverReveal(
  enabled: boolean,
  canClose?: (reason: TimedHoverRevealCloseReason) => boolean
): TimedHoverRevealInternal {
  const [isVisible, setIsVisible] = useState(false);
  const canCloseRef = useRef(canClose);
  canCloseRef.current = canClose;
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

  const close = useCallback(() => {
    clearCloseTimer();
    if (canCloseRef.current?.('manual') === false) return;
    setIsVisible(false);
  }, [clearCloseTimer]);

  const scheduleClose = useCallback(() => {
    clearCloseTimer();
    const tick = () => {
      closeTimerRef.current = null;
      // 閉じられない間（モーダル表示中など）は待ち続け、解消後に閉じる。再入時は open が予約を消す。
      if (canCloseRef.current?.('timer') === false) {
        closeTimerRef.current = setTimeout(tick, KIOSK_REVEAL_CLOSE_DELAY_MS);
        return;
      }
      setIsVisible(false);
    };
    closeTimerRef.current = setTimeout(tick, KIOSK_REVEAL_CLOSE_DELAY_MS);
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
    open,
    close
  };
}
