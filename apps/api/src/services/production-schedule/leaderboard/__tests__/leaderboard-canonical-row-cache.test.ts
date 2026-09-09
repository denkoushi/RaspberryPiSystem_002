import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  clearLeaderboardCanonicalRowCacheForTests,
  getLeaderboardCanonicalRows,
  loadLeaderboardCanonicalRows,
  putLeaderboardCanonicalRows
} from '../leaderboard-canonical-row-cache.js';
import type { LeaderboardScheduleRowSql } from '../leaderboard-schedule-row.types.js';

const key = { siteKey: 'site-a', generationToken: 'generation-1' };

function row(id: string, overrides: Partial<LeaderboardScheduleRowSql> = {}): LeaderboardScheduleRowSql {
  return {
    id,
    seibanJoinKey: 'ORDER-A',
    occurredAt: new Date('2026-09-09T00:00:00.000Z'),
    updatedAt: new Date('2026-09-09T00:00:00.000Z'),
    rowData: { FSEIBAN: 'ORDER-A', FHINCD: id, FSIGENCD: '305', FKOJUN: '1' },
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

describe('leaderboard canonical row cache', () => {
  beforeEach(() => clearLeaderboardCanonicalRowCacheForTests());

  it('shares rows by generation and supplements only missing planning coverage', async () => {
    const base = row('row-1', { processingOrder: 4, globalRank: 2 });
    putLeaderboardCanonicalRows({ key: { ...key, rankContext: 'site-a|site-a' }, rows: [base], coverage: 'rank' });
    putLeaderboardCanonicalRows({ key, rows: [base], coverage: 'identity' });

    const load = vi.fn(async (missingIds: readonly string[]) => missingIds.map((id) => row(id, {
      planningDetail: {
        detailUpdatedAt: null,
        progressUpdatedAt: null,
        externalUpdatedAt: null,
        dueDate: null,
        plannedQuantity: 1,
        plannedEndDate: null,
        isCompleted: false,
        isExternallyCompleted: false,
        splits: []
      }
    })));
    const loaded = await loadLeaderboardCanonicalRows({ key, rowIds: ['row-1'], coverage: 'planning', load });

    expect(load).toHaveBeenCalledWith(['row-1']);
    expect(loaded[0]?.planningDetail?.plannedQuantity).toBe(1);
    expect(loaded[0]?.processingOrder).toBe(4);
    expect(loaded[0]?.globalRank).toBe(2);

    const second = await loadLeaderboardCanonicalRows({ key, rowIds: ['row-1'], coverage: 'planning', load });
    expect(load).toHaveBeenCalledTimes(1);
    expect(second[0]?.processingOrder).toBe(4);
  });

  it('does not reuse another generation or rank context', () => {
    putLeaderboardCanonicalRows({ key: { ...key, rankContext: 'site-a|site-a' }, rows: [row('row-1')], coverage: 'rank' });
    expect(getLeaderboardCanonicalRows({ key, rowIds: ['row-1'], coverage: 'identity' }).missingIds).toEqual(['row-1']);
    expect(getLeaderboardCanonicalRows({ key: { ...key, generationToken: 'generation-2' }, rowIds: ['row-1'], coverage: 'identity' }).missingIds).toEqual(['row-1']);
    expect(getLeaderboardCanonicalRows({ key: { ...key, rankContext: 'site-b|site-b' }, rowIds: ['row-1'], coverage: 'rank' }).missingIds).toEqual(['row-1']);
  });

  it('reuses the same canonical row in both consumer directions without rereading', async () => {
    const rankKey = { ...key, rankContext: 'site-a|site-a' };
    const planningRow = row('row-1', {
      processingOrder: 7,
      globalRank: 3,
      planningDetail: {
        detailUpdatedAt: null,
        progressUpdatedAt: null,
        externalUpdatedAt: null,
        dueDate: null,
        plannedQuantity: 2,
        plannedEndDate: null,
        isCompleted: false,
        isExternallyCompleted: false,
        splits: []
      }
    });
    putLeaderboardCanonicalRows({ key, rows: [planningRow], coverage: 'planning' });
    putLeaderboardCanonicalRows({ key: rankKey, rows: [planningRow], coverage: 'rank' });

    const planningLoad = vi.fn(async () => [] as LeaderboardScheduleRowSql[]);
    const planning = await loadLeaderboardCanonicalRows({ key, rowIds: ['row-1'], coverage: 'planning', load: planningLoad });
    expect(planningLoad).not.toHaveBeenCalled();
    expect(planning[0]?.planningDetail?.plannedQuantity).toBe(2);

    const rankLoad = vi.fn(async () => [] as LeaderboardScheduleRowSql[]);
    const rank = await loadLeaderboardCanonicalRows({ key: rankKey, rowIds: ['row-1'], coverage: 'rank', load: rankLoad });
    expect(rankLoad).not.toHaveBeenCalled();
    expect(rank[0]?.processingOrder).toBe(7);
    expect(rank[0]?.globalRank).toBe(3);
  });

  it('preserves identity and rank fields when planning coverage is a partial supplement', async () => {
    const canonical = row('row-1', {
      seibanJoinKey: 'ORDER-A',
      rowData: {
        ProductNo: 'PRODUCT-1',
        FSEIBAN: 'ORDER-A',
        FHINCD: 'PART-1',
        FHINMEI: 'long part name',
        FSIGENCD: '305',
        FKOJUN: '1'
      },
      processingOrder: 8,
      globalRank: 3,
      note: 'keep this note',
      processingType: 'grinding',
      dueDate: new Date('2026-09-15T00:00:00.000Z'),
      plannedQuantity: 5
    });
    putLeaderboardCanonicalRows({ key, rows: [canonical], coverage: 'identity' });

    const planning = await loadLeaderboardCanonicalRows({
      key,
      rowIds: ['row-1'],
      coverage: 'planning',
      load: async () => [row('row-1', {
        rowData: { FSEIBAN: 'ORDER-A', FHINCD: 'PART-1' },
        processingOrder: null,
        globalRank: null,
        note: null,
        processingType: null,
        dueDate: null,
        plannedQuantity: 2,
        planningDetail: {
          detailUpdatedAt: null,
          progressUpdatedAt: null,
          externalUpdatedAt: null,
          dueDate: null,
          plannedQuantity: 2,
          plannedEndDate: null,
          isCompleted: false,
          isExternallyCompleted: false,
          splits: []
        }
      })]
    });

    expect(planning[0]?.rowData).toEqual(canonical.rowData);
    expect(planning[0]?.processingOrder).toBe(8);
    expect(planning[0]?.globalRank).toBe(3);
    expect(planning[0]?.note).toBe('keep this note');
    expect(planning[0]?.processingType).toBe('grinding');
    expect(planning[0]?.dueDate).toBeNull();
    expect(planning[0]?.plannedQuantity).toBe(2);
  });

  it('preserves planning detail when a later rank read omits it', () => {
    const planningDetail = {
      detailUpdatedAt: null,
      progressUpdatedAt: null,
      externalUpdatedAt: null,
      dueDate: null,
      plannedQuantity: 2,
      plannedEndDate: null,
      isCompleted: false,
      isExternallyCompleted: false,
      splits: []
    };
    putLeaderboardCanonicalRows({ key, rows: [row('row-1', { planningDetail })], coverage: 'planning' });
    putLeaderboardCanonicalRows({ key, rows: [row('row-1', { processingOrder: 1 })], coverage: 'rank' });

    expect(getLeaderboardCanonicalRows({ key, rowIds: ['row-1'], coverage: 'rank' }).rows[0]?.planningDetail).toEqual(planningDetail);
  });

  it('deduplicates concurrent loads while preserving each caller order', async () => {
    let resolveLoad: ((rows: readonly LeaderboardScheduleRowSql[]) => void) | undefined;
    const load = vi.fn((missingIds: readonly string[]) => new Promise<readonly LeaderboardScheduleRowSql[]>((resolve) => {
      resolveLoad = () => resolve(missingIds.map((id) => row(id)));
    }));

    const firstPromise = loadLeaderboardCanonicalRows({ key, rowIds: ['row-2', 'row-1'], coverage: 'identity', load });
    const secondPromise = loadLeaderboardCanonicalRows({ key, rowIds: ['row-1', 'row-2'], coverage: 'identity', load });
    expect(load).toHaveBeenCalledTimes(1);
    resolveLoad?.([]);

    await expect(firstPromise).resolves.toEqual([expect.objectContaining({ id: 'row-2' }), expect.objectContaining({ id: 'row-1' })]);
    await expect(secondPromise).resolves.toEqual([expect.objectContaining({ id: 'row-1' }), expect.objectContaining({ id: 'row-2' })]);
  });

  it('uses only explicitly requested row ids', () => {
    putLeaderboardCanonicalRows({
      key,
      rows: [
        row('row-a', { rowData: { FSEIBAN: 'ORDER-A' } }),
        row('row-b', { rowData: { FSEIBAN: 'ORDER-B' } })
      ],
      coverage: 'identity'
    });
    const result = getLeaderboardCanonicalRows({ key, rowIds: ['row-b', 'row-c'], coverage: 'identity' });
    expect(result.rows.map((item) => item.id)).toEqual(['row-b']);
    expect(result.missingIds).toEqual(['row-c']);
  });

  it('returns the complete loaded scope even when bounded cache capacity evicts entries', async () => {
    const ids = Array.from({ length: 40_001 }, (_, index) => `row-${index}`);
    const loaded = await loadLeaderboardCanonicalRows({
      key,
      rowIds: ids,
      coverage: 'identity',
      load: async (missingIds) => missingIds.map((id) => row(id))
    });
    expect(loaded).toHaveLength(ids.length);
    expect(loaded[0]?.id).toBe(ids[0]);
    expect(loaded.at(-1)?.id).toBe(ids.at(-1));
    expect(new Set(loaded.map((item) => item.id)).size).toBe(ids.length);
  });
});
