import type { FastifyInstance } from 'fastify';

import {
  countProductionScheduleDashboardVisibleRowsFromListFilters,
  decorateLeaderboardShellRowsForKiosk,
  listLeaderboardShellContinuationProductionScheduleRows,
  listLeaderboardShellProductionScheduleRows
} from '../../../services/production-schedule/production-schedule-query.service.js';
import {
  continueLeaderboardCompositeBoard,
  fetchLeaderboardCompositeBoardShell,
  type LeaderboardBoardPerformanceSink
} from '../../../services/production-schedule/leaderboard/leaderboard-composite-board.service.js';
import { fetchLeaderboardBoardLaborMetadata } from '../../../services/production-schedule/leaderboard/leaderboard-labor-metadata.service.js';
import {
  materializeProcessChangeResidualStrongEvidence,
  type ProcessChangeResidualStrongEvidenceMaterialization
} from '../../../services/production-schedule/leaderboard/leaderboard-process-change-residual.materialization.js';
import { readLeaderboardShellSnapshotGenerationTokenDetails } from '../../../services/production-schedule/leaderboard/leaderboard-shell-snapshot-generation.js';
import {
  parseCsvList,
  productionScheduleLeaderboardBoardContinueBodySchema,
  productionScheduleLeaderboardBoardQuerySchema,
  productionScheduleLeaderboardClientPerfBodySchema,
  productionScheduleLeaderboardDecorationsBodySchema,
  productionScheduleLeaderboardLaborMetadataBodySchema,
  productionScheduleLeaderboardPhasedQuerySchema,
  productionScheduleLeaderboardShellContinuationBodySchema,
  toLegacyLocationKeyFromDeviceScope,
  type KioskRouteDeps
} from './shared.js';
import { resolveProductionScheduleAssignmentLocationKey } from './resolve-assignment-location-key.js';

const LEADERBOARD_SHELL_PAGE_SIZE_CAP = 160;

const KIOSK_LEADERBOARD_PROCESS_CHANGE_RESIDUAL_MODE = 'normal' as const;

function isLeaderboardBoardPerformanceLogEnabled(): boolean {
  const value = process.env.LEADERBOARD_BOARD_PERF_LOG?.trim().toLowerCase();
  return value === 'true' || value === '1';
}

function createLeaderboardBoardPerformanceSink(request: {
  id?: unknown;
  log: { info: (obj: Record<string, unknown>, message: string) => void };
}): LeaderboardBoardPerformanceSink | undefined {
  if (!isLeaderboardBoardPerformanceLogEnabled()) return undefined;
  return (event) => {
    request.log.info(
      {
        component: 'leaderboardBoardPerformance',
        requestId: request.id,
        ...event
      },
      '[leaderboard-board-performance]'
    );
  };
}

