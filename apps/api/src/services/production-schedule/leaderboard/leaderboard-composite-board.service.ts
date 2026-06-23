/**
 * 順位ボード（複数資源スロット）向け集約取得。
 * 単一資源の shell / continue / COUNT / 装飾を既存サービスに委譲し、HTTP 層とクエリ実装の間に置くオーケストレーションのみを担当する。
 */
import { performance } from 'node:perf_hooks';
import {
  countProductionScheduleDashboardVisibleRowsFromListFilters,
  listLeaderboardShellContinuationProductionScheduleRows,
  listLeaderboardShellProductionScheduleRows,
  type LeaderboardShellPhasedReadResult,
  type ProductionScheduleListParams,
  type ProductionScheduleRow
} from '../production-schedule-query.service.js';
import type { Prisma } from '@prisma/client';
import { resolveLeaderboardMaterializedBaseWhere } from '../row-resolver/index.js';
import { prisma } from '../../../lib/prisma.js';
import {
  decorateLeaderboardCompositeBoardContinue,
  decorateLeaderboardCompositeBoardShell
} from './leaderboard-composite-board-decoration.service.js';
import { resolveFiniteLeaderboardBoardNextCursor } from './leaderboard-board-resource-cursor.js';
import {
  assembleContinueMergedRowsForResource,
  deriveStateFromSnapshot,
  type ContinueAssembledResourceSlice
} from './leaderboard-composite-board-continue-assembly.js';
import { seedLeaderboardBoardSnapshotResourceTotal } from './leaderboard-composite-board-snapshot-totals.js';
import { seedLeaderboardBoardPrefixRowCache } from './leaderboard-composite-board-prefix-row-cache.js';
import { resolveLeaderboardBoardResourceTotalsForContinue } from './resolve-leaderboard-board-resource-totals-for-continue.js';
import { resolveLeaderboardBoardShellResourceTotalFromShell } from './resolve-leaderboard-board-shell-resource-total.js';
import type { LeaderboardShellSnapshotStore } from './leaderboard-shell-snapshot.store.js';
import { fetchLeaderboardProcessChangeResidualSummary } from './leaderboard-process-change-residual.service.js';
import {
  materializeProcessChangeResidualStrongEvidence,
  type ProcessChangeResidualStrongEvidenceMaterialization,
  type ProcessChangeResidualStrongEvidenceMaterializationTelemetryEvent
} from './leaderboard-process-change-residual.materialization.js';
import { readLeaderboardShellSnapshotGenerationTokenDetails } from './leaderboard-shell-snapshot-generation.js';
import type { ProcessChangeResidualEvidence } from './leaderboard-process-change-residual.types.js';
import { attachLeaderboardLaborMinutes, type LeaderboardLaborMinutesLookupContext } from './leaderboard-labor-minutes.service.js';

/** キオスク順位ボード通常表示: 強い工程変更残骸疑いを通常候補から除外する。 */
const KIOSK_LEADERBOARD_PROCESS_CHANGE_RESIDUAL_MODE = 'normal' as const;

