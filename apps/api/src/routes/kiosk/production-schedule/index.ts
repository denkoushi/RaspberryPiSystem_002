import type { FastifyInstance } from 'fastify';

import { registerProductionScheduleListRoute } from './list.js';
import { registerProductionScheduleResourcesRoute } from './resources.js';
import { registerProductionScheduleOrderUsageRoute } from './order-usage.js';
import { registerProductionScheduleCompleteRoute } from './complete.js';
import { registerProductionScheduleNoteRoute } from './note.js';
import { registerProductionScheduleDueDateRoute } from './due-date.js';
import { registerProductionScheduleProcessingRoute } from './processing.js';
import { registerProductionScheduleOrderRoute } from './order.js';
import { registerProductionScheduleSearchStateRoute } from './search-state.js';
import { registerProductionScheduleHistoryProgressRoute } from './history-progress.js';
import { registerProductionScheduleSearchHistoryRoute } from './search-history.js';
import type { KioskRouteDeps } from './shared.js';

export async function registerProductionScheduleRoutes(
  app: FastifyInstance,
  deps: KioskRouteDeps
): Promise<void> {
  await registerProductionScheduleListRoute(app, deps);
  await registerProductionScheduleResourcesRoute(app, deps);
  await registerProductionScheduleOrderUsageRoute(app, deps);
  await registerProductionScheduleCompleteRoute(app, deps);
  await registerProductionScheduleNoteRoute(app, deps);
  await registerProductionScheduleDueDateRoute(app, deps);
  await registerProductionScheduleProcessingRoute(app, deps);
  await registerProductionScheduleOrderRoute(app, deps);
  await registerProductionScheduleSearchStateRoute(app, deps);
  await registerProductionScheduleHistoryProgressRoute(app, deps);
  await registerProductionScheduleSearchHistoryRoute(app, deps);
}
