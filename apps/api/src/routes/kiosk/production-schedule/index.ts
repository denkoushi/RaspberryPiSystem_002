import type { FastifyInstance } from 'fastify';

import { registerProductionScheduleListRoute } from './list.js';
import { registerProductionScheduleResourcesRoute } from './resources.js';
import { registerProductionScheduleOrderUsageRoute } from './order-usage.js';
import { registerProductionScheduleOrderSearchRoute } from './order-search.js';
import { registerProductionScheduleCompleteRoute } from './complete.js';
import { registerProductionScheduleNoteRoute } from './note.js';
import { registerProductionScheduleDueDateRoute } from './due-date.js';
import { registerProductionScheduleProcessingRoute } from './processing.js';
import { registerProductionScheduleOrderRoute } from './order.js';
import { registerProductionScheduleSearchStateRoute } from './search-state.js';
import { registerProductionScheduleHistoryProgressRoute } from './history-progress.js';
import { registerProductionScheduleSeibanMachineNamesRoute } from './seiban-machine-names.js';
import { registerProductionScheduleSearchHistoryRoute } from './search-history.js';
import { registerProductionScheduleDueManagementSummaryRoute } from './due-management-summary.js';
import { registerProductionScheduleDueManagementSeibanRoute } from './due-management-seiban.js';
import { registerProductionScheduleDueManagementDueDateRoute } from './due-management-due-date.js';
import { registerProductionScheduleDueManagementProcessingDueDateRoute } from './due-management-processing-due-date.js';
import { registerProductionScheduleDueManagementPartPrioritiesRoute } from './due-management-part-priorities.js';
import { registerProductionScheduleDueManagementProcessingRoute } from './due-management-processing.js';
import { registerProductionScheduleDueManagementNoteRoute } from './due-management-note.js';
import { registerProductionScheduleDueManagementAuthRoute } from './due-management-auth.js';
import { registerProductionScheduleDueManagementTriageRoute } from './due-management-triage.js';
import { registerProductionScheduleDueManagementGlobalRankRoute } from './due-management-global-rank.js';
import { registerProductionScheduleDueManagementActualHoursRoute } from './due-management-actual-hours.js';
import { registerProductionScheduleDueManagementManualOrderOverviewRoute } from './due-management-manual-order-overview.js';
import { registerProductionScheduleManualOrderSiteDevicesRoute } from './manual-order-site-devices.js';
import { registerProductionScheduleManualOrderResourceAssignmentsRoute } from './manual-order-resource-assignments.js';
import { registerProductionScheduleProcessingTypeOptionsRoute } from './processing-type-options.js';
import { registerProductionScheduleProgressOverviewRoute } from './progress-overview.js';
import type { KioskRouteDeps } from './shared.js';

export async function registerProductionScheduleRoutes(
  app: FastifyInstance,
  deps: KioskRouteDeps
): Promise<void> {
  await registerProductionScheduleListRoute(app, deps);
  await registerProductionScheduleResourcesRoute(app, deps);
  await registerProductionScheduleOrderUsageRoute(app, deps);
  await registerProductionScheduleOrderSearchRoute(app, deps);
  await registerProductionScheduleCompleteRoute(app, deps);
  await registerProductionScheduleNoteRoute(app, deps);
  await registerProductionScheduleDueDateRoute(app, deps);
  await registerProductionScheduleProcessingRoute(app, deps);
  await registerProductionScheduleOrderRoute(app, deps);
  await registerProductionScheduleSearchStateRoute(app, deps);
  await registerProductionScheduleHistoryProgressRoute(app, deps);
  await registerProductionScheduleSeibanMachineNamesRoute(app, deps);
  await registerProductionScheduleSearchHistoryRoute(app, deps);
  await registerProductionScheduleDueManagementSummaryRoute(app, deps);
  await registerProductionScheduleDueManagementSeibanRoute(app, deps);
  await registerProductionScheduleDueManagementDueDateRoute(app, deps);
  await registerProductionScheduleDueManagementProcessingDueDateRoute(app, deps);
  await registerProductionScheduleDueManagementPartPrioritiesRoute(app, deps);
  await registerProductionScheduleDueManagementProcessingRoute(app, deps);
  await registerProductionScheduleDueManagementNoteRoute(app, deps);
  await registerProductionScheduleDueManagementAuthRoute(app, deps);
  await registerProductionScheduleDueManagementTriageRoute(app, deps);
  await registerProductionScheduleDueManagementGlobalRankRoute(app, deps);
  await registerProductionScheduleDueManagementManualOrderOverviewRoute(app, deps);
  await registerProductionScheduleManualOrderSiteDevicesRoute(app, deps);
  await registerProductionScheduleManualOrderResourceAssignmentsRoute(app, deps);
  await registerProductionScheduleDueManagementActualHoursRoute(app, deps);
  await registerProductionScheduleProcessingTypeOptionsRoute(app, deps);
  await registerProductionScheduleProgressOverviewRoute(app, deps);
}
