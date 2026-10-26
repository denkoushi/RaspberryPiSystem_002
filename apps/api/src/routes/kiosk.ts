import type { FastifyInstance } from 'fastify';
import { registerProductionScheduleRoutes } from './kiosk/production-schedule/index.js';
import { registerKioskEmployeesRoute } from './kiosk/employees.js';
import { registerKioskPortalCardsRoute } from './kiosk/portal-cards.js';
import { registerKioskInitialRoute } from './kiosk/initial-route.js';
import { registerKioskConfigRoute } from './kiosk/config.js';
import { registerKioskSitesRoute } from './kiosk/sites.js';
import { registerKioskCallTargetsRoute } from './kiosk/call-targets.js';
import { registerKioskSupportRoute } from './kiosk/support.js';
import { registerKioskInquiryRoutes } from './kiosk/inquiries.js';
import { registerKioskPowerRoute } from './kiosk/power.js';
import { registerKioskSignagePreviewRoutes } from './kiosk/signage-preview.js';
import { registerPurchaseOrderLookupRoute } from './kiosk/purchase-order-lookup.js';
import { registerKioskPalletVisualizationRoutes } from './kiosk/pallet-visualization.js';
import {
  registerKioskPartMeasurementSelfInspectionRecordApprovalAuthRoute
} from './kiosk/part-measurement-self-inspection-record-approval-auth.js';
import { registerKioskAssemblyRecordApprovalAuthRoute } from './kiosk/assembly-record-approval-auth.js';
import { registerKioskAssemblyTemplateAuthRoute } from './kiosk/assembly-template-auth.js';
import { registerKioskAssemblyTraceabilityAuthRoute } from './kiosk/assembly-traceability-auth.js';
import { registerSelfInspectionNonconformityRoutes } from './kiosk/self-inspection-nonconformities.js';
import {
  checkPowerRateLimit,
  checkRateLimit,
  getWebRTCCallExcludeClientIds,
  normalizeClientKey,
  requireClientDevice,
  resolveLocationScopeContext,
  resolveTargetLocation
} from './kiosk/shared.js';
import { leaderboardShellSnapshotStore } from '../services/production-schedule/leaderboard/kiosk-leaderboard-snapshot-store.js';

const POWER_ACTIONS_DIR = process.env.POWER_ACTIONS_DIR ?? '/app/power-actions';

export async function registerKioskRoutes(app: FastifyInstance): Promise<void> {
  await registerKioskEmployeesRoute(app, {
    requireClientDevice
  });

  await registerSelfInspectionNonconformityRoutes(app);

  await registerProductionScheduleRoutes(app, {
    requireClientDevice,
    resolveLocationScopeContext,
    resolveTargetLocation,
    leaderboardShellSnapshotStore
  });

  await registerKioskConfigRoute(app, {
    normalizeClientKey
  });

  await registerKioskInitialRoute(app, { requireClientDevice });
  await registerKioskPortalCardsRoute(app, { requireClientDevice });

  await registerKioskSitesRoute(app, {
    requireClientDevice
  });

  await registerKioskCallTargetsRoute(app, {
    normalizeClientKey,
    getWebRTCCallExcludeClientIds
  });

  await registerKioskSupportRoute(app, {
    normalizeClientKey,
    checkRateLimit,
    resolveLocationScopeContext
  });

  await registerKioskInquiryRoutes(app);

  await registerKioskPowerRoute(app, {
    requireClientDevice,
    checkPowerRateLimit,
    powerActionsDir: POWER_ACTIONS_DIR
  });

  await registerKioskSignagePreviewRoutes(app, {
    requireClientDevice
  });

  await registerPurchaseOrderLookupRoute(app, {
    requireClientDevice
  });

  await registerKioskPalletVisualizationRoutes(app, {
    requireClientDevice
  });

  await registerKioskPartMeasurementSelfInspectionRecordApprovalAuthRoute(app, {
    requireClientDevice,
    resolveLocationScopeContext,
    resolveTargetLocation,
    leaderboardShellSnapshotStore
  });

  await registerKioskAssemblyTemplateAuthRoute(app, {
    requireClientDevice,
    resolveLocationScopeContext,
    resolveTargetLocation,
    leaderboardShellSnapshotStore
  });

  await registerKioskAssemblyRecordApprovalAuthRoute(app, {
    requireClientDevice,
    resolveLocationScopeContext,
    resolveTargetLocation,
    leaderboardShellSnapshotStore
  });

  await registerKioskAssemblyTraceabilityAuthRoute(app, {
    requireClientDevice,
    resolveLocationScopeContext,
    resolveTargetLocation,
    leaderboardShellSnapshotStore
  });
}
