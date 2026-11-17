import { useQuery } from '@tanstack/react-query';

import { getKioskGrindingPlanningBoardTestBarPartCandidates } from '../../domains/production-schedule/grinding-planning-board';
import { productionScheduleQueryKeys } from '../../queryKeys/productionSchedule';

export function usePlanningBoardTestBarPartCandidates(resourceCd: string) {
  return useQuery({
    queryKey: productionScheduleQueryKeys.grindingPlanningBoardTestBarPartCandidates(resourceCd),
    queryFn: () => getKioskGrindingPlanningBoardTestBarPartCandidates(resourceCd),
    enabled: Boolean(resourceCd),
    refetchOnWindowFocus: false
  });
}
