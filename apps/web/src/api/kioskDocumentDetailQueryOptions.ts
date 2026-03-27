import { kioskDocumentDetailQueryKey } from '../features/kiosk/documents/kioskDocumentQueryKeys';

import { getKioskDocumentDetail } from './client';

/**
 * キオスクは同一文書の連続閲覧が主。管理画面の kiosk 要領書 mutation は `['kiosk-document']` を invalidate するため、
 * ここで stale を伸ばしても運用更新後はキャッシュが捨てられる。
 */
export const KIOSK_DOCUMENT_DETAIL_STALE_TIME_MS = 60_000;

export const KIOSK_DOCUMENT_DETAIL_GC_TIME_MS = 5 * 60_000;

const kioskDocumentDetailQueryCachePolicy = {
  staleTime: KIOSK_DOCUMENT_DETAIL_STALE_TIME_MS,
  gcTime: KIOSK_DOCUMENT_DETAIL_GC_TIME_MS,
} as const;

/** `prefetchQuery` 用（id は呼び出し側で検証済み） */
export function kioskDocumentDetailQueryOptions(id: string) {
  return {
    queryKey: kioskDocumentDetailQueryKey(id),
    queryFn: () => getKioskDocumentDetail(id),
    ...kioskDocumentDetailQueryCachePolicy,
  };
}
