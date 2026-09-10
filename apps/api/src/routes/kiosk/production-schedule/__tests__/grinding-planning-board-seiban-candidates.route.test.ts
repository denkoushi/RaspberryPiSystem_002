import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ZodError } from 'zod';

const mocks = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock('../../../../services/production-schedule/grinding-planning-board-seiban-candidates.service.js', () => ({
  getGrindingPlanningBoardSeibanCandidates: mocks.get
}));

import { registerProductionScheduleGrindingPlanningBoardSeibanCandidatesRoute } from '../grinding-planning-board-seiban-candidates.js';
import { createInMemoryLeaderboardShellSnapshotStore } from '../../../../services/production-schedule/leaderboard/leaderboard-shell-snapshot.store.js';

async function createApp(requireClientDevice: (rawClientKey: unknown) => Promise<unknown>) {
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
  await registerProductionScheduleGrindingPlanningBoardSeibanCandidatesRoute(app, {
    requireClientDevice: async (rawClientKey) => ({
      clientKey: String(rawClientKey ?? ''),
      clientDevice: await requireClientDevice(rawClientKey) as typeof clientDevice
    }),
    resolveLocationScopeContext: () => ({
      deviceScopeKey: 'site-a - terminal-1',
      siteKey: 'site-a',
      deviceName: 'terminal-1',
      infraHost: 'terminal-1',
      credentialIdentity: { clientDeviceId: 'device-1', apiKey: 'key-1', statusClientId: null }
    }),
    resolveTargetLocation: ({ actorLocation }) => actorLocation,
    leaderboardShellSnapshotStore: createInMemoryLeaderboardShellSnapshotStore({ defaultTtlMs: 60_000 })
  });
  return app;
}

describe('grinding planning board seiban candidates route', () => {
  afterEach(() => vi.clearAllMocks());

  it('uses the authenticated site and defaults to incomplete candidates', async () => {
    mocks.get.mockResolvedValue({ today: '2026-09-11', rangeStart: '2026-08-11', rangeEnd: '2026-10-11', completionFilter: 'incomplete', candidates: [] });
    const app = await createApp(async () => ({ id: 'device-1', apiKey: 'key-1', name: 'terminal-1', location: 'site-a', statusClientId: null }));
    try {
      const response = await app.inject({ method: 'GET', url: '/kiosk/production-schedule/grinding-planning-board/seiban-candidates', headers: { 'x-client-key': 'key-1' } });
      expect(response.statusCode).toBe(200);
      expect(mocks.get).toHaveBeenCalledWith({ siteKey: 'site-a', category: 'grinding', completionFilter: 'incomplete' });
    } finally {
      await app.close();
    }
  });

  it('accepts the completed toggle', async () => {
    mocks.get.mockResolvedValue({ today: '2026-09-11', rangeStart: '2026-08-11', rangeEnd: '2026-10-11', completionFilter: 'all', candidates: [] });
    const app = await createApp(async () => ({ id: 'device-1', apiKey: 'key-1', name: 'terminal-1', location: 'site-a', statusClientId: null }));
    try {
      const response = await app.inject({ method: 'GET', url: '/kiosk/production-schedule/grinding-planning-board/seiban-candidates?category=cutting&completionFilter=all', headers: { 'x-client-key': 'key-1' } });
      expect(response.statusCode).toBe(200);
      expect(mocks.get).toHaveBeenCalledWith({ siteKey: 'site-a', category: 'cutting', completionFilter: 'all' });
    } finally {
      await app.close();
    }
  });
});
