import { Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ queryRaw: vi.fn() }));
vi.mock('../../../lib/prisma.js', () => ({ prisma: { $queryRaw: mocks.queryRaw } }));
vi.mock('../production-schedule-query/filters.js', () => ({
  prepareProductionScheduleDashboardFilters: vi.fn(async (params: { planningFseibans: string[]; resourceCategory?: string }) => ({
    kind: 'ready',
    queryWhere: Prisma.sql`AND "CsvDashboardRow"."rowData"->>'FSEIBAN' = ANY(${params.planningFseibans}::text[])
      ${params.resourceCategory ? Prisma.sql`AND "CsvDashboardRow"."rowData"->>'FSIGENCD' = ${'305'}` : Prisma.empty}`
  }))
}));
vi.mock('../policies/resource-category-policy.service.js', () => ({
  getResourceCategoryPolicy: vi.fn(async () => ({ cuttingExcludedResourceCds: [] })),
  normalizeProductionScheduleResourceCd: (value: string) => value
}));

import { readPlanningSource } from '../grinding-planning-board/source.js';
import { fetchLeaderboardPlanningScopedParentRowIds } from '../leaderboard/leaderboard-row-selection.service.js';
import { clearLeaderboardMaterializedWinnerCacheForTests } from '../leaderboard/leaderboard-materialized-winner-cache.js';
import { clearLeaderboardCanonicalRowCacheForTests } from '../leaderboard/leaderboard-canonical-row-cache.js';
import { buildProductionScheduleDashboardBaseWhereWithMaterializedMaxProductNoWinners } from '../row-resolver/max-product-no-winner-materialization.js';
import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from '../constants.js';

const dashboardWhere = Prisma.sql`"CsvDashboardRow"."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}`;
const updatedAt = new Date('2026-09-09T00:00:00Z');
const row = (id: string, resourceCd: string, productNo: string) => ({
  id, updatedAt,
  rowData: { FSEIBAN: 'ORDER-A', FHINCD: 'PART-A', FSIGENCD: resourceCd, FKOJUN: '1', ProductNo: productNo },
  planningDetail: {
    dueDate: '2026-09-20', plannedQuantity: 5, plannedEndDate: null,
    isCompleted: resourceCd === '100', isExternallyCompleted: false,
    progressUpdatedAt: updatedAt, externalUpdatedAt: null, splits: []
  }
});
// b is an older ProductNo for exactly the same logical key as c, not just the same seiban.
const candidates = [row('a', '100', '1'), row('b', '305', '1'), row('c', '305', '2'), row('d', '305', '3')];
candidates[3]!.rowData.FHINCD = 'PART-B';
const winnerIds = ['d', 'a', 'c']; // Intentionally different from SQL ID order.

function asSql(first: Prisma.Sql | TemplateStringsArray, values: unknown[]): Prisma.Sql {
  return Array.isArray(first) ? Prisma.sql(first as TemplateStringsArray, ...values) : first as Prisma.Sql;
}

