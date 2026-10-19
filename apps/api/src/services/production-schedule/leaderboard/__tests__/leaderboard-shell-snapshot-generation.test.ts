import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../../lib/prisma.js', () => ({
  prisma: (() => {
    const queryRaw = vi.fn();
    const executeRaw = vi.fn();
    const transaction = vi.fn(async (callback: (tx: unknown) => unknown) =>
      callback({ $queryRaw: queryRaw, $executeRaw: executeRaw })
    );
    return { $queryRaw: queryRaw, $executeRaw: executeRaw, $transaction: transaction };
  })()
}));

import { prisma } from '../../../../lib/prisma.js';
import {
  readGrindingPlanningBoardSnapshotGenerationTokenDetails,
  readLeaderboardShellSnapshotGenerationTokenDetails,
  resolveLeaderboardShellSnapshotGenerationToken
} from '../leaderboard-shell-snapshot-generation.js';

describe('resolveLeaderboardShellSnapshotGenerationToken', () => {
  it('reuses cached token without hitting database', async () => {
    await expect(resolveLeaderboardShellSnapshotGenerationToken('{"cached":true}')).resolves.toBe(
      '{"cached":true}'
    );
  });

  it('uses explicit raw mail revision as the only raw-mail token component', async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValueOnce([
      {
        rowsRevision: 10n,
        orderAssignmentUpdatedAt: null,
        orderSplitCount: 0n,
        orderSplitUpdatedAt: null,
        orderSplitAssignmentCount: 0n,
        orderSplitAssignmentUpdatedAt: null,
        globalRowRankUpdatedAt: null,
        rowNoteUpdatedAt: null,
        progressCount: 0n,
        progressUpdatedAt: null,
        externalCompletionCount: 0n,
        externalCompletionUpdatedAt: null,
        fkstUpdatedAt: null,
        fkmailUpdatedAt: null,
        orderSupplementCount: 0n,
        orderSupplementUpdatedAt: null,
        seibanDueDateUpdatedAt: null,
        seibanProcessingDueDateUpdatedAt: null,
        resourceCategoryUpdatedAt: null,
        resourceCodeMappingUpdatedAt: null
      }
    ] as never);

    const details = await readLeaderboardShellSnapshotGenerationTokenDetails({
      fkojunstStatusMailRowsRevision: 'materialized-revision-B'
    });
    const token = JSON.parse(details.generationToken) as Record<string, unknown>;

    expect(details.fkojunstStatusMailRowsRevision).toBe('materialized-revision-B');
    expect(token.fkojunstStatusMailRowsRevision).toBe('materialized-revision-B');
    expect(token.rowsRevision).toBe('10');
    expect(Object.keys(token)).toEqual([
      'rowsRevision', 'fkojunstStatusMailRowsRevision', 'orderAssignmentUpdatedAt',
      'orderSplitCount', 'orderSplitUpdatedAt', 'orderSplitAssignmentCount',
      'orderSplitAssignmentUpdatedAt', 'globalRowRankUpdatedAt', 'rowNoteUpdatedAt',
      'progressCount', 'progressUpdatedAt', 'externalCompletionCount', 'externalCompletionUpdatedAt',
      'fkstUpdatedAt', 'fkmailUpdatedAt', 'orderSupplementCount', 'orderSupplementUpdatedAt',
      'seibanDueDateUpdatedAt', 'seibanProcessingDueDateUpdatedAt',
      'resourceCategoryUpdatedAt', 'resourceCodeMappingUpdatedAt'
    ]);
    expect(token).not.toHaveProperty('fkojunstStatusMailRowsCount');
    expect(token).not.toHaveProperty('fkojunstStatusMailRowsLatestCreatedAt');
    expect(token).not.toHaveProperty('fkojunstStatusMailRowsLatestUpdatedAt');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('includes split row/assignment counts so deletions invalidate cached snapshots', async () => {
    vi.mocked(prisma.$queryRaw)
      .mockResolvedValueOnce([
        {
          rowsRevision: 1n,
          orderAssignmentUpdatedAt: null,
          orderSplitCount: 2n,
          orderSplitUpdatedAt: new Date('2026-06-19T00:01:00.000Z'),
          orderSplitAssignmentCount: 3n,
          orderSplitAssignmentUpdatedAt: new Date('2026-06-19T00:01:00.000Z'),
          globalRowRankUpdatedAt: null,
          rowNoteUpdatedAt: null,
          progressCount: 0n,
          progressUpdatedAt: null,
          externalCompletionCount: 0n,
          externalCompletionUpdatedAt: null,
          fkstUpdatedAt: null,
          fkmailUpdatedAt: null,
          orderSupplementCount: 0n,
          orderSupplementUpdatedAt: null,
          seibanDueDateUpdatedAt: null,
          seibanProcessingDueDateUpdatedAt: null,
          resourceCategoryUpdatedAt: null,
          resourceCodeMappingUpdatedAt: null
        }
      ] as never)
      .mockResolvedValueOnce([{ revision: 9214n }] as never);

    const details = await readLeaderboardShellSnapshotGenerationTokenDetails();
    const token = JSON.parse(details.generationToken) as Record<string, unknown>;

    expect(token.orderSplitCount).toBe('2');
    expect(token.orderSplitAssignmentCount).toBe('3');
    expect(token.orderSplitUpdatedAt).toBe('2026-06-19T00:01:00.000Z');
    expect(details.fkojunstStatusMailRowsRevision).toBe('9214');
    expect(token.fkojunstStatusMailRowsRevision).toBe('9214');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it.each([
    ['progressCount', 'progressUpdatedAt', 'ProductionScheduleProgress'],
    ['externalCompletionCount', 'externalCompletionUpdatedAt', 'ProductionScheduleExternalCompletion'],
    ['orderSupplementCount', 'orderSupplementUpdatedAt', 'ProductionScheduleOrderSupplement']
  ])('invalidates when only %s changes after a deletion', async (countKey, updatedAtKey, table) => {
    const row = {
      rowsRevision: 1n,
      progressCount: 0n,
      externalCompletionCount: 0n,
      orderSupplementCount: 0n,
      [countKey]: 2n,
      [updatedAtKey]: new Date('2026-10-09T00:00:00.000Z')
    };
    vi.mocked(prisma.$queryRaw).mockReset();
    vi.mocked(prisma.$queryRaw)
      .mockResolvedValueOnce([row] as never)
      .mockResolvedValueOnce([{ ...row, [countKey]: 1n }] as never);

    const options = { fkojunstStatusMailRowsRevision: '37' };
    const before = await readLeaderboardShellSnapshotGenerationTokenDetails(options);
    const after = await readLeaderboardShellSnapshotGenerationTokenDetails(options);
    const beforeToken = JSON.parse(before.generationToken) as Record<string, string>;
    const afterToken = JSON.parse(after.generationToken) as Record<string, string>;

    expect(beforeToken[countKey]).toBe('2');
    expect(afterToken).toEqual({ ...beforeToken, [countKey]: '1' });
    expect(afterToken[updatedAtKey]).toBe('2026-10-09T00:00:00.000Z');
    expect(after.generationToken).not.toBe(before.generationToken);
    const sql = vi.mocked(prisma.$queryRaw).mock.calls[0][0] as { sql: string; values: unknown[] };
    expect(sql.sql).toContain(`(SELECT COUNT(*)::bigint\n       FROM "${table}"\n       WHERE "csvDashboardId" = ?) AS "${countKey}"`);
    expect(sql.values.every((value) => value === '3f2f6b0e-6a1e-4c0b-9d0b-1a4f3f0d2a01')).toBe(true);
  });

  it('invalidates when a CSV row changes in place without changing count, createdAt or updatedAt', async () => {
    const row = {
      rowsRevision: 1n,
      orderAssignmentUpdatedAt: null,
      orderSplitCount: 0n,
      orderSplitUpdatedAt: null,
      orderSplitAssignmentCount: 0n,
      orderSplitAssignmentUpdatedAt: null,
      globalRowRankUpdatedAt: null,
      rowNoteUpdatedAt: null,
      progressCount: 0n,
      progressUpdatedAt: null,
      externalCompletionCount: 0n,
      externalCompletionUpdatedAt: null,
      fkstUpdatedAt: null,
      fkmailUpdatedAt: null,
      orderSupplementCount: 0n,
      orderSupplementUpdatedAt: null,
      seibanDueDateUpdatedAt: null,
      seibanProcessingDueDateUpdatedAt: null,
      resourceCategoryUpdatedAt: null,
      resourceCodeMappingUpdatedAt: null
    };

    vi.mocked(prisma.$queryRaw)
      .mockResolvedValueOnce([{ ...row, rowsRevision: 2n }] as never)
      .mockResolvedValueOnce([{ revision: 1n }] as never)
      .mockResolvedValueOnce([{ ...row, rowsRevision: 3n }] as never)
      .mockResolvedValueOnce([{ revision: 1n }] as never);

    const before = await readLeaderboardShellSnapshotGenerationTokenDetails();
    const after = await readLeaderboardShellSnapshotGenerationTokenDetails();

    expect(JSON.parse(before.generationToken)).toMatchObject({
      rowsRevision: '2'
    });
    expect(JSON.parse(after.generationToken)).toMatchObject({
      rowsRevision: '3'
    });
    expect(after.generationToken).not.toBe(before.generationToken);
  });

  it.each([null, undefined])('rejects a missing main revision (%s) instead of using zero', async (rowsRevision) => {
    vi.mocked(prisma.$queryRaw).mockReset();
    vi.mocked(prisma.$queryRaw).mockResolvedValueOnce([{ rowsRevision }] as never);
    await expect(readLeaderboardShellSnapshotGenerationTokenDetails({
      fkojunstStatusMailRowsRevision: '37'
    })).rejects.toThrow(
      '[ProductionScheduleGenerationRevision] raw revision row is missing for dashboard 3f2f6b0e-6a1e-4c0b-9d0b-1a4f3f0d2a01'
    );
    vi.mocked(prisma.$queryRaw)
      .mockResolvedValueOnce([{ rowsRevision }] as never)
      .mockResolvedValueOnce([{ revision: 37n }] as never);
    await expect(readGrindingPlanningBoardSnapshotGenerationTokenDetails()).rejects.toThrow('raw revision row is missing');
  });

  it('uses the persistent raw revision for the planning-board-only token', async () => {
    vi.mocked(prisma.$queryRaw).mockReset();
    vi.mocked(prisma.$queryRaw)
      .mockResolvedValueOnce([{
        rowsRevision: 1n,
        orderAssignmentUpdatedAt: null,
        orderSplitCount: 0n,
        orderSplitUpdatedAt: null,
        orderSplitAssignmentCount: 0n,
        orderSplitAssignmentUpdatedAt: null,
        globalRowRankUpdatedAt: null,
        rowNoteUpdatedAt: null,
        progressCount: 0n,
        progressUpdatedAt: null,
        externalCompletionCount: 0n,
        externalCompletionUpdatedAt: null,
        fkstUpdatedAt: null,
        fkmailUpdatedAt: null,
        orderSupplementCount: 0n,
        orderSupplementUpdatedAt: null,
        seibanDueDateUpdatedAt: null,
        seibanProcessingDueDateUpdatedAt: null,
        resourceCategoryUpdatedAt: null,
        resourceCodeMappingUpdatedAt: null
      }] as never)
      .mockResolvedValueOnce([{ revision: 37n }] as never);

    const details = await readGrindingPlanningBoardSnapshotGenerationTokenDetails();
    const token = JSON.parse(details.generationToken) as Record<string, unknown>;

    expect(details.fkojunstStatusMailRowsRevision).toBe('37');
    expect(token.fkojunstStatusMailRowsRevision).toBe('37');
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
  });
});
