import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

process.env.JWT_ACCESS_SECRET ??= 'test-access-secret-1234567890';

import { env } from '../../../config/env.js';
import { createSchedulerRuntimeState } from '../../../bootstrap/scheduler-runtime-state.js';
import { registerDeployWorkloadRoute } from '../deploy-workload.js';

const originalSignageRenderEnabled = env.SIGNAGE_RENDER_ENABLED;

function createApp() {
  const app = Fastify();
  let signageRunning = true;
  const scheduler = {
    pauseForDeploy: vi.fn(async () => {
      signageRunning = false;
    }),
    resumeAfterDeploy: vi.fn(async () => {
      signageRunning = true;
    }),
    getTelemetrySnapshot: vi.fn(() => ({ isRunning: signageRunning, runner: 'test' })),
  };
  const schedulerRuntimeState = createSchedulerRuntimeState();
  schedulerRuntimeState.setLeader({ enabled: true, databaseConnection: 'connected' });
  app.decorate('signageRenderScheduler', scheduler);
  app.decorate('schedulerRuntimeState', schedulerRuntimeState);
  registerDeployWorkloadRoute(app);
  return { app, scheduler, schedulerRuntimeState };
}

describe('POST /system/deploy-workload/internal', () => {
  const apps: Array<ReturnType<typeof createApp>['app']> = [];

  beforeEach(() => {
    env.SIGNAGE_RENDER_ENABLED = true;
  });

  afterEach(async () => {
    while (apps.length > 0) await apps.pop()?.close();
    env.SIGNAGE_RENDER_ENABLED = originalSignageRenderEnabled;
  });

  it('requires the protected token', async () => {
    const { app, scheduler } = createApp();
    apps.push(app);
    const response = await app.inject({
      method: 'POST', url: '/system/deploy-workload/internal',
      payload: { action: 'pause-signage' },
    });
    expect(response.statusCode).toBe(403);
    expect(scheduler.pauseForDeploy).not.toHaveBeenCalled();
  });

  it('rejects a same-character-count token with a different UTF-8 byte length', async () => {
    const { app, scheduler } = createApp();
    apps.push(app);
    const expected = env.DEPLOY_CONTROL_TOKEN ?? env.JWT_ACCESS_SECRET;
    const response = await app.inject({
      method: 'POST', url: '/system/deploy-workload/internal',
      headers: { 'x-deploy-control-token': 'é'.repeat(expected.length) },
      payload: { action: 'pause-signage' },
    });
    expect(response.statusCode).toBe(403);
    expect(scheduler.pauseForDeploy).not.toHaveBeenCalled();
  });

  it('quiesces and resumes only the signage scheduler', async () => {
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
    expect(paused.json()).toMatchObject({
      action: 'pause-signage',
      enabled: true,
      resumeRequired: true,
      signage: { isRunning: false },
    });
    expect(resumed.json()).toMatchObject({
      action: 'resume-signage',
      enabled: true,
      resumeRequired: false,
      signage: { isRunning: true },
    });
    expect(scheduler.pauseForDeploy).toHaveBeenCalledOnce();
    expect(scheduler.resumeAfterDeploy).toHaveBeenCalledOnce();
  });

  it('serializes overlapping pause and resume requests', async () => {
    const { app, scheduler } = createApp();
    apps.push(app);
    const headers = { 'x-deploy-control-token': env.DEPLOY_CONTROL_TOKEN ?? env.JWT_ACCESS_SECRET };
    const pauseImplementation = scheduler.pauseForDeploy.getMockImplementation();
    let releasePause!: () => void;
    const pauseGate = new Promise<void>((resolve) => {
      releasePause = resolve;
    });
    scheduler.pauseForDeploy.mockImplementationOnce(async () => {
      await pauseGate;
      await pauseImplementation?.();
    });

    const pause = app.inject({
      method: 'POST', url: '/system/deploy-workload/internal', headers,
      payload: { action: 'pause-signage' },
    });
    await vi.waitFor(() => expect(scheduler.pauseForDeploy).toHaveBeenCalledOnce());
    const resume = app.inject({
      method: 'POST', url: '/system/deploy-workload/internal', headers,
      payload: { action: 'resume-signage' },
    });
    await Promise.resolve();
    expect(scheduler.resumeAfterDeploy).not.toHaveBeenCalled();

    releasePause();
    const [pauseResponse, resumeResponse] = await Promise.all([pause, resume]);
    expect(pauseResponse.statusCode).toBe(200);
    expect(resumeResponse.statusCode).toBe(200);
    expect(scheduler.resumeAfterDeploy).toHaveBeenCalledOnce();
  });

  it('reports that a disabled renderer does not require a resume', async () => {
    env.SIGNAGE_RENDER_ENABLED = false;
    const { app } = createApp();
    apps.push(app);
    const response = await app.inject({
      method: 'POST', url: '/system/deploy-workload/internal',
      headers: { 'x-deploy-control-token': env.DEPLOY_CONTROL_TOKEN ?? env.JWT_ACCESS_SECRET },
      payload: { action: 'pause-signage' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      action: 'pause-signage',
      enabled: false,
      resumeRequired: false,
      signage: { isRunning: false },
    });
  });

  it.each(['10.20.30.40', '172.18.0.2'])('rejects non-loopback caller %s', async (remoteAddress) => {
    const { app, scheduler } = createApp();
    apps.push(app);
    const response = await app.inject({
      method: 'POST', url: '/system/deploy-workload/internal',
      remoteAddress,
      headers: { 'x-deploy-control-token': env.DEPLOY_CONTROL_TOKEN ?? env.JWT_ACCESS_SECRET },
      payload: { action: 'pause-signage' },
    });
    expect(response.statusCode).toBe(403);
    expect(scheduler.pauseForDeploy).not.toHaveBeenCalled();
  });

  it('accepts IPv4-mapped loopback', async () => {
    const { app, scheduler } = createApp();
    apps.push(app);
    const response = await app.inject({
      method: 'POST', url: '/system/deploy-workload/internal',
      remoteAddress: '::ffff:127.0.0.1',
      headers: { 'x-deploy-control-token': env.DEPLOY_CONTROL_TOKEN ?? env.JWT_ACCESS_SECRET },
      payload: { action: 'pause-signage' },
    });
    expect(response.statusCode).toBe(200);
    expect(scheduler.pauseForDeploy).toHaveBeenCalledOnce();
  });

  it('rejects a scheduler standby without changing workload state', async () => {
    const { app, scheduler, schedulerRuntimeState } = createApp();
    apps.push(app);
    schedulerRuntimeState.setStandby({ databaseConnection: 'connected' });
    const response = await app.inject({
      method: 'POST', url: '/system/deploy-workload/internal',
      headers: { 'x-deploy-control-token': env.DEPLOY_CONTROL_TOKEN ?? env.JWT_ACCESS_SECRET },
      payload: { action: 'resume-signage' },
    });
    expect(response.statusCode).toBe(409);
    expect(scheduler.resumeAfterDeploy).not.toHaveBeenCalled();
    expect(scheduler.pauseForDeploy).not.toHaveBeenCalled();
  });

  it('does not acknowledge a failed async resume', async () => {
    const { app, scheduler } = createApp();
    apps.push(app);
    scheduler.resumeAfterDeploy.mockRejectedValueOnce(new Error('worker exited'));
    const response = await app.inject({
      method: 'POST', url: '/system/deploy-workload/internal',
      headers: { 'x-deploy-control-token': env.DEPLOY_CONTROL_TOKEN ?? env.JWT_ACCESS_SECRET },
      payload: { action: 'resume-signage' },
    });
    expect(response.statusCode).toBe(503);
    expect(scheduler.resumeAfterDeploy).toHaveBeenCalledOnce();
  });

  it('stops a resumed scheduler if leadership changes during startup', async () => {
    const { app, scheduler, schedulerRuntimeState } = createApp();
    apps.push(app);
    scheduler.resumeAfterDeploy.mockImplementationOnce(async () => {
      schedulerRuntimeState.setStandby({ databaseConnection: 'connected' });
    });
    const response = await app.inject({
      method: 'POST', url: '/system/deploy-workload/internal',
      headers: { 'x-deploy-control-token': env.DEPLOY_CONTROL_TOKEN ?? env.JWT_ACCESS_SECRET },
      payload: { action: 'resume-signage' },
    });
    expect(response.statusCode).toBe(409);
    expect(scheduler.pauseForDeploy).toHaveBeenCalledOnce();
  });

  it('rejects a pause if the scheduler demotes and reacquires leadership during the operation', async () => {
    const { app, scheduler, schedulerRuntimeState } = createApp();
    apps.push(app);
    scheduler.pauseForDeploy.mockImplementationOnce(async () => {
      schedulerRuntimeState.setStandby({ databaseConnection: 'disconnected' });
      schedulerRuntimeState.setLeader({ enabled: true, databaseConnection: 'connected' });
    });
    const response = await app.inject({
      method: 'POST', url: '/system/deploy-workload/internal',
      headers: { 'x-deploy-control-token': env.DEPLOY_CONTROL_TOKEN ?? env.JWT_ACCESS_SECRET },
      payload: { action: 'pause-signage' },
    });

    expect(response.statusCode).toBe(409);
    expect(scheduler.pauseForDeploy).toHaveBeenCalledOnce();
  });

  it('does not acknowledge pause while telemetry still reports active work', async () => {
    const { app, scheduler } = createApp();
    apps.push(app);
    scheduler.pauseForDeploy.mockImplementationOnce(async () => undefined);
    const response = await app.inject({
      method: 'POST', url: '/system/deploy-workload/internal',
      headers: { 'x-deploy-control-token': env.DEPLOY_CONTROL_TOKEN ?? env.JWT_ACCESS_SECRET },
      payload: { action: 'pause-signage' },
    });

    expect(response.statusCode).toBe(503);
    expect(scheduler.getTelemetrySnapshot).toHaveBeenCalledOnce();
  });

  it('does not acknowledge resume when telemetry remains stopped', async () => {
    const { app, scheduler } = createApp();
    apps.push(app);
    scheduler.getTelemetrySnapshot.mockReturnValueOnce({ isRunning: false, runner: 'test' });
    const response = await app.inject({
      method: 'POST', url: '/system/deploy-workload/internal',
      headers: { 'x-deploy-control-token': env.DEPLOY_CONTROL_TOKEN ?? env.JWT_ACCESS_SECRET },
      payload: { action: 'resume-signage' },
    });
    expect(response.statusCode).toBe(503);
    expect(scheduler.pauseForDeploy).toHaveBeenCalledOnce();
  });
});
