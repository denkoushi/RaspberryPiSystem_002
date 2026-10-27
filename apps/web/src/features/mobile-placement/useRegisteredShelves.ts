import { useQuery } from '@tanstack/react-query';

import { mobilePlacementQueryKeys } from './mobilePlacementQueryKeys';
import { getCachedRegisteredShelves } from './shelfListCache';

/**
 * 登録済み棚一覧。取得できないときは端末の最後の成功結果を使う。
 */
export function useRegisteredShelves() {
  return useQuery({
    queryKey: mobilePlacementQueryKeys.registeredShelves,
    queryFn: getCachedRegisteredShelves,
    networkMode: 'always',
    staleTime: 60_000
  });
}
