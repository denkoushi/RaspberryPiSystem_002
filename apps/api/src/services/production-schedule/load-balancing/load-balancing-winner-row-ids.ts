import { prisma } from '../../../lib/prisma.js';
import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from '../constants.js';
import { fetchMaxProductNoWinnerRowIdsForDashboard } from '../row-resolver/index.js';

/**
 * 負荷調整リクエスト内で winner 行 id を 1 回だけ取得するための境界。
 * 順位ボード用 generation cache は使わない（モジュール境界を跨がない）。
 */
export async function fetchLoadBalancingWinnerRowIds(): Promise<string[]> {
  return fetchMaxProductNoWinnerRowIdsForDashboard({
    prisma,
    csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID
  });
}
