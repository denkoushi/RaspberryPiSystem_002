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
      locationKey: '第2工場 - kensakuMain'
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

  it('preserves site fallback while excluding legacy assignments from candidates', () => {
    const where = buildLeaderboardShellManualPriorityWhereSql({ commonWhere: Prisma.sql`TRUE`, locationKey: 'loc' });
    const sql = normalize(where);
    expect(sql).not.toContain('UNION');
    expect(sql.match(/FROM "ProductionScheduleOrderAssignment"/g)).toHaveLength(2);
    expect(where.values.filter((value) => value === 'loc')).toHaveLength(4);
  });
});
