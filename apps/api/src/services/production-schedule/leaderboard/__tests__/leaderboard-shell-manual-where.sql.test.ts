import { Prisma } from '@prisma/client';
import { describe, expect, it } from 'vitest';

import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from '../../constants.js';
import { buildLeaderboardShellManualPriorityWhereSql } from '../leaderboard-shell-manual-where.sql.js';

function normalize(sql: Prisma.Sql): string {
  return sql.sql.replace(/\s+/g, ' ');
}

describe('buildLeaderboardShellManualPriorityWhereSql', () => {
  it('narrows candidates by assignment row ids before the EXISTS check', () => {
    const where = buildLeaderboardShellManualPriorityWhereSql({
      commonWhere: Prisma.sql`TRUE`,
      locationKey: '第2工場 - kensakuMain',
      splitEnabled: false
    });
    const sql = normalize(where);

    expect(sql).toContain('"CsvDashboardRow"."id" = ANY(ARRAY( SELECT "ord_c"."csvDashboardRowId"');
    expect(sql.indexOf('= ANY(ARRAY(')).toBeLessThan(sql.indexOf('EXISTS ('));
    expect(sql).toContain('FROM "ProductionScheduleOrderAssignment" AS "ord_m"');
    expect(sql).not.toContain('ProductionScheduleOrderSplitAssignment');
    const idList = sql.slice(sql.indexOf('= ANY(ARRAY('), sql.indexOf(')) AND ('));
    expect(idList).toContain('"ord_c"."csvDashboardId" = ?');
    expect(idList).toContain('( "ord_c"."location" = ? OR "ord_c"."siteKey" = ? )');
    expect(where.values).toEqual([
      PRODUCTION_SCHEDULE_DASHBOARD_ID,
      '第2工場 - kensakuMain',
      '第2工場 - kensakuMain',
      PRODUCTION_SCHEDULE_DASHBOARD_ID,
      '第2工場 - kensakuMain',
      '第2工場 - kensakuMain'
    ]);
  });

  it('includes split parent row ids in both the id list and EXISTS when split is enabled', () => {
    const where = buildLeaderboardShellManualPriorityWhereSql({
      commonWhere: Prisma.sql`TRUE`,
      locationKey: 'loc',
      splitEnabled: true
    });
    const sql = normalize(where);

    const idListEnd = sql.indexOf(')) AND (');
    const idList = sql.slice(sql.indexOf('= ANY(ARRAY('), idListEnd);
    expect(idList).toContain('UNION ALL SELECT "s_c"."parentCsvDashboardRowId"');
    expect(idList).toContain('FROM "ProductionScheduleOrderSplitAssignment" AS "sa_c"');
    expect(idList).toContain('ON "s_c"."id" = "sa_c"."splitId" AND "s_c"."csvDashboardId" = ?');
    expect(idList).toContain('WHERE "sa_c"."csvDashboardId" = ? AND ( "sa_c"."location" = ? OR "sa_c"."siteKey" = ? )');
    expect(where.values.filter((v) => v === 'loc')).toHaveLength(8);
    expect(sql.slice(idListEnd)).toContain('OR EXISTS ( SELECT 1 FROM "ProductionScheduleOrderSplitAssignment" AS "sa_m"');
  });
});
