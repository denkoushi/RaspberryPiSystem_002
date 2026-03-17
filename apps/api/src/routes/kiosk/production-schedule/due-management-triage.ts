import type { FastifyInstance } from 'fastify';

import { getDueManagementDailyPlan, replaceDueManagementDailyPlan } from '../../../services/production-schedule/due-management-daily-plan.service.js';
import {
  resolveDueManagementStorageLocationKey,
  toDueManagementScopeFromContext
} from '../../../services/production-schedule/due-management-location-scope-adapter.service.js';
import { getDueManagementTriageSelections, replaceDueManagementTriageSelections } from '../../../services/production-schedule/due-management-selection.service.js';
import {
  hasDueManagementResourceFilter,
  listDueManagementFilteredFseibans
} from '../../../services/production-schedule/due-management-resource-filter.service.js';
import { listDueManagementTriage } from '../../../services/production-schedule/due-management-triage.service.js';
import { getProductionScheduleSearchState } from '../../../services/production-schedule/production-schedule-search-state.service.js';
import {
  productionScheduleDueManagementDailyPlanBodySchema,
  productionScheduleDueManagementFilterQuerySchema,
  productionScheduleDueManagementTriageSelectionBodySchema,
  type KioskRouteDeps
} from './shared.js';

export async function registerProductionScheduleDueManagementTriageRoute(
  app: FastifyInstance,
  deps: KioskRouteDeps
): Promise<void> {
  app.get('/kiosk/production-schedule/due-management/triage', { config: { rateLimit: false } }, async (request) => {
    const { clientDevice } = await deps.requireClientDevice(request.headers['x-client-key']);
    const locationScopeContext = deps.resolveLocationScopeContext(clientDevice);
    const dueManagementScope = toDueManagementScopeFromContext(locationScopeContext);
    const query = productionScheduleDueManagementFilterQuerySchema.parse(request.query);
    const locationKey = resolveDueManagementStorageLocationKey(dueManagementScope);
    const [searchState, selectedFseibans] = await Promise.all([
      getProductionScheduleSearchState(locationKey),
      getDueManagementTriageSelections(locationKey)
    ]);
    const targetFseibans = hasDueManagementResourceFilter(query)
      ? await listDueManagementFilteredFseibans({
          locationScope: dueManagementScope,
          targetFseibans: searchState.state.history,
          filter: query
        })
      : searchState.state.history;
    const triage = await listDueManagementTriage({
      locationScope: dueManagementScope,
      targetFseibans,
      selectedFseibans
    });

    return {
      ...triage,
      selectedFseibans
    };
  });

  app.put('/kiosk/production-schedule/due-management/triage/selection', { config: { rateLimit: false } }, async (request) => {
    const { clientDevice } = await deps.requireClientDevice(request.headers['x-client-key']);
    const locationScopeContext = deps.resolveLocationScopeContext(clientDevice);
    const dueManagementScope = toDueManagementScopeFromContext(locationScopeContext);
    const locationKey = resolveDueManagementStorageLocationKey(dueManagementScope);
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

  app.get('/kiosk/production-schedule/due-management/daily-plan', { config: { rateLimit: false } }, async (request) => {
    const { clientDevice } = await deps.requireClientDevice(request.headers['x-client-key']);
    const locationScopeContext = deps.resolveLocationScopeContext(clientDevice);
    const dueManagementScope = toDueManagementScopeFromContext(locationScopeContext);
    const query = productionScheduleDueManagementFilterQuerySchema.parse(request.query);
    const locationKey = resolveDueManagementStorageLocationKey(dueManagementScope);
    const selectedFseibans = await getDueManagementTriageSelections(locationKey);
    const dailyPlan = await getDueManagementDailyPlan({
      locationKey,
      selectedFseibans
    });
    if (!hasDueManagementResourceFilter(query)) {
      return dailyPlan;
    }
    const filteredFseibans = await listDueManagementFilteredFseibans({
      locationScope: dueManagementScope,
      targetFseibans: dailyPlan.orderedFseibans,
      filter: query
    });
    const allowedFseibans = new Set(filteredFseibans);
    return {
      ...dailyPlan,
      orderedFseibans: dailyPlan.orderedFseibans.filter((fseiban) => allowedFseibans.has(fseiban)),
      items: dailyPlan.items.filter((item) => allowedFseibans.has(item.fseiban))
    };
  });

  app.put('/kiosk/production-schedule/due-management/daily-plan', { config: { rateLimit: false } }, async (request) => {
    const { clientDevice } = await deps.requireClientDevice(request.headers['x-client-key']);
    const locationScopeContext = deps.resolveLocationScopeContext(clientDevice);
    const dueManagementScope = toDueManagementScopeFromContext(locationScopeContext);
    const locationKey = resolveDueManagementStorageLocationKey(dueManagementScope);
    const body = productionScheduleDueManagementDailyPlanBodySchema.parse(request.body);
    const dailyPlan = await replaceDueManagementDailyPlan({
      locationKey,
      orderedFseibans: body.orderedFseibans
    });
    return {
      success: true,
      ...dailyPlan
    };
  });

}
