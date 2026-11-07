import { prisma } from '../../../lib/prisma.js';
import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from '../constants.js';
import { fetchMaxProductNoWinnerRowIdsForDashboard } from '../row-resolver/index.js';

/** 独自の世代キャッシュ。順位ボード用 generation cache は再利用しない。 */
let cached: { token: string; rowIds: string[]; revision: number } | undefined;
const inflight = new Map<string, Promise<string[]>>();
let revision = 0;

export async function fetchLoadBalancingWinnerRowIds(generationToken: string): Promise<string[]> {
  if (cached?.token === generationToken) return cached.rowIds;
  const running = inflight.get(generationToken);
  if (running) return running;
  const loadRevision = ++revision;
  const promise = fetchMaxProductNoWinnerRowIdsForDashboard({
    prisma,
    csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID
  }).then((rowIds) => {
    if ((cached?.revision ?? 0) < loadRevision) cached = { token: generationToken, rowIds, revision: loadRevision };
    return rowIds;
  }).finally(() => {
    if (inflight.get(generationToken) === promise) inflight.delete(generationToken);
  });
  inflight.set(generationToken, promise);
  return promise;
}

export function clearLoadBalancingWinnerRowIdsCacheForTests(): void {
  cached = undefined;
  inflight.clear();
}
