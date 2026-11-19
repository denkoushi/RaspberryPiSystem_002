import { productionScheduleQueryKeys } from '../../../api/queryKeys/productionSchedule';

import type { QueryClient } from '@tanstack/react-query';

export function invalidateLeaderboardDecorationsQueries(queryClient: QueryClient) {
  return queryClient.invalidateQueries({
    predicate: (q) =>
      Array.isArray(q.queryKey) &&
      q.queryKey[0] === productionScheduleQueryKeys.scheduleAll[0] &&
      q.queryKey[1] === 'leaderboard-decorations'
  });
}