async function resolveLeaderboardBoardProcessChangeResidualContext(
  sink: LeaderboardBoardPerformanceSink | undefined,
  endpoint: 'shell' | 'continue',
  eventBase: Pick<LeaderboardBoardPerformanceEvent, 'resourceCount' | 'chunkSize'>
): Promise<{
  generationToken: string;
  processChangeResidualMaterialization: ProcessChangeResidualStrongEvidenceMaterialization;
}> {
  const initialTokenDetails = await measureLeaderboardBoardPhase(
    sink,
    {
      endpoint,
      phase: 'processChangeResidualContext',
      subphase: 'generationTokenInitial',
      ...eventBase
    },
    () => readLeaderboardShellSnapshotGenerationTokenDetails()
  );

  let materializationTelemetry: ProcessChangeResidualStrongEvidenceMaterializationTelemetryEvent | undefined;
  const processChangeResidualMaterialization = await measureLeaderboardBoardPhase(
    sink,
    {
      endpoint,
      phase: 'processChangeResidualContext',
      subphase: 'residualMaterialization',
      ...eventBase
    },
    () =>
      materializeProcessChangeResidualStrongEvidence(prisma, {
        fkojunstStatusMailRowsRevision: initialTokenDetails.fkojunstStatusMailRowsRevision,
        telemetry: (event) => {
          materializationTelemetry = event;
        }
      }),
    (materialization) => ({
      cacheHit: materializationTelemetry?.cacheHit,
      persistedHit: materializationTelemetry?.persistedHit,
      persistedEvidenceRowCount: materializationTelemetry?.persistedEvidenceRowCount,
      rawRowCount: materializationTelemetry?.rawRowCount,
      normalizedRowCount: materializationTelemetry?.normalizedRowCount,
      dedupedRowCount: materializationTelemetry?.dedupedRowCount,
      strongEvidenceKeyCount:
        materializationTelemetry?.strongEvidenceKeyCount ?? materialization.keys.size,
      revisionChanged:
        materialization.rawMailRowsRevision !== initialTokenDetails.fkojunstStatusMailRowsRevision,
      sourceRowFetchDurationMs: materializationTelemetry?.sourceRowFetchDurationMs,
      normalizeDurationMs: materializationTelemetry?.normalizeDurationMs,
      dedupeDurationMs: materializationTelemetry?.dedupeDurationMs,
      buildEvidenceDurationMs: materializationTelemetry?.buildEvidenceDurationMs
    })
  );

  const tokenDetails =
    processChangeResidualMaterialization.rawMailRowsRevision === initialTokenDetails.fkojunstStatusMailRowsRevision
      ? initialTokenDetails
      : await measureLeaderboardBoardPhase(
          sink,
          {
            endpoint,
            phase: 'processChangeResidualContext',
            subphase: 'generationTokenRefresh',
            revisionChanged: true,
            ...eventBase
          },
          () =>
            readLeaderboardShellSnapshotGenerationTokenDetails({
              fkojunstStatusMailRowsRevision: processChangeResidualMaterialization.rawMailRowsRevision
            })
        );
  return {
    generationToken: tokenDetails.generationToken,
    processChangeResidualMaterialization
  };
}

type LightShellRow = LeaderboardShellPhasedReadResult['rows'][number];

export type LeaderboardBoardPerformanceEvent = {
  endpoint: 'shell' | 'continue';
  phase: string;
  durationMs: number;
  ok?: boolean;
  errorName?: string;
  errorCode?: string;
  subphase?: string;
  cacheHit?: boolean;
  persistedHit?: boolean;
  persistedEvidenceRowCount?: number;
  rawRowCount?: number;
  normalizedRowCount?: number;
  dedupedRowCount?: number;
  strongEvidenceKeyCount?: number;
  revisionChanged?: boolean;
  sourceRowFetchDurationMs?: number;
  normalizeDurationMs?: number;
  dedupeDurationMs?: number;
  buildEvidenceDurationMs?: number;
  resourceCd?: string;
  resourceCount?: number;
  rowCount?: number;
  deltaRowCount?: number;
  hasMore?: boolean;
  hasMoreCount?: number;
  total?: number;
  snapshotExpired?: boolean;
  includeDecorations?: boolean;
  chunkSize?: number;
  deferredTotals?: boolean;
};

export type LeaderboardBoardPerformanceSink = (event: LeaderboardBoardPerformanceEvent) => void;

type LeaderboardBoardServiceDeps = {
  snapshotStore: LeaderboardShellSnapshotStore;
  performanceSink?: LeaderboardBoardPerformanceSink;
};

function roundOptionalDurationMs(value: number | undefined): number | undefined {
  return value == null ? undefined : Math.round(value);
}

function emitLeaderboardBoardPerformance(
  sink: LeaderboardBoardPerformanceSink | undefined,
  event: LeaderboardBoardPerformanceEvent
): void {
  if (!sink) return;
  try {
    sink({
      ...event,
      durationMs: Math.round(event.durationMs),
      sourceRowFetchDurationMs: roundOptionalDurationMs(event.sourceRowFetchDurationMs),
      normalizeDurationMs: roundOptionalDurationMs(event.normalizeDurationMs),
      dedupeDurationMs: roundOptionalDurationMs(event.dedupeDurationMs),
      buildEvidenceDurationMs: roundOptionalDurationMs(event.buildEvidenceDurationMs)
    });
  } catch {
    // 計測ログは診断専用。sink 側の失敗で表示 API を壊さない。
  }
}

function extractLeaderboardBoardPerformanceErrorMeta(error: unknown): {
  errorName: string;
  errorCode?: string;
} {
  if (error instanceof Error) {
    const code = (error as { code?: unknown }).code;
    return {
      errorName: error.name,
      ...(typeof code === 'string' && code.length > 0 ? { errorCode: code } : {})
    };
  }
  return { errorName: 'UnknownError' };
}

