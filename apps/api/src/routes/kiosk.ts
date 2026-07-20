import type { FastifyInstance } from 'fastify';
import { registerProductionScheduleRoutes } from './kiosk/production-schedule/index.js';
import { registerKioskEmployeesRoute } from './kiosk/employees.js';
import { registerKioskConfigRoute } from './kiosk/config.js';
import { registerKioskCallTargetsRoute } from './kiosk/call-targets.js';
import { registerKioskSupportRoute } from './kiosk/support.js';
import { registerKioskPowerRoute } from './kiosk/power.js';
import { registerKioskSignagePreviewRoutes } from './kiosk/signage-preview.js';
import { registerPurchaseOrderLookupRoute } from './kiosk/purchase-order-lookup.js';
import { registerKioskPalletVisualizationRoutes } from './kiosk/pallet-visualization.js';
import {
  registerKioskPartMeasurementSelfInspectionRecordApprovalAuthRoute
} from './kiosk/part-measurement-self-inspection-record-approval-auth.js';
import { registerKioskAssemblyProcedureOrderAuthRoute } from './kiosk/assembly-procedure-order-auth.js';
import { registerKioskAssemblyRecordApprovalAuthRoute } from './kiosk/assembly-record-approval-auth.js';
import { registerKioskAssemblyTraceabilityAuthRoute } from './kiosk/assembly-traceability-auth.js';
import {
  checkPowerRateLimit,
  checkRateLimit,
  getWebRTCCallExcludeClientIds,
  normalizeClientKey,
  requireClientDevice,
  resolveLocationScopeContext,
  resolveTargetLocation
} from './kiosk/shared.js';
import { createInMemoryLeaderboardShellSnapshotStore } from '../services/production-schedule/leaderboard/leaderboard-shell-snapshot.store.js';

const POWER_ACTIONS_DIR = process.env.POWER_ACTIONS_DIR ?? '/app/power-actions';

function resolveLeaderboardShellSnapshotTtlMs(): number {
  const raw = process.env.LEADERBOARD_SHELL_SNAPSHOT_TTL_MS;
  if (raw == null || raw.trim() === '') {
    return 5 * 60 * 1000;
  }
  const n = Number(raw);
  return Number.isFinite(n) && n >= 30_000 ? n : 5 * 60 * 1000;
}

const leaderboardShellSnapshotStore = createInMemoryLeaderboardShellSnapshotStore({
  defaultTtlMs: resolveLeaderboardShellSnapshotTtlMs()
});

export async function registerKioskRoutes(app: FastifyInstance): Promise<void> {
  await registerKioskEmployeesRoute(app, {
    requireClientDevice
  });

  await registerProductionScheduleRoutes(app, {
    requireClientDevice,
    resolveLocationScopeContext,
    resolveTargetLocation,
    leaderboardShellSnapshotStore
  });

  await registerKioskConfigRoute(app, {
    normalizeClientKey
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

  await registerKioskAssemblyProcedureOrderAuthRoute(app, {
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
