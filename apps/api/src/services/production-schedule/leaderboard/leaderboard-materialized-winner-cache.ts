import { Prisma } from '@prisma/client';

import type { PrismaClientLike } from '../row-resolver/max-product-no-winner-materialization.js';
import { buildProductionScheduleLeaderboardMaterializedBaseWhere } from '../row-resolver/max-product-no-winner-materialization.js';
import { readLeaderboardShellSnapshotGenerationToken } from './leaderboard-shell-snapshot-generation.js';

type MaterializedWinnerCacheEntry = {
  generationToken: string;
  baseWhere: Prisma.Sql;
};

type InflightMaterializedWinnerBuild = {
  generationToken: string;
  promise: Promise<Prisma.Sql>;
};

/** 単一ダッシュボード向け。世代トークン一致時に winner materialization を再利用する。 */
let cachedEntry: MaterializedWinnerCacheEntry | undefined;
let inflightBuild: InflightMaterializedWinnerBuild | undefined;

/**
 * decorations / planning board / shell / continue の同一世代の winner baseWhere を再利用する。
 * generationToken は readLeaderboardShellSnapshotGenerationToken /
 * readGrindingPlanningBoardSnapshotGenerationToken が返す leaderboard shell snapshot 世代文字列を渡す。
 * 非空の token を指定した場合は世代を再読込しない。
 */
export async function resolveLeaderboardMaterializedBaseWhereWithGenerationCache(
  prisma: PrismaClientLike,
  options?: { generationToken?: string }
): Promise<Prisma.Sql> {
  const generationToken = options?.generationToken || await readLeaderboardShellSnapshotGenerationToken();

  if (cachedEntry?.generationToken === generationToken) {
    return cachedEntry.baseWhere;
  }

  if (inflightBuild?.generationToken === generationToken) {
    return inflightBuild.promise;
  }

  const promise = buildProductionScheduleLeaderboardMaterializedBaseWhere(prisma)
    .then((baseWhere) => {
      cachedEntry = { generationToken, baseWhere };
      if (inflightBuild?.generationToken === generationToken) {
        inflightBuild = undefined;
      }
      return baseWhere;
    })
    .catch((error) => {
      if (inflightBuild?.generationToken === generationToken) {
        inflightBuild = undefined;
      }
      throw error;
    });

  inflightBuild = { generationToken, promise };
  return promise;
}

/** テスト用 */
export function clearLeaderboardMaterializedWinnerCacheForTests(): void {
  cachedEntry = undefined;
  inflightBuild = undefined;
}