async function measureLeaderboardBoardPhase<T>(
  sink: LeaderboardBoardPerformanceSink | undefined,
  eventBase: Omit<LeaderboardBoardPerformanceEvent, 'durationMs'>,
  work: () => Promise<T>,
  buildExtra?: (value: T) => Partial<LeaderboardBoardPerformanceEvent>
): Promise<T> {
  const started = performance.now();
  try {
    const value = await work();
    emitLeaderboardBoardPerformance(sink, {
      ...eventBase,
      ...buildExtra?.(value),
      ok: true,
      durationMs: performance.now() - started
    });
    return value;
  } catch (error) {
    const { errorName, errorCode } = extractLeaderboardBoardPerformanceErrorMeta(error);
    emitLeaderboardBoardPerformance(sink, {
      ...eventBase,
      ok: false,
      errorName,
      ...(errorCode ? { errorCode } : {}),
      durationMs: performance.now() - started
    });
    throw error;
  }
}

async function attachLaborToBoardPayload(params: {
  rows: LightShellRow[];
  deltaRows?: LightShellRow[];
  laborLookupContext: LeaderboardLaborMinutesLookupContext;
}): Promise<{ rows: LightShellRow[]; deltaRows?: LightShellRow[] }> {
  const { laborLookupContext } = params;
  const deltaRows = params.deltaRows ?? [];
  const combined: ProductionScheduleRow[] = [];
  const seenIds = new Set<string>();
  for (const row of [...params.rows, ...deltaRows]) {
    if (seenIds.has(row.id)) continue;
    seenIds.add(row.id);
    combined.push(row);
  }
  const attachedCombined = await attachLeaderboardLaborMinutes(combined, laborLookupContext);
  const byId = new Map(attachedCombined.map((row) => [row.id, row]));
  return {
    rows: params.rows.map((row) => byId.get(row.id) ?? row),
    ...(params.deltaRows !== undefined
      ? { deltaRows: deltaRows.map((row) => byId.get(row.id) ?? row) }
      : {})
  };
}

function seedAttachedRowsForSnapshot(params: {
  snapshotId: string | undefined;
  sourceRows: readonly LightShellRow[];
  attachedRowsById: ReadonlyMap<string, LightShellRow>;
}): void {
  const snapshotId = params.snapshotId?.trim();
  if (!snapshotId || params.sourceRows.length === 0) return;
  const attachedRows = params.sourceRows.map((row) => params.attachedRowsById.get(row.id) ?? row);
  seedLeaderboardBoardPrefixRowCache(snapshotId, attachedRows);
}

export type LeaderboardBoardResourceState = {
  resourceCd: string;
  snapshotId?: string;
  nextCursor?: number;
  hasMore: boolean;
  total: number;
  pageSize: number;
};

export type LeaderboardBoardReadResult = {
  page: number;
  pageSize: number;
  total: number;
  /** 初回 shell で一部スロットの exact total を後続 continue に回した場合のみ true。 */
  totalsDeferred?: boolean;
  rows: LightShellRow[];
  /**
   * 集約 `leaderboard-board/continue` のみ。軽量差分チャンク（スロット順に連結）。
   * 付与しない場合は古いクライアントのみを想定するか、このラウンドは累積 `rows` が正本。
   */
  deltaRows?: LightShellRow[];
  resources: LeaderboardBoardResourceState[];
  snapshotExpired?: boolean;
  leaderboardFooterChipsByPartKey?: Record<string, unknown>;
  processChangeResidualTotal?: number;
  processChangeResidualRows?: Array<
    LightShellRow & {
      processChangeResidualSuspected: true;
      processChangeResidualEvidence: ProcessChangeResidualEvidence;
    }
  >;
  processChangeResidualRepresentativeLimit?: number;
};

type ListParamsBase = Omit<ProductionScheduleListParams, 'page' | 'pageSize' | 'responseProfile' | 'resourceCds'>;

