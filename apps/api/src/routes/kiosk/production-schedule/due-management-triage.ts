import type { FastifyInstance } from 'fastify';

import { getDueManagementDailyPlan, replaceDueManagementDailyPlan } from '../../../services/production-schedule/due-management-daily-plan.service.js';
import {
  listDueManagementGlobalRank,
  replaceDueManagementGlobalRank
} from '../../../services/production-schedule/due-management-global-rank.service.js';
import { getDueManagementTriageSelections, replaceDueManagementTriageSelections } from '../../../services/production-schedule/due-management-selection.service.js';
import { listDueManagementTriage } from '../../../services/production-schedule/due-management-triage.service.js';
import { getProductionScheduleSearchState } from '../../../services/production-schedule/production-schedule-search-state.service.js';
import {
  productionScheduleDueManagementDailyPlanBodySchema,
  productionScheduleDueManagementGlobalRankBodySchema,
  productionScheduleDueManagementTriageSelectionBodySchema,
  type KioskRouteDeps
} from './shared.js';

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

  app.get('/kiosk/production-schedule/due-management/daily-plan', { config: { rateLimit: false } }, async (request) => {
    const { clientDevice } = await deps.requireClientDevice(request.headers['x-client-key']);
    const locationKey = deps.resolveLocationKey(clientDevice);
    const selectedFseibans = await getDueManagementTriageSelections(locationKey);
    const dailyPlan = await getDueManagementDailyPlan({
      locationKey,
      selectedFseibans
    });
    return dailyPlan;
  });

  app.put('/kiosk/production-schedule/due-management/daily-plan', { config: { rateLimit: false } }, async (request) => {
    const { clientDevice } = await deps.requireClientDevice(request.headers['x-client-key']);
    const locationKey = deps.resolveLocationKey(clientDevice);
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

  app.get('/kiosk/production-schedule/due-management/global-rank', { config: { rateLimit: false } }, async (request) => {
    const { clientDevice } = await deps.requireClientDevice(request.headers['x-client-key']);
    const locationKey = deps.resolveLocationKey(clientDevice);
    const orderedFseibans = await listDueManagementGlobalRank(locationKey);
    return {
      orderedFseibans
    };
  });

  app.put('/kiosk/production-schedule/due-management/global-rank', { config: { rateLimit: false } }, async (request) => {
    const { clientDevice } = await deps.requireClientDevice(request.headers['x-client-key']);
    const locationKey = deps.resolveLocationKey(clientDevice);
    const body = productionScheduleDueManagementGlobalRankBodySchema.parse(request.body);
    const orderedFseibans = await replaceDueManagementGlobalRank({
      locationKey,
      orderedFseibans: body.orderedFseibans
    });
    return {
      success: true,
      orderedFseibans
    };
  });
}
