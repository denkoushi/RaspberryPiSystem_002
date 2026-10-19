import { useQuery } from '@tanstack/react-query';

import { getOrderPlacementBranches } from '../../api/client';

import { mobilePlacementQueryKeys } from './mobilePlacementQueryKeys';

/**
 * 製造orderスキャン値に紐づく分配枝の現在棚（サーバ）。
 */
export function useOrderPlacementBranches(manufacturingOrderBarcodeRaw: string) {
  const key = manufacturingOrderBarcodeRaw.trim();
  return useQuery({
    queryKey: mobilePlacementQueryKeys.orderPlacementBranches(key),
    queryFn: () => getOrderPlacementBranches(key),
    enabled: key.length > 0,
    staleTime: 30_000
  });
}
