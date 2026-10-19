import { Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  queryRaw: vi.fn(),
  splitFindMany: vi.fn()
}));

vi.mock('../../../../lib/prisma.js', () => ({
  prisma: {
    $queryRaw: mocks.queryRaw,
    productionScheduleOrderSplit: { findMany: mocks.splitFindMany }
  }
}));

import { fetchLeaderboardScheduleHydratedRowsOrderedByIds } from '../leaderboard-shell-hydrate.service.js';
import {
  clearLeaderboardCanonicalRowCacheForTests,
  getLeaderboardCanonicalRows,
  putLeaderboardCanonicalRows
} from '../leaderboard-canonical-row-cache.js';
import type { LeaderboardScheduleRowSql } from '../leaderboard-schedule-row.types.js';
import { resolveHydrateSourceRowIdsFromDisplayItemIds } from '../../order-split/production-schedule-order-split.service.js';

const baseWhere = Prisma.sql`TRUE`;
const canonicalScope = {
  canonicalSourceSiteKey: 'site-a',
  canonicalSourceGenerationToken: 'generation-1'
};

function row(id: string, overrides: Partial<LeaderboardScheduleRowSql> = {}): LeaderboardScheduleRowSql {
  return {
    id,
    seibanJoinKey: 'ORDER-A',
    occurredAt: new Date('2026-09-09T00:00:00.000Z'),
    updatedAt: new Date('2026-09-09T00:00:00.000Z'),
    rowData: {
      ProductNo: 'PRODUCT-1',
      FSEIBAN: 'ORDER-A',
      FHINCD: 'PART-1',
      FSIGENCD: '305',
      FKOJUN: '1'
    },
    processingOrder: null,
    globalRank: null,
    note: null,
    processingType: null,
    dueDate: null,
    plannedQuantity: null,
    plannedStartDate: null,
    plannedEndDate: null,
    ...overrides
  };
}

function fetchRows(params: {
  rowIds: readonly string[];
  locationKey?: string;
  siteScopedGlobalRankLocation?: string;
  includePlanningDetails?: boolean;
  includeRank?: boolean;
  planningSource?: boolean;
  planningDetailsOnly?: boolean;
  siteKey?: string;
  generationToken?: string;
  canonical?: boolean;
}): Promise<LeaderboardScheduleRowSql[]> {
  const hydrateParams = {
    orderedRowIds: params.rowIds,
    locationKey: params.locationKey ?? 'location-a',
    siteScopedGlobalRankLocation: params.siteScopedGlobalRankLocation ?? 'site-a',
    leaderboardMaterializedBaseWhere: baseWhere,
    includePlanningDetails: params.includePlanningDetails,
    includeRank: params.includeRank,
    planningSource: params.planningSource,
    planningDetailsOnly: params.planningDetailsOnly,
    ...(params.canonical === false
      ? {}
      : {
          canonicalSourceSiteKey: params.siteKey ?? canonicalScope.canonicalSourceSiteKey,
          canonicalSourceGenerationToken: params.generationToken ?? canonicalScope.canonicalSourceGenerationToken
        })
  };
  return fetchLeaderboardScheduleHydratedRowsOrderedByIds(hydrateParams);
}

