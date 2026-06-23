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
import {
  clearLeaderboardBoardPrefixRowCacheForTests,
  putLeaderboardBoardPrefixRowsInCache,
  resolveLeaderboardBoardPrefixRowsFromCache
} from '../leaderboard-composite-board-prefix-row-cache.js';
import { Prisma } from '@prisma/client';

describe('leaderboard-composite-board generation token prefetch', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    clearLeaderboardBoardPrefixRowCacheForTests();
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
      fkojunstStatusMailRowsRevision: 'revision-1',
      telemetry: expect.any(Function)
    });
    expect(shellSpy).toHaveBeenCalledTimes(3);
    for (const call of shellSpy.mock.calls) {
      expect(call[1]?.generationToken).toBe('{"generation":"1"}');
      expect(call[1]?.leaderboardWinnerBaseStrategy).toBe('correlated');
      expect(call[1]?.leaderboardMaterializedBaseWhere).toBeUndefined();
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

  it('skips global winner materialization on machine-only deferred shell with no residual evidence', async () => {
    const resolveMaterializedSpy = vi
      .spyOn(rowResolver, 'resolveLeaderboardMaterializedBaseWhere')
      .mockResolvedValue(Prisma.sql`TRUE`);
    const residualSummarySpy = vi.spyOn(residualService, 'fetchLeaderboardProcessChangeResidualSummary');
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
    const shellSpy = vi.spyOn(queryService, 'listLeaderboardShellProductionScheduleRows').mockImplementation(async (params) => ({
      page: 1,
      pageSize: params.pageSize,
      rows: [{ id: `row-${params.resourceCds[0]}`, rowData: { FSIGENCD: params.resourceCds[0], FSIGENSHOYORYO: '5' } }] as any,
      snapshotId: `snap-${params.resourceCds[0]}`,
      nextCursor: 1,
      hasMore: true
    }));
    const countSpy = vi.spyOn(queryService, 'countProductionScheduleDashboardVisibleRowsFromListFilters');
    const performanceSink = vi.fn();

    const result = await fetchLeaderboardCompositeBoardShell(
      {
        listParamsBase: {
          queryText: '',
          productNos: [],
          locationKey: 'loc-1'
        },
        boardResourceCds: ['1', '2'],
        page: 1,
        pageSize: 50,
        includeDecorations: false,
        includeLabor: false,
        deferTotals: true
      },
      {
        snapshotStore: createInMemoryLeaderboardShellSnapshotStore({ defaultTtlMs: 10_000 }),
        performanceSink
      }
    );

    expect(resolveMaterializedSpy).not.toHaveBeenCalled();
    expect(residualSummarySpy).not.toHaveBeenCalled();
    expect(countSpy).not.toHaveBeenCalled();
    expect(shellSpy).toHaveBeenCalledTimes(2);
    for (const call of shellSpy.mock.calls) {
      expect(call[1]?.leaderboardWinnerBaseStrategy).toBe('correlated');
      expect(call[1]?.leaderboardMaterializedBaseWhere).toBeUndefined();
    }
    expect(result.totalsDeferred).toBe(true);
    expect(result.processChangeResidualTotal).toBe(0);
    expect(result.processChangeResidualRows).toEqual([]);
    expect(result.rows).toEqual([
      expect.objectContaining({ id: 'row-1', laborRequiredMinutes: 0, machineRequiredMinutes: 5 }),
      expect.objectContaining({ id: 'row-2', laborRequiredMinutes: 0, machineRequiredMinutes: 5 })
    ]);
    expect(performanceSink.mock.calls.map(([event]) => event.phase)).not.toContain('materializedBaseWhere');
    expect(performanceSink).toHaveBeenCalledWith(
      expect.objectContaining({
        endpoint: 'shell',
        phase: 'requestTotal',
        includeLabor: false,
        deferredTotals: true
      })
    );
  });

  it('uses correlated winner base for deferred shell residual summary without global materialization', async () => {
    const correlatedBaseWhere = Prisma.sql`TRUE /* correlated */`;
    const buildCorrelatedSpy = vi
      .spyOn(rowResolver, 'buildProductionScheduleDashboardBaseWhereWithCorrelatedMaxProductNoWinner')
      .mockReturnValue(correlatedBaseWhere);
    const resolveMaterializedSpy = vi
      .spyOn(rowResolver, 'resolveLeaderboardMaterializedBaseWhere')
      .mockResolvedValue(Prisma.sql`TRUE /* materialized */`);
    vi.spyOn(materialization, 'materializeProcessChangeResidualStrongEvidence').mockResolvedValue({
      keys: new Set<string>(['P1\u0000K1\u0000R1']),
      keyArrays: { productNos: ['P1'], fkojuns: ['K1'], resourceCds: ['R1'] },
      evidenceByKey: new Map(),
      rawMailRowsRevision: 'revision-1'
    });
    vi.spyOn(generation, 'readLeaderboardShellSnapshotGenerationTokenDetails').mockResolvedValue({
      generationToken: '{"generation":"1"}',
      fkojunstStatusMailRowsRevision: 'revision-1'
    });
    const residualSummarySpy = vi
      .spyOn(residualService, 'fetchLeaderboardProcessChangeResidualSummary')
      .mockResolvedValue({
        processChangeResidualTotal: 1,
        processChangeResidualRows: [{ id: 'residual-1' } as any],
        processChangeResidualRepresentativeLimit: 20
      });
    vi.spyOn(queryService, 'listLeaderboardShellProductionScheduleRows').mockResolvedValue({
      page: 1,
      pageSize: 50,
      rows: [{ id: 'row-1', rowData: { FSIGENCD: '1', FSIGENSHOYORYO: '5' } }] as any,
      snapshotId: 'snap-1',
      nextCursor: 1,
      hasMore: true
    });
    const performanceSink = vi.fn();

    const result = await fetchLeaderboardCompositeBoardShell(
      {
        listParamsBase: {
          queryText: '',
          productNos: [],
          locationKey: 'loc-1'
        },
        boardResourceCds: ['1'],
        page: 1,
        pageSize: 50,
        includeDecorations: false,
        includeLabor: false,
        deferTotals: true
      },
      {
        snapshotStore: createInMemoryLeaderboardShellSnapshotStore({ defaultTtlMs: 10_000 }),
        performanceSink
      }
    );

    expect(resolveMaterializedSpy).not.toHaveBeenCalled();
    expect(buildCorrelatedSpy).toHaveBeenCalledTimes(1);
    expect(residualSummarySpy).toHaveBeenCalledWith(
      expect.objectContaining({
        resourceCds: ['1'],
        leaderboardMaterializedBaseWhere: correlatedBaseWhere
      })
    );
    expect(result.processChangeResidualTotal).toBe(1);
    expect(result.processChangeResidualRows).toEqual([{ id: 'residual-1' }]);
    expect(performanceSink).toHaveBeenCalledWith(
      expect.objectContaining({
        endpoint: 'shell',
        phase: 'processChangeResidualSummary',
        winnerBaseStrategy: 'correlated'
      })
    );
    expect(performanceSink.mock.calls.map(([event]) => event.phase)).not.toContain('materializedBaseWhere');
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
    const contextEvents = events.filter((event) => event.phase === 'processChangeResidualContext');
    expect(contextEvents.filter((event) => event.subphase == null)).toHaveLength(1);
    expect(contextEvents).toContainEqual(
      expect.objectContaining({
        endpoint: 'shell',
        phase: 'processChangeResidualContext',
        subphase: 'generationTokenInitial',
        ok: true
      })
    );
    expect(contextEvents).toContainEqual(
      expect.objectContaining({
        endpoint: 'shell',
        phase: 'processChangeResidualContext',
        subphase: 'residualMaterialization',
        revisionChanged: false,
        ok: true
      })
    );
    expect(contextEvents.some((event) => event.subphase === 'generationTokenRefresh')).toBe(false);
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
      expect(event.ok).toBe(true);
    }
  });

  it('emits opt-in performance events for board continue phases without double-counting materializedBaseWhere', async () => {
    const materializedBaseWhere = Prisma.sql`TRUE`;
    vi.spyOn(rowResolver, 'resolveLeaderboardMaterializedBaseWhere').mockResolvedValue(materializedBaseWhere);
    vi.spyOn(totalsResolver, 'resolveLeaderboardBoardResourceTotalsForContinue').mockResolvedValue([0, 0]);
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
    vi.spyOn(queryService, 'listLeaderboardShellContinuationProductionScheduleRows').mockResolvedValue({
      page: 1,
      pageSize: 160,
      rows: [],
      snapshotId: 'snap-1',
      nextCursor: 0,
      hasMore: false
    });
    const performanceSink = vi.fn();

    await continueLeaderboardCompositeBoard(
      {
        listParamsBase: {
          queryText: '',
          productNos: [],
          locationKey: 'loc-1'
        },
        boardResourceCds: ['1', '2'],
        resourceSlices: [
          { resourceCd: '1', snapshotId: 'snap-1', cursor: 0, hasMore: true },
          { resourceCd: '2', snapshotId: 'snap-2', cursor: 0, hasMore: true }
        ],
        chunkSize: 160,
        includeDecorations: false
      },
      {
        snapshotStore: createInMemoryLeaderboardShellSnapshotStore({ defaultTtlMs: 10_000 }),
        performanceSink
      }
    );

    const events = performanceSink.mock.calls.map(([event]) => event);
    const materializedEvents = events.filter((event) => event.phase === 'materializedBaseWhere');
    expect(materializedEvents).toHaveLength(1);
    expect(events.map((event) => event.phase)).toEqual(
      expect.arrayContaining([
        'processChangeResidualContext',
        'materializedBaseWhere',
        'resourceTotals',
        'resourceContinue',
        'assembleResource',
        'attachLabor',
        'requestTotal'
      ])
    );
    for (const event of events) {
      expect(event.ok).toBe(true);
    }
  });

  it('emits processChangeResidualContext subphase events including revision refresh when materialization observes newer revision', async () => {
    vi.spyOn(rowResolver, 'resolveLeaderboardMaterializedBaseWhere').mockResolvedValue(Prisma.empty);
    vi.spyOn(materialization, 'materializeProcessChangeResidualStrongEvidence').mockImplementation(
      async (_prisma, options) => {
        options?.telemetry?.({
          cacheHit: false,
          rawRowCount: 10,
          normalizedRowCount: 9,
          dedupedRowCount: 8,
          strongEvidenceKeyCount: 2,
          sourceRowFetchDurationMs: 12.5,
          normalizeDurationMs: 3.2,
          dedupeDurationMs: 1.1,
          buildEvidenceDurationMs: 0.8
        });
        return {
          keys: new Set(['k1', 'k2']),
          keyArrays: { productNos: [], fkojuns: [], resourceCds: [] },
          evidenceByKey: new Map(),
          rawMailRowsRevision: 'revision-2'
        };
      }
    );
    vi.spyOn(residualService, 'fetchLeaderboardProcessChangeResidualSummary').mockResolvedValue({
      processChangeResidualTotal: 0,
      processChangeResidualRows: [],
      processChangeResidualRepresentativeLimit: 20
    });
    const readSpy = vi
      .spyOn(generation, 'readLeaderboardShellSnapshotGenerationTokenDetails')
      .mockResolvedValueOnce({
        generationToken: '{"generation":"1"}',
        fkojunstStatusMailRowsRevision: 'revision-1'
      })
      .mockResolvedValueOnce({
        generationToken: '{"generation":"2"}',
        fkojunstStatusMailRowsRevision: 'revision-2'
      });
    vi.spyOn(queryService, 'listLeaderboardShellProductionScheduleRows').mockResolvedValue({
      page: 1,
      pageSize: 80,
      rows: [],
      snapshotId: 'snap-1',
      nextCursor: 0,
      hasMore: false
    });
    const performanceSink = vi.fn();

    await fetchLeaderboardCompositeBoardShell(
      {
        listParamsBase: {
          queryText: '',
          productNos: [],
          locationKey: 'loc-1'
        },
        boardResourceCds: ['1'],
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

    const contextEvents = performanceSink.mock.calls
      .map(([event]) => event)
      .filter((event) => event.phase === 'processChangeResidualContext');
    expect(contextEvents.filter((event) => event.subphase == null)).toHaveLength(1);
    expect(contextEvents).toContainEqual(
      expect.objectContaining({
        endpoint: 'shell',
        subphase: 'residualMaterialization',
        cacheHit: false,
        rawRowCount: 10,
        normalizedRowCount: 9,
        dedupedRowCount: 8,
        strongEvidenceKeyCount: 2,
        revisionChanged: true,
        sourceRowFetchDurationMs: 13,
        normalizeDurationMs: 3,
        dedupeDurationMs: 1,
        buildEvidenceDurationMs: 1
      })
    );
    expect(contextEvents).toContainEqual(
      expect.objectContaining({
        endpoint: 'shell',
        subphase: 'generationTokenRefresh',
        revisionChanged: true
      })
    );
    expect(readSpy).toHaveBeenCalledTimes(2);
    expect(readSpy).toHaveBeenNthCalledWith(2, {
      fkojunstStatusMailRowsRevision: 'revision-2'
    });
  });

  it('emits failed phase performance events before rethrowing', async () => {
    vi.spyOn(rowResolver, 'resolveLeaderboardMaterializedBaseWhere').mockRejectedValue(
      Object.assign(new Error('shared memory exhausted'), { code: 'P2034' })
    );
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
    const performanceSink = vi.fn();

    await expect(
      continueLeaderboardCompositeBoard(
        {
          listParamsBase: {
            queryText: '',
            productNos: [],
            locationKey: 'loc-1'
          },
          boardResourceCds: ['1'],
          resourceSlices: [{ resourceCd: '1', snapshotId: 'snap-1', cursor: 0, hasMore: true }],
          chunkSize: 160,
          includeDecorations: false
        },
        {
          snapshotStore: createInMemoryLeaderboardShellSnapshotStore({ defaultTtlMs: 10_000 }),
          performanceSink
        }
      )
    ).rejects.toThrow('shared memory exhausted');

    expect(performanceSink).toHaveBeenCalledWith(
      expect.objectContaining({
        endpoint: 'continue',
        phase: 'materializedBaseWhere',
        ok: false,
        errorName: 'Error',
        errorCode: 'P2034'
      })
    );
  });

  it('seeds shell prefix cache with labor-attached rows', async () => {
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
    vi.spyOn(queryService, 'listLeaderboardShellProductionScheduleRows').mockResolvedValue({
      page: 1,
      pageSize: 80,
      rows: [
        {
          id: 'row-1',
          rowData: { FSIGENCD: '1', FSIGENSHOYORYO: '42' }
        }
      ] as any,
      snapshotId: 'snap-1',
      nextCursor: 1,
      hasMore: false
    });

    await fetchLeaderboardCompositeBoardShell(
      {
        listParamsBase: {
          queryText: '',
          productNos: [],
          locationKey: 'loc-1'
        },
        boardResourceCds: ['1'],
        page: 1,
        pageSize: 80,
        includeDecorations: false,
        deferTotals: true
      },
      { snapshotStore: createInMemoryLeaderboardShellSnapshotStore({ defaultTtlMs: 10_000 }) }
    );

    const cached = resolveLeaderboardBoardPrefixRowsFromCache('snap-1', ['row-1']);

    expect(cached.missingIds).toEqual([]);
    expect(cached.cachedRows[0]).toEqual(
      expect.objectContaining({
        id: 'row-1',
        machineRequiredMinutes: 42,
        laborRequiredMinutes: 0
      })
    );
  });

  it('updates continue prefix cache with labor-attached accumulated rows', async () => {
    const store = createInMemoryLeaderboardShellSnapshotStore({ defaultTtlMs: 10_000 });
    const snapshotId = store.create({
      orderedRowIds: ['row-a', 'row-b'],
      partialOrdering: false,
      filterFingerprint: 'fp-1',
      generationToken: '{"generation":"1"}',
      locationKey: 'loc-1',
      siteKey: undefined
    });
    putLeaderboardBoardPrefixRowsInCache(snapshotId, [
      {
        id: 'row-a',
        rowData: { FSIGENCD: '1', FSIGENSHOYORYO: '10' },
        machineRequiredMinutes: 10,
        laborRequiredMinutes: 0
      } as any
    ]);
    vi.spyOn(rowResolver, 'resolveLeaderboardMaterializedBaseWhere').mockResolvedValue(Prisma.empty);
    vi.spyOn(totalsResolver, 'resolveLeaderboardBoardResourceTotalsForContinue').mockResolvedValue([2]);
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
    vi.spyOn(queryService, 'listLeaderboardShellContinuationProductionScheduleRows').mockResolvedValue({
      page: 1,
      pageSize: 160,
      rows: [
        {
          id: 'row-b',
          rowData: { FSIGENCD: '1', FSIGENSHOYORYO: '20' }
        }
      ] as any,
      snapshotId,
      nextCursor: 2,
      hasMore: false
    });

    await continueLeaderboardCompositeBoard(
      {
        listParamsBase: {
          queryText: '',
          productNos: [],
          locationKey: 'loc-1'
        },
        boardResourceCds: ['1'],
        resourceSlices: [{ resourceCd: '1', snapshotId, cursor: 1, hasMore: true }],
        chunkSize: 160,
        includeDecorations: false
      },
      { snapshotStore: store }
    );

    const cached = resolveLeaderboardBoardPrefixRowsFromCache(snapshotId, ['row-a', 'row-b']);

    expect(cached.missingIds).toEqual([]);
    expect(cached.cachedRows.map((row) => row.machineRequiredMinutes)).toEqual([10, 20]);
    expect(cached.cachedRows.map((row) => row.laborRequiredMinutes)).toEqual([0, 0]);
  });
});
