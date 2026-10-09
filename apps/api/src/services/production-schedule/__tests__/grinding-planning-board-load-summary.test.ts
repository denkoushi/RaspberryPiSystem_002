import { Prisma } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';

import {
  buildGrindingPlanningBoardLoadSummary,
  readGrindingPlanningBoardLoadSummary,
  type GrindingPlanningBoardLoadSummaryRow
} from '../grinding-planning-board-load-summary.js';

const row = (
  itemId: string,
  overrides: Partial<GrindingPlanningBoardLoadSummaryRow> = {}
): GrindingPlanningBoardLoadSummaryRow => ({
  itemId,
  sourceRowId: 'source-1',
  kind: 'row',
  originalResourceCd: 'G-01',
  effectiveResourceCd: 'G-01',
  requiredMinutes: 100,
  requiredMinutesKnown: true,
  isCompleted: false,
  ...overrides
});

describe('grinding-planning-board-load-summary', () => {
  it('keeps original and effective resource totals separate and counts unknowns', () => {
    const result = buildGrindingPlanningBoardLoadSummary([
      row('moved', { effectiveResourceCd: 'G-02' }),
      row('unknown', { itemId: 'unknown', requiredMinutes: null, requiredMinutesKnown: false }),
      row('done', { itemId: 'done', isCompleted: true, effectiveResourceCd: 'G-03' })
    ]);

    expect(result).toEqual({
      load: [
        {
          resourceCd: 'G-01',
          originalItemCount: 2,
          alternateItemCount: 1,
          originalRequiredMinutes: 100,
          alternateRequiredMinutes: null,
          unfinishedItemCount: 1,
          requiredMinutes: null,
          unknownItemCount: 1,
          originalUnknownItemCount: 1,
          alternateUnknownItemCount: 1
        },
        {
          resourceCd: 'G-02',
          originalItemCount: 0,
          alternateItemCount: 1,
          originalRequiredMinutes: 0,
          alternateRequiredMinutes: 100,
          unfinishedItemCount: 1,
          requiredMinutes: 100,
          unknownItemCount: 0,
          originalUnknownItemCount: 0,
          alternateUnknownItemCount: 0
        }
      ],
      unknownRequiredMinutesCount: 1
    });
  });

  it('counts split items once and suppresses the unsplit parent', () => {
    const result = buildGrindingPlanningBoardLoadSummary([
      row('row:source-1', { requiredMinutes: 100 }),
      row('split:1', { itemId: 'split:1', kind: 'split', requiredMinutes: 33 }),
      row('split:2', { itemId: 'split:2', kind: 'split', requiredMinutes: 67 }),
      row('split:2-duplicate', { itemId: 'split:2', kind: 'split', requiredMinutes: 67 })
    ]);

    expect(result.load).toEqual([
      {
        resourceCd: 'G-01',
        originalItemCount: 2,
        alternateItemCount: 2,
        originalRequiredMinutes: 100,
        alternateRequiredMinutes: 100,
        unfinishedItemCount: 2,
        requiredMinutes: 100,
        unknownItemCount: 0,
        originalUnknownItemCount: 0,
        alternateUnknownItemCount: 0
      }
    ]);
    expect(result.unknownRequiredMinutesCount).toBe(0);
  });

  it('aggregates rows from unselected seiban and ignores rows without a resource', () => {
    const result = buildGrindingPlanningBoardLoadSummary([
      row('selected', { sourceRowId: 'selected-source', originalResourceCd: 'G-01', effectiveResourceCd: 'G-02' }),
      row('unselected', { itemId: 'unselected', sourceRowId: 'unselected-source', originalResourceCd: 'G-03', effectiveResourceCd: 'G-03', requiredMinutes: 12 }),
      row('unassigned', { itemId: 'unassigned', sourceRowId: 'unassigned-source', originalResourceCd: null, effectiveResourceCd: null, requiredMinutes: null, requiredMinutesKnown: false })
    ]);

    expect(result.load.map((entry) => [entry.resourceCd, entry.originalItemCount, entry.alternateItemCount])).toEqual([
      ['G-01', 1, 0],
      ['G-02', 0, 1],
      ['G-03', 1, 1]
    ]);
    expect(result.unknownRequiredMinutesCount).toBe(0);
  });

  it('reduces materialized aggregate rows without changing the load payload contract', async () => {
    const queryRaw = vi.fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          originalResourceCd: ' G-01 ',
          effectiveResourceCd: 'G-02',
          itemCount: 2n,
          unknownItemCount: 1n,
          requiredMinutesSum: 5
        },
        {
          originalResourceCd: null,
          effectiveResourceCd: 'G-03',
          itemCount: 4n,
          unknownItemCount: 4n,
          requiredMinutesSum: null
        }
      ]);

    const result = await readGrindingPlanningBoardLoadSummary({
      client: { $queryRaw: queryRaw } as never,
      siteKey: 'site-a',
      category: 'grinding',
      splitEnabled: true,
      leaderboardMaterializedBaseWhere: Prisma.sql`TRUE`,
      isResourceInCategory: (resourceCd, category) => category === 'grinding' && resourceCd.startsWith('G-')
    });

    expect(queryRaw).toHaveBeenCalledTimes(2);
    expect(result).toEqual({
      load: [
        {
          resourceCd: 'G-01',
          originalItemCount: 2,
          alternateItemCount: 0,
          originalRequiredMinutes: 5,
          alternateRequiredMinutes: 0,
          unfinishedItemCount: 0,
          requiredMinutes: 0,
          unknownItemCount: 0,
          originalUnknownItemCount: 1,
          alternateUnknownItemCount: 0
        },
        {
          resourceCd: 'G-02',
          originalItemCount: 0,
          alternateItemCount: 2,
          originalRequiredMinutes: 0,
          alternateRequiredMinutes: 5,
          unfinishedItemCount: 2,
          requiredMinutes: 5,
          unknownItemCount: 1,
          originalUnknownItemCount: 0,
          alternateUnknownItemCount: 1
        }
      ],
      unknownRequiredMinutesCount: 1
    });
  });
});

