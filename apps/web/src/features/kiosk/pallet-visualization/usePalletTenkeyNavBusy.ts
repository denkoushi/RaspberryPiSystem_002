import { useCallback, useEffect, useRef, useState } from 'react';

export type UsePalletTenkeyNavBusyOptions = {
  /** テンキー連打抑止の最小ロック時間（ms） */
  cooldownMs?: number;
};

/**
 * パレット番号テンキー操作後の短いビジー状態（スピナー・入力無効化用）。
 */
export function usePalletTenkeyNavBusy(options?: UsePalletTenkeyNavBusyOptions) {
  const cooldownMs = options?.cooldownMs ?? 110;
  const [navBusy, setNavBusy] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const pulseNavBusy = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }
    setNavBusy(true);
    timerRef.current = setTimeout(() => {
      setNavBusy(false);
      timerRef.current = null;
    }, cooldownMs);
  }, [cooldownMs]);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    []
  );

  return { navBusy, pulseNavBusy };
}
