import type { FastifyInstance } from 'fastify';

import { getProductionScheduleSearchState } from '../../../services/production-schedule/production-schedule-search-state.service.js';
import { getDueManagementTriageSelections, replaceDueManagementTriageSelections } from '../../../services/production-schedule/due-management-selection.service.js';
import { listDueManagementTriage } from '../../../services/production-schedule/due-management-triage.service.js';
import { productionScheduleDueManagementTriageSelectionBodySchema, type KioskRouteDeps } from './shared.js';

export async function registerProductionScheduleDueManagementTriageRoute(
  app: FastifyInstance,
  deps: KioskRouteDeps
): Promise<void> {
  app.get('/kiosk/production-schedule/due-management/triage', { config: { rateLimit: false } }, async (request) => {
    const { clientDevice } = await deps.requireClientDevice(request.headers['x-client-key']);
    const locationKey = deps.resolveLocationKey(clientDevice);
    const [searchState, selectedFseibans] = await Promise.all([
      getProductionScheduleSearchState(locationKey),
      getDueManagementTriageSelections(locationKey)
    ]);
    const triage = await listDueManagementTriage({
      locationKey,
      targetFseibans: searchState.state.history,
      selectedFseibans
    });

    return {
      ...triage,
      selectedFseibans
    };
  });

  app.put('/kiosk/production-schedule/due-management/triage/selection', { config: { rateLimit: false } }, async (request) => {
    const { clientDevice } = await deps.requireClientDevice(request.headers['x-client-key']);
    const locationKey = deps.resolveLocationKey(clientDevice);
    const body = productionScheduleDueManagementTriageSelectionBodySchema.parse(request.body);
    const selectedFseibans = await replaceDueManagementTriageSelections({
      locationKey,
      selectedFseibans: body.selectedFseibans
    });
    return {
      success: true,
      selectedFseibans
    };
  });
}
