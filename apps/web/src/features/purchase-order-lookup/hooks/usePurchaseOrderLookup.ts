import { useCallback, useEffect, useRef, useState } from 'react';

import {
  getKioskPurchaseOrderLookup,
  type PurchaseOrderLookupResponse
} from '../../../api/client';
import { resolveClientKey } from '../../../lib/client-key';

export type UsePurchaseOrderLookupOptions = {
  lookup?: typeof getKioskPurchaseOrderLookup;
};

/**
 * 購買照会: 10桁で API 実行。注文番号はバーコードスキャン成功時のみ更新する。
 */
export function usePurchaseOrderLookup(options?: UsePurchaseOrderLookupOptions) {
  const lookupFn = options?.lookup ?? getKioskPurchaseOrderLookup;

  const [orderNo, setOrderNo] = useState('');
  const [scanOpen, setScanOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PurchaseOrderLookupResponse | null>(null);

  const requestIdRef = useRef(0);

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

  const onScanSuccess = useCallback(
    (text: string) => {
      const digits = text.replace(/\D/g, '').slice(0, 10);
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
    [runLookup]
  );

  useEffect(
    () => () => {
      requestIdRef.current += 1;
    },
    []
  );

  return {
    orderNo,
    scanOpen,
    setScanOpen,
    loading,
    error,
    result,
    onScanSuccess
  };
}
