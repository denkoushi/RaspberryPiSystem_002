import { useCallback, useEffect, useRef, useState } from 'react';

/** 連続失敗は回数で打ち切らず、待ち時間だけを30秒で頭打ちにする。 */
export function leaderboardAppendRetryDelayMs(consecutiveFailures: number): number {
  return Math.min(30_000, 1000 * 2 ** Math.min(5, Math.max(0, consecutiveFailures - 1)));
}

export function useLeaderboardAppendRetry(paramsKey: string) {
  const [generation, setGeneration] = useState(0);
  const failuresRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resetRetry = useCallback(() => {
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    timerRef.current = null;
    failuresRef.current = 0;
  }, []);
  const activeRef = useRef(false);
  useEffect(() => {
    activeRef.current = true;
    resetRetry();
    return () => {
      activeRef.current = false;
      resetRetry();
    };
  }, [paramsKey, resetRetry]);
  const scheduleRetry = useCallback(() => {
    if (!activeRef.current || timerRef.current !== null) return;
    failuresRef.current += 1;
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      setGeneration((n) => n + 1);
    }, leaderboardAppendRetryDelayMs(failuresRef.current));
  }, []);
  const isRetryScheduled = useCallback(() => timerRef.current !== null, []);
  return { generation, scheduleRetry, resetRetry, isRetryScheduled };
}
