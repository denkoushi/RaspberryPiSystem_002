import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { User } from '@prisma/client';
import { signAccessToken } from '../../../lib/auth.js';
import { registerTorqueWrenchRoutes } from '../index.js';

const mocks = vi.hoisted(() => ({ confirm: vi.fn(), acquire: vi.fn(), takeover: vi.fn(), role: 'ADMIN' }));
vi.mock('../../../lib/prisma.js', () => ({ prisma: { user: { findUnique: vi.fn(async () => ({
  id: 'user', username: 'operator', role: mocks.role, status: 'ACTIVE', mfaEnabled: true
})) } } }));
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
beforeEach(async () => {
  vi.clearAllMocks();
  mocks.confirm.mockResolvedValue({ id });
  mocks.acquire.mockResolvedValue({ leaseId: id });
  mocks.takeover.mockResolvedValue({ leaseId: id });
  app = Fastify();
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
    const token = signAccessToken({ id: 'user', username: 'operator', role, mfaEnabled: true } as User);
    const response = await app.inject({ method: 'POST', url, headers: { 'x-client-key': 'key', authorization: `Bearer ${token}` }, payload });
    expect(response.statusCode).toBe(status);
    expect(service).toHaveBeenCalledWith(expect.objectContaining({ actorDevice: null }));
  });
  it('does not accept a VIEWER JWT as an operation actor', async () => {
    mocks.role = 'VIEWER';
    const token = signAccessToken({ id: 'user', username: 'operator', role: 'VIEWER', mfaEnabled: true } as User);
    const response = await app.inject({ method: 'POST', url, headers: { 'x-client-key': 'key', authorization: `Bearer ${token}` }, payload });
    expect(response.statusCode).toBe(403);
    expect(service).not.toHaveBeenCalled();
  });
});
