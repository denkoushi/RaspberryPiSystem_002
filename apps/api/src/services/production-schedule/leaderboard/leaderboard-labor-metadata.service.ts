import { performance } from 'node:perf_hooks';

import { Prisma } from '@prisma/client';
import { prisma } from '../../../lib/prisma.js';
import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from '../constants.js';
import {
  buildProductionScheduleDashboardBaseWhereWithCorrelatedMaxProductNoWinner,
  resolveLeaderboardMaterializedBaseWhere
} from '../row-resolver/index.js';
import { attachLeaderboardLaborMinutes } from './leaderboard-labor-minutes.service.js';
import {
  materializeProcessChangeResidualStrongEvidence,
  type ProcessChangeResidualStrongEvidenceMaterialization,
  type ProcessChangeResidualStrongEvidenceMaterializationTelemetryEvent
} from './leaderboard-process-change-residual.materialization.js';
import {
  readLeaderboardShellSnapshotGenerationTokenDetails,
  type LeaderboardShellSnapshotGenerationTokenDetails
} from './leaderboard-shell-snapshot-generation.js';
import { fetchLeaderboardScheduleHydratedRowsOrderedByDisplayItemIds } from './leaderboard-split-expansion.service.js';
import { normalizeLeaderboardDisplayRowIdScope } from './leaderboard-display-row-scope.js';
import { resolveLeaderboardLaborMetadataSnapshotContext } from './leaderboard-labor-metadata-snapshot-context.js';

import type {
  LeaderboardBoardPerformanceEvent,
  LeaderboardBoardPerformanceSink
} from './leaderboard-composite-board.service.js';
import type { LeaderboardShellSnapshotStore } from './leaderboard-shell-snapshot.store.js';
import type { ProductionScheduleRow } from '../production-schedule-query.service.js';

const KIOSK_LEADERBOARD_PROCESS_CHANGE_RESIDUAL_MODE = 'normal' as const;

export type LeaderboardLaborMetadataEntry = {
  id: string;
  machineRequiredMinutes: number;
  laborRequiredMinutes: number;
};

