import { useQuery } from '@tanstack/react-query';

import { getMobilePlacementRegisteredShelves } from '../../api/client';

import { mobilePlacementQueryKeys } from './mobilePlacementQueryKeys';

/**
 * 部品配膳に登場した棚番の distinct 一覧（サーバ）。UI は失敗時リトライ可能。
 */
export function useRegisteredShelves() {
  return useQuery({
    queryKey: mobilePlacementQueryKeys.registeredShelves,
    queryFn: getMobilePlacementRegisteredShelves,
    staleTime: 60_000
  });
}
