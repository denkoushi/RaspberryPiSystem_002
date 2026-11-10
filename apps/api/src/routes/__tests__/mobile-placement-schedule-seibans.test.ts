import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ list: vi.fn(), detail: vi.fn() }));
vi.mock('../../services/mobile-placement/schedule-seiban-status.service.js', () => ({ listScheduleSeibans: mocks.list, getScheduleSeiban: mocks.detail }));
import { registerMobilePlacementScheduleSeibansRoutes } from '../mobile-placement/schedule-seibans.js';

afterEach(() => vi.resetAllMocks());
describe('mobile schedule seibans routes', () => {
  it('returns the authenticated list and detail without caching', async () => {
    const app = Fastify();
    const auth = vi.fn().mockResolvedValue({});
    await registerMobilePlacementScheduleSeibansRoutes(app, { requireClientDevice: auth });
    mocks.list.mockResolvedValue({ seibans: [{ fseiban: 'BA1' }], truncated: false });
    mocks.detail.mockResolvedValue({ fseiban: 'BA1', parts: [] });
    try {
      const list = await app.inject({ url: '/mobile-placement/schedule-seibans', headers: { 'x-client-key': 'key' } });
      expect(list.statusCode).toBe(200); expect(list.json()).toEqual({ seibans: [{ fseiban: 'BA1' }], truncated: false });
      expect(list.headers['cache-control']).toBe('no-store');
      const detail = await app.inject({ url: '/mobile-placement/schedule-seibans/BA1', headers: { 'x-client-key': 'key' } });
      expect(detail.statusCode).toBe(200); expect(detail.json()).toEqual({ fseiban: 'BA1', parts: [] });
      expect(mocks.detail).toHaveBeenCalledWith('BA1'); expect(auth).toHaveBeenCalledWith('key');
    } finally { await app.close(); }
  });
  it('returns 404 for a seiban absent from Excel', async () => {
    const app = Fastify();
    await registerMobilePlacementScheduleSeibansRoutes(app, { requireClientDevice: vi.fn().mockResolvedValue({}) });
    mocks.detail.mockResolvedValue(null);
    try { expect((await app.inject({ url: '/mobile-placement/schedule-seibans/unknown' })).statusCode).toBe(404); }
    finally { await app.close(); }
  });
  it('does not read either endpoint when device authentication fails', async () => {
    const app = Fastify();
    await registerMobilePlacementScheduleSeibansRoutes(app, { requireClientDevice: vi.fn().mockRejectedValue(Object.assign(new Error('Unauthorized'), { statusCode: 401 })) });
    try {
      for (const url of ['/mobile-placement/schedule-seibans', '/mobile-placement/schedule-seibans/BA1']) expect((await app.inject({ url })).statusCode).toBe(401);
      expect(mocks.list).not.toHaveBeenCalled(); expect(mocks.detail).not.toHaveBeenCalled();
    } finally { await app.close(); }
  });
});
