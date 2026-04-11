import { useQuery } from '@tanstack/react-query';

import { getMobilePlacementRegisteredShelves } from '../../api/client';

/**
 * 部品配膳に登場した棚番の distinct 一覧（サーバ）。UI は失敗時リトライ可能。
 */
export function useRegisteredShelves() {
  return useQuery({
    queryKey: ['mobile-placement', 'registered-shelves'] as const,
    queryFn: getMobilePlacementRegisteredShelves,
    staleTime: 60_000
  });
}
