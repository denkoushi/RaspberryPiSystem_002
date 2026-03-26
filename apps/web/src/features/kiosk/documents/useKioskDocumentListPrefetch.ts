import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef } from 'react';

import { getKioskDocumentDetail } from '../../../api/client';

import { kioskDocumentDetailQueryKey } from './kioskDocumentQueryKeys';

export const KIOSK_DOCUMENT_LIST_PREFETCH_DEBOUNCE_MS = 150;

export type UseKioskDocumentListPrefetchOptions = {
  /** 選択中の文書はプリフェッチしない */
  selectedId: string | null;
  debounceMs?: number;
};

/**
 * 一覧行のホバー／フォーカスから詳細 API を先読みする（デバウンス付き）。
 */
export function useKioskDocumentListPrefetch(options: UseKioskDocumentListPrefetchOptions) {
  const { selectedId, debounceMs = KIOSK_DOCUMENT_LIST_PREFETCH_DEBOUNCE_MS } = options;
  const queryClient = useQueryClient();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  useEffect(() => () => clearTimer(), [clearTimer]);

  const schedulePrefetchDocumentId = useCallback(
    (id: string) => {
      clearTimer();
      if (!id || id === selectedId) return;
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        void queryClient.prefetchQuery({
          queryKey: kioskDocumentDetailQueryKey(id),
          queryFn: () => getKioskDocumentDetail(id),
        });
      }, debounceMs);
    },
    [clearTimer, debounceMs, queryClient, selectedId]
  );

  const cancelScheduledPrefetch = useCallback(() => {
    clearTimer();
  }, [clearTimer]);

  return { schedulePrefetchDocumentId, cancelScheduledPrefetch };
}
