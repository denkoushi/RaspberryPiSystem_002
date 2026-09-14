import Fastify from 'fastify';
import { expect, it, vi } from 'vitest';
import { startSchedulerRuntime } from '../scheduler-leader.js';
import { createSchedulerRuntimeState } from '../scheduler-runtime-state.js';
import { createDeployReadinessObservability } from '../../services/system/deploy-readiness-observability.js';
import { registerDeployReadinessRoute } from '../../routes/system/deploy-readiness.js';
vi.mock('../../services/system/db-health.service.js', () => ({ checkDatabaseConnection: async () => undefined }));
vi.mock('../start-post-listen-schedulers.js', () => ({ startPostListenSchedulers: vi.fn(), stopPostListenSchedulers: vi.fn() }));

it('stays unready until enabled scheduler initialization completes', async () => {
  const app = Fastify();
  app.decorate('schedulerRuntimeState', createSchedulerRuntimeState());
  app.decorate('deployReadinessObservability', createDeployReadinessObservability());
  registerDeployReadinessRoute(app);
  app.get('/system/health', async () => ({status:'ok'}));
  await app.ready();
  let finishStart!: () => void;
  let entered!: () => void;
  const enteredStart = new Promise<void>(resolve => { entered = resolve; });
  const startGate = new Promise<void>(resolve => { finishStart = resolve; });
  const starting = startSchedulerRuntime(app, {
    enabled: true,
    databaseUrl: 'postgresql://unused/diagnostic',
    clientFactory: () => ({
      connect: async () => undefined,
      query: async () => ({rows:[{acquired:true,released:true,held:true}]}),
      end: async () => undefined,
      on: () => undefined,
    }),
    startSchedulers: async () => { entered(); await startGate; return {}; },
    stopSchedulers: async () => undefined,
    probeIntervalMs: 100000,
  });
  await enteredStart;
  try {
    expect((await app.inject('/system/health')).statusCode).toBe(200);
    const early = await app.inject('/system/deploy-readiness/internal');
    expect(early.statusCode).toBe(503);
    expect(early.json()).toMatchObject({ready:false, database:'ready', scheduler:{enabled:true, role:'stopped', databaseConnection:'disconnected'}});
    finishStart();
    await starting;
    const later = await app.inject('/system/deploy-readiness/internal');
    expect(later.statusCode).toBe(200);
    expect(later.json()).toMatchObject({ready:true, scheduler:{enabled:true,role:'leader',databaseConnection:'connected'}});
  } finally {
    finishStart();
    await (await starting).stop();
    await app.close();
  }
});