async function resolveKioskLeaderboardProcessChangeResidualContext(): Promise<{
  generationToken: string;
  processChangeResidualMaterialization: ProcessChangeResidualStrongEvidenceMaterialization;
}> {
  const initialTokenDetails = await readLeaderboardShellSnapshotGenerationTokenDetails();
  const processChangeResidualMaterialization = await materializeProcessChangeResidualStrongEvidence({
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

export async function registerProductionScheduleLeaderboardPhasedReadRoutes(
  app: FastifyInstance,
  deps: KioskRouteDeps
): Promise<void> {
  app.get('/kiosk/production-schedule/leaderboard-shell', { config: { rateLimit: false } }, async (request) => {
    const { clientDevice } = await deps.requireClientDevice(request.headers['x-client-key']);
    const locationScopeContext = deps.resolveLocationScopeContext(clientDevice);
    const deviceScopeKey = locationScopeContext.deviceScopeKey;

    const query = productionScheduleLeaderboardPhasedQuerySchema.parse(request.query);
    const page = query.page ?? 1;
    const requestedPageSize = query.pageSize ?? LEADERBOARD_SHELL_PAGE_SIZE_CAP;
    const pageSize = Math.min(requestedPageSize, LEADERBOARD_SHELL_PAGE_SIZE_CAP);
    const rawQueryText = (query.q ?? query.productNo)?.trim() ?? '';
    const productNos = parseCsvList(query.productNos);
    const machineName = query.machineName?.trim();
    const resourceCds = parseCsvList(query.resourceCds);
    const assignedOnlyCds = parseCsvList(query.resourceAssignedOnlyCds);
    const resourceCategory = query.resourceCategory;

    const assignmentLocationKey = await resolveProductionScheduleAssignmentLocationKey({
      actorDeviceScopeKey: toLegacyLocationKeyFromDeviceScope(deviceScopeKey),
      targetDeviceScopeKey: query.targetDeviceScopeKey
    });
    const { generationToken, processChangeResidualMaterialization } =
      await resolveKioskLeaderboardProcessChangeResidualContext();

    return listLeaderboardShellProductionScheduleRows(
      {
        page,
        pageSize,
        queryText: rawQueryText,
        productNos,
        machineName: machineName && machineName.length > 0 ? machineName : undefined,
        resourceCds,
        assignedOnlyCds,
        resourceCategory,
        hasNoteOnly: query.hasNoteOnly === true,
        hasDueDateOnly: query.hasDueDateOnly === true,
        allowResourceOnly: query.allowResourceOnly === true,
        completionFilter: query.completionFilter,
        locationKey: assignmentLocationKey,
        siteKey: locationScopeContext.siteKey,
        processChangeResidualMode: KIOSK_LEADERBOARD_PROCESS_CHANGE_RESIDUAL_MODE,
        processChangeResidualStrongEvidenceKeys: processChangeResidualMaterialization.keys
      },
      { snapshotStore: deps.leaderboardShellSnapshotStore, generationToken }
    );
  });

  app.post('/kiosk/production-schedule/leaderboard-shell/continue', { config: { rateLimit: false } }, async (request) => {
    const { clientDevice } = await deps.requireClientDevice(request.headers['x-client-key']);
    const locationScopeContext = deps.resolveLocationScopeContext(clientDevice);
    const deviceScopeKey = locationScopeContext.deviceScopeKey;

    const body = productionScheduleLeaderboardShellContinuationBodySchema.parse(request.body ?? {});
    const chunkSize = Math.min(body.pageSize ?? LEADERBOARD_SHELL_PAGE_SIZE_CAP, LEADERBOARD_SHELL_PAGE_SIZE_CAP);
    const rawQueryText = (body.q ?? body.productNo)?.trim() ?? '';
    const productNos = parseCsvList(body.productNos);
    const machineName = body.machineName?.trim();
    const resourceCds = parseCsvList(body.resourceCds);
    const assignedOnlyCds = parseCsvList(body.resourceAssignedOnlyCds);
    const resourceCategory = body.resourceCategory;

    const assignmentLocationKey = await resolveProductionScheduleAssignmentLocationKey({
      actorDeviceScopeKey: toLegacyLocationKeyFromDeviceScope(deviceScopeKey),
      targetDeviceScopeKey: body.targetDeviceScopeKey
    });
    const { generationToken, processChangeResidualMaterialization } =
      await resolveKioskLeaderboardProcessChangeResidualContext();

    return listLeaderboardShellContinuationProductionScheduleRows(
      {
        locationKey: assignmentLocationKey,
        siteKey: locationScopeContext.siteKey,
        queryText: rawQueryText,
        productNos,
        machineName: machineName && machineName.length > 0 ? machineName : undefined,
        resourceCds,
        assignedOnlyCds,
        resourceCategory,
        hasNoteOnly: body.hasNoteOnly === true,
        hasDueDateOnly: body.hasDueDateOnly === true,
        allowResourceOnly: body.allowResourceOnly === true,
        completionFilter: body.completionFilter,
        excludeRowIds: body.excludeRowIds ?? [],
        cursor: body.cursor,
        chunkSize,
        snapshotId: body.snapshotId,
        processChangeResidualMode: KIOSK_LEADERBOARD_PROCESS_CHANGE_RESIDUAL_MODE,
        processChangeResidualStrongEvidenceKeys: processChangeResidualMaterialization.keys
      },
      { snapshotStore: deps.leaderboardShellSnapshotStore, generationToken }
    );
  });

  app.get('/kiosk/production-schedule/leaderboard-total', { config: { rateLimit: false } }, async (request) => {
    const { clientDevice } = await deps.requireClientDevice(request.headers['x-client-key']);
    const locationScopeContext = deps.resolveLocationScopeContext(clientDevice);
    const deviceScopeKey = locationScopeContext.deviceScopeKey;

    const query = productionScheduleLeaderboardPhasedQuerySchema.parse(request.query);
    const rawQueryText = (query.q ?? query.productNo)?.trim() ?? '';
    const productNos = parseCsvList(query.productNos);
    const machineName = query.machineName?.trim();
    const resourceCds = parseCsvList(query.resourceCds);
    const assignedOnlyCds = parseCsvList(query.resourceAssignedOnlyCds);
    const resourceCategory = query.resourceCategory;

    const assignmentLocationKey = await resolveProductionScheduleAssignmentLocationKey({
      actorDeviceScopeKey: toLegacyLocationKeyFromDeviceScope(deviceScopeKey),
      targetDeviceScopeKey: query.targetDeviceScopeKey
    });
    const { processChangeResidualMaterialization } = await resolveKioskLeaderboardProcessChangeResidualContext();

    const total = await countProductionScheduleDashboardVisibleRowsFromListFilters({
      queryText: rawQueryText,
      productNos,
      machineName: machineName && machineName.length > 0 ? machineName : undefined,
      resourceCds,
      assignedOnlyCds,
      resourceCategory,
      hasNoteOnly: query.hasNoteOnly === true,
      hasDueDateOnly: query.hasDueDateOnly === true,
      allowResourceOnly: query.allowResourceOnly === true,
      completionFilter: query.completionFilter,
      locationKey: assignmentLocationKey,
      siteKey: locationScopeContext.siteKey,
      processChangeResidualMode: KIOSK_LEADERBOARD_PROCESS_CHANGE_RESIDUAL_MODE,
      processChangeResidualStrongEvidenceKeys: processChangeResidualMaterialization.keys
    });

    return { total };
  });

  app.post('/kiosk/production-schedule/leaderboard-decorations', { config: { rateLimit: false } }, async (request) => {
    const { clientDevice } = await deps.requireClientDevice(request.headers['x-client-key']);
    const locationScopeContext = deps.resolveLocationScopeContext(clientDevice);
    const deviceScopeKey = locationScopeContext.deviceScopeKey;

    const body = productionScheduleLeaderboardDecorationsBodySchema.parse(request.body ?? {});

    const assignmentLocationKey = await resolveProductionScheduleAssignmentLocationKey({
      actorDeviceScopeKey: toLegacyLocationKeyFromDeviceScope(deviceScopeKey),
      targetDeviceScopeKey: body.targetDeviceScopeKey
    });

    return decorateLeaderboardShellRowsForKiosk({
      orderedRowIds: body.rowIds,
      locationKey: assignmentLocationKey,
      siteKey: locationScopeContext.siteKey
    });
  });

  app.post('/kiosk/production-schedule/leaderboard-board/client-perf', { config: { rateLimit: false } }, async (request, reply) => {
    const { clientDevice } = await deps.requireClientDevice(request.headers['x-client-key']);
    const body = productionScheduleLeaderboardClientPerfBodySchema.parse(request.body ?? {});

    request.log.info(
      {
        component: 'leaderboardBoardClientPerf',
        requestId: request.id,
        clientDeviceId: clientDevice.id,
        forwardedFor: request.headers['x-forwarded-for'],
        userAgent: request.headers['user-agent'],
        referer: request.headers.referer,
        ...body
      },
      '[leaderboard-board-client-perf]'
    );

    return reply.status(204).send();
  });

  app.post('/kiosk/production-schedule/leaderboard-board/labor-metadata', { config: { rateLimit: false } }, async (request) => {
    const { clientDevice } = await deps.requireClientDevice(request.headers['x-client-key']);
    const locationScopeContext = deps.resolveLocationScopeContext(clientDevice);
    const deviceScopeKey = locationScopeContext.deviceScopeKey;

    const body = productionScheduleLeaderboardLaborMetadataBodySchema.parse(request.body ?? {});
    const assignmentLocationKey = await resolveProductionScheduleAssignmentLocationKey({
      actorDeviceScopeKey: toLegacyLocationKeyFromDeviceScope(deviceScopeKey),
      targetDeviceScopeKey: body.targetDeviceScopeKey
    });

    return fetchLeaderboardBoardLaborMetadata(
      {
        orderedRowIds: body.rowIds,
        locationKey: assignmentLocationKey,
        siteKey: locationScopeContext.siteKey
      },
      {
        performanceSink: createLeaderboardBoardPerformanceSink(request)
      }
    );
  });

  app.get('/kiosk/production-schedule/leaderboard-board', { config: { rateLimit: false } }, async (request, reply) => {
    const { clientDevice } = await deps.requireClientDevice(request.headers['x-client-key']);
    const locationScopeContext = deps.resolveLocationScopeContext(clientDevice);
    const deviceScopeKey = locationScopeContext.deviceScopeKey;

    const query = productionScheduleLeaderboardBoardQuerySchema.parse(request.query);
    const boardResourceCds = parseCsvList(query.boardResourceCds);
    if (boardResourceCds.length === 0) {
      return reply.status(400).send({
        statusCode: 400,
        error: 'Bad Request',
        message: 'boardResourceCds に有効な資源 CD が必要です'
      });
    }

    const page = query.page ?? 1;
    const requestedPageSize = query.pageSize ?? LEADERBOARD_SHELL_PAGE_SIZE_CAP;
    const pageSize = Math.min(requestedPageSize, LEADERBOARD_SHELL_PAGE_SIZE_CAP);
    const rawQueryText = (query.q ?? query.productNo)?.trim() ?? '';
    const productNos = parseCsvList(query.productNos);
    const machineName = query.machineName?.trim();
    const assignedOnlyCds = parseCsvList(query.resourceAssignedOnlyCds);
    const resourceCategory = query.resourceCategory;

    const assignmentLocationKey = await resolveProductionScheduleAssignmentLocationKey({
      actorDeviceScopeKey: toLegacyLocationKeyFromDeviceScope(deviceScopeKey),
      targetDeviceScopeKey: query.targetDeviceScopeKey
    });

    return fetchLeaderboardCompositeBoardShell(
      {
        listParamsBase: {
          queryText: rawQueryText,
          productNos,
          machineName: machineName && machineName.length > 0 ? machineName : undefined,
          assignedOnlyCds,
          resourceCategory,
          hasNoteOnly: query.hasNoteOnly === true,
          hasDueDateOnly: query.hasDueDateOnly === true,
          allowResourceOnly: query.allowResourceOnly === true,
          completionFilter: query.completionFilter,
          locationKey: assignmentLocationKey,
          siteKey: locationScopeContext.siteKey
        },
        boardResourceCds,
        page,
        pageSize,
        includeDecorations: query.includeDecorations,
        includeLabor: query.includeLabor,
        deferTotals: query.deferTotals
      },
      {
        snapshotStore: deps.leaderboardShellSnapshotStore,
        performanceSink: createLeaderboardBoardPerformanceSink(request)
      }
    );
  });

  app.post('/kiosk/production-schedule/leaderboard-board/continue', { config: { rateLimit: false } }, async (request, reply) => {
    const { clientDevice } = await deps.requireClientDevice(request.headers['x-client-key']);
    const locationScopeContext = deps.resolveLocationScopeContext(clientDevice);
    const deviceScopeKey = locationScopeContext.deviceScopeKey;

    const body = productionScheduleLeaderboardBoardContinueBodySchema.parse(request.body ?? {});
    const boardResourceCds = parseCsvList(body.boardResourceCds);
    if (boardResourceCds.length === 0) {
      return reply.status(400).send({
        statusCode: 400,
        error: 'Bad Request',
        message: 'boardResourceCds に有効な資源 CD が必要です'
      });
    }

    const chunkSize = Math.min(body.pageSize ?? LEADERBOARD_SHELL_PAGE_SIZE_CAP, LEADERBOARD_SHELL_PAGE_SIZE_CAP);
    const rawQueryText = (body.q ?? body.productNo)?.trim() ?? '';
    const productNos = parseCsvList(body.productNos);
    const machineName = body.machineName?.trim();
    const assignedOnlyCds = parseCsvList(body.resourceAssignedOnlyCds);
    const resourceCategory = body.resourceCategory;

    const assignmentLocationKey = await resolveProductionScheduleAssignmentLocationKey({
      actorDeviceScopeKey: toLegacyLocationKeyFromDeviceScope(deviceScopeKey),
      targetDeviceScopeKey: body.targetDeviceScopeKey
    });

    return continueLeaderboardCompositeBoard(
      {
        listParamsBase: {
          queryText: rawQueryText,
          productNos,
          machineName: machineName && machineName.length > 0 ? machineName : undefined,
          assignedOnlyCds,
          resourceCategory,
          hasNoteOnly: body.hasNoteOnly === true,
          hasDueDateOnly: body.hasDueDateOnly === true,
          allowResourceOnly: body.allowResourceOnly === true,
          completionFilter: body.completionFilter,
          locationKey: assignmentLocationKey,
          siteKey: locationScopeContext.siteKey
        },
        boardResourceCds,
        resourceSlices: body.resourceSlices,
        chunkSize,
        includeDecorations: body.includeDecorations,
        includeLabor: body.includeLabor
      },
      {
        snapshotStore: deps.leaderboardShellSnapshotStore,
        performanceSink: createLeaderboardBoardPerformanceSink(request)
      }
    );
  });
}
