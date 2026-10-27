import { useQuery } from '@tanstack/react-query';

import { mobilePlacementQueryKeys } from './mobilePlacementQueryKeys';
import { getCachedShelfMachines, readCachedShelfMachines } from './shelfListCache';

export function useShelfMachines() {
  return useQuery({
    queryKey: mobilePlacementQueryKeys.shelfMachines,
    queryFn: () => getCachedShelfMachines({ refresh: true }),
    initialData: readCachedShelfMachines,
    initialDataUpdatedAt: 0,
    networkMode: 'always',
    retry: false,
    staleTime: 60_000
  });
}
