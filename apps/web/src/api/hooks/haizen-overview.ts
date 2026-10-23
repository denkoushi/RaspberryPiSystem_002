import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { deleteOrderPlacementBranch, getHaizenOverview, getMobilePlacementRegisteredShelves } from '../domains/mobile-placement';

export function useHaizenOverview() {
  return useQuery({ queryKey: ['mobile-placement', 'haizen-overview'], queryFn: getHaizenOverview, refetchInterval: 60_000 });
}

export function useHaizenShelves() {
  return useQuery({ queryKey: ['mobile-placement', 'registered-shelves'], queryFn: getMobilePlacementRegisteredShelves, refetchInterval: 60_000 });
}

export function useDeleteOrderPlacementBranch() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: deleteOrderPlacementBranch,
    onSuccess: () => client.invalidateQueries({ queryKey: ['mobile-placement', 'haizen-overview'] })
  });
}
