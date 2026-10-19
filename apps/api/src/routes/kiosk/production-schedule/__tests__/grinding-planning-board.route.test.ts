import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ZodError } from 'zod';

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  getLoad: vi.fn(),
  rewarm: vi.fn(),
  getDueScope: vi.fn(),
  updateDueScope: vi.fn(),
  getCapacity: vi.fn(),
  updateCapacity: vi.fn(),
  updateOverrides: vi.fn(),
  updatePins: vi.fn(),
  updateRank: vi.fn(),
  updateResourceOrder: vi.fn(),
  updateResourceOrderBulk: vi.fn(),
  updateOrder: vi.fn()
}));

vi.mock('../../../../services/production-schedule/grinding-planning-board.service.js', () => ({
  getGrindingPlanningBoard: mocks.get,
  getGrindingPlanningBoardLoad: mocks.getLoad,
  scheduleGrindingPlanningBoardRewarm: mocks.rewarm,
  updateGrindingPlanningBoardOverrides: mocks.updateOverrides,
  updateGrindingPlanningBoardPins: mocks.updatePins,
  updateGrindingPlanningBoardRank: mocks.updateRank,
  updateGrindingPlanningBoardResourceOrder: mocks.updateResourceOrder,
  updateGrindingPlanningBoardResourceOrderBulk: mocks.updateResourceOrderBulk,
  updateGrindingPlanningBoardSeibanOrder: mocks.updateOrder
}));

vi.mock('../../../../services/production-schedule/grinding-planning-board-due-scope.service.js', () => ({
  getGrindingPlanningBoardDueScope: mocks.getDueScope,
  updateGrindingPlanningBoardDueScope: mocks.updateDueScope
}));