describe('leaderboard hydrate canonical cache flow', () => {
  beforeEach(() => {
    clearLeaderboardCanonicalRowCacheForTests();
    mocks.queryRaw.mockReset();
    mocks.splitFindMany.mockReset();
  });

  it('lets the new hydrate reader consume a row seeded by the old reader without SQL', async () => {
    const seeded = row('row-1', { processingOrder: 4, globalRank: 2 });
    putLeaderboardCanonicalRows({
      key: { siteKey: 'site-a', generationToken: 'generation-1', rankContext: 'location-a|site-a' },
      rows: [seeded],
      coverage: 'rank'
    });

    await expect(fetchRows({ rowIds: ['row-1'], includeRank: true })).resolves.toEqual([seeded]);
    expect(mocks.queryRaw).not.toHaveBeenCalled();
  });

  it('detects rank cache poisoning when a planning-source row omits old identity fields', async () => {
    const oldRow = row('row-1', {
      rowData: {
        ProductNo: 'PRODUCT-1',
        FSEIBAN: 'ORDER-A',
        FHINCD: 'PART-1',
        FHINMEI: 'old part name',
        FSIGENCD: '305',
        FKOJUN: '1',
        FKOJUNST: 'old status',
        progress: '0'
      },
      processingOrder: 5,
      globalRank: 2,
      note: 'old note',
      processingType: 'grinding'
    });
    const sqlText = (value: unknown): string => {
      if (Array.isArray(value)) return value.map(sqlText).join(' ');
      if (value && typeof value === 'object') {
        const strings = (value as { strings?: unknown }).strings;
        if (strings !== undefined) return sqlText(strings);
      }
      return String(value);
    };
    mocks.queryRaw.mockImplementation(async (...args: unknown[]) => {
      // The first call is the real old list-reader projection. Its result is
      // used as the mergedPrefix-like canonical seed below.
      if (mocks.queryRaw.mock.calls.length === 1) return [oldRow];
      const sql = args.map(sqlText).join(' ');
      // A corrected backend uses the complete old hydrate projection whenever
      // rank coverage is requested; the current planning-source projection
      // omits these fields and is expected to fail the assertions below.
      return sql.includes("'FKOJUNST'")
        ? [oldRow]
        : [row('row-1', {
            rowData: { FSEIBAN: 'ORDER-A', FHINCD: 'PART-1', FSIGENCD: '305', FKOJUN: '1' },
            processingOrder: null,
            globalRank: null,
            note: null,
            processingType: null
          })];
    });

    const oldSeed = await fetchRows({ rowIds: ['row-1'], includeRank: true, canonical: false });
    expect(oldSeed[0]?.rowData).toEqual(oldRow.rowData);
    putLeaderboardCanonicalRows({
      key: { siteKey: 'site-a', generationToken: 'generation-1', rankContext: 'location-a|site-a' },
      rows: oldSeed,
      coverage: 'identity'
    });
    await fetchRows({ rowIds: ['row-1'], includeRank: true, planningSource: true });
    const oldReader = await fetchRows({ rowIds: ['row-1'], includeRank: true });

    expect(oldReader[0]?.rowData).toEqual(oldRow.rowData);
    expect(oldReader[0]?.processingOrder).toBe(5);
    expect(oldReader[0]?.globalRank).toBe(2);
    expect(oldReader[0]?.note).toBe('old note');
    expect(oldReader[0]?.processingType).toBe('grinding');
    expect(mocks.queryRaw).toHaveBeenCalledTimes(2);
  });

  it('shares planning supplement results back to the old hydrate reader without losing identity or rank', async () => {
    const seeded = row('row-1', {
      rowData: {
        ProductNo: 'PRODUCT-1',
        FSEIBAN: 'ORDER-A',
        FHINCD: 'PART-1',
        FHINMEI: 'long name',
        FSIGENCD: '305',
        FKOJUN: '1'
      },
      processingOrder: 7,
      globalRank: 3,
      note: 'old note',
      processingType: 'grinding'
    });
    putLeaderboardCanonicalRows({
      key: { siteKey: 'site-a', generationToken: 'generation-1', rankContext: 'none' },
      rows: [seeded],
      coverage: 'identity'
    });

    const supplement = row('row-1', {
      rowData: null,
      processingOrder: null,
      globalRank: null,
      note: null,
      processingType: null,
      dueDate: new Date('2026-09-20T00:00:00.000Z'),
      plannedQuantity: 5,
      planningDetail: {
        detailUpdatedAt: null,
        progressUpdatedAt: null,
        externalUpdatedAt: null,
        dueDate: new Date('2026-09-20T00:00:00.000Z'),
        plannedQuantity: 5,
        plannedEndDate: null,
        isCompleted: false,
        isExternallyCompleted: false,
        splits: []
      }
    });
    mocks.queryRaw.mockResolvedValueOnce([supplement]);

    const planning = await fetchRows({
      rowIds: ['row-1'],
      includePlanningDetails: true,
      includeRank: false,
      planningSource: true,
      planningDetailsOnly: true
    });
    expect(planning[0]?.planningDetail?.plannedQuantity).toBe(5);

    const oldReader = await fetchRows({ rowIds: ['row-1'], includeRank: false });
    expect(oldReader[0]?.planningDetail?.plannedQuantity).toBe(5);
    expect(oldReader[0]?.rowData).toEqual(seeded.rowData);
    expect(oldReader[0]?.processingOrder).toBe(7);
    expect(oldReader[0]?.globalRank).toBe(3);
    expect(mocks.queryRaw).toHaveBeenCalledTimes(1);
  });

  it('does not reuse a cached row across site, generation, or rank context', async () => {
    const seeded = row('row-1', { processingOrder: 4, globalRank: 2 });
    putLeaderboardCanonicalRows({
      key: { siteKey: 'site-a', generationToken: 'generation-1', rankContext: 'location-a|site-a' },
      rows: [seeded],
      coverage: 'rank'
    });
    mocks.queryRaw.mockResolvedValue([row('row-1')]);

    await fetchRows({ rowIds: ['row-1'], includeRank: true, siteKey: 'site-b' });
    await fetchRows({ rowIds: ['row-1'], includeRank: true, generationToken: 'generation-2' });
    await fetchRows({ rowIds: ['row-1'], includeRank: true, locationKey: 'location-b' });

    expect(mocks.queryRaw).toHaveBeenCalledTimes(3);
  });

  it('hydrates an expanded split display item through its parent and never caches split ids', async () => {
    const splitId = '11111111-1111-4111-8111-111111111111';
    mocks.splitFindMany.mockResolvedValue([{ parentCsvDashboardRowId: 'parent-1' }]);
    mocks.queryRaw.mockResolvedValueOnce([row('parent-1')]);

    const sourceRowIds = await resolveHydrateSourceRowIdsFromDisplayItemIds([`split:${splitId}`]);
    expect(sourceRowIds).toEqual(['parent-1']);
    await fetchRows({ rowIds: sourceRowIds, includeRank: false });
    await fetchRows({ rowIds: ['parent-1'], includeRank: false });

    expect(getLeaderboardCanonicalRows({
      key: { siteKey: 'site-a', generationToken: 'generation-1', rankContext: 'none' },
      rowIds: [`split:${splitId}`],
      coverage: 'identity'
    }).missingIds).toEqual([`split:${splitId}`]);
    expect(mocks.queryRaw).toHaveBeenCalledTimes(1);
  });
});