describe('planning source bounded winner scope', () => {
  beforeEach(() => {
    mocks.queryRaw.mockReset();
    clearLeaderboardMaterializedWinnerCacheForTests();
    clearLeaderboardCanonicalRowCacheForTests();
  });

  it.each([winnerIds, []].map((ids) => ({ ids })))('preserves legacy selector IDs and SQL order for winner set $ids', async ({ ids }) => {
    const winners = new Set(ids);
    const fullWhere = buildProductionScheduleDashboardBaseWhereWithMaterializedMaxProductNoWinners(PRODUCTION_SCHEDULE_DASHBOARD_ID, ids);
    const queryWhere = Prisma.sql`AND "CsvDashboardRow"."rowData"->>'FSEIBAN' = ${'ORDER-A'}`;
    mocks.queryRaw.mockImplementation(async (query: Prisma.Sql) => {
      expect(query.sql).toContain('ORDER BY "CsvDashboardRow"."id" ASC');
      // Model SQL membership for the legacy query; the new query returns all scoped candidates.
      return candidates.filter((r) => (query.values.some(Array.isArray) || query.sql.includes('FALSE')) ? winners.has(r.id) : true);
    });
    const legacy = await fetchLeaderboardPlanningScopedParentRowIds({ leaderboardMaterializedBaseWhere: fullWhere, queryWhere });
    const bounded = await fetchLeaderboardPlanningScopedParentRowIds({ leaderboardMaterializedBaseWhere: dashboardWhere, winnerRowIds: winners, queryWhere });
    expect(bounded).toEqual(legacy);
    expect(bounded).toEqual(candidates.filter((r) => winners.has(r.id)).map((r) => r.id));
    expect(bounded).not.toContain('b');
    const boundedQuery = mocks.queryRaw.mock.calls[1]![0] as Prisma.Sql;
    expect(boundedQuery.values).not.toContainEqual(ids);
  });

  it('never sends the 107k winner array in category/progress selection or hydrate, and retains source fields', async () => {
    const allWinnerIds = [...winnerIds, ...Array.from({ length: 107_000 }, (_, i) => `unrelated-${i}`)];
    const queries: Prisma.Sql[] = [];
    mocks.queryRaw.mockImplementation(async (first: Prisma.Sql | TemplateStringsArray, ...values: unknown[]) => {
      const query = asSql(first, values);
      queries.push(query);
      if (query.sql.includes('ROW_NUMBER()')) return allWinnerIds.map((id) => ({ id }));
      expect(JSON.stringify(query.values)).not.toContain('unrelated-');
      if (query.sql.includes('ORDER BY "CsvDashboardRow"."id" ASC')) {
        expect(query.values).toContainEqual(['ORDER-A']);
        return candidates.filter((r) => !query.values.includes('305') || r.rowData.FSIGENCD === '305');
      }
      // Hydration still receives explicit IDs only, all already winner-filtered.
      const ids = [...new Set(query.values.filter((v): v is string => typeof v === 'string' && candidates.some((r) => r.id === v)))];
      expect(ids).not.toContain('b');
      return ids.map((id) => {
        const r = candidates.find((candidate) => candidate.id === id)!;
        return { ...r, rowData: query.sql.includes('NULL::jsonb') ? null : r.rowData };
      });
    });

    const source = await readPlanningSource({ siteKey: 'site-a', category: 'grinding', fseibans: [' ORDER-A ', 'ORDER-A'], leaderboardGenerationToken: 'generation-a' });
    expect(source.rows).toEqual(candidates.filter((r) => ['c', 'd'].includes(r.id)).map(({ id, rowData, updatedAt }) => ({ id, rowData, updatedAt })));
    expect([...source.details.keys()]).toEqual(['c', 'd']);
    expect(source.details.get('c')).toMatchObject({
      updatedAt, rowNotes: [{ dueDate: new Date('2026-09-20') }],
      orderSupplements: [{ plannedQuantity: 5, plannedEndDate: null }], orderSplits: []
    });
    expect(source.progressRows).toEqual(candidates.filter((r) => winnerIds.includes(r.id)).map((r) => ({
      rowId: r.id, fseiban: r.rowData.FSEIBAN, productNo: r.rowData.ProductNo, fhincd: r.rowData.FHINCD,
      isCompleted: r.planningDetail.isCompleted
    })));
    expect(queries.filter((q) => q.sql.includes('ROW_NUMBER()'))).toHaveLength(1);
    expect(queries.filter((q) => q.sql.includes('ORDER BY "CsvDashboardRow"."id" ASC'))).toHaveLength(2);
    expect(queries.filter((q) => q.sql.includes('ORDER BY array_position'))).toHaveLength(3);
    // Other callers (including load summary) still receive the original complete baseWhere.
    expect(source.baseWhere.values).toContainEqual(allWinnerIds);
  });
});
