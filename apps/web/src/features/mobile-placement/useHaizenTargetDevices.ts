import { useQuery } from '@tanstack/react-query';

import { getMobilePlacementHaizenTargetDevices } from '../../api/client';

/**
 * Zero2W 担当棚設定用の対象端末一覧。
 */
export function useHaizenTargetDevices() {
  return useQuery({
    queryKey: ['mobile-placement', 'haizen-target-devices'] as const,
    queryFn: getMobilePlacementHaizenTargetDevices,
    staleTime: 30_000
  });
}