function countLeaderboardBoardShellResourceTotal(
  listParamsBase: ListParamsBase,
  params: {
    resourceCd: string;
    processChangeResidualStrongEvidenceKeys: ReadonlySet<string>;
    leaderboardMaterializedBaseWhere: Prisma.Sql;
  }
): Promise<number> {
  return countProductionScheduleDashboardVisibleRowsFromListFilters(
    {
      queryText: listParamsBase.queryText,
      productNos: listParamsBase.productNos,
      machineName: listParamsBase.machineName,
      resourceCds: [params.resourceCd],
      assignedOnlyCds: listParamsBase.assignedOnlyCds,
      resourceCategory: listParamsBase.resourceCategory,
      hasNoteOnly: listParamsBase.hasNoteOnly,
      hasDueDateOnly: listParamsBase.hasDueDateOnly,
      allowResourceOnly: listParamsBase.allowResourceOnly,
      locationKey: listParamsBase.locationKey,
      siteKey: listParamsBase.siteKey,
      processChangeResidualMode: KIOSK_LEADERBOARD_PROCESS_CHANGE_RESIDUAL_MODE,
      processChangeResidualStrongEvidenceKeys: params.processChangeResidualStrongEvidenceKeys
    },
    {
      leaderboardMaterializedBaseWhere: params.leaderboardMaterializedBaseWhere
    }
  );
}

function settleUnusedLeaderboardBoardShellCount(promise: Promise<number>): void {
  void promise.catch(() => {
    // hasMore=false スロットでは shell.rows.length を total 正本として返すため、
    // 並行起動済み COUNT の失敗は未処理 reject にしない。
  });
}

