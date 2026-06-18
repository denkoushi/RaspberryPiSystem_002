import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  continueLeaderboardCompositeBoard,
  fetchLeaderboardCompositeBoardShell
} from '../leaderboard-composite-board.service.js';
import * as generation from '../leaderboard-shell-snapshot-generation.js';
import * as materialization from '../leaderboard-process-change-residual.materialization.js';
import * as residualService from '../leaderboard-process-change-residual.service.js';
import * as queryService from '../../production-schedule-query.service.js';
import * as rowResolver from '../../row-resolver/index.js';
import * as totalsResolver from '../resolve-leaderboard-board-resource-totals-for-continue.js';
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

  it('shares winner materialization once per board continue request', async () => {
    const materializedBaseWhere = Prisma.sql`TRUE`;
    const resolveMaterializedSpy = vi
      .spyOn(rowResolver, 'resolveLeaderboardMaterializedBaseWhere')
      .mockResolvedValue(materializedBaseWhere);
    vi.spyOn(totalsResolver, 'resolveLeaderboardBoardResourceTotalsForContinue').mockResolvedValue([0, 0, 0]);
    vi.spyOn(materialization, 'materializeProcessChangeResidualStrongEvidence').mockResolvedValue({
      keys: new Set<string>(),
      keyArrays: { productNos: [], fkojuns: [], resourceCds: [] },
      evidenceByKey: new Map(),
      rawMailRowsRevision: 'revision-1'
    });
    vi.spyOn(generation, 'readLeaderboardShellSnapshotGenerationTokenDetails').mockResolvedValue({
      generationToken: '{"generation":"1"}',
      fkojunstStatusMailRowsRevision: 'revision-1'
    });
    const continueSpy = vi
      .spyOn(queryService, 'listLeaderboardShellContinuationProductionScheduleRows')
      .mockResolvedValue({
        page: 1,
        pageSize: 160,
        rows: [],
        snapshotId: 'snap-1',
        nextCursor: 0,
        hasMore: false
      });

    await continueLeaderboardCompositeBoard(
      {
        listParamsBase: {
          queryText: '',
          productNos: [],
          locationKey: 'loc-1'
        },
        boardResourceCds: ['1', '2', '3'],
        resourceSlices: [
          { resourceCd: '1', snapshotId: 'snap-1', cursor: 0, hasMore: true },
          { resourceCd: '2', snapshotId: 'snap-2', cursor: 0, hasMore: true },
          { resourceCd: '3', snapshotId: 'snap-3', cursor: 0, hasMore: true }
        ],
        chunkSize: 160,
        includeDecorations: false
      },
      { snapshotStore: createInMemoryLeaderboardShellSnapshotStore({ defaultTtlMs: 10_000 }) }
    );

    expect(resolveMaterializedSpy).toHaveBeenCalledTimes(1);
    expect(continueSpy).toHaveBeenCalledTimes(3);
    for (const call of continueSpy.mock.calls) {
      expect(call[1]?.leaderboardMaterializedBaseWhere).toBe(materializedBaseWhere);
      expect(call[1]?.generationToken).toBe('{"generation":"1"}');
    }
  });

  it('can defer exact shell totals so initial board render does not wait for COUNT', async () => {
    vi.spyOn(rowResolver, 'resolveLeaderboardMaterializedBaseWhere').mockResolvedValue(Prisma.empty);
    vi.spyOn(materialization, 'materializeProcessChangeResidualStrongEvidence').mockResolvedValue({
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
    vi.spyOn(generation, 'readLeaderboardShellSnapshotGenerationTokenDetails').mockResolvedValue({
      generationToken: '{"generation":"1"}',
      fkojunstStatusMailRowsRevision: 'revision-1'
    });
    const countSpy = vi
      .spyOn(queryService, 'countProductionScheduleDashboardVisibleRowsFromListFilters')
      .mockResolvedValue(999);
    vi.spyOn(queryService, 'listLeaderboardShellProductionScheduleRows').mockImplementation(async (params) => {
      const resourceCd = params.resourceCds[0];
      return {
        page: 1,
        pageSize: 80,
        rows:
          resourceCd === '1'
            ? ([{ id: 'row-1a' }, { id: 'row-1b' }] as any)
            : ([{ id: 'row-2a' }] as any),
        snapshotId: resourceCd === '1' ? 'snap-1' : 'snap-2',
        nextCursor: resourceCd === '1' ? 2 : 1,
        hasMore: resourceCd === '1'
      };
    });

    const result = await fetchLeaderboardCompositeBoardShell(
      {
        listParamsBase: {
          queryText: '',
          productNos: [],
          locationKey: 'loc-1'
        },
        boardResourceCds: ['1', '2'],
        page: 1,
        pageSize: 80,
        includeDecorations: false,
        deferTotals: true
      },
      { snapshotStore: createInMemoryLeaderboardShellSnapshotStore({ defaultTtlMs: 10_000 }) }
    );

    expect(countSpy).not.toHaveBeenCalled();
    expect(result.totalsDeferred).toBe(true);
    expect(result.total).toBe(3);
    expect(result.resources.map((r) => ({ resourceCd: r.resourceCd, total: r.total, hasMore: r.hasMore }))).toEqual([
      { resourceCd: '1', total: 2, hasMore: true },
      { resourceCd: '2', total: 1, hasMore: false }
    ]);
  });

  it('emits opt-in performance events for board shell phases', async () => {
    vi.spyOn(rowResolver, 'resolveLeaderboardMaterializedBaseWhere').mockResolvedValue(Prisma.empty);
    vi.spyOn(materialization, 'materializeProcessChangeResidualStrongEvidence').mockResolvedValue({
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
    vi.spyOn(generation, 'readLeaderboardShellSnapshotGenerationTokenDetails').mockResolvedValue({
      generationToken: '{"generation":"1"}',
      fkojunstStatusMailRowsRevision: 'revision-1'
    });
    vi.spyOn(queryService, 'listLeaderboardShellProductionScheduleRows').mockImplementation(async (params) => ({
      page: 1,
      pageSize: 80,
      rows: [{ id: `row-${params.resourceCds[0]}`, rowData: { FSIGENCD: params.resourceCds[0] } }] as any,
      snapshotId: `snap-${params.resourceCds[0]}`,
      nextCursor: 1,
      hasMore: false
    }));
    const performanceSink = vi.fn();

    await fetchLeaderboardCompositeBoardShell(
      {
        listParamsBase: {
          queryText: '',
          productNos: [],
          locationKey: 'loc-1'
        },
        boardResourceCds: ['1', '2'],
        page: 1,
        pageSize: 80,
        includeDecorations: false,
        deferTotals: true
      },
      {
        snapshotStore: createInMemoryLeaderboardShellSnapshotStore({ defaultTtlMs: 10_000 }),
        performanceSink
      }
    );

    const events = performanceSink.mock.calls.map(([event]) => event);
    expect(events.map((event) => event.phase)).toEqual(
      expect.arrayContaining([
        'processChangeResidualContext',
        'materializedBaseWhere',
        'resourceShell',
        'processChangeResidualSummary',
        'resourceTotals',
        'attachLabor',
        'requestTotal'
      ])
    );
    expect(events.filter((event) => event.phase === 'resourceShell')).toHaveLength(2);
    expect(events).toContainEqual(
      expect.objectContaining({
        endpoint: 'shell',
        phase: 'requestTotal',
        resourceCount: 2,
        rowCount: 2,
        includeDecorations: false
      })
    );
    for (const event of events) {
      expect(Number.isInteger(event.durationMs)).toBe(true);
      expect(event.durationMs).toBeGreaterThanOrEqual(0);
    }
  });
});