vi.mock('../../../../services/production-schedule/grinding-planning-board-resource-capacity.service.js', () => ({
  getGrindingPlanningBoardResourceCapacity: mocks.getCapacity,
  updateGrindingPlanningBoardResourceCapacity: mocks.updateCapacity
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

  const item = { itemId: 'item-1', itemRevision: 'revision-1' };
  const writes = [
    { path: 'overrides', write: mocks.updateOverrides, payload: { sourceRevision: 'revision', items: [item] } },
    { path: 'pins', write: mocks.updatePins, payload: { sourceRevision: 'revision', items: [item], pinned: true } },
    { path: 'rank', write: mocks.updateRank, payload: { sourceRevision: 'revision', ...item, alternateRank: 1 } },
    { path: 'resource-order', write: mocks.updateResourceOrder, payload: { sourceRevision: 'revision', ...item, targetItemId: 'item-2', targetItemRevision: 'revision-2', placement: 'before' } },
    { path: 'resource-order/bulk', write: mocks.updateResourceOrderBulk, payload: { sourceRevision: 'revision', resourceCd: '305', items: [item] } },
    { path: 'seiban-order', write: mocks.updateOrder, payload: { sourceRevision: 'revision', fseibans: ['ORDER-A'] } },
    { path: 'seiban/ORDER-A/due-scope', write: mocks.updateDueScope, payload: { sourceGenerationToken: 'generation', scopeRevision: 'a'.repeat(64), scope: { kind: 'seiban' }, dueDate: '2026-10-20' } }
  ];

  it.each(writes)('schedules rewarm after a successful $path write and preserves the response', async ({ path, write, payload }) => {
    const app = await createApp(async () => ({ id: 'device-1' }));
    const result = { updated: true };
    write.mockImplementationOnce(async () => {
      expect(mocks.rewarm).not.toHaveBeenCalled();
      return result;
    });
    // An unfinished background run must not delay the write response.
    mocks.rewarm.mockReturnValueOnce(new Promise<void>(() => {}));
    try {
      const response = await app.inject({ method: 'PUT', url: `/kiosk/production-schedule/grinding-planning-board/${path}`, payload });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual(result);
      expect(mocks.rewarm).toHaveBeenCalledTimes(1);
      expect(mocks.rewarm).toHaveBeenCalledWith({ siteKey: 'site-a', snapshotStore: expect.objectContaining({ create: expect.any(Function) }) });
    } finally { await app.close(); }
  });

  it.each(writes)('does not schedule rewarm after a failed $path write', async ({ path, write, payload }) => {
    const app = await createApp(async () => ({ id: 'device-1' }));
    write.mockRejectedValueOnce(Object.assign(new Error('stale write'), { statusCode: 409 }));
    try {
      const response = await app.inject({ method: 'PUT', url: `/kiosk/production-schedule/grinding-planning-board/${path}`, payload });
      expect(response.statusCode).toBe(409);
      expect(mocks.rewarm).not.toHaveBeenCalled();
    } finally { await app.close(); }
  });

  it.each(['', '/load'])('accepts category=all for %s', async (suffix) => {
    const app = await createApp(async () => ({ id: 'device-1' }));
    mocks.get.mockResolvedValue({ items: [] });
    mocks.getLoad.mockResolvedValue({ load: [] });
    try {
      const response = await app.inject({ method: 'GET', url: `/kiosk/production-schedule/grinding-planning-board${suffix}?category=all` });
      expect(response.statusCode).toBe(200);
      expect(suffix ? mocks.getLoad : mocks.get).toHaveBeenCalledWith(expect.objectContaining({ category: 'all', siteKey: 'site-a' }));
    } finally { await app.close(); }
  });

  it.each([[640, 200], [641, 400]])('validates pageSize=%s at the 640 cap', async (pageSize, status) => {
    const app = await createApp(async () => ({ id: 'device-1' }));
    mocks.get.mockResolvedValue({ items: [] });
    try {
      const response = await app.inject({ method: 'GET', url: `/kiosk/production-schedule/grinding-planning-board?pageSize=${pageSize}` });
      expect(response.statusCode).toBe(status);
      if (status === 200) expect(mocks.get).toHaveBeenCalledWith(expect.objectContaining({ pageSize }));
      else expect(mocks.get).not.toHaveBeenCalled();
    } finally { await app.close(); }
  });

  it.each(['true', 'false'])('parses includeLoad=%s without boolean coercion', async (includeLoad) => {
    const app = await createApp(async () => ({ id: 'device-1' }));
    mocks.get.mockResolvedValue({ load: [], unknownRequiredMinutesCount: 0 });
    try {
      const response = await app.inject({ method: 'GET', url: `/kiosk/production-schedule/grinding-planning-board?includeLoad=${includeLoad}` });
      expect(response.statusCode).toBe(200);
      expect(mocks.get).toHaveBeenCalledWith(expect.objectContaining({ siteKey: 'site-a', includeLoad: includeLoad === 'true' }));
    } finally { await app.close(); }
  });

  it('includes load by default for legacy requests', async () => {
    const app = await createApp(async () => ({ id: 'device-1' }));
    try {
      await app.inject({ method: 'GET', url: '/kiosk/production-schedule/grinding-planning-board' });
      expect(mocks.get).toHaveBeenCalledWith(expect.objectContaining({ includeLoad: true }));
    } finally { await app.close(); }
  });

  it('uses the authenticated site for load and validates its category', async () => {
    const requireClientDevice = vi.fn(async () => ({ id: 'device-1' }));
    const summary = { load: [], unknownRequiredMinutesCount: 2 };
    mocks.getLoad.mockResolvedValue(summary);
    const app = await createApp(requireClientDevice);
    try {
      const response = await app.inject({ method: 'GET', url: '/kiosk/production-schedule/grinding-planning-board/load?category=cutting&siteKey=foreign-site', headers: { 'x-client-key': 'key-1' } });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual(summary);
      expect(requireClientDevice).toHaveBeenCalledWith('key-1');
      expect(mocks.getLoad).toHaveBeenCalledWith({ siteKey: 'site-a', category: 'cutting' });
      const invalid = await app.inject({ method: 'GET', url: '/kiosk/production-schedule/grinding-planning-board/load?category=invalid' });
      expect(invalid.statusCode).toBe(400);
      expect(mocks.getLoad).toHaveBeenCalledTimes(1);
    } finally { await app.close(); }
  });

  it('authenticates load before accessing its service', async () => {
    const app = await createApp(async () => { throw Object.assign(new Error('client key required'), { statusCode: 401 }); });
    try {
      const response = await app.inject({ method: 'GET', url: '/kiosk/production-schedule/grinding-planning-board/load' });
      expect(response.statusCode).toBe(401);
      expect(mocks.getLoad).not.toHaveBeenCalled();
    } finally { await app.close(); }
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

  it('passes the scoped same-resource order request to the service', async () => {
    const requireClientDevice = vi.fn(async () => ({ id: 'device-1', apiKey: 'key-1', name: 'terminal-1', location: 'site-a', statusClientId: null }));
    mocks.updateResourceOrder.mockResolvedValue({ sourceRevision: 'next', items: [] });
    const app = await createApp(requireClientDevice);
    try {
      const response = await app.inject({
        method: 'PUT',
        url: '/kiosk/production-schedule/grinding-planning-board/resource-order',
        headers: { 'x-client-key': 'key-1' },
        payload: {
          sourceRevision: 'board-revision',
          itemId: 'source-item',
          itemRevision: 'source-revision',
          overrideVersion: 2,
          targetItemId: 'target-item',
          targetItemRevision: 'target-revision',
          targetOverrideVersion: 3,
          placement: 'before',
          siteKey: 'foreign-site'
        }
      });
      expect(response.statusCode).toBe(200);
      expect(mocks.updateResourceOrder).toHaveBeenCalledWith({
        siteKey: 'site-a',
        sourceRevision: 'board-revision',
        itemId: 'source-item',
        itemRevision: 'source-revision',
        overrideVersion: 2,
        targetItemId: 'target-item',
        targetItemRevision: 'target-revision',
        targetOverrideVersion: 3,
        placement: 'before'
      });
    } finally {
      await app.close();
    }
  });
  it('returns resource capacity for the authenticated site', async () => {
    const requireClientDevice = vi.fn(async () => ({ id: 'device-1' }));
    const app = await createApp(requireClientDevice);
    const result = { dailyHoursByResource: { '305': 10, '306': 24 }, runsThroughBreaksResources: ['305'] };
    mocks.getCapacity.mockResolvedValue(result);
    try {
      const response = await app.inject({ method: 'GET', url: '/kiosk/production-schedule/grinding-planning-board/resource-capacity?siteKey=foreign-site', headers: { 'x-client-key': 'key-1' } });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual(result);
      expect(requireClientDevice).toHaveBeenCalledWith('key-1');
      expect(mocks.getCapacity).toHaveBeenCalledWith({ siteKey: 'site-a' });
    } finally { await app.close(); }
  });

  it.each([8, 10, 24])('accepts %s daily hours and trims resource code using the authenticated site', async (dailyHours) => {
    const requireClientDevice = vi.fn(async () => ({ id: 'device-1' }));
    const app = await createApp(requireClientDevice);
    const result = { dailyHoursByResource: dailyHours === 8 ? {} : { '305': dailyHours } };
    mocks.updateCapacity.mockResolvedValue(result);
    try {
      const response = await app.inject({
        method: 'PUT', url: '/kiosk/production-schedule/grinding-planning-board/resource-capacity',
        headers: { 'x-client-key': 'key-1' }, payload: { resourceCd: ' 305 ', dailyHours, siteKey: 'foreign-site' }
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual(result);
      expect(requireClientDevice).toHaveBeenCalledWith('key-1');
      expect(mocks.updateCapacity).toHaveBeenCalledWith({ siteKey: 'site-a', resourceCd: '305', dailyHours });
      expect(mocks.rewarm).not.toHaveBeenCalled();
    } finally { await app.close(); }
  });

  it.each([{ runsThroughBreaks: true }, { runsThroughBreaks: false }, { dailyHours: 8, runsThroughBreaks: true }])('accepts a capacity patch %j', async (patch) => {
    const app = await createApp(async () => ({ id: 'device-1' }));
    mocks.updateCapacity.mockResolvedValue({ dailyHoursByResource: {}, runsThroughBreaksResources: ['305'] });
    try {
      const response = await app.inject({ method: 'PUT', url: '/kiosk/production-schedule/grinding-planning-board/resource-capacity',
        headers: { 'x-client-key': 'key-1' }, payload: { resourceCd: '305', ...patch } });
      expect(response.statusCode).toBe(200);
      expect(mocks.updateCapacity).toHaveBeenCalledWith({ siteKey: 'site-a', resourceCd: '305', ...patch });
    } finally { await app.close(); }
  });

  it.each([
    { resourceCd: '305' },
    { resourceCd: '305', runsThroughBreaks: 'true' },
    { resourceCd: '305', dailyHours: 12 },
    { resourceCd: '305', dailyHours: '10' },
    { resourceCd: ' ', dailyHours: 10 },
    { resourceCd: 'x'.repeat(21), dailyHours: 10 }
  ])('rejects invalid resource capacity body %j', async (payload) => {
    const app = await createApp(async () => ({ id: 'device-1' }));
    try {
      const response = await app.inject({ method: 'PUT', url: '/kiosk/production-schedule/grinding-planning-board/resource-capacity', payload });
      expect(response.statusCode).toBe(400);
      expect(mocks.updateCapacity).not.toHaveBeenCalled();
    } finally { await app.close(); }
  });

  it.each(['GET', 'PUT'] as const)('rejects missing client key for resource capacity %s', async (method) => {
    const app = await createApp(async () => { throw Object.assign(new Error('client key required'), { statusCode: 401 }); });
    try {
      const response = await app.inject({
        method, url: '/kiosk/production-schedule/grinding-planning-board/resource-capacity',
        ...(method === 'PUT' ? { payload: { resourceCd: '305', dailyHours: 10 } } : {})
      });
      expect(response.statusCode).toBe(401);
      expect(mocks.getCapacity).not.toHaveBeenCalled();
      expect(mocks.updateCapacity).not.toHaveBeenCalled();
    } finally { await app.close(); }
  });

});


describe('bulk resource order route', () => {
  const payload = { sourceRevision: 'board-1', resourceCd: '305', items: [{ itemId: 'a', itemRevision: 'r1', overrideVersion: 2 }] };
  it('uses authenticated scope and returns the ordered revisions', async () => {
    const app = await createApp(async () => ({ id: 'device-1' }));
    const result = { sourceRevision: 'board-1', items: [{ itemId: 'a', itemRevision: 'r2', version: 3, alternateRank: 1 }] };
    mocks.updateResourceOrderBulk.mockResolvedValue(result);
    try {
      const response = await app.inject({ method: 'PUT', url: '/kiosk/production-schedule/grinding-planning-board/resource-order/bulk', payload: { ...payload, siteKey: 'foreign' } });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual(result);
      expect(mocks.updateResourceOrderBulk).toHaveBeenCalledWith({ ...payload, siteKey: 'site-a' });
    } finally { await app.close(); }
  });
  it.each([0, 501, 2])('rejects invalid size or duplicate IDs: %i', async (count) => {
    const app = await createApp(async () => ({ id: 'device-1' }));
    try {
      const response = await app.inject({ method: 'PUT', url: '/kiosk/production-schedule/grinding-planning-board/resource-order/bulk', payload: { ...payload, items: Array.from({ length: count }, () => payload.items[0]) } });
      expect(response.statusCode).toBe(400);
    } finally { await app.close(); }
  });
  it.each(['STALE_PLANNING_BOARD_ITEM', 'RESOURCE_ORDER_PANE_MISMATCH'])('propagates concurrency/resource conflict %s', async (code) => {
    mocks.updateResourceOrderBulk.mockRejectedValueOnce(Object.assign(new Error(code), { statusCode: 409 }));
    const app = await createApp(async () => ({ id: 'device-1' }));
    try {
      const response = await app.inject({ method: 'PUT', url: '/kiosk/production-schedule/grinding-planning-board/resource-order/bulk', payload });
      expect(response.statusCode).toBe(409);
    } finally { await app.close(); }
  });
});


describe('grinding planning board pins route', () => {
  const payload = { sourceRevision: 'board', items: [{ itemId: 'row:a', itemRevision: 'revision', overrideVersion: 2 }], pinned: true };
  afterEach(() => vi.clearAllMocks());
  it('uses authenticated site and passes versions and pinned state', async () => {
    const auth = vi.fn(async () => ({ id: 'device-1' }));
    const app = await createApp(auth);
    const result = { sourceRevision: 'board', items: [{ itemId: 'row:a', orderPinned: true, version: 3 }] };
    mocks.updatePins.mockResolvedValue(result);
    try {
      const response = await app.inject({ method: 'PUT', url: '/kiosk/production-schedule/grinding-planning-board/pins', headers: { 'x-client-key': 'device-key' }, payload: { ...payload, siteKey: 'other-site' } });
      expect(response.statusCode).toBe(200); expect(response.json()).toEqual(result);
      expect(auth).toHaveBeenCalledWith('device-key');
      expect(mocks.updatePins).toHaveBeenCalledWith({ ...payload, siteKey: 'site-a' });
    } finally { await app.close(); }
  });
  it.each([{ pinned: 'true' }, { items: [] }, { items: [{ itemId: 'a' }] }])('validates pin requests: %j', async (invalid) => {
    const app = await createApp(async () => ({ id: 'device-1' }));
    try {
      const response = await app.inject({ method: 'PUT', url: '/kiosk/production-schedule/grinding-planning-board/pins', payload: { ...payload, ...invalid } });
      expect(response.statusCode).toBe(400); expect(mocks.updatePins).not.toHaveBeenCalled();
    } finally { await app.close(); }
  });
  it.each([401, 409])('preserves authentication/conflict status %i', async (statusCode) => {
    const error = Object.assign(new Error('rejected'), { statusCode });
    const app = await createApp(async () => { if (statusCode === 401) throw error; return { id: 'device-1' }; });
    mocks.updatePins.mockRejectedValue(error);
    try {
      const response = await app.inject({ method: 'PUT', url: '/kiosk/production-schedule/grinding-planning-board/pins', payload });
      expect(response.statusCode).toBe(statusCode);
      if (statusCode === 401) expect(mocks.updatePins).not.toHaveBeenCalled();
    } finally { await app.close(); }
  });
});