export async function fetchLeaderboardCompositeBoardShell(
  params: {
    listParamsBase: ListParamsBase;
    boardResourceCds: readonly string[];
    page: number;
    pageSize: number;
    includeDecorations?: boolean;
    deferTotals?: boolean;
  },
  deps: LeaderboardBoardServiceDeps
): Promise<LeaderboardBoardReadResult> {
  const requestStarted = performance.now();
  const sink = deps.performanceSink;
  const includeDecorations = params.includeDecorations !== false;
  const deferTotals = params.deferTotals === true;
  const cappedPageSize = Math.min(Math.max(1, Math.floor(params.pageSize)), 160);

  /** continue と同型: 同一 board shell リクエスト内で winner / residual / generation token を 1 回だけ */
  const { generationToken, processChangeResidualMaterialization } =
    await measureLeaderboardBoardPhase(
      sink,
      {
        endpoint: 'shell',
        phase: 'processChangeResidualContext',
        resourceCount: params.boardResourceCds.length
      },
      () =>
        resolveLeaderboardBoardProcessChangeResidualContext(sink, 'shell', {
          resourceCount: params.boardResourceCds.length
        })
    );
  const processChangeResidualStrongEvidenceKeys = processChangeResidualMaterialization.keys;
  const leaderboardMaterializedBaseWhere = await measureLeaderboardBoardPhase(
    sink,
    {
      endpoint: 'shell',
      phase: 'materializedBaseWhere',
      resourceCount: params.boardResourceCds.length
    },
    () => resolveLeaderboardMaterializedBaseWhere(prisma)
  );

  const countPromises = deferTotals
    ? []
    : params.boardResourceCds.map((resourceCd) => {
        const promise = countLeaderboardBoardShellResourceTotal(
          params.listParamsBase,
          {
            resourceCd,
            processChangeResidualStrongEvidenceKeys,
            leaderboardMaterializedBaseWhere
          }
        );
        settleUnusedLeaderboardBoardShellCount(promise);
        return promise;
      });

  const [shells, processChangeResidualSummary] = await Promise.all([
    Promise.all(
      params.boardResourceCds.map((resourceCd) =>
        measureLeaderboardBoardPhase(
          sink,
          {
            endpoint: 'shell',
            phase: 'resourceShell',
            resourceCd,
            resourceCount: params.boardResourceCds.length
          },
          () =>
            listLeaderboardShellProductionScheduleRows(
              {
                ...params.listParamsBase,
                page: params.page,
                pageSize: cappedPageSize,
                resourceCds: [resourceCd],
                processChangeResidualMode: KIOSK_LEADERBOARD_PROCESS_CHANGE_RESIDUAL_MODE,
                processChangeResidualStrongEvidenceKeys
              },
              { snapshotStore: deps.snapshotStore, leaderboardMaterializedBaseWhere, generationToken }
            ),
          (shell) => ({
            rowCount: shell.rows.length,
            hasMore: shell.hasMore
          })
        )
      )
    ),
    measureLeaderboardBoardPhase(
      sink,
      {
        endpoint: 'shell',
        phase: 'processChangeResidualSummary',
        resourceCount: params.boardResourceCds.length
      },
      () =>
        fetchLeaderboardProcessChangeResidualSummary({
          ...params.listParamsBase,
          resourceCds: [...params.boardResourceCds],
          leaderboardMaterializedBaseWhere,
          processChangeResidualMaterialization
        }),
      (summary) => ({
        total: summary.processChangeResidualTotal,
        rowCount: summary.processChangeResidualRows.length
      })
    )
  ]);

  const resourceTotals = await measureLeaderboardBoardPhase(
    sink,
    {
      endpoint: 'shell',
      phase: 'resourceTotals',
      resourceCount: params.boardResourceCds.length,
      deferredTotals: deferTotals
    },
    () =>
      Promise.all(
        shells.map((shell, i) => {
          const totalFromShell = resolveLeaderboardBoardShellResourceTotalFromShell(shell);
          if (totalFromShell !== undefined) {
            return Promise.resolve({ total: totalFromShell, exact: true });
          }
          if (deferTotals) {
            return Promise.resolve({ total: shell.rows.length, exact: false });
          }
          return countPromises[i]!.then((total) => ({ total, exact: true }));
        })
      ),
    (entries) => ({
      total: entries.reduce((acc, entry) => acc + entry.total, 0)
    })
  );
  const totals = resourceTotals.map((entry) => entry.total);
  const totalsDeferred = resourceTotals.some((entry) => !entry.exact);

  const mergedRowsRaw = shells.flatMap((s) => s.rows);
  const { rows: mergedRows } = await measureLeaderboardBoardPhase(
    sink,
    {
      endpoint: 'shell',
      phase: 'attachLabor',
      resourceCount: params.boardResourceCds.length,
      rowCount: mergedRowsRaw.length
    },
    () =>
      attachLaborToBoardPayload({
        rows: mergedRowsRaw,
        laborLookupContext: {
          leaderboardMaterializedBaseWhere,
          processChangeResidualMode: KIOSK_LEADERBOARD_PROCESS_CHANGE_RESIDUAL_MODE,
          processChangeResidualStrongEvidenceKeys
        }
      }),
    (attached) => ({
      rowCount: attached.rows.length
    })
  );
  const totalSum = totals.reduce((acc, n) => acc + n, 0);

  const resources: LeaderboardBoardResourceState[] = params.boardResourceCds.map((resourceCd, i) => ({
    resourceCd,
    snapshotId: shells[i]?.snapshotId,
    nextCursor: resolveFiniteLeaderboardBoardNextCursor(shells[i]?.nextCursor, [shells[i]?.rows.length]),
    hasMore: shells[i]?.hasMore ?? false,
    total: totals[i] ?? 0,
    pageSize: shells[i]?.pageSize ?? cappedPageSize
  }));

  const mergedRowsById = new Map(mergedRows.map((row) => [row.id, row] as const));
  for (let i = 0; i < shells.length; i += 1) {
    const snapshotId = shells[i]?.snapshotId?.trim();
    if (snapshotId && shells[i]!.rows.length > 0) {
      seedAttachedRowsForSnapshot({
        snapshotId,
        sourceRows: shells[i]!.rows,
        attachedRowsById: mergedRowsById
      });
    }
    if (snapshotId && resourceTotals[i]?.exact === true) {
      seedLeaderboardBoardSnapshotResourceTotal(snapshotId, totals[i] ?? 0);
    }
  }

  const maxPageSize = shells.length > 0 ? Math.max(...shells.map((s) => s.pageSize)) : cappedPageSize;

  const processChangeResidualPayload =
    processChangeResidualSummary.processChangeResidualTotal > 0
      ? {
          processChangeResidualTotal: processChangeResidualSummary.processChangeResidualTotal,
          processChangeResidualRows: processChangeResidualSummary.processChangeResidualRows,
          processChangeResidualRepresentativeLimit:
            processChangeResidualSummary.processChangeResidualRepresentativeLimit
        }
      : {
          processChangeResidualTotal: 0,
          processChangeResidualRows: [] as LeaderboardBoardReadResult['processChangeResidualRows'],
          processChangeResidualRepresentativeLimit:
            processChangeResidualSummary.processChangeResidualRepresentativeLimit
        };

  if (!includeDecorations) {
    emitLeaderboardBoardPerformance(sink, {
      endpoint: 'shell',
      phase: 'requestTotal',
      durationMs: performance.now() - requestStarted,
      ok: true,
      resourceCount: params.boardResourceCds.length,
      rowCount: mergedRows.length,
      hasMoreCount: resources.filter((r) => r.hasMore).length,
      total: totalSum,
      includeDecorations,
      deferredTotals: totalsDeferred
    });
    return {
      page: params.page,
      pageSize: maxPageSize,
      total: totalSum,
      rows: mergedRows,
      resources,
      ...(totalsDeferred ? { totalsDeferred: true } : {}),
      ...processChangeResidualPayload
    };
  }

  const { rowsWithDeco, leaderboardFooterChipsByPartKey } = await measureLeaderboardBoardPhase(
    sink,
    {
      endpoint: 'shell',
      phase: 'decorate',
      resourceCount: params.boardResourceCds.length,
      rowCount: mergedRows.length
    },
    () =>
      decorateLeaderboardCompositeBoardShell({
        mergedLightRows: mergedRows,
        locationKey: params.listParamsBase.locationKey,
        siteKey: params.listParamsBase.siteKey
      }),
    (decorated) => ({
      rowCount: decorated.rowsWithDeco.length
    })
  );

  emitLeaderboardBoardPerformance(sink, {
    endpoint: 'shell',
    phase: 'requestTotal',
    durationMs: performance.now() - requestStarted,
    ok: true,
    resourceCount: params.boardResourceCds.length,
    rowCount: rowsWithDeco.length,
    hasMoreCount: resources.filter((r) => r.hasMore).length,
    total: totalSum,
    includeDecorations,
    deferredTotals: totalsDeferred
  });

  return {
    page: params.page,
    pageSize: maxPageSize,
    total: totalSum,
    rows: rowsWithDeco,
    resources,
    ...(totalsDeferred ? { totalsDeferred: true } : {}),
    leaderboardFooterChipsByPartKey,
    ...processChangeResidualPayload
  };
}

