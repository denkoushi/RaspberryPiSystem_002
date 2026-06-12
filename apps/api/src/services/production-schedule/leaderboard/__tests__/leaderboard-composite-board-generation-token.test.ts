import { beforeEach, describe, expect, it, vi } from 'vitest';

import { fetchLeaderboardCompositeBoardShell } from '../leaderboard-composite-board.service.js';
import * as generation from '../leaderboard-shell-snapshot-generation.js';
import * as materialization from '../leaderboard-process-change-residual.materialization.js';
import * as residualService from '../leaderboard-process-change-residual.service.js';
import * as queryService from '../../production-schedule-query.service.js';
import * as rowResolver from '../../row-resolver/index.js';
import { createInMemoryLeaderboardShellSnapshotStore } from '../leaderboard-shell-snapshot.store.js';
import { Prisma } from '@prisma/client';

describe('leaderboard-composite-board generation token prefetch', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('reads snapshot generation token once per board shell request', async () => {
    vi.spyOn(rowResolver, 'resolveLeaderboardMaterializedBaseWhere').mockResolvedValue(Prisma.empty);
    const materializeSpy = vi.spyOn(materialization, 'materializeProcessChangeResidualStrongEvidence').mockResolvedValue({
      keys: new Set<string>(),
      keyArrays: { productNos: [], fkojuns: [], resourceCds: [] },
      evidenceByKey: new Map(),
      rawMailRowsRevision: 'revision-1'
    });
    vi.spyOn(residualService, 'fetchLeaderboardProcessChangeResidualSummary').mockResolvedValue({
      processChangeResidualTotal: 0,
      processChangeResidualRows: [],
      processChangeResidualRepresentativeLimit: 20
    });
    const readSpy = vi.spyOn(generation, 'readLeaderboardShellSnapshotGenerationTokenDetails').mockResolvedValue({
      generationToken: '{"generation":"1"}',
      fkojunstStatusMailRowsRevision: 'revision-1'
    });
    const shellSpy = vi.spyOn(queryService, 'listLeaderboardShellProductionScheduleRows').mockResolvedValue({
      page: 1,
      pageSize: 80,
      rows: [],
      snapshotId: 'snap-1',
      nextCursor: 0,
      hasMore: false
    });

    await fetchLeaderboardCompositeBoardShell(
      {
        listParamsBase: {
          queryText: '',
          productNos: [],
          locationKey: 'loc-1'
        },
        boardResourceCds: ['1', '2', '3'],
        page: 1,
        pageSize: 80,
        includeDecorations: false
      },
      { snapshotStore: createInMemoryLeaderboardShellSnapshotStore({ defaultTtlMs: 10_000 }) }
    );

    expect(readSpy).toHaveBeenCalledTimes(1);
    expect(readSpy).toHaveBeenCalledWith();
    expect(materializeSpy).toHaveBeenCalledWith(expect.anything(), {
      fkojunstStatusMailRowsRevision: 'revision-1'
    });
    expect(shellSpy).toHaveBeenCalledTimes(3);
    for (const call of shellSpy.mock.calls) {
      expect(call[1]?.generationToken).toBe('{"generation":"1"}');
    }
  });
});
