import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { User } from '@prisma/client';
import { assertClientDeviceOperationScope } from '../../../services/clients/client-device-resolution.service.js';
import { ApiError } from '../../../lib/errors.js';
import { signTestAccessToken as signAccessToken } from '../../../test/auth-session-fixture.js';
import { registerTorqueWrenchRoutes } from '../index.js';

const mocks = vi.hoisted(() => ({ confirm: vi.fn(), acquire: vi.fn(), takeover: vi.fn(), role: 'ADMIN' }));
vi.mock('../../../lib/prisma.js', () => ({ prisma: { authSession: { findUnique: vi.fn(async ({ where }) => ({ userId: where.id, expiresAt: new Date(Date.now() + 86400000), revokedAt: null, id: where.id, user: {
  id: 'user', username: 'operator', role: mocks.role, status: 'ACTIVE', mfaEnabled: true
} })) } } }));
vi.mock('../../../services/clients/client-device-auth.service.js', () => ({
  requireKioskClientDevice: vi.fn(async () => ({ clientDevice: { id: 'device', name: 'terminal', canProxyOtherDevices: false } }))
}));
vi.mock('../../../services/torque-wrenches/index.js', () => ({
  TorqueWrenchMasterService: class {},
  AssemblyTorqueTraceabilityService: class { confirm = mocks.confirm; },
  TorqueWrenchConnectionLeaseService: class { acquire = mocks.acquire; takeover = mocks.takeover; }
}));
const id = '00000000-0000-4000-8000-000000000001';
let app: ReturnType<typeof Fastify>;
let owner: string;
beforeEach(async () => {
  vi.clearAllMocks();
  mocks.role = 'ADMIN';
  for (const service of [mocks.confirm, mocks.acquire, mocks.takeover]) {
    service.mockImplementation(async ({ actorDevice }) => {
      assertClientDeviceOperationScope(actorDevice, owner);
      return { id, leaseId: id };
    });
  }
  owner = 'device';
  app = Fastify();
  app.setErrorHandler((error, _request, reply) => {
    const apiError = error as ApiError;
    void reply.code(apiError.statusCode ?? 500).send({ errorCode: apiError.code });
  });
  await registerTorqueWrenchRoutes(app);
});
afterEach(async () => { await app.close(); });
const routes = [
  { url: `/assembly/work-sessions/${id}/torque-wrench-confirmations`, service: mocks.confirm, status: 201,
    payload: { expectedTemplateBoltId: id, torqueWrenchProfileId: id, physicalDisplayConfirmed: true } },
  { url: `/torque-wrenches/${id}/connection-lease/acquire`, service: mocks.acquire, status: 200,
    payload: { sessionId: id, confirmationId: id, requestId: 'acquire' } },
  { url: `/torque-wrenches/${id}/connection-lease/takeover`, service: mocks.takeover, status: 200,
    payload: { sessionId: id, confirmationId: id, requestId: 'takeover', physicalWrenchPresent: true, reason: 'handoff' } }
];
describe.each(routes)('$url operation actor', ({ url, payload, status, service }) => {
  it('passes the authenticated terminal for a client-key operation', async () => {
    const response = await app.inject({ method: 'POST', url, headers: { 'x-client-key': 'key' }, payload });
    expect(response.statusCode).toBe(status);
    expect(service).toHaveBeenCalledWith(expect.objectContaining({ actorDevice: { id: 'device', name: 'terminal', canProxyOtherDevices: false } }));
  });
  it.each(['ADMIN', 'MANAGER'] as const)('passes null for a verified %s JWT actor', async (role) => {
    mocks.role = role;
    owner = 'other-device';
    const token = signAccessToken({ id: 'user', username: 'operator', role, mfaEnabled: true } as User);
    const response = await app.inject({ method: 'POST', url, headers: { 'x-client-key': 'key', authorization: `Bearer ${token}` }, payload });
    expect(response.statusCode).toBe(status);
    expect(service).toHaveBeenCalledWith(expect.objectContaining({ actorDevice: null }));
  });
  it.each(['invalid', 'VIEWER'] as const)('uses terminal scope for a %s JWT', async (kind) => {
    mocks.role = 'VIEWER';
    const token = kind === 'invalid' ? 'invalid-token' : signAccessToken({ id: 'user', username: 'operator', role: 'VIEWER', mfaEnabled: true } as User);
    const headers = { 'x-client-key': 'key', authorization: `Bearer ${token}` };
    const allowed = await app.inject({ method: 'POST', url, headers, payload });
    expect(allowed.statusCode).toBe(status);
    expect(service).toHaveBeenLastCalledWith(expect.objectContaining({ actorDevice: expect.objectContaining({ id: 'device' }) }));
    owner = 'other-device';
    const refused = await app.inject({ method: 'POST', url, headers, payload });
    expect(refused.statusCode).toBe(403);
    expect(refused.json().errorCode).toBe('CLIENT_DEVICE_SCOPE_MISMATCH');
  });
  it('preserves a JWT failure without a client key', async () => {
    const response = await app.inject({ method: 'POST', url, headers: { authorization: 'Bearer invalid-token' }, payload });
    expect(response.statusCode).toBe(401);
    expect(service).not.toHaveBeenCalled();
  });
});
