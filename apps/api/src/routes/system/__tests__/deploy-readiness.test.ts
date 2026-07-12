import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSchedulerRuntimeState } from '../../../bootstrap/scheduler-runtime-state.js';
import { createDeployReadinessObservability } from '../../../services/system/deploy-readiness-observability.js';
import { registerDeployReadinessRoute } from '../deploy-readiness.js';

const checkDatabaseConnection = vi.fn(async () => undefined);

vi.mock('../../../services/system/db-health.service.js', () => ({
  checkDatabaseConnection: (...args: unknown[]) => checkDatabaseConnection(...args),
}));

function createApp() {
  const app = Fastify();
  app.decorate('schedulerRuntimeState', createSchedulerRuntimeState());
  app.decorate('deployReadinessObservability', createDeployReadinessObservability());
  registerDeployReadinessRoute(app);
  return app;
}

describe('GET /system/deploy-readiness/internal', () => {
  const apps: Array<ReturnType<typeof createApp>> = [];

  afterEach(async () => {
    while (apps.length > 0) {
      const app = apps.pop();
      if (app) await app.close();
    }
    checkDatabaseConnection.mockReset();
    checkDatabaseConnection.mockResolvedValue(undefined);
  });

  it('accepts a standby whose advisory-lock session is connected', async () => {
    const app = createApp();
    apps.push(app);
    app.schedulerRuntimeState.setStandby({ databaseConnection: 'connected' });

    const response = await app.inject({ method: 'GET', url: '/system/deploy-readiness/internal' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      ready: true,
      database: 'ready',
      scheduler: {
        enabled: true,
        role: 'standby',
        databaseConnection: 'connected',
        lastTransitionAt: expect.any(String),
      },
      metrics: {
        windowSeconds: 60,
        sampleCount: 0,
        serverErrorCount: 0,
        errorRate: 0,
      },
    });
  });

  it('rejects when the database check fails', async () => {
    const app = createApp();
    apps.push(app);
    app.schedulerRuntimeState.setStandby({ databaseConnection: 'connected' });
    checkDatabaseConnection.mockRejectedValueOnce(new Error('db down'));

    const response = await app.inject({ method: 'GET', url: '/system/deploy-readiness/internal' });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({
      ready: false,
      database: 'error',
      scheduler: {
        enabled: true,
        role: 'standby',
        databaseConnection: 'connected',
      },
    });
  });

  it('rejects a standby whose dedicated advisory-lock session is disconnected', async () => {
    const app = createApp();
    apps.push(app);
    app.schedulerRuntimeState.setStandby({ databaseConnection: 'disconnected' });

    const response = await app.inject({ method: 'GET', url: '/system/deploy-readiness/internal' });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({
      ready: false,
      database: 'ready',
      scheduler: {
        enabled: true,
        role: 'standby',
        databaseConnection: 'disconnected',
        lastTransitionAt: expect.any(String),
      },
      metrics: {
        windowSeconds: 60,
        sampleCount: 0,
        serverErrorCount: 0,
        errorRate: 0,
      },
    });
  });

  it('rejects a demoted former leader whose advisory-lock session is disconnected', async () => {
    const app = createApp();
    apps.push(app);
    app.schedulerRuntimeState.setLeader({ enabled: true, databaseConnection: 'connected' });
    app.schedulerRuntimeState.setStandby({ databaseConnection: 'disconnected' });

    const response = await app.inject({ method: 'GET', url: '/system/deploy-readiness/internal' });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({
      ready: false,
      database: 'ready',
      scheduler: {
        enabled: true,
        role: 'standby',
        databaseConnection: 'disconnected',
      },
    });
  });
});
