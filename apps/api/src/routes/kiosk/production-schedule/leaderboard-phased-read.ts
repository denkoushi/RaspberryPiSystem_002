import type { FastifyInstance } from 'fastify';

import {
  countProductionScheduleDashboardVisibleRowsFromListFilters,
  decorateLeaderboardShellRowsForKiosk,
  listLeaderboardShellContinuationProductionScheduleRows,
  listLeaderboardShellProductionScheduleRows
} from '../../../services/production-schedule/production-schedule-query.service.js';
import {
  continueLeaderboardCompositeBoard,
  fetchLeaderboardCompositeBoardShell
} from '../../../services/production-schedule/leaderboard/leaderboard-composite-board.service.js';
import {
  parseCsvList,
  productionScheduleLeaderboardBoardContinueBodySchema,
  productionScheduleLeaderboardBoardQuerySchema,
  productionScheduleLeaderboardDecorationsBodySchema,
  productionScheduleLeaderboardPhasedQuerySchema,
  productionScheduleLeaderboardShellContinuationBodySchema,
  toLegacyLocationKeyFromDeviceScope,
  type KioskRouteDeps
} from './shared.js';
import { resolveProductionScheduleAssignmentLocationKey } from './resolve-assignment-location-key.js';

const LEADERBOARD_SHELL_PAGE_SIZE_CAP = 160;

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
        locationKey: assignmentLocationKey,
        siteKey: locationScopeContext.siteKey
      },
      { snapshotStore: deps.leaderboardShellSnapshotStore }
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
        excludeRowIds: body.excludeRowIds ?? [],
        cursor: body.cursor,
        chunkSize,
        snapshotId: body.snapshotId
      },
      { snapshotStore: deps.leaderboardShellSnapshotStore }
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
      locationKey: assignmentLocationKey,
      siteKey: locationScopeContext.siteKey
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
          locationKey: assignmentLocationKey,
          siteKey: locationScopeContext.siteKey
        },
        boardResourceCds,
        page,
        pageSize,
        includeDecorations: query.includeDecorations
      },
      { snapshotStore: deps.leaderboardShellSnapshotStore }
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
          locationKey: assignmentLocationKey,
          siteKey: locationScopeContext.siteKey
        },
        boardResourceCds,
        resourceSlices: body.resourceSlices,
        chunkSize,
        includeDecorations: body.includeDecorations
      },
      { snapshotStore: deps.leaderboardShellSnapshotStore }
    );
  });
}
