import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  putMobilePlacementHaizenTargetPresetShelf,
  getMobilePlacementHaizenTargetDevices
} from '../../../api/client';
import { mobilePlacementQueryKeys } from '../mobilePlacementQueryKeys';

export function useHaizenTargetDevicesForShelfMaster() {
  return useQuery({
    queryKey: mobilePlacementQueryKeys.haizenTargetDevices,
    queryFn: getMobilePlacementHaizenTargetDevices
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
