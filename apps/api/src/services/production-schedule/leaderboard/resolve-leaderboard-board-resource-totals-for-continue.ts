import { countProductionScheduleDashboardVisibleRowsFromListFilters } from '../production-schedule-query.service.js';
import {
  resolveLeaderboardBoardSnapshotResourceTotal,
  seedLeaderboardBoardSnapshotResourceTotal
} from './leaderboard-composite-board-snapshot-totals.js';

import type { ProductionScheduleListParams } from '../production-schedule-query.service.js';
import type { Prisma } from '@prisma/client';

type ListParamsBase = Omit<ProductionScheduleListParams, 'page' | 'pageSize' | 'responseProfile' | 'resourceCds'>;

export type LeaderboardBoardContinueResourceSlice = {
  resourceCd: string;
  snapshotId?: string;
};

/**
 * continue 応答用のスロット別 total。shell 時に seed した snapshot total を優先し、
 * キャッシュミス時のみ従来どおり COUNT する（出力同値・安全側フォールバック）。
 */
export async function resolveLeaderboardBoardResourceTotalsForContinue(
  listParamsBase: ListParamsBase,
  resourceSlices: ReadonlyArray<LeaderboardBoardContinueResourceSlice>,
  processChangeResidualStrongEvidenceKeys?: ReadonlySet<string>,
  leaderboardMaterializedBaseWhere?: Prisma.Sql | Promise<Prisma.Sql>
): Promise<number[]> {
  return Promise.all(
    resourceSlices.map(async (slice) => {
      const cached = resolveLeaderboardBoardSnapshotResourceTotal(slice.snapshotId);
      if (cached !== undefined) {
        return cached;
      }
      const total = await countProductionScheduleDashboardVisibleRowsFromListFilters(
        {
          queryText: listParamsBase.queryText,
          productNos: listParamsBase.productNos,
          machineName: listParamsBase.machineName,
          resourceCds: [slice.resourceCd],
          assignedOnlyCds: listParamsBase.assignedOnlyCds,
          resourceCategory: listParamsBase.resourceCategory,
          hasNoteOnly: listParamsBase.hasNoteOnly,
          hasDueDateOnly: listParamsBase.hasDueDateOnly,
          allowResourceOnly: listParamsBase.allowResourceOnly,
          completionFilter: listParamsBase.completionFilter,
          locationKey: listParamsBase.locationKey,
          siteKey: listParamsBase.siteKey,
          processChangeResidualMode: 'normal',
          processChangeResidualStrongEvidenceKeys
        },
        {
          leaderboardMaterializedBaseWhere: await leaderboardMaterializedBaseWhere
        }
      );
      if (slice.snapshotId) {
        seedLeaderboardBoardSnapshotResourceTotal(slice.snapshotId, total);
      }
      return total;
    })
  );
}
