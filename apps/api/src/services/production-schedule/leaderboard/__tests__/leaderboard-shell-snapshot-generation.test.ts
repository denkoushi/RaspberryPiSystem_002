import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../../lib/prisma.js', () => ({
  prisma: {
    $queryRaw: vi.fn()
  }
}));

import { prisma } from '../../../../lib/prisma.js';
import {
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
  });

  it('includes split row/assignment counts so deletions invalidate cached snapshots', async () => {
    vi.mocked(prisma.$queryRaw)
      .mockResolvedValueOnce([
        {
          rowsCount: 1n,
          rowsLatestCreatedAt: null,
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
  });
});