export async function continueLeaderboardCompositeBoard(
  params: {
    listParamsBase: ListParamsBase;
    boardResourceCds: readonly string[];
    resourceSlices: ReadonlyArray<{
      resourceCd: string;
      snapshotId?: string;
      cursor?: number;
      excludeRowIds?: readonly string[];
      hasMore: boolean;
    }>;
    chunkSize: number;
    includeDecorations?: boolean;
  },
  deps: LeaderboardBoardServiceDeps
): Promise<LeaderboardBoardReadResult> {
  const requestStarted = performance.now();
  const sink = deps.performanceSink;
  const includeDecorations = params.includeDecorations !== false;
  const chunkSize = Math.min(160, Math.max(1, Math.floor(params.chunkSize)));

  const { generationToken, processChangeResidualMaterialization } =
    await measureLeaderboardBoardPhase(
      sink,
      {
        endpoint: 'continue',
        phase: 'processChangeResidualContext',
        resourceCount: params.boardResourceCds.length,
        chunkSize
      },
      () =>
        resolveLeaderboardBoardProcessChangeResidualContext(sink, 'continue', {
          resourceCount: params.boardResourceCds.length,
          chunkSize
        })
    );
  const processChangeResidualStrongEvidenceKeys = processChangeResidualMaterialization.keys;
  const leaderboardMaterializedBaseWhere = await measureLeaderboardBoardPhase(
    sink,
    {
      endpoint: 'continue',
      phase: 'materializedBaseWhere',
      resourceCount: params.boardResourceCds.length,
      chunkSize
    },
    () => resolveLeaderboardMaterializedBaseWhere(prisma)
  );

  const [totals, contOutputs] = await Promise.all([
    measureLeaderboardBoardPhase(
      sink,
      {
        endpoint: 'continue',
        phase: 'resourceTotals',
        resourceCount: params.resourceSlices.length,
        chunkSize
      },
      () =>
        resolveLeaderboardBoardResourceTotalsForContinue(
          params.listParamsBase,
          params.resourceSlices,
          processChangeResidualStrongEvidenceKeys,
          leaderboardMaterializedBaseWhere
        ),
      (resolvedTotals) => ({
        total: resolvedTotals.reduce((acc, n) => acc + n, 0)
      })
    ),
    Promise.all(
      params.boardResourceCds.map(async (_resourceCd, i) => {
        const slice = params.resourceSlices[i]!;
        if (!slice.hasMore) {
          return null;
        }
        return measureLeaderboardBoardPhase(
          sink,
          {
            endpoint: 'continue',
            phase: 'resourceContinue',
            resourceCd: slice.resourceCd,
            resourceCount: params.boardResourceCds.length,
            chunkSize
          },
          async () =>
            listLeaderboardShellContinuationProductionScheduleRows(
              {
                queryText: params.listParamsBase.queryText,
                productNos: params.listParamsBase.productNos,
                machineName: params.listParamsBase.machineName,
                resourceCds: [slice.resourceCd],
                assignedOnlyCds: params.listParamsBase.assignedOnlyCds,
                resourceCategory: params.listParamsBase.resourceCategory,
                hasNoteOnly: params.listParamsBase.hasNoteOnly,
                hasDueDateOnly: params.listParamsBase.hasDueDateOnly,
                allowResourceOnly: params.listParamsBase.allowResourceOnly,
                locationKey: params.listParamsBase.locationKey,
                siteKey: params.listParamsBase.siteKey,
                processChangeResidualMode: KIOSK_LEADERBOARD_PROCESS_CHANGE_RESIDUAL_MODE,
                processChangeResidualStrongEvidenceKeys,
                excludeRowIds: slice.excludeRowIds ?? [],
                cursor: slice.cursor,
                chunkSize,
                snapshotId: slice.snapshotId,
                page: 1
              },
              {
                snapshotStore: deps.snapshotStore,
                generationToken,
                leaderboardMaterializedBaseWhere
              }
            ),
          (cont) => ({
            rowCount: cont.rows.length,
            hasMore: cont.hasMore,
            snapshotExpired: cont.snapshotExpired
          })
        );
      })
    )
  ]);

  if (contOutputs.some((o) => o?.snapshotExpired === true)) {
    emitLeaderboardBoardPerformance(sink, {
      endpoint: 'continue',
      phase: 'requestTotal',
      durationMs: performance.now() - requestStarted,
      ok: true,
      resourceCount: params.boardResourceCds.length,
      total: totals.reduce((a, b) => a + b, 0),
      snapshotExpired: true,
      includeDecorations,
      chunkSize
    });
    return {
      page: 1,
      pageSize: chunkSize,
      total: totals.reduce((a, b) => a + b, 0),
      rows: [],
      resources: [],
      snapshotExpired: true
    };
  }

  const perResourceAssembled: ContinueAssembledResourceSlice[] = [];
  for (let i = 0; i < params.boardResourceCds.length; i += 1) {
    const slice = params.resourceSlices[i]!;
    const cont = contOutputs[i];
    const assembled = await measureLeaderboardBoardPhase(
      sink,
      {
        endpoint: 'continue',
        phase: 'assembleResource',
        resourceCd: slice.resourceCd,
        resourceCount: params.boardResourceCds.length,
        chunkSize
      },
      () =>
        assembleContinueMergedRowsForResource({
          slice,
          cont,
          deps,
          locationKey: params.listParamsBase.locationKey,
          siteKey: params.listParamsBase.siteKey,
          leaderboardMaterializedBaseWhere
        }),
      (value) => ({
        rowCount: value.merged.length,
        deltaRowCount: value.incrementalRows?.length
      })
    );
    perResourceAssembled.push(assembled);
  }

  const mergedRowsRaw = perResourceAssembled.flatMap((a) => a.merged);
  const canAttachDelta = perResourceAssembled.every((a) => a.incrementalRows !== undefined);
  const incrementalLightRows = canAttachDelta
    ? perResourceAssembled.flatMap((a) => a.incrementalRows!)
    : [];
  const deltaShellRowsFlattened = incrementalLightRows;
  const { rows: mergedRows, deltaRows: mergedDeltaRows } = await measureLeaderboardBoardPhase(
    sink,
    {
      endpoint: 'continue',
      phase: 'attachLabor',
      resourceCount: params.boardResourceCds.length,
      rowCount: mergedRowsRaw.length,
      deltaRowCount: deltaShellRowsFlattened.length,
      chunkSize
    },
    () =>
      attachLaborToBoardPayload({
        rows: mergedRowsRaw,
        ...(canAttachDelta ? { deltaRows: deltaShellRowsFlattened } : {}),
        laborLookupContext: {
          leaderboardMaterializedBaseWhere,
          processChangeResidualMode: KIOSK_LEADERBOARD_PROCESS_CHANGE_RESIDUAL_MODE,
          processChangeResidualStrongEvidenceKeys
        }
      }),
    (attached) => ({
      rowCount: attached.rows.length,
      deltaRowCount: attached.deltaRows?.length
    })
  );
  const mergedRowsById = new Map(mergedRows.map((row) => [row.id, row] as const));
  for (let i = 0; i < params.boardResourceCds.length; i += 1) {
    seedAttachedRowsForSnapshot({
      snapshotId: params.resourceSlices[i]?.snapshotId,
      sourceRows: perResourceAssembled[i]?.merged ?? [],
      attachedRowsById: mergedRowsById
    });
  }

  const resources: LeaderboardBoardResourceState[] = params.boardResourceCds.map((resourceCd, i) => {
    const slice = params.resourceSlices[i]!;
    const cont = contOutputs[i];
    const snap = slice.snapshotId?.trim()
      ? deps.snapshotStore.get(slice.snapshotId.trim())
      : undefined;
    const totalI = totals[i] ?? 0;

    if (cont != null) {
      return {
        resourceCd,
        snapshotId: slice.snapshotId,
        nextCursor: resolveFiniteLeaderboardBoardNextCursor(cont.nextCursor, [
          slice.cursor,
          snap?.orderedRowIds.length
        ]),
        hasMore: cont.hasMore ?? false,
        total: totalI,
        pageSize: chunkSize
      };
    }

    const derived = deriveStateFromSnapshot(snap, totalI);
    return {
      resourceCd,
      snapshotId: slice.snapshotId,
      nextCursor: resolveFiniteLeaderboardBoardNextCursor(derived.nextCursor, []),
      hasMore: false,
      total: totalI,
      pageSize: chunkSize
    };
  });

  const totalSum = totals.reduce((a, b) => a + b, 0);

  if (!includeDecorations) {
    emitLeaderboardBoardPerformance(sink, {
      endpoint: 'continue',
      phase: 'requestTotal',
      durationMs: performance.now() - requestStarted,
      ok: true,
      resourceCount: params.boardResourceCds.length,
      rowCount: mergedRows.length,
      deltaRowCount: mergedDeltaRows?.length,
      hasMoreCount: resources.filter((r) => r.hasMore).length,
      total: totalSum,
      includeDecorations,
      chunkSize
    });
    return {
      page: 1,
      pageSize: chunkSize,
      total: totalSum,
      rows: mergedRows,
      ...(canAttachDelta && mergedDeltaRows ? { deltaRows: mergedDeltaRows } : {}),
      resources
    };
  }

  const { rowsWithDeco, deltaRowsWithDeco, leaderboardFooterChipsByPartKey } =
    await measureLeaderboardBoardPhase(
      sink,
      {
        endpoint: 'continue',
        phase: 'decorate',
        resourceCount: params.boardResourceCds.length,
        rowCount: mergedRows.length,
        deltaRowCount: (mergedDeltaRows ?? incrementalLightRows).length,
        chunkSize
      },
      () =>
        decorateLeaderboardCompositeBoardContinue({
          mergedLightRows: mergedRows,
          incrementalLightRows: mergedDeltaRows ?? incrementalLightRows,
          canAttachDelta,
          deltaShellRowsFlattened: mergedDeltaRows ?? deltaShellRowsFlattened,
          locationKey: params.listParamsBase.locationKey,
          siteKey: params.listParamsBase.siteKey
        }),
      (decorated) => ({
        rowCount: decorated.rowsWithDeco.length,
        deltaRowCount: decorated.deltaRowsWithDeco?.length
      })
    );

  emitLeaderboardBoardPerformance(sink, {
    endpoint: 'continue',
    phase: 'requestTotal',
    durationMs: performance.now() - requestStarted,
    ok: true,
    resourceCount: params.boardResourceCds.length,
    rowCount: rowsWithDeco.length,
    deltaRowCount: deltaRowsWithDeco?.length,
    hasMoreCount: resources.filter((r) => r.hasMore).length,
    total: totalSum,
    includeDecorations,
    chunkSize
  });

  return {
    page: 1,
    pageSize: chunkSize,
    total: totalSum,
    rows: rowsWithDeco,
    ...(deltaRowsWithDeco !== undefined ? { deltaRows: deltaRowsWithDeco } : {}),
    resources,
    leaderboardFooterChipsByPartKey
  };
}
