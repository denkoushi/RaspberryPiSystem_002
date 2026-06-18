import { Prisma } from '@prisma/client';

import { buildLeaderboardProcessChangeResidualFilterWhereSql } from './leaderboard-process-change-residual.sql.js';
import type { ProcessChangeResidualMode } from './leaderboard-process-change-residual.types.js';

export type LeaderboardLaborMinutesLookupContext = {
  leaderboardMaterializedBaseWhere: Prisma.Sql;
  processChangeResidualMode?: ProcessChangeResidualMode;
  processChangeResidualStrongEvidenceKeys?: ReadonlySet<string>;
};

/**
 * FSIGENCD=10 人工数行の lookup WHERE。
 *
 * - 可視性の正本は表示済み通常行側: `collectDistinctLaborLookupKeys()` が通常行だけから
 *   `ProductNo + FKOJUN` を集め、不可視な通常行のキーは lookup 自体が走らない。
 * - 10 行自身には shell と同じ `fkmail` 可視条件を掛けない（実データで 10 行に fkmail が無い）。
 * - winner materialization（`leaderboardMaterializedBaseWhere`）は維持。
 * - 残骸フィルタは 10 行自身の `ProductNo + FKOJUN + FSIGENCD=10` に対する除外。
 */
export function buildLeaderboardLaborMinutesLookupWhereSql(
  context: LeaderboardLaborMinutesLookupContext
): Prisma.Sql {
  const residualFilterSql = buildLeaderboardProcessChangeResidualFilterWhereSql(
    context.processChangeResidualMode,
    context.processChangeResidualStrongEvidenceKeys
  );
  return Prisma.sql`${context.leaderboardMaterializedBaseWhere} ${residualFilterSql}`;
}

/** 人工数 lookup では fkmail/fkst 可視性 JOIN は不要（表示行由来キーに従属）。 */
export function buildLeaderboardLaborMinutesLookupJoinSql(): Prisma.Sql {
  return Prisma.empty;
}
