import type { BoardDueSource } from '../d-schedule-minutes/resolve-board-due-date.js';
import { Prisma } from '@prisma/client';

import { prisma } from '../../../lib/prisma.js';
import type { LeaderboardScheduleRowSql } from './leaderboard-schedule-row.types.js';
import type { LeaderboardShellRankJoinContext } from './leaderboard-shell-rank-join.sql.js';
import {
  buildLeaderboardShellRowFromJoins,
  buildLeaderboardShellRowSelectList,
} from './leaderboard-shell-row-projection.sql.js';

export type LeaderboardShellRowQuerySpec = {
  dueSource?: BoardDueSource;
  rankJoins: LeaderboardShellRankJoinContext;
  whereSql: Prisma.Sql;
  orderBySql: Prisma.Sql;
  limitSql?: Prisma.Sql;
};

export async function queryLeaderboardShellScheduleRows(
  spec: LeaderboardShellRowQuerySpec
): Promise<LeaderboardScheduleRowSql[]> {
  const { rankJoins, whereSql, orderBySql, limitSql = Prisma.empty } = spec;
  const selectList = buildLeaderboardShellRowSelectList(rankJoins, spec.dueSource);
  const fromJoins = buildLeaderboardShellRowFromJoins(rankJoins);

  const raw = await prisma.$queryRaw<LeaderboardScheduleRowSql[]>`
    SELECT
      ${selectList}
    ${fromJoins}
    WHERE ${whereSql}
    ORDER BY
      ${orderBySql}
    ${limitSql}
  `;
  return raw ?? [];
}
