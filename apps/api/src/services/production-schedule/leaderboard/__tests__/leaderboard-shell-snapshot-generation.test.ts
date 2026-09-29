import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
  resetLeaderboardFkojunstStatusMailGenerationCache,
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

describe('raw mail generation cache', () => {
  const mainRow = {
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
  };
  const mailRow = (count: bigint) => ({
    fkojunstStatusMailRowsCount: count,
    fkojunstStatusMailRowsLatestCreatedAt: null,
    fkojunstStatusMailRowsLatestUpdatedAt: null
  });
  let previousTtl: string | undefined;

  beforeEach(() => {
    previousTtl = process.env.LEADERBOARD_MAIL_REVISION_CACHE_TTL_MS;
    process.env.LEADERBOARD_MAIL_REVISION_CACHE_TTL_MS = '60000';
    resetLeaderboardFkojunstStatusMailGenerationCache();
    vi.mocked(prisma.$queryRaw).mockReset();
    vi.mocked(prisma.$transaction).mockClear();
  });

  afterEach(() => {
    if (previousTtl === undefined) delete process.env.LEADERBOARD_MAIL_REVISION_CACHE_TTL_MS;
    else process.env.LEADERBOARD_MAIL_REVISION_CACHE_TTL_MS = previousTtl;
    resetLeaderboardFkojunstStatusMailGenerationCache();
  });

  it('reads the heavy raw mail stats once within the TTL but main stats every time', async () => {
    vi.mocked(prisma.$queryRaw)
      .mockResolvedValueOnce([mainRow] as never)
      .mockResolvedValueOnce([mailRow(5n)] as never)
      .mockResolvedValueOnce([{ ...mainRow, orderAssignmentUpdatedAt: new Date('2026-09-29T00:00:00.000Z') }] as never);

    const first = await readLeaderboardShellSnapshotGenerationTokenDetails();
    const second = await readLeaderboardShellSnapshotGenerationTokenDetails();

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(3);
    expect(second.fkojunstStatusMailRowsRevision).toBe(first.fkojunstStatusMailRowsRevision);
    expect(second.generationToken).not.toBe(first.generationToken);
  });

  it('shares one raw mail query between concurrent callers', async () => {
    vi.mocked(prisma.$queryRaw).mockImplementation((async (query: { strings?: readonly string[] }) => {
      const text = query.strings?.join('') ?? '';
      return text.includes('fkojunstStatusMailRowsCount') ? [mailRow(7n)] : [mainRow];
    }) as never);

    const [a, b] = await Promise.all([
      readLeaderboardShellSnapshotGenerationTokenDetails(),
      readLeaderboardShellSnapshotGenerationTokenDetails()
    ]);

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(a.fkojunstStatusMailRowsRevision).toBe(b.fkojunstStatusMailRowsRevision);
  });

  it('re-reads raw mail stats after the ingest reset', async () => {
    vi.mocked(prisma.$queryRaw)
      .mockResolvedValueOnce([mainRow] as never)
      .mockResolvedValueOnce([mailRow(5n)] as never)
      .mockResolvedValueOnce([mainRow] as never)
      .mockResolvedValueOnce([mailRow(6n)] as never);

    const before = await readLeaderboardShellSnapshotGenerationTokenDetails();
    resetLeaderboardFkojunstStatusMailGenerationCache();
    const after = await readLeaderboardShellSnapshotGenerationTokenDetails();

    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(before.fkojunstStatusMailRowsRevision).toBe('5::');
    expect(after.fkojunstStatusMailRowsRevision).toBe('6::');
  });
});
