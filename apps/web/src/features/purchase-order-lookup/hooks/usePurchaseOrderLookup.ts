import { useCallback, useEffect, useRef, useState } from 'react';

import {
  getKioskPurchaseOrderLookup,
  type PurchaseOrderLookupResponse
} from '../../../api/client';
import { resolveClientKey } from '../../../lib/client-key';

const DEFAULT_DEBOUNCE_MS = 300;

export type UsePurchaseOrderLookupOptions = {
  debounceMs?: number;
  lookup?: typeof getKioskPurchaseOrderLookup;
};

/**
 * 購買照会: 10桁で API 実行。手入力は debounce、スキャン成功は即実行（計画のハイブリッド B）。
 */
export function usePurchaseOrderLookup(options?: UsePurchaseOrderLookupOptions) {
  const debounceMs = options?.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  const lookupFn = options?.lookup ?? getKioskPurchaseOrderLookup;

  const [orderNo, setOrderNo] = useState('');
  const [scanOpen, setScanOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PurchaseOrderLookupResponse | null>(null);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestIdRef = useRef(0);

  const clearDebounce = useCallback(() => {
    if (debounceRef.current != null) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
  }, []);

  const runLookup = useCallback(
    async (digits: string) => {
      if (!/^\d{10}$/.test(digits)) {
        return;
      }
      const myId = ++requestIdRef.current;
      setLoading(true);
      setError(null);
      try {
        const { key } = resolveClientKey({ allowDefaultFallback: true });
        const data = await lookupFn(digits, key);
        if (requestIdRef.current !== myId) {
          return;
        }
        setResult(data);
      } catch (e) {
        if (requestIdRef.current !== myId) {
          return;
        }
        setError(e instanceof Error ? e.message : '照会に失敗しました');
        setResult(null);
      } finally {
        if (requestIdRef.current === myId) {
          setLoading(false);
        }
      }
    },
    [lookupFn]
  );

  const scheduleDebouncedLookup = useCallback(
    (digits: string) => {
      clearDebounce();
      if (digits.length !== 10) {
        requestIdRef.current += 1;
        setResult(null);
        setError(null);
        setLoading(false);
        return;
      }
      debounceRef.current = setTimeout(() => {
        debounceRef.current = null;
        void runLookup(digits);
      }, debounceMs);
    },
    [clearDebounce, debounceMs, runLookup]
  );

  const onOrderNoChange = useCallback(
    (raw: string) => {
      const digits = raw.replace(/\D/g, '').slice(0, 10);
      setOrderNo(digits);
      scheduleDebouncedLookup(digits);
    },
    [scheduleDebouncedLookup]
  );

  const onScanSuccess = useCallback(
    (text: string) => {
      const digits = text.replace(/\D/g, '').slice(0, 10);
      clearDebounce();
      setOrderNo(digits);
      setScanOpen(false);
      if (digits.length === 10) {
        void runLookup(digits);
      } else {
        requestIdRef.current += 1;
        setResult(null);
        setError(null);
        setLoading(false);
      }
    },
    [clearDebounce, runLookup]
  );

  useEffect(
    () => () => {
      clearDebounce();
    },
    [clearDebounce]
  );

  return {
    orderNo,
    onOrderNoChange,
    scanOpen,
    setScanOpen,
    loading,
    error,
    result,
    onScanSuccess
  };
}
