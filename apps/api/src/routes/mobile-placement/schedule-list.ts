import type { FastifyInstance } from 'fastify';

import { resolveLocationScopeContext } from '../../lib/location-scope-resolver.js';
import { listProductionScheduleRows } from '../../services/production-schedule/production-schedule-query.service.js';
import type { ClientDeviceForScopeResolution } from '../kiosk/shared.js';
import {
  parseCsvList,
  productionScheduleQuerySchema,
  toLegacyLocationKeyFromDeviceScope
} from '../kiosk/production-schedule/shared.js';
import { resolveProductionScheduleAssignmentLocationKey } from '../kiosk/production-schedule/resolve-assignment-location-key.js';

type ScheduleDeps = {
  requireClientDevice: (rawClientKey: unknown) => Promise<{
    clientKey: string;
    clientDevice: ClientDeviceForScopeResolution;
  }>;
};

/**
 * GET /api/mobile-placement/schedule
 * キオスク生産スケジュール一覧と同一クエリ契約（clientKey 必須）
 */
export async function registerMobilePlacementScheduleRoute(
  app: FastifyInstance,
  deps: ScheduleDeps
): Promise<void> {
  app.get('/mobile-placement/schedule', { config: { rateLimit: false } }, async (request) => {
    const { clientDevice } = await deps.requireClientDevice(request.headers['x-client-key']);
    const locationScopeContext = resolveLocationScopeContext(clientDevice);
    const deviceScopeKey = locationScopeContext.deviceScopeKey;

    const q = request.query as Record<string, string | string[] | undefined>;
    const flatQuery: Record<string, string | undefined> = {};
    for (const [k, v] of Object.entries(q ?? {})) {
      if (v === undefined) continue;
      flatQuery[k] = Array.isArray(v) ? v[0] : v;
    }

    const query = productionScheduleQuerySchema.parse(flatQuery);
    const page = query.page ?? 1;
    const pageSize = Math.min(query.pageSize ?? 200, 2000);
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

    return listProductionScheduleRows({
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
      siteKey: locationScopeContext.siteKey
    });
  });
}
