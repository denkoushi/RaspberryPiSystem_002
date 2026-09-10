import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ZodError } from 'zod';

const mocks = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock('../../../../services/production-schedule/grinding-planning-board-seiban-candidates.service.js', () => ({
  getGrindingPlanningBoardSeibanCandidates: mocks.get
}));

import { registerProductionScheduleGrindingPlanningBoardSeibanCandidatesRoute } from '../grinding-planning-board-seiban-candidates.js';

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
  const scope = { siteKey: 'site-a' };
  return registerProductionScheduleGrindingPlanningBoardSeibanCandidatesRoute(app, {
    requireClientDevice: async (rawClientKey) => ({
      clientKey: String(rawClientKey ?? ''),
      clientDevice: await requireClientDevice(rawClientKey) as {
        id: string;
        apiKey: string;
        name: string;
        location: string;
        statusClientId: string | null;
      }
    }),
    resolveLocationScopeContext: () => scope,
    resolveTargetLocation: ({ actorLocation }) => actorLocation
  }).then(() => app);
}

describe('grinding planning board seiban candidates route', () => {
  afterEach(() => vi.clearAllMocks());

  it('uses the authenticated site and defaults to grinding incomplete candidates', async () => {
    const requireClientDevice = vi.fn(async () => ({
      id: 'device-1', apiKey: 'key-1', name: 'terminal-1', location: 'site-a', statusClientId: null
    }));
    mocks.get.mockResolvedValue({ today: '2026-09-11', rangeStart: '2026-08-11', rangeEnd: '2026-10-11', completionFilter: 'incomplete', candidates: [] });
    const app = await createApp(requireClientDevice);
    try {
      const response = await app.inject({
        method: 'GET',
        url: '/kiosk/production-schedule/grinding-planning-board/seiban-candidates',
        headers: { 'x-client-key': 'key-1' }
      });
      expect(response.statusCode).toBe(200);
      expect(mocks.get).toHaveBeenCalledWith({ siteKey: 'site-a', category: 'grinding', completionFilter: 'incomplete' });
    } finally {
      await app.close();
    }
  });

  it('accepts the cutting/all scope and rejects invalid filters before service access', async () => {
    const requireClientDevice = vi.fn(async () => ({
      id: 'device-1', apiKey: 'key-1', name: 'terminal-1', location: 'site-a', statusClientId: null
    }));
    mocks.get.mockResolvedValue({ today: '2026-09-11', rangeStart: '2026-08-11', rangeEnd: '2026-10-11', completionFilter: 'all', candidates: [] });
    const app = await createApp(requireClientDevice);
    try {
      const valid = await app.inject({
        method: 'GET',
        url: '/kiosk/production-schedule/grinding-planning-board/seiban-candidates?category=cutting&completionFilter=all',
        headers: { 'x-client-key': 'key-1' }
      });
      expect(valid.statusCode).toBe(200);
      expect(mocks.get).toHaveBeenCalledWith({ siteKey: 'site-a', category: 'cutting', completionFilter: 'all' });

      mocks.get.mockClear();
      const invalid = await app.inject({
        method: 'GET',
        url: '/kiosk/production-schedule/grinding-planning-board/seiban-candidates?completionFilter=complete',
        headers: { 'x-client-key': 'key-1' }
      });
      expect(invalid.statusCode).toBe(400);
      expect(mocks.get).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });
});
