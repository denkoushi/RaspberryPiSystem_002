import { useQuery } from '@tanstack/react-query';

import { getMobilePlacementHaizenTargetDevices } from '../../api/client';

import { mobilePlacementQueryKeys } from './mobilePlacementQueryKeys';

/**
 * Zero2W 担当棚設定用の対象端末一覧。
 */
export function useHaizenTargetDevices() {
  return useQuery({
    queryKey: mobilePlacementQueryKeys.haizenTargetDevices,
    queryFn: getMobilePlacementHaizenTargetDevices,
    staleTime: 30_000
  });
}
