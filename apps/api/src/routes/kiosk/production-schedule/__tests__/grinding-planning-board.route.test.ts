import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ZodError } from 'zod';

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  updateOverrides: vi.fn(),
  updateRank: vi.fn(),
  updateOrder: vi.fn()
}));

vi.mock('../../../../services/production-schedule/grinding-planning-board.service.js', () => ({
  getGrindingPlanningBoard: mocks.get,
  updateGrindingPlanningBoardOverrides: mocks.updateOverrides,
  updateGrindingPlanningBoardRank: mocks.updateRank,
  updateGrindingPlanningBoardSeibanOrder: mocks.updateOrder
}));

import { createInMemoryLeaderboardShellSnapshotStore } from '../../../../services/production-schedule/leaderboard/leaderboard-shell-snapshot.store.js';
import { registerProductionScheduleGrindingPlanningBoardRoute } from '../grinding-planning-board.js';

function createApp(requireClientDevice: (rawClientKey: unknown) => Promise<unknown>) {
  const app = Fastify();
  app.setErrorHandler((error, _request, reply) => {
    const statusCode = error instanceof ZodError
      ? 400
      : typeof (error as { statusCode?: unknown }).statusCode === 'number'
      ? (error as { statusCode: number }).statusCode
      : 500;
    void reply.code(statusCode).send({ error: error.message });
  });
  const clientDevice = { id: 'device-1', apiKey: 'key-1', name: 'terminal-1', location: 'site-a', statusClientId: null };
  const scope = {
    deviceScopeKey: 'site-a - terminal-1',
    siteKey: 'site-a',
    deviceName: 'terminal-1',
    infraHost: 'terminal-1',
    credentialIdentity: { clientDeviceId: 'device-1', apiKey: 'key-1', statusClientId: null }
  };
  return registerProductionScheduleGrindingPlanningBoardRoute(app, {
    requireClientDevice: async (rawClientKey) => ({
      clientKey: String(rawClientKey ?? ''),
      clientDevice: await requireClientDevice(rawClientKey) as typeof clientDevice
    }),
    resolveLocationScopeContext: () => scope,
    resolveTargetLocation: ({ actorLocation }) => actorLocation,
    leaderboardShellSnapshotStore: createInMemoryLeaderboardShellSnapshotStore({ defaultTtlMs: 60_000 })
  }).then(() => app);
}

describe('grinding planning board route scope', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('rejects a missing client key before calling the board service', async () => {
    const requireClientDevice = vi.fn(async () => {
      const error = new Error('client key required') as Error & { statusCode?: number };
      error.statusCode = 401;
      throw error;
    });
    const app = await createApp(requireClientDevice);
    try {
      const response = await app.inject({ method: 'GET', url: '/kiosk/production-schedule/grinding-planning-board?category=grinding&view=seiban' });
      expect(response.statusCode).toBe(401);
      expect(mocks.get).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('uses the authenticated site even when the body supplies another site', async () => {
    const requireClientDevice = vi.fn(async () => ({ id: 'device-1', apiKey: 'key-1', name: 'terminal-1', location: 'site-a', statusClientId: null }));
    mocks.updateOrder.mockResolvedValue({ sourceRevision: 'next', seibanOrder: ['ORDER-1'] });
    const app = await createApp(requireClientDevice);
    try {
      const response = await app.inject({
        method: 'PUT',
        url: '/kiosk/production-schedule/grinding-planning-board/seiban-order',
        headers: { 'x-client-key': 'key-1' },
        payload: { sourceRevision: 'client-revision', fseibans: ['ORDER-1'], siteKey: 'foreign-site' }
      });
      expect(response.statusCode).toBe(200);
      expect(mocks.updateOrder).toHaveBeenCalledWith({ siteKey: 'site-a', sourceRevision: 'client-revision', fseibans: ['ORDER-1'] });
    } finally {
      await app.close();
    }
  });

  it('rejects a continuation cursor without its snapshot binding', async () => {
    const requireClientDevice = vi.fn(async () => ({ id: 'device-1', apiKey: 'key-1', name: 'terminal-1', location: 'site-a', statusClientId: null }));
    const app = await createApp(requireClientDevice);
    try {
      const response = await app.inject({
        method: 'GET',
        url: '/kiosk/production-schedule/grinding-planning-board?category=grinding&view=seiban&cursor=1'
      });
      expect(response.statusCode).toBe(400);
      expect(mocks.get).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });
});
