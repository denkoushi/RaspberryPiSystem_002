import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { ZodError } from 'zod';

const mocks = vi.hoisted(() => ({ workspace: vi.fn(), day: vi.fn(), getOutsource: vi.fn(), saveOutsource: vi.fn() }));
vi.mock('../../../../services/production-schedule/load-balancing/load-balancing-workspace.service.js', () => ({
  getProductionScheduleLoadBalancingWorkspace: mocks.workspace,
  getProductionScheduleLoadBalancingWorkspaceDay: mocks.day
}));
vi.mock('../../../../services/production-schedule/load-balancing/load-balancing-settings.service.js', () => ({
  upsertLoadBalancingCapacityBaseItem: vi.fn()
}));
vi.mock('../../../../services/production-schedule/load-balancing/load-balancing-outsource-settings.service.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../../../services/production-schedule/load-balancing/load-balancing-outsource-settings.service.js')>(),
  getLoadBalancingOutsourceSettings: mocks.getOutsource,
  saveLoadBalancingOutsourceSettings: mocks.saveOutsource
}));
vi.mock('../resolve-assignment-location-key.js', () => ({
  resolveProductionScheduleAssignmentLocationKey: vi.fn().mockResolvedValue('site-a')
}));

import { registerProductionScheduleLoadBalancingRoutes } from '../load-balancing.js';
import type { KioskRouteDeps } from '../shared.js';

describe('load-balancing due source routes', () => {
  const endpoints = [
    ['workspace?fromMonth=2026-10&toMonth=2026-11', mocks.workspace],
    ['workspace/day?month=2026-10&resourceCd=033', mocks.day]
  ] as const;

  it.each(endpoints)('validates and forwards dueSource for %s', async (path, service) => {
    const app = Fastify();
    app.setErrorHandler((error, _request, reply) => {
      void reply.code(error instanceof ZodError ? 400 : 500).send({ error: error instanceof Error ? error.message : String(error) });
    });
    await registerProductionScheduleLoadBalancingRoutes(app, {
      requireClientDevice: async () => ({ clientDevice: {} }),
      resolveLocationScopeContext: () => ({ deviceScopeKey: 'site-a - terminal-1', canProxyOtherDevices: false })
    } as unknown as KioskRouteDeps);
    service.mockResolvedValue({ siteKey: 'site-a' });
    try {
      for (const [suffix, dueSource] of [['', 'excel'], ['&dueSource=excel', 'excel'], ['&dueSource=scaw', 'scaw']]) {
        service.mockClear();
        const response = await app.inject({ method: 'GET', url: '/kiosk/production-schedule/load-balancing/' + path + suffix });
        expect(response.statusCode).toBe(200);
        expect(response.headers['content-type']).toContain('application/json');
        expect(response.json()).toEqual({ siteKey: 'site-a' });
        expect(service).toHaveBeenCalledWith(expect.objectContaining({ dueSource }));
      }
      service.mockClear();
      const invalid = await app.inject({ method: 'GET', url: '/kiosk/production-schedule/load-balancing/' + path + '&dueSource=other' });
      expect(invalid.statusCode).toBe(400);
      expect(service).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });
});

describe('kiosk outsource settings routes', () => {
  const value = { mode: 'process', order: ['due', 'minutes', 'vendor'], vendors: [{ id: 'v1', name: '業者', priority: 1, monthlyCapacityMinutes: null, conditions: [] }] };
  async function appForSettings() {
    const app = Fastify();
    app.setErrorHandler((error, _request, reply) => { void reply.code(error instanceof ZodError ? 400 : (error as { statusCode?: number }).statusCode ?? 500).send({ error: error instanceof Error ? error.message : String(error) }); });
    const requireClientDevice = vi.fn(async (key) => {
      if (key !== 'registered-key') throw Object.assign(new Error('unauthorized'), { statusCode: 401 });
      return { clientDevice: {} };
    });
    await registerProductionScheduleLoadBalancingRoutes(app, {
      requireClientDevice,
      resolveLocationScopeContext: () => ({ deviceScopeKey: 'site-a - terminal-1', canProxyOtherDevices: false })
    } as unknown as KioskRouteDeps);
    mocks.getOutsource.mockReset().mockResolvedValue(value);
    mocks.saveOutsource.mockReset().mockResolvedValue(value);
    return { app, requireClientDevice };
  }
  it('reads and saves through the registered-client site scope', async () => {
    const { app, requireClientDevice } = await appForSettings();
    try {
      const get = await app.inject({ method: 'GET', url: '/kiosk/production-schedule/load-balancing/outsource-settings', headers: { 'x-client-key': 'registered-key' } });
      expect(get.statusCode).toBe(200); expect(get.json()).toEqual(value);
      expect(mocks.getOutsource).toHaveBeenCalledWith('site-a');
      const put = await app.inject({ method: 'PUT', url: '/kiosk/production-schedule/load-balancing/outsource-settings', headers: { 'x-client-key': 'registered-key' }, payload: value });
      expect(put.statusCode).toBe(200);
      expect(mocks.saveOutsource).toHaveBeenCalledWith('site-a', value);
      expect(requireClientDevice).toHaveBeenCalledWith('registered-key');
    } finally { await app.close(); }
  });
  it.each(['GET', 'PUT'] as const)('requires x-client-key for %s', async (method) => {
    const { app } = await appForSettings();
    try {
      expect((await app.inject({ method, url: '/kiosk/production-schedule/load-balancing/outsource-settings', ...(method === 'PUT' ? { payload: value } : {}) })).statusCode).toBe(401);
      expect(mocks.getOutsource).not.toHaveBeenCalled(); expect(mocks.saveOutsource).not.toHaveBeenCalled();
    } finally { await app.close(); }
  });
  it.each([{ name: ' ' }, { monthlyCapacityMinutes: -1 }, { conditions: [{ resourceCds: [], partPrefix: '', partName: '', maxMinutes: -1 }] }])('rejects invalid vendor %j', async (change) => {
    const { app } = await appForSettings();
    try {
      const result = await app.inject({ method: 'PUT', url: '/kiosk/production-schedule/load-balancing/outsource-settings', headers: { 'x-client-key': 'registered-key' }, payload: { ...value, vendors: [{ ...value.vendors[0], ...change }] } });
      expect(result.statusCode).toBe(400); expect(mocks.saveOutsource).not.toHaveBeenCalled();
    } finally { await app.close(); }
  });
});