function emitLeaderboardLaborMetadataPerformance(
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

function roundOptionalDurationMs(value: number | undefined): number | undefined {
  return value == null ? undefined : Math.round(value);
}

async function measureLeaderboardLaborMetadataPhase<T>(
  sink: LeaderboardBoardPerformanceSink | undefined,
  eventBase: Omit<LeaderboardBoardPerformanceEvent, 'durationMs'>,
  work: () => Promise<T>,
  buildExtra?: (value: T) => Partial<LeaderboardBoardPerformanceEvent>
): Promise<T> {
  const started = performance.now();
  try {
    const value = await work();
    emitLeaderboardLaborMetadataPerformance(sink, {
      ...eventBase,
      ...buildExtra?.(value),
      ok: true,
      durationMs: performance.now() - started
    });
    return value;
  } catch (error) {
    const errorName = error instanceof Error ? error.name : 'UnknownError';
    const code = error instanceof Error ? (error as { code?: unknown }).code : undefined;
    emitLeaderboardLaborMetadataPerformance(sink, {
      ...eventBase,
      ok: false,
      errorName,
      ...(typeof code === 'string' && code.length > 0 ? { errorCode: code } : {}),
      durationMs: performance.now() - started
    });
    throw error;
  }
}

async function resolveLaborMetadataProcessChangeResidualContext(
  sink: LeaderboardBoardPerformanceSink | undefined,
  eventBase: Pick<
    LeaderboardBoardPerformanceEvent,
    'endpoint' | 'rowCount' | 'snapshotHit' | 'snapshotIdCount' | 'fallbackReason'
  >,
  snapshotGenerationTokenDetails?: {
    tokenDetails: LeaderboardShellSnapshotGenerationTokenDetails;
    snapshotIdCount: number;
  }
): Promise<{
  generationToken: string;
  processChangeResidualMaterialization: ProcessChangeResidualStrongEvidenceMaterialization;
}> {
  const initialTokenDetails =
    snapshotGenerationTokenDetails != null
      ? await measureLeaderboardLaborMetadataPhase(
          sink,
          {
            ...eventBase,
            phase: 'processChangeResidualContext',
            subphase: 'generationTokenSnapshot',
            snapshotHit: true,
            snapshotIdCount: snapshotGenerationTokenDetails.snapshotIdCount
          },
          async () => snapshotGenerationTokenDetails.tokenDetails
        )
      : await measureLeaderboardLaborMetadataPhase(
          sink,
          {
            ...eventBase,
            phase: 'processChangeResidualContext',
            subphase: 'generationTokenInitial',
            snapshotHit: false
          },
          () => readLeaderboardShellSnapshotGenerationTokenDetails()
        );

  let materializationTelemetry: ProcessChangeResidualStrongEvidenceMaterializationTelemetryEvent | undefined;
  const processChangeResidualMaterialization = await measureLeaderboardLaborMetadataPhase(
    sink,
    {
      ...eventBase,
      phase: 'processChangeResidualContext',
      subphase: 'residualMaterialization'
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
      strongEvidenceKeyCount: materializationTelemetry?.strongEvidenceKeyCount ?? materialization.keys.size,
      revisionChanged: materialization.rawMailRowsRevision !== initialTokenDetails.fkojunstStatusMailRowsRevision,
      sourceRowFetchDurationMs: materializationTelemetry?.sourceRowFetchDurationMs,
      normalizeDurationMs: materializationTelemetry?.normalizeDurationMs,
      dedupeDurationMs: materializationTelemetry?.dedupeDurationMs,
      buildEvidenceDurationMs: materializationTelemetry?.buildEvidenceDurationMs
    })
  );
  const tokenDetails =
    processChangeResidualMaterialization.rawMailRowsRevision === initialTokenDetails.fkojunstStatusMailRowsRevision
      ? initialTokenDetails
      : await measureLeaderboardLaborMetadataPhase(
          sink,
          {
            ...eventBase,
            phase: 'processChangeResidualContext',
            subphase: 'generationTokenRefresh',
            revisionChanged: true
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

function readFiniteMetadata(row: ProductionScheduleRow): LeaderboardLaborMetadataEntry | null {
  const machine = row.machineRequiredMinutes;
  const labor = row.laborRequiredMinutes;
  if (
    typeof machine !== 'number' ||
    !Number.isFinite(machine) ||
    typeof labor !== 'number' ||
    !Number.isFinite(labor)
  ) {
    return null;
  }
  return {
    id: row.id,
    machineRequiredMinutes: Math.max(0, machine),
    laborRequiredMinutes: Math.max(0, labor)
  };
}

export async function fetchLeaderboardBoardLaborMetadata(
  params: {
    orderedRowIds: readonly string[];
    locationKey: string;
    siteKey?: string;
    snapshotIds?: readonly string[];
  },
  deps: {
    performanceSink?: LeaderboardBoardPerformanceSink;
    snapshotStore?: LeaderboardShellSnapshotStore;
  } = {}
): Promise<{ rowMetadata: LeaderboardLaborMetadataEntry[] }> {
  const requestStarted = performance.now();
  const sink = deps.performanceSink;
  const orderedRowIds = normalizeLeaderboardDisplayRowIdScope(params.orderedRowIds);
  const snapshotContextStarted = performance.now();
  const snapshotContext = resolveLeaderboardLaborMetadataSnapshotContext({
    snapshotStore: deps.snapshotStore,
    snapshotIds: params.snapshotIds,
    orderedRowIds,
    locationKey: params.locationKey,
    siteKey: params.siteKey
  });
  const snapshotIdsRequested = (params.snapshotIds?.length ?? 0) > 0;
  if (snapshotIdsRequested) {
    emitLeaderboardLaborMetadataPerformance(sink, {
      endpoint: 'laborMetadata',
      phase: 'snapshotScope',
      durationMs: performance.now() - snapshotContextStarted,
      ok: true,
      rowCount: orderedRowIds.length,
      snapshotHit: snapshotContext.kind === 'hit',
      snapshotIdCount: snapshotContext.snapshotIdCount,
      trustedDisplayScope: snapshotContext.kind === 'hit',
      ...(snapshotContext.kind === 'miss' ? { fallbackReason: snapshotContext.reason } : {})
    });
  }

  const snapshotHit = snapshotContext.kind === 'hit';
  const fallbackReason = snapshotContext.kind === 'miss' ? snapshotContext.reason : undefined;
  const eventBase = {
    endpoint: 'laborMetadata' as const,
    rowCount: orderedRowIds.length,
    snapshotHit,
    ...(snapshotIdsRequested ? { snapshotIdCount: snapshotContext.snapshotIdCount } : {}),
    ...(fallbackReason && snapshotIdsRequested ? { fallbackReason } : {})
  };

  const { generationToken, processChangeResidualMaterialization } =
    await measureLeaderboardLaborMetadataPhase(
      sink,
      {
        ...eventBase,
        phase: 'processChangeResidualContext'
      },
      () =>
        resolveLaborMetadataProcessChangeResidualContext(
          sink,
          eventBase,
          snapshotContext.kind === 'hit'
            ? {
                tokenDetails: snapshotContext.generationTokenDetails,
                snapshotIdCount: snapshotContext.snapshotIdCount
              }
            : undefined
        )
    );
  const hydrateShellListWhere = snapshotHit
    ? Prisma.sql`"CsvDashboardRow"."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}`
    : undefined;
  const laborLookupBaseWhere = snapshotHit
    ? buildProductionScheduleDashboardBaseWhereWithCorrelatedMaxProductNoWinner(PRODUCTION_SCHEDULE_DASHBOARD_ID)
    : await measureLeaderboardLaborMetadataPhase(
        sink,
        {
          ...eventBase,
          phase: 'materializedBaseWhere',
          winnerBaseStrategy: 'materialized'
        },
        () => resolveLeaderboardMaterializedBaseWhere(prisma)
      );

  if (snapshotHit) {
    emitLeaderboardLaborMetadataPerformance(sink, {
      ...eventBase,
      phase: 'laborLookupBaseWhere',
      durationMs: 0,
      ok: true,
      winnerBaseStrategy: 'correlated',
      trustedDisplayScope: true
    });
  }

  const siteScopedGlobalRankLocation = params.siteKey?.trim().length
    ? params.siteKey.trim()
    : params.locationKey;
  const hydratedRows = await measureLeaderboardLaborMetadataPhase(
    sink,
    {
      ...eventBase,
      phase: 'hydrateRows'
    },
    () =>
      fetchLeaderboardScheduleHydratedRowsOrderedByDisplayItemIds({
        orderedDisplayItemIds: orderedRowIds,
        locationKey: params.locationKey,
        siteScopedGlobalRankLocation,
        leaderboardMaterializedBaseWhere: snapshotHit ? undefined : laborLookupBaseWhere,
        leaderboardShellListWhere: hydrateShellListWhere
      }),
    (rows) => ({
      rowCount: rows.length,
      trustedDisplayScope: snapshotHit
    })
  );

  const attachedRows = await measureLeaderboardLaborMetadataPhase(
    sink,
    {
      ...eventBase,
      phase: 'attachLabor',
      rowCount: hydratedRows.length,
      includeLabor: true,
      winnerBaseStrategy: snapshotHit ? 'correlated' : 'materialized'
    },
    () =>
      attachLeaderboardLaborMinutes(hydratedRows, {
        leaderboardMaterializedBaseWhere: laborLookupBaseWhere,
        processChangeResidualMode: KIOSK_LEADERBOARD_PROCESS_CHANGE_RESIDUAL_MODE,
        processChangeResidualStrongEvidenceKeys: processChangeResidualMaterialization.keys,
        cacheScopeKey: generationToken
      }),
    (rows) => ({
      rowCount: rows.length
    })
  );

  const rowMetadata = attachedRows
    .map(readFiniteMetadata)
    .filter((entry): entry is LeaderboardLaborMetadataEntry => entry != null);

  emitLeaderboardLaborMetadataPerformance(sink, {
    ...eventBase,
    phase: 'requestTotal',
    durationMs: performance.now() - requestStarted,
    ok: true,
    rowCount: rowMetadata.length,
    includeLabor: true,
    trustedDisplayScope: snapshotHit,
    winnerBaseStrategy: snapshotHit ? 'correlated' : 'materialized'
  });

  return { rowMetadata };
}
