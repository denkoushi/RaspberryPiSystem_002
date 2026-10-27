import { useQuery } from '@tanstack/react-query';

import { getOrderPlacementBranches } from '../../api/client';

import { canUseMobileNetwork, mobileRequest, useMobileConnectivity } from './connectivity';
import { haizenOfflineQueueStore } from './haizen/offline/haizenOfflineQueueStore';
import { mobilePlacementQueryKeys } from './mobilePlacementQueryKeys';
import { overlayPendingBranches, readOrderBranches, saveOrderBranches } from './orderPlacementBranchesCache';

/** Last successful list plus unsent placements, with a bounded background refresh. */
export function useOrderPlacementBranches(manufacturingOrderBarcodeRaw: string) {
  const key = manufacturingOrderBarcodeRaw.trim();
  const online = useMobileConnectivity();
  const local = useQuery({
    queryKey: [...mobilePlacementQueryKeys.orderPlacementBranches(key), 'local', online],
    queryFn: async () => ({ saved: readOrderBranches(key), pending: await haizenOfflineQueueStore.list() }),
    enabled: key.length > 0,
    networkMode: 'always',
    retry: false,
    staleTime: 0
  });
  const remote = useQuery({
    queryKey: mobilePlacementQueryKeys.orderPlacementBranches(key),
    queryFn: async () => {
      // Recheck at dispatch time: another mobile request may have failed since render.
      if (!canUseMobileNetwork()) return null;
      const value = await mobileRequest(() => getOrderPlacementBranches(key));
      saveOrderBranches(key, value);
      return value;
    },
    enabled: key.length > 0 && online,
    networkMode: 'always',
    retry: false,
    staleTime: 0
  });
  const saved = remote.data ?? local.data?.saved;
  const data = saved && local.data && !local.isFetching ? overlayPendingBranches(key, saved, local.data.pending) : undefined;
  const branchStatus = data ? 'known' : key && online && (local.isLoading || remote.isFetching) ? 'loading' : 'unknown';
  return { ...remote, data, branchStatus };
}
