import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { ZodError } from 'zod';

const mocks = vi.hoisted(() => ({ workspace: vi.fn(), day: vi.fn() }));
vi.mock('../../../../services/production-schedule/load-balancing/load-balancing-workspace.service.js', () => ({
  getProductionScheduleLoadBalancingWorkspace: mocks.workspace,
  getProductionScheduleLoadBalancingWorkspaceDay: mocks.day
}));
vi.mock('../../../../services/production-schedule/load-balancing/load-balancing-settings.service.js', () => ({
  upsertLoadBalancingCapacityBaseItem: vi.fn()
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
      void reply.code(error instanceof ZodError ? 400 : 500).send({ error: error.message });
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
