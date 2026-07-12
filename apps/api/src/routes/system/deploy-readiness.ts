import type { FastifyInstance } from 'fastify';
import { checkDatabaseConnection } from '../../services/system/db-health.service.js';

export type InternalDeployReadinessScheduler = {
  enabled: boolean;
  role: 'leader' | 'standby' | 'stopped';
  databaseConnection: 'connected' | 'disconnected' | 'not-used';
  lastTransitionAt?: string;
};

export type InternalDeployReadinessResponse = {
  ready: boolean;
  database: 'ready' | 'error';
  scheduler: InternalDeployReadinessScheduler;
  metrics: {
    windowSeconds: number;
    sampleCount: number;
    serverErrorCount: number;
    errorRate: number;
  };
};

/**
 * Internal Blue/Green readiness probe (no auth).
 * Ready when the database is healthy and, if scheduler election is enabled,
 * the dedicated advisory-lock session is still connected.
 */
export function registerDeployReadinessRoute(app: FastifyInstance): void {
  app.get(
    '/system/deploy-readiness/internal',
    { config: { rateLimit: false } },
    async (_request, reply) => {
      let database: 'ready' | 'error' = 'ready';
      try {
        await checkDatabaseConnection();
      } catch {
        database = 'error';
      }

      const snapshot = app.schedulerRuntimeState.snapshot();
      const scheduler: InternalDeployReadinessScheduler = {
        enabled: snapshot.enabled,
        role: snapshot.role,
        databaseConnection: snapshot.databaseConnection,
        ...(snapshot.lastTransitionAt
          ? { lastTransitionAt: snapshot.lastTransitionAt }
          : {}),
      };

      const metrics = app.deployReadinessObservability.snapshot();
      const schedulerSessionReady =
        !scheduler.enabled || scheduler.databaseConnection === 'connected';
      const ready = database === 'ready' && schedulerSessionReady;

      const response: InternalDeployReadinessResponse = {
        ready,
        database,
        scheduler,
        metrics,
      };

      const statusCode = ready ? 200 : 503;
      app.deployReadinessObservability.recordResponse(statusCode);
      return reply.status(statusCode).send(response);
    }
  );
}
