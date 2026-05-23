import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  getMobilePlacementClientCapabilities,
  getMobilePlacementMachineMasters,
  getMobilePlacementShelfLayoutSummary,
  getMobilePlacementShelfLayoutZone,
  postMobilePlacementShelfRelocate,
  putMobilePlacementHaizenTargetPresetShelf,
  putMobilePlacementShelfLayoutZone,
  getMobilePlacementHaizenTargetDevices
} from '../../../api/client';

export function useClientCapabilities() {
  return useQuery({
    queryKey: ['mobile-placement', 'client-capabilities'],
    queryFn: getMobilePlacementClientCapabilities
  });
}

export function useShelfLayoutSummary() {
  return useQuery({
    queryKey: ['mobile-placement', 'shelf-layout'],
    queryFn: getMobilePlacementShelfLayoutSummary
  });
}

export function useShelfLayoutZone(macroZoneId: string | null) {
  return useQuery({
    queryKey: ['mobile-placement', 'shelf-layout', 'zone', macroZoneId],
    queryFn: () => getMobilePlacementShelfLayoutZone(macroZoneId!),
    enabled: macroZoneId != null && macroZoneId.length > 0
  });
}

export function useMachineMasters() {
  return useQuery({
    queryKey: ['mobile-placement', 'machine-masters'],
    queryFn: getMobilePlacementMachineMasters
  });
}

export function useHaizenTargetDevicesForShelfMaster() {
  return useQuery({
    queryKey: ['mobile-placement', 'haizen-target-devices'],
    queryFn: getMobilePlacementHaizenTargetDevices
  });
}

export function useSaveShelfLayoutZone(macroZoneId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: Parameters<typeof putMobilePlacementShelfLayoutZone>[1]) =>
      putMobilePlacementShelfLayoutZone(macroZoneId, payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['mobile-placement', 'shelf-layout'] });
      await queryClient.invalidateQueries({ queryKey: ['mobile-placement', 'shelf-layout', 'zone', macroZoneId] });
      await queryClient.invalidateQueries({ queryKey: ['mobile-placement', 'registered-shelves'] });
    }
  });
}

export function useRelocateShelf() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: { sourceShelfCodeRaw: string; targetShelfCodeRaw: string }) =>
      postMobilePlacementShelfRelocate(payload.sourceShelfCodeRaw, payload.targetShelfCodeRaw),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['mobile-placement'] });
    }
  });
}

export function useAssignZero2wPreset() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: putMobilePlacementHaizenTargetPresetShelf,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['mobile-placement', 'haizen-target-devices'] });
      await queryClient.invalidateQueries({ queryKey: ['mobile-placement', 'shelf-layout'] });
    }
  });
}
