import { performance } from 'node:perf_hooks';

import { prisma } from '../../../lib/prisma.js';
import { resolveLeaderboardMaterializedBaseWhere } from '../row-resolver/index.js';
import { attachLeaderboardLaborMinutes } from './leaderboard-labor-minutes.service.js';
import {
  materializeProcessChangeResidualStrongEvidence,
  type ProcessChangeResidualStrongEvidenceMaterialization
} from './leaderboard-process-change-residual.materialization.js';
import { readLeaderboardShellSnapshotGenerationTokenDetails } from './leaderboard-shell-snapshot-generation.js';
import { fetchLeaderboardScheduleHydratedRowsOrderedByDisplayItemIds } from './leaderboard-split-expansion.service.js';
import { normalizeLeaderboardDisplayRowIdScope } from './leaderboard-display-row-scope.js';

import type {
  LeaderboardBoardPerformanceEvent,
  LeaderboardBoardPerformanceSink
} from './leaderboard-composite-board.service.js';
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
      durationMs: Math.round(event.durationMs)
    });
  } catch {
    // 計測ログは診断専用。sink 側の失敗で表示 API を壊さない。
  }
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

async function resolveLaborMetadataProcessChangeResidualContext(): Promise<{
  generationToken: string;
  processChangeResidualMaterialization: ProcessChangeResidualStrongEvidenceMaterialization;
}> {
  const initialTokenDetails = await readLeaderboardShellSnapshotGenerationTokenDetails();
  const processChangeResidualMaterialization = await materializeProcessChangeResidualStrongEvidence(prisma, {
    fkojunstStatusMailRowsRevision: initialTokenDetails.fkojunstStatusMailRowsRevision
  });
  const tokenDetails =
    processChangeResidualMaterialization.rawMailRowsRevision === initialTokenDetails.fkojunstStatusMailRowsRevision
      ? initialTokenDetails
      : await readLeaderboardShellSnapshotGenerationTokenDetails({
          fkojunstStatusMailRowsRevision: processChangeResidualMaterialization.rawMailRowsRevision
        });
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
  },
  deps: {
    performanceSink?: LeaderboardBoardPerformanceSink;
  } = {}
): Promise<{ rowMetadata: LeaderboardLaborMetadataEntry[] }> {
  const requestStarted = performance.now();
  const sink = deps.performanceSink;
  const orderedRowIds = normalizeLeaderboardDisplayRowIdScope(params.orderedRowIds);
  const eventBase = {
    endpoint: 'laborMetadata' as const,
    rowCount: orderedRowIds.length
  };

  const { generationToken, processChangeResidualMaterialization } =
    await resolveLaborMetadataProcessChangeResidualContext();
  const leaderboardMaterializedBaseWhere = await measureLeaderboardLaborMetadataPhase(
    sink,
    {
      ...eventBase,
      phase: 'materializedBaseWhere'
    },
    () => resolveLeaderboardMaterializedBaseWhere(prisma)
  );

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
        leaderboardMaterializedBaseWhere
      }),
    (rows) => ({
      rowCount: rows.length
    })
  );

  const attachedRows = await measureLeaderboardLaborMetadataPhase(
    sink,
    {
      ...eventBase,
      phase: 'attachLabor',
      rowCount: hydratedRows.length,
      includeLabor: true
    },
    () =>
      attachLeaderboardLaborMinutes(hydratedRows, {
        leaderboardMaterializedBaseWhere,
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
    includeLabor: true
  });

  return { rowMetadata };
}
