import { useQuery } from '@tanstack/react-query';

import { getMobilePlacementHaizenCurrent } from '../../api/client';

/**
 * Zero2W 配膳の現在値（棚絞り込み）。ポーリングで現場追従。
 */
export function useHaizenCurrentPlacements(shelfCode: string | undefined) {
  const shelf = shelfCode?.trim() ?? '';
  return useQuery({
    queryKey: ['mobile-placement', 'haizen-current', shelf || '__all__'] as const,
    queryFn: () =>
      getMobilePlacementHaizenCurrent({
        shelfCodeRaw: shelf.length > 0 ? shelf : undefined,
        limit: 50
      }),
    staleTime: 5_000,
    refetchInterval: 15_000
  });
}
