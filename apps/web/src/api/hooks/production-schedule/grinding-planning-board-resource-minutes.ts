import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';

import { getKioskGrindingPlanningBoardResourceMinutes, updateKioskGrindingPlanningBoardResourceMinutesSource, updateKioskGrindingPlanningBoardResourcePartMinutes } from '../../client';
import { productionScheduleQueryKeys } from '../../queryKeys/productionSchedule';

import type { GrindingPlanningBoardResourceMinutesResponse as Settings, GrindingPlanningBoardResourceMinutesSourceRequest as Source, GrindingPlanningBoardResourcePartMinutesRequest as Value } from '@raspi-system/shared-types';
import type { QueryClient } from '@tanstack/react-query';

const key = productionScheduleQueryKeys.planningBoardResourceMinutesAll;
// Preserve refresh requests when a later optimistic save cancels the fetch.
const needsRefresh = new WeakSet<QueryClient>();
const empty: Settings = { ownSourceResourceCds: [], values: [] };
// The board stays open for days; pick up edits made on other kiosks.
export const PLANNING_BOARD_SETTINGS_REFETCH_MS = 60_000;
export function useKioskGrindingPlanningBoardResourceMinutes(enabled: boolean) {
  return useQuery({ queryKey: key, queryFn: getKioskGrindingPlanningBoardResourceMinutes, enabled, staleTime: 10 * 60_000, refetchInterval: PLANNING_BOARD_SETTINGS_REFETCH_MS });
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
      if (client.isFetching({ queryKey: key })) needsRefresh.add(client);
      await client.cancelQueries({ queryKey: key });
      const previous = client.getQueryData<Settings>(key) ?? empty;
      const next: Settings = 'source' in payload
        ? { ...empty, ownSourceResourceCds: payload.source === 'own' ? [payload.resourceCd] : [] }
        : { ...empty, values: payload.perUnitMinutes === null ? [] : [{ ...payload, perUnitMinutes: payload.perUnitMinutes }] };
      client.setQueryData<Settings>(key, (current = empty) => mergeTarget(current, next, payload));
      return { previous };
    },
    onError: (error, payload, context) => {
      client.setQueryData<Settings>(key, (current = empty) => mergeTarget(current, context?.previous ?? empty, payload));
      if (isAxiosError(error) && error.response && error.response.status >= 400 && error.response.status < 500) {
        needsRefresh.add(client);
        void client.invalidateQueries({ queryKey: key });
      }
    },
    onSuccess: (response, payload) => {
      client.setQueryData<Settings>(key, (current = empty) => mergeTarget(current, response, payload));
      if ('perUnitMinutes' in payload && payload.perUnitMinutes !== null) {
        client.setQueryData<Settings>(key, (current = empty) => mergeTarget(current, response, { resourceCd: payload.resourceCd, source: 'own' }));
      }
      if (needsRefresh.has(client) || client.isFetching({ queryKey: key })) {
        needsRefresh.delete(client);
        void client.invalidateQueries({ queryKey: key });
      }
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
