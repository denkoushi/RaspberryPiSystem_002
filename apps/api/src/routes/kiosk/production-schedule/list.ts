import type { FastifyInstance } from 'fastify';

import { listProductionScheduleRows } from '../../../services/production-schedule/production-schedule-query.service.js';
import {
  productionScheduleQuerySchema,
  parseCsvList,
  toLegacyLocationKeyFromDeviceScope,
  type KioskRouteDeps
} from './shared.js';
import { resolveProductionScheduleAssignmentLocationKey } from './resolve-assignment-location-key.js';

// #region agent log
const emitLeaderboardRouteDebugLog = (payload: {
  hypothesisId: string;
  location: string;
  message: string;
  data: Record<string, unknown>;
  runId?: string;
}) => {
  fetch('http://127.0.0.1:7426/ingest/2502f74a-7c46-49e5-b1c6-8c32b7781f8e', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '44c291' },
    body: JSON.stringify({
      sessionId: '44c291',
      runId: payload.runId ?? 'investigate-1',
      hypothesisId: payload.hypothesisId,
      location: payload.location,
      message: payload.message,
      data: payload.data,
      timestamp: Date.now()
    })
  }).catch(() => {});
};
// #endregion

export async function registerProductionScheduleListRoute(
  app: FastifyInstance,
  deps: KioskRouteDeps
): Promise<void> {
  app.get('/kiosk/production-schedule', { config: { rateLimit: false } }, async (request) => {
    const requestStartAt = Date.now();
    const { clientDevice } = await deps.requireClientDevice(request.headers['x-client-key']);
    const locationScopeContext = deps.resolveLocationScopeContext(clientDevice);
    const deviceScopeKey = locationScopeContext.deviceScopeKey;

    const query = productionScheduleQuerySchema.parse(request.query);
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 400;
    const rawQueryText = (query.q ?? query.productNo)?.trim() ?? '';
    const productNos = parseCsvList(query.productNos);
    const machineName = query.machineName?.trim();
    const resourceCds = parseCsvList(query.resourceCds);
    const assignedOnlyCds = parseCsvList(query.resourceAssignedOnlyCds);
    const resourceCategory = query.resourceCategory;
    const hasNoteOnly = query.hasNoteOnly === true;
    const hasDueDateOnly = query.hasDueDateOnly === true;

    const assignmentLocationKey = await resolveProductionScheduleAssignmentLocationKey({
      actorDeviceScopeKey: toLegacyLocationKeyFromDeviceScope(deviceScopeKey),
      targetDeviceScopeKey: query.targetDeviceScopeKey
    });
    // #region agent log
    emitLeaderboardRouteDebugLog({
      hypothesisId: 'H1',
      location: 'list.ts:routeEntry',
      message: 'kiosk production-schedule request parsed',
      data: {
        responseProfile: query.responseProfile ?? 'full',
        page,
        pageSize,
        resourceCdsCount: resourceCds.length,
        assignedOnlyCdsCount: assignedOnlyCds.length,
        activeQueryLength: rawQueryText.length
      }
    });
    // #endregion

    const result = await listProductionScheduleRows({
      page,
      pageSize,
      queryText: rawQueryText,
      productNos,
      machineName: machineName && machineName.length > 0 ? machineName : undefined,
      resourceCds,
      assignedOnlyCds,
      resourceCategory,
      hasNoteOnly,
      hasDueDateOnly,
      allowResourceOnly: query.allowResourceOnly === true,
      locationKey: assignmentLocationKey,
      siteKey: locationScopeContext.siteKey,
      responseProfile: query.responseProfile
    });
    // #region agent log
    emitLeaderboardRouteDebugLog({
      hypothesisId: 'H4',
      location: 'list.ts:routeReturn',
      message: 'kiosk production-schedule response summary',
      data: {
        responseProfile: query.responseProfile ?? 'full',
        elapsedMs: Date.now() - requestStartAt,
        total: result.total,
        rowCount: result.rows.length,
        footerPartKeyCount: result.leaderboardFooterChipsByPartKey
          ? Object.keys(result.leaderboardFooterChipsByPartKey).length
          : 0
      }
    });
    // #endregion

    return result;
  });
}
