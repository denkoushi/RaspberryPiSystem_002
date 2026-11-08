import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { getKioskGrindingPlanningBoardResourceMinutes, updateKioskGrindingPlanningBoardResourceMinutesSource, updateKioskGrindingPlanningBoardResourcePartMinutes } from '../../client';
import { productionScheduleQueryKeys } from '../../queryKeys/productionSchedule';

import type { GrindingPlanningBoardResourceMinutesResponse as Settings, GrindingPlanningBoardResourceMinutesSourceRequest as Source, GrindingPlanningBoardResourcePartMinutesRequest as Value } from '@raspi-system/shared-types';

const key = productionScheduleQueryKeys.planningBoardResourceMinutesAll;
const empty: Settings = { ownSourceResourceCds: [], values: [] };
export function useKioskGrindingPlanningBoardResourceMinutes(enabled: boolean) {
  return useQuery({ queryKey: key, queryFn: getKioskGrindingPlanningBoardResourceMinutes, enabled, staleTime: 10 * 60_000 });
}
function mergeTarget(current: Settings, next: Settings, payload: Source | Value): Settings {
  if ('source' in payload) return { ...current, ownSourceResourceCds: [
    ...current.ownSourceResourceCds.filter((cd) => cd !== payload.resourceCd),
    ...next.ownSourceResourceCds.filter((cd) => cd === payload.resourceCd)
  ] };
  const matches = (value: Settings['values'][number]) => value.resourceCd === payload.resourceCd && value.fhincd === payload.fhincd;
  return { ...current, values: [...current.values.filter((value) => !matches(value)), ...next.values.filter(matches)] };
}
function useUpdateMinutes<T extends Source | Value>(mutationFn: (payload: T) => Promise<Settings>, scope: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn, scope: { id: scope },
    onMutate: async (payload) => {
      await client.cancelQueries({ queryKey: key });
      const previous = client.getQueryData<Settings>(key) ?? empty;
      const next: Settings = 'source' in payload
        ? { ...empty, ownSourceResourceCds: payload.source === 'own' ? [payload.resourceCd] : [] }
        : { ...empty, values: payload.perUnitMinutes === null ? [] : [{ ...payload, perUnitMinutes: payload.perUnitMinutes }] };
      client.setQueryData<Settings>(key, (current = empty) => mergeTarget(current, next, payload));
      return { previous };
    },
    onError: (_error, payload, context) => {
      client.setQueryData<Settings>(key, (current = empty) => mergeTarget(current, context?.previous ?? empty, payload));
    },
    onSuccess: (response, payload) => {
      client.setQueryData<Settings>(key, (current = empty) => mergeTarget(current, response, payload));
      // The board prefix includes progressive snapshots and load queries.
      void client.invalidateQueries({ queryKey: productionScheduleQueryKeys.grindingPlanningBoardAll });
    }
  });
}
export function useUpdateKioskGrindingPlanningBoardResourceMinutesSource() {
  return useUpdateMinutes(updateKioskGrindingPlanningBoardResourceMinutesSource, 'planning-board-minutes-source');
}
export function useUpdateKioskGrindingPlanningBoardResourcePartMinutes(resourceCd: string, fhincd: string) {
  return useUpdateMinutes(updateKioskGrindingPlanningBoardResourcePartMinutes, `planning-board-minutes:${resourceCd}:${fhincd}`);
}
