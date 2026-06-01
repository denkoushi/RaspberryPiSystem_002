import type { FastifyInstance } from 'fastify';

import { listProductionScheduleRows } from '../../../services/production-schedule/production-schedule-query.service.js';
import {
  productionScheduleQuerySchema,
  parseCsvList,
  toLegacyLocationKeyFromDeviceScope,
  type KioskRouteDeps
} from './shared.js';
import { resolveProductionScheduleAssignmentLocationKey } from './resolve-assignment-location-key.js';

const LEADERBOARD_PAGE_SIZE_HARD_CAP = 900;

export async function registerProductionScheduleListRoute(
  app: FastifyInstance,
  deps: KioskRouteDeps
): Promise<void> {
  app.get('/kiosk/production-schedule', { config: { rateLimit: false } }, async (request) => {
    const { clientDevice } = await deps.requireClientDevice(request.headers['x-client-key']);
    const locationScopeContext = deps.resolveLocationScopeContext(clientDevice);
    const deviceScopeKey = locationScopeContext.deviceScopeKey;

    const query = productionScheduleQuerySchema.parse(request.query);
    const page = query.page ?? 1;
    const requestedPageSize = query.pageSize ?? 400;
    const pageSize = query.responseProfile === 'leaderboard'
      ? Math.min(requestedPageSize, LEADERBOARD_PAGE_SIZE_HARD_CAP)
      : requestedPageSize;
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
      // 自主検査候補一覧は `listSelfInspectionEligibleProductionScheduleRows` が OFFSET 付きダッシュボード SQL で走査する。
      // leaderboard プロファイル（page/offset 非対応）は使わない。
      responseProfile: query.selfInspectionEligibleOnly === true ? 'full' : query.responseProfile,
      selfInspectionEligibleOnly: query.selfInspectionEligibleOnly === true
    });

    return result;
  });
}