describe('materialized load aggregate cache', () => {
  function setup() {
    const aggregates = [
      { originalResourceCd: 'G-01', effectiveResourceCd: 'G-02', itemCount: 2n, unknownItemCount: 1n, requiredMinutesSum: 20 },
      { originalResourceCd: 'C-01', effectiveResourceCd: 'C-01', itemCount: 1n, unknownItemCount: 0n, requiredMinutesSum: 5 }
    ];
    const queryRaw = vi.fn(async (sql: Prisma.Sql) => sql.sql.includes('effectiveItems') ? aggregates : []);
    const readGenerationToken = vi.fn().mockResolvedValue('generation-1');
    const measure = vi.fn<(phase: string) => void>();
    const params = {
      client: { $queryRaw: queryRaw } as never,
      siteKey: 'site-a', category: 'grinding' as const, splitEnabled: true,
      leaderboardMaterializedBaseWhere: Prisma.sql`"CsvDashboardRow"."id" = ANY(${['row-2', 'row-1']}::text[])`,
      isResourceInCategory: (cd: string, category: 'grinding' | 'cutting') => cd.startsWith(category === 'grinding' ? 'G-' : 'C-'),
      cache: { generationToken: 'generation-1', readGenerationToken, performance: {
        async measure<T>(phase: string, work: () => Promise<T>): Promise<T> {
          measure(phase);
          return work();
        },
        flush: vi.fn()
      } }
    };
    const aggregateCalls = () => queryRaw.mock.calls.filter(([sql]: [Prisma.Sql]) => sql.sql.includes('effectiveItems')).length;
    return { params, aggregates, queryRaw, readGenerationToken, measure, aggregateCalls };
  }

  it('shares concurrent SQL, reduces each category separately and normalizes winner membership order', async () => {
    const { params, queryRaw, aggregates, measure, aggregateCalls } = setup();
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    queryRaw.mockImplementation(async (sql: Prisma.Sql) => {
      if (!sql.sql.includes('effectiveItems')) return [];
      await gate;
      return aggregates;
    });
    const grinding = readGrindingPlanningBoardLoadSummary(params);
    const cutting = readGrindingPlanningBoardLoadSummary({ ...params, category: 'cutting',
      leaderboardMaterializedBaseWhere: Prisma.sql`"CsvDashboardRow"."id" = ANY(${['row-1', 'row-2']}::text[])` });
    await vi.waitFor(() => expect(aggregateCalls()).toBe(1));
    release?.();
    expect((await grinding).unknownRequiredMinutesCount).toBe(1);
    expect((await cutting).load[0]).toMatchObject({ resourceCd: 'C-01', requiredMinutes: 5 });
    await readGrindingPlanningBoardLoadSummary(params);
    expect(aggregateCalls()).toBe(1);
    expect(measure.mock.calls.map(([phase]) => phase)).toEqual(['loadSummaryCompute', 'loadSummaryCacheHit', 'loadSummaryCacheHit']);
  });

  it('recomputes on generation changes and discards the previous generation', async () => {
    const { params, readGenerationToken, aggregateCalls } = setup();
    await readGrindingPlanningBoardLoadSummary(params);
    readGenerationToken.mockResolvedValue('generation-2');
    await readGrindingPlanningBoardLoadSummary({ ...params, cache: { ...params.cache, generationToken: 'generation-2' } });
    readGenerationToken.mockResolvedValue('generation-1');
    await readGrindingPlanningBoardLoadSummary(params);
    expect(aggregateCalls()).toBe(3);
  });

  it('isolates sites, split flags and base predicates', async () => {
    const { params, aggregateCalls } = setup();
    await readGrindingPlanningBoardLoadSummary(params);
    await readGrindingPlanningBoardLoadSummary({ ...params, siteKey: 'site-b' });
    await readGrindingPlanningBoardLoadSummary({ ...params, splitEnabled: false });
    await readGrindingPlanningBoardLoadSummary({ ...params, leaderboardMaterializedBaseWhere: Prisma.sql`FALSE` });
    expect(aggregateCalls()).toBe(4);
  });

  it('removes a failed shared promise and allows a subsequent retry', async () => {
    const { params, queryRaw, aggregates, aggregateCalls } = setup();
    const failure = new Error('aggregate SQL failed');
    let fail = true;
    queryRaw.mockImplementation(async (sql: Prisma.Sql) => {
      if (!sql.sql.includes('effectiveItems')) return [];
      if (fail) throw failure;
      return aggregates;
    });
    const results = await Promise.allSettled([
      readGrindingPlanningBoardLoadSummary(params), readGrindingPlanningBoardLoadSummary({ ...params, category: 'cutting' })
    ]);
    expect(results).toEqual([{ status: 'rejected', reason: failure }, { status: 'rejected', reason: failure }]);
    fail = false;
    await readGrindingPlanningBoardLoadSummary(params);
    expect(aggregateCalls()).toBe(2);
  });

  it('does not retain results when the generation changes during SQL', async () => {
    const { params, readGenerationToken, aggregateCalls } = setup();
    readGenerationToken.mockResolvedValueOnce('generation-2');
    await expect(readGrindingPlanningBoardLoadSummary(params)).rejects.toMatchObject({ code: 'STALE_PLANNING_BOARD_SNAPSHOT' });
    await readGrindingPlanningBoardLoadSummary(params);
    expect(aggregateCalls()).toBe(2);
  });

  it('recomputes a completed aggregate after its fixed lifetime', async () => {
    const { params, aggregateCalls } = setup();
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
    try {
      await readGrindingPlanningBoardLoadSummary(params);
      now.mockReturnValue(1_000_000 + 12 * 60 * 60 * 1000 - 1);
      await readGrindingPlanningBoardLoadSummary(params);
      expect(aggregateCalls()).toBe(1);
      now.mockReturnValue(1_000_000 + 12 * 60 * 60 * 1000);
      await readGrindingPlanningBoardLoadSummary(params);
      expect(aggregateCalls()).toBe(1);
      now.mockReturnValue(1_000_000 + 12 * 60 * 60 * 1000 + 1);
      await readGrindingPlanningBoardLoadSummary(params);
      expect(aggregateCalls()).toBe(2);
    } finally {
      now.mockRestore();
    }
  });

  it('keeps a newer in-flight aggregate when an older generation arrives late', async () => {
    const { params, queryRaw, aggregates, readGenerationToken, aggregateCalls } = setup();
    readGenerationToken.mockResolvedValue('generation-2');
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    queryRaw.mockImplementation(async (sql: Prisma.Sql) => {
      if (!sql.sql.includes('effectiveItems')) return [];
      await gate;
      return aggregates;
    });
    const newer = { ...params, cache: { ...params.cache, generationToken: 'generation-2' } };
    const first = readGrindingPlanningBoardLoadSummary(newer);
    const late = readGrindingPlanningBoardLoadSummary(params);
    const second = readGrindingPlanningBoardLoadSummary(newer);
    await vi.waitFor(() => expect(aggregateCalls()).toBe(2));
    release?.();
    await expect(late).rejects.toMatchObject({ code: 'STALE_PLANNING_BOARD_SNAPSHOT' });
    await Promise.all([first, second]);
    expect(aggregateCalls()).toBe(2);
  });

  it('bounds retained entries', async () => {
    const { params, aggregateCalls } = setup();
    for (let site = 0; site < 129; site += 1) {
      await readGrindingPlanningBoardLoadSummary({ ...params, siteKey: `site-${site}` });
    }
    await readGrindingPlanningBoardLoadSummary({ ...params, siteKey: 'site-0' });
    expect(aggregateCalls()).toBe(130);
  });
});
