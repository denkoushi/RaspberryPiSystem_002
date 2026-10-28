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
import { mobilePlacementQueryKeys } from '../mobilePlacementQueryKeys';

export function useClientCapabilities() {
  return useQuery({
    queryKey: mobilePlacementQueryKeys.clientCapabilities,
    queryFn: getMobilePlacementClientCapabilities
  });
}

export function useShelfLayoutSummary() {
  return useQuery({
    queryKey: mobilePlacementQueryKeys.shelfLayout,
    queryFn: getMobilePlacementShelfLayoutSummary
  });
}

export function useShelfLayoutZone(macroZoneId: string | null) {
  return useQuery({
    queryKey: mobilePlacementQueryKeys.shelfLayoutZone(macroZoneId),
    queryFn: () => getMobilePlacementShelfLayoutZone(macroZoneId!),
    enabled: macroZoneId != null && macroZoneId.length > 0
  });
}

export function useMachineMasters() {
  return useQuery({
    queryKey: mobilePlacementQueryKeys.machineMasters,
    queryFn: getMobilePlacementMachineMasters
  });
}

export function useHaizenTargetDevicesForShelfMaster() {
  return useQuery({
    queryKey: mobilePlacementQueryKeys.haizenTargetDevices,
    queryFn: getMobilePlacementHaizenTargetDevices
  });
}

export function useSaveShelfLayoutZone(macroZoneId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: Parameters<typeof putMobilePlacementShelfLayoutZone>[1]) =>
      putMobilePlacementShelfLayoutZone(macroZoneId, payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: mobilePlacementQueryKeys.shelfLayout });
      await queryClient.invalidateQueries({ queryKey: mobilePlacementQueryKeys.shelfLayoutZone(macroZoneId) });
      await queryClient.invalidateQueries({ queryKey: mobilePlacementQueryKeys.registeredShelves });
    }
  });
}

export function useRelocateShelf() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: { sourceShelfCodeRaw: string; targetShelfCodeRaw: string }) =>
      postMobilePlacementShelfRelocate(payload.sourceShelfCodeRaw, payload.targetShelfCodeRaw),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: mobilePlacementQueryKeys.all });
    }
  });
}

export function useAssignZero2wPreset() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: putMobilePlacementHaizenTargetPresetShelf,
    // Fail fast offline so the caller's busy state settles instead of pausing.
    networkMode: 'always',
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: mobilePlacementQueryKeys.haizenTargetDevices });
      await queryClient.invalidateQueries({ queryKey: mobilePlacementQueryKeys.shelfLayout });
    }
  });
}
