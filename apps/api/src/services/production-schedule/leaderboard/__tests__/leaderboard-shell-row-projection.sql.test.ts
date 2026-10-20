import { Prisma } from '@prisma/client';
import { describe, expect, it } from 'vitest';

import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from '../../constants.js';
import {
  buildLeaderboardShellRowAuxiliaryJoins,
  buildLeaderboardShellRowSelectList,
} from '../leaderboard-shell-row-projection.sql.js';
import { buildLeaderboardShellRankJoinContext } from '../leaderboard-shell-rank-join.sql.js';

function normalize(sql: Prisma.Sql): string {
  return sql.sql.replace(/\s+/g, ' ');
}

const rankJoins = buildLeaderboardShellRankJoinContext({
  locationKey: '第2工場 - kensakuMain',
  siteScopedGlobalRankLocation: '第2工場',
});

describe('leaderboard shell row projection', () => {
  it('does not join part processing types before ORDER BY / LIMIT', () => {
    const joins = normalize(buildLeaderboardShellRowAuxiliaryJoins(rankJoins));

    expect(joins).not.toContain('ProductionSchedulePartProcessingType');
    expect(joins).not.toContain('"pp"');
  });

  it('reads the part processing type with a scalar subquery keyed by dashboard and FHINCD', () => {
    const select = buildLeaderboardShellRowSelectList(rankJoins);
    const sql = normalize(select);

    expect(sql).toContain(
      'COALESCE(( SELECT "pp"."processingType" FROM "ProductionSchedulePartProcessingType" AS "pp" ' +
        'WHERE "pp"."csvDashboardId" = ? AND "pp"."fhincd" = ("CsvDashboardRow"."rowData"->>\'FHINCD\') ), ' +
        '"n"."processingType") AS "processingType"'
    );
    expect(select.values).toContain(PRODUCTION_SCHEDULE_DASHBOARD_ID);
  });
});
