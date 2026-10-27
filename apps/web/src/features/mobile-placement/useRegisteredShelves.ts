import { useQuery } from '@tanstack/react-query';

import { mobilePlacementQueryKeys } from './mobilePlacementQueryKeys';
import { getCachedRegisteredShelves, readCachedRegisteredShelves } from './shelfListCache';

/**
 * 登録済み棚一覧。端末の保存を即時表示し、裏で最新の一覧へ更新する。
 */
export function useRegisteredShelves() {
  return useQuery({
    queryKey: mobilePlacementQueryKeys.registeredShelves,
    queryFn: () => getCachedRegisteredShelves({ refresh: true }),
    initialData: readCachedRegisteredShelves,
    initialDataUpdatedAt: 0,
    networkMode: 'always',
    retry: false,
    staleTime: 60_000
  });
}
