import { useQuery } from '@tanstack/react-query';

import { getOrderPlacementBranches } from '../../api/client';

/**
 * 製造orderスキャン値に紐づく分配枝の現在棚（サーバ）。
 */
export function useOrderPlacementBranches(manufacturingOrderBarcodeRaw: string) {
  const key = manufacturingOrderBarcodeRaw.trim();
  return useQuery({
    queryKey: ['mobile-placement', 'order-placement-branches', key] as const,
    queryFn: () => getOrderPlacementBranches(key),
    enabled: key.length > 0,
    staleTime: 30_000
  });
}
