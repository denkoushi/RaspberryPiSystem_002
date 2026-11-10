import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ZodError } from 'zod';

const device = vi.hoisted(() => ({ findMany: vi.fn(), update: vi.fn(), findUniqueOrThrow: vi.fn() }));
vi.mock('../../lib/prisma.js', () => ({ prisma: { clientDevice: device } }));
vi.mock('../../lib/auth.js', () => ({ authorizeRoles: () => async () => undefined }));
vi.mock('../../lib/logger.js', () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));
vi.mock('../../services/kiosk-inquiry/system-notice-sources.js', () => ({ deliverTelemetryNotice: vi.fn() }));
vi.mock('../../services/alerts/alerts-config.js', () => ({ loadAlertsDispatcherConfig: vi.fn(), resolveRouteKey: vi.fn() }));

import { getClientCapabilities } from '../../services/mobile-placement/client-capabilities.service.js';
import { registerClientCoreRoutes } from '../clients/core.js';

async function server() {
  const app = Fastify();
  app.setErrorHandler((error, _request, reply) => {
    reply.code(error instanceof ZodError ? 400 : 500).send({ message: error.message });
  });
  await registerClientCoreRoutes(app);
  return app;
}

describe('client planning board offline flag', () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([true, false])('lists and updates the flag to %s without exposing the key', async (value) => {
    const app = await server();
    try {
      device.findMany.mockResolvedValue([{ id: 'device-1', planningBoardOfflineEnabled: value }]);
      device.update.mockResolvedValue({ id: 'device-1', apiKey: 'private-key', planningBoardOfflineEnabled: value });
      const listed = await app.inject({ url: '/clients' });
      expect(listed.statusCode).toBe(200);
      expect(listed.json().clients[0].planningBoardOfflineEnabled).toBe(value);
      expect(device.findMany).toHaveBeenCalledWith(expect.objectContaining({ omit: { apiKey: true } }));
      const updated = await app.inject({ method: 'PUT', url: '/clients/device-1', payload: { planningBoardOfflineEnabled: value } });
      expect(updated.statusCode).toBe(200);
      expect(updated.json().client).toEqual({ id: 'device-1', planningBoardOfflineEnabled: value });
      expect(device.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ planningBoardOfflineEnabled: value }) }));
    } finally { await app.close(); }
  });

  it('preserves the stored flag when omitted and rejects null and non-booleans', async () => {
    const app = await server();
    try {
      device.update.mockResolvedValue({ id: 'device-1', planningBoardOfflineEnabled: true });
      expect((await app.inject({ method: 'PUT', url: '/clients/device-1', payload: {} })).json().client.planningBoardOfflineEnabled).toBe(true);
      expect(device.update.mock.calls.at(-1)?.[0].data).not.toHaveProperty('planningBoardOfflineEnabled');
      for (const value of [null, 'true', 1]) {
        expect((await app.inject({ method: 'PUT', url: '/clients/device-1', payload: { planningBoardOfflineEnabled: value } })).statusCode).toBe(400);
      }
      expect(device.update).toHaveBeenCalledTimes(1);
    } finally { await app.close(); }
  });

  it.each([true, false, undefined])('returns an explicit capability for %s', async (value) => {
    device.findUniqueOrThrow.mockResolvedValue({ planningBoardOfflineEnabled: value });
    expect((await getClientCapabilities('device-1')).planningBoardOfflineEnabled).toBe(value === true);
    expect(device.findUniqueOrThrow).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'device-1' }, select: expect.objectContaining({ planningBoardOfflineEnabled: true }) }));
  });
});
