import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';

process.env.JWT_ACCESS_SECRET ??= 'test-access-secret-1234567890';

import { env } from '../../../config/env.js';
import { registerDeployWorkloadRoute } from '../deploy-workload.js';

function createApp() {
  const app = Fastify();
  const scheduler = {
    start: vi.fn(),
    stop: vi.fn(),
    getTelemetrySnapshot: vi.fn(() => ({ running: true, runner: 'test' })),
  };
  app.decorate('signageRenderScheduler', scheduler);
  registerDeployWorkloadRoute(app);
  return { app, scheduler };
}

describe('POST /system/deploy-workload/internal', () => {
  const apps: Array<ReturnType<typeof createApp>['app']> = [];

  afterEach(async () => {
    while (apps.length > 0) await apps.pop()?.close();
  });

  it('requires the protected token before it pauses signage rendering', async () => {
    const { app, scheduler } = createApp();
    apps.push(app);

    const response = await app.inject({
      method: 'POST', url: '/system/deploy-workload/internal',
      payload: { action: 'pause-signage' },
    });

    expect(response.statusCode).toBe(403);
    expect(scheduler.stop).not.toHaveBeenCalled();
  });

  it('pauses and resumes only the signage scheduler with the correct token', async () => {
    const { app, scheduler } = createApp();
    apps.push(app);
    const headers = { 'x-deploy-control-token': env.DEPLOY_CONTROL_TOKEN ?? env.JWT_ACCESS_SECRET };

    const paused = await app.inject({
      method: 'POST', url: '/system/deploy-workload/internal', headers,
      payload: { action: 'pause-signage' },
    });
    const resumed = await app.inject({
      method: 'POST', url: '/system/deploy-workload/internal', headers,
      payload: { action: 'resume-signage' },
    });

    expect(paused.statusCode).toBe(200);
    expect(resumed.statusCode).toBe(200);
    expect(scheduler.stop).toHaveBeenCalledOnce();
    expect(scheduler.start).toHaveBeenCalledOnce();
  });

  it('rejects callers outside the host or Docker network', async () => {
    const { app, scheduler } = createApp();
    apps.push(app);
    const response = await app.inject({
      method: 'POST', url: '/system/deploy-workload/internal',
      remoteAddress: '10.20.30.40',
      headers: { 'x-deploy-control-token': env.DEPLOY_CONTROL_TOKEN ?? env.JWT_ACCESS_SECRET },
      payload: { action: 'pause-signage' },
    });

    expect(response.statusCode).toBe(403);
    expect(scheduler.stop).not.toHaveBeenCalled();
  });
});
