import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  getRiggingGears,
  createRiggingGear,
  updateRiggingGear,
  deleteRiggingGear,
  createRiggingInspectionRecord,
  getRiggingInspectionRecords
} from '../client';

import type {
  RiggingGear,
  RiggingStatus,
  RiggingInspectionRecord,
  RiggingInspectionResult
} from '../types';

export function useRiggingGears(params?: { search?: string; status?: RiggingStatus }) {
  return useQuery({
    queryKey: ['rigging-gears', params],
    queryFn: () => getRiggingGears(params)
  });
}

export function useRiggingGearMutations() {
  const queryClient = useQueryClient();
  const create = useMutation({
    mutationFn: (payload: Partial<RiggingGear> & { name: string; managementNumber: string }) =>
      createRiggingGear(payload),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['rigging-gears'] })
  });
  const update = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: Partial<RiggingGear> }) => updateRiggingGear(id, payload),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['rigging-gears'] })
  });
  const remove = useMutation({
    mutationFn: (id: string) => deleteRiggingGear(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['rigging-gears'] })
  });
  return { create, update, remove };
}

export function useRiggingInspectionRecords(riggingGearId?: string) {
  return useQuery({
    queryKey: ['rigging-inspection-records', riggingGearId],
    queryFn: async () => {
      if (!riggingGearId) return [] as RiggingInspectionRecord[];
      return getRiggingInspectionRecords(riggingGearId);
    },
    enabled: Boolean(riggingGearId)
  });
}

export function useRiggingInspectionRecordMutations() {
  const queryClient = useQueryClient();
  const create = useMutation({
    mutationFn: (payload: {
      riggingGearId: string;
      loanId?: string | null;
      employeeId: string;
      result: RiggingInspectionResult;
      inspectedAt: string;
      notes?: string | null;
    }) => createRiggingInspectionRecord(payload),
    onSuccess: (_data, variables) =>
      queryClient.invalidateQueries({ queryKey: ['rigging-inspection-records', variables.riggingGearId] })
  });
  return { create };
}

// バックアップ履歴フック
