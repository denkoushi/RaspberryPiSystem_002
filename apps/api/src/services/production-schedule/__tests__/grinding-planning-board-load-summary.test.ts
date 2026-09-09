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
