import Fastify from 'fastify';
import jwt from 'jsonwebtoken';
import { describe, expect, it, vi } from 'vitest';

import { env } from '../../../config/env.js';
import { ApiError } from '../../../lib/errors.js';
import { registerBusinessHermesRoutes } from '../business-hermes.js';

function createApp() {
  const guide = vi.fn().mockResolvedValue({
    status: 'ready',
    uiRevision: 'r1',
    message: '案内',
    targetKey: 'current-bolt',
    evidence: []
  });
  const listProactiveSuggestions = vi.fn().mockResolvedValue([]);
  const requireClientDevice = vi.fn(async (raw: unknown) => {
    if (raw === 'device-a') return { clientKey: 'device-a', clientDevice: { id: 'device-a', apiKey: 'device-a', name: 'A', location: null, statusClientId: null } };
    throw new ApiError(401, 'client key required', undefined, 'CLIENT_KEY_INVALID');
  });
  const app = Fastify();
  app.setErrorHandler((error, _request, reply) => {
    const statusCode = error instanceof ApiError ? error.statusCode : 500;
    void reply.status(statusCode).send({ code: error instanceof ApiError ? error.code : 'INTERNAL_ERROR' });
  });
  return {
    app,
    guide,
    listProactiveSuggestions,
    requireClientDevice,
    service: { guide, listProactiveSuggestions } as never
  };
}

describe('business Hermes routes', () => {
  it('requires a client key and passes server-resolved device identity', async () => {
    const fixture = createApp();
    await registerBusinessHermesRoutes(fixture.app, { requireClientDevice: fixture.requireClientDevice, service: fixture.service });

    const noKey = await fixture.app.inject({ method: 'POST', url: '/assembly/work-sessions/00000000-0000-0000-0000-000000000001/hermes-guide', payload: { uiRevision: 'r1', eventCode: 'USER_REQUEST' } });
    expect(noKey.statusCode).toBe(401);

    const ok = await fixture.app.inject({
      method: 'POST',
      url: '/assembly/work-sessions/00000000-0000-0000-0000-000000000001/hermes-guide',
      headers: { 'x-client-key': 'device-a' },
      payload: { uiRevision: 'r1', eventCode: 'USER_REQUEST' }
    });
    expect(ok.statusCode).toBe(200);
    expect(fixture.guide).toHaveBeenCalledWith(expect.objectContaining({ clientDeviceId: 'device-a' }));
  });

  it('allows proactive suggestions to ADMIN only', async () => {
    const fixture = createApp();
    await registerBusinessHermesRoutes(fixture.app, { requireClientDevice: fixture.requireClientDevice, service: fixture.service });
    const managerToken = jwt.sign({ sub: 'manager', username: 'manager', role: 'MANAGER' }, env.JWT_ACCESS_SECRET);
    const adminToken = jwt.sign({ sub: 'admin', username: 'admin', role: 'ADMIN' }, env.JWT_ACCESS_SECRET);

    const unauthenticated = await fixture.app.inject({ method: 'GET', url: '/assembly/business-hermes/proactive-suggestions' });
    expect(unauthenticated.statusCode).toBe(401);
    const manager = await fixture.app.inject({ method: 'GET', url: '/assembly/business-hermes/proactive-suggestions', headers: { authorization: `Bearer ${managerToken}` } });
    expect(manager.statusCode).toBe(403);
    const admin = await fixture.app.inject({ method: 'GET', url: '/assembly/business-hermes/proactive-suggestions', headers: { authorization: `Bearer ${adminToken}` } });
    expect(admin.statusCode).toBe(200);
  });
});
