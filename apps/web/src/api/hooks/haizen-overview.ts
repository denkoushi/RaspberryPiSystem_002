import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { deleteHaizenCurrentPlacement, deleteOrderPlacementBranch, getHaizenOverview, getHaizenUnplacedParts, getMobilePlacementRegisteredShelves } from '../domains/mobile-placement';

import type { HaizenOverviewRow } from '../domains/mobile-placement';

export function useHaizenOverview() {
  return useQuery({ queryKey: ['mobile-placement', 'haizen-overview'], queryFn: getHaizenOverview, refetchInterval: 60_000 });
}

export function useHaizenShelves() {
  return useQuery({ queryKey: ['mobile-placement', 'registered-shelves'], queryFn: getMobilePlacementRegisteredShelves, refetchInterval: 60_000 });
}

export function useDeleteOrderPlacementBranch() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteOrderPlacementBranch(id),
    onSuccess: () => client.invalidateQueries({ queryKey: ['mobile-placement', 'haizen-overview'] })
  });
}

export function useDeleteHaizenPlacement() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (row: HaizenOverviewRow) => row.source === 'zero2w'
      ? deleteHaizenCurrentPlacement(row.id)
      : deleteOrderPlacementBranch(row.id),
    onSuccess: () => client.invalidateQueries({ queryKey: ['mobile-placement', 'haizen-overview'] })
  });
}

export function useHaizenUnplacedParts(enabled: boolean) {
  return useQuery({ queryKey: ['mobile-placement', 'haizen-overview', 'unplaced-parts'], queryFn: getHaizenUnplacedParts, enabled, refetchInterval: 60_000 });
}
