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
        rowsCount: 10n,
        rowsLatestCreatedAt: new Date('2026-02-01T00:00:00.000Z'),
        rowsLatestUpdatedAt: new Date('2026-02-01T00:00:00.000Z'),
        orderAssignmentUpdatedAt: null,
        orderSplitCount: 0n,
        orderSplitUpdatedAt: null,
        orderSplitAssignmentCount: 0n,
        orderSplitAssignmentUpdatedAt: null,
        globalRowRankUpdatedAt: null,
        rowNoteUpdatedAt: null,
        progressUpdatedAt: null,
        externalCompletionUpdatedAt: null,
        fkstUpdatedAt: null,
        fkmailUpdatedAt: null,
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
    expect(token).not.toHaveProperty('fkojunstStatusMailRowsCount');
    expect(token).not.toHaveProperty('fkojunstStatusMailRowsLatestCreatedAt');
    expect(token).not.toHaveProperty('fkojunstStatusMailRowsLatestUpdatedAt');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('includes split row/assignment counts so deletions invalidate cached snapshots', async () => {
    vi.mocked(prisma.$queryRaw)
      .mockResolvedValueOnce([
        {
          rowsCount: 1n,
          rowsLatestCreatedAt: null,
          rowsLatestUpdatedAt: null,
          orderAssignmentUpdatedAt: null,
          orderSplitCount: 2n,
          orderSplitUpdatedAt: new Date('2026-06-19T00:01:00.000Z'),
          orderSplitAssignmentCount: 3n,
          orderSplitAssignmentUpdatedAt: new Date('2026-06-19T00:01:00.000Z'),
          globalRowRankUpdatedAt: null,
          rowNoteUpdatedAt: null,
          progressUpdatedAt: null,
          externalCompletionUpdatedAt: null,
          fkstUpdatedAt: null,
          fkmailUpdatedAt: null,
          orderSupplementUpdatedAt: null,
          seibanDueDateUpdatedAt: null,
          seibanProcessingDueDateUpdatedAt: null,
          resourceCategoryUpdatedAt: null,
          resourceCodeMappingUpdatedAt: null
        }
      ] as never)
      .mockResolvedValueOnce([
        {
          fkojunstStatusMailRowsCount: 0n,
          fkojunstStatusMailRowsLatestCreatedAt: null,
          fkojunstStatusMailRowsLatestUpdatedAt: null
        }
      ] as never);

    const details = await readLeaderboardShellSnapshotGenerationTokenDetails();
    const token = JSON.parse(details.generationToken) as Record<string, unknown>;

    expect(token.orderSplitCount).toBe('2');
    expect(token.orderSplitAssignmentCount).toBe('3');
    expect(token.orderSplitUpdatedAt).toBe('2026-06-19T00:01:00.000Z');
    expect(prisma.$executeRaw).toHaveBeenCalledWith(expect.anything());
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      maxWait: 15_000,
      timeout: 60_000
    });
  });

  it('invalidates when a CSV row changes in place without changing count or createdAt', async () => {
    const row = {
      rowsCount: 1n,
      rowsLatestCreatedAt: new Date('2026-06-19T00:00:00.000Z'),
      orderAssignmentUpdatedAt: null,
      orderSplitCount: 0n,
      orderSplitUpdatedAt: null,
      orderSplitAssignmentCount: 0n,
      orderSplitAssignmentUpdatedAt: null,
      globalRowRankUpdatedAt: null,
      rowNoteUpdatedAt: null,
      progressUpdatedAt: null,
      externalCompletionUpdatedAt: null,
      fkstUpdatedAt: null,
      fkmailUpdatedAt: null,
      orderSupplementUpdatedAt: null,
      seibanDueDateUpdatedAt: null,
      seibanProcessingDueDateUpdatedAt: null,
      resourceCategoryUpdatedAt: null,
      resourceCodeMappingUpdatedAt: null
    };

    vi.mocked(prisma.$queryRaw)
      .mockResolvedValueOnce([{ ...row, rowsLatestUpdatedAt: new Date('2026-06-19T00:01:00.000Z') }] as never)
      .mockResolvedValueOnce([{ fkojunstStatusMailRowsCount: 0n, fkojunstStatusMailRowsLatestCreatedAt: null, fkojunstStatusMailRowsLatestUpdatedAt: null }] as never)
      .mockResolvedValueOnce([{ ...row, rowsLatestUpdatedAt: new Date('2026-06-19T00:02:00.000Z') }] as never)
      .mockResolvedValueOnce([{ fkojunstStatusMailRowsCount: 0n, fkojunstStatusMailRowsLatestCreatedAt: null, fkojunstStatusMailRowsLatestUpdatedAt: null }] as never);

    const before = await readLeaderboardShellSnapshotGenerationTokenDetails();
    const after = await readLeaderboardShellSnapshotGenerationTokenDetails();

    expect(JSON.parse(before.generationToken)).toMatchObject({
      rowsCount: '1',
      rowsLatestCreatedAt: '2026-06-19T00:00:00.000Z',
      rowsLatestUpdatedAt: '2026-06-19T00:01:00.000Z'
    });
    expect(JSON.parse(after.generationToken)).toMatchObject({
      rowsCount: '1',
      rowsLatestCreatedAt: '2026-06-19T00:00:00.000Z',
      rowsLatestUpdatedAt: '2026-06-19T00:02:00.000Z'
    });
    expect(after.generationToken).not.toBe(before.generationToken);
  });

  it('uses the persistent raw revision for the planning-board-only token', async () => {
    vi.mocked(prisma.$queryRaw).mockReset();
    vi.mocked(prisma.$queryRaw)
      .mockResolvedValueOnce([{
        rowsCount: 1n,
        rowsLatestCreatedAt: null,
        rowsLatestUpdatedAt: null,
        orderAssignmentUpdatedAt: null,
        orderSplitCount: 0n,
        orderSplitUpdatedAt: null,
        orderSplitAssignmentCount: 0n,
        orderSplitAssignmentUpdatedAt: null,
        globalRowRankUpdatedAt: null,
        rowNoteUpdatedAt: null,
        progressUpdatedAt: null,
        externalCompletionUpdatedAt: null,
        fkstUpdatedAt: null,
        fkmailUpdatedAt: null,
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
