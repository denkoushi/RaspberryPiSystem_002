import Fastify from 'fastify';
import type { User } from '@prisma/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { signTestAccessToken as signAccessToken } from '../../test/auth-session-fixture.js';
import { prisma } from '../../lib/prisma.js';
import { registerErrorHandler } from '../../plugins/error-handler.js';
import { MeasuringInstrumentLoanService } from '../../services/measuring-instruments/loan.service.js';
import { RiggingLoanService } from '../../services/rigging/index.js';
import { registerMeasuringInstrumentRoutes } from '../measuring-instruments/index.js';
import { registerRiggingRoutes } from '../rigging/index.js';

vi.mock('../../lib/prisma.js', () => ({ prisma: { authSession: { findUnique: vi.fn(async ({ where }) => ({ userId: where.id, expiresAt: new Date(Date.now() + 86400000), revokedAt: null, id: where.id })) }, user: { findUnique: vi.fn() }, clientDevice: { findUnique: vi.fn() } } }));

function tokenForUser(user: User): string {
  const activeUser = { ...user, status: 'ACTIVE' as const, mfaEnabled: true };
  vi.mocked(prisma.user.findUnique).mockResolvedValue(activeUser);
  return signAccessToken(activeUser);
}

const ownId = '11111111-1111-4111-8111-111111111111';
const otherId = '22222222-2222-4222-8222-222222222222';
const loanId = '33333333-3333-4333-8333-333333333333';

describe.each([
  { path: '/measuring-instruments/return', register: registerMeasuringInstrumentRoutes, service: MeasuringInstrumentLoanService },
  { path: '/rigging-gears/return', register: registerRiggingRoutes, service: RiggingLoanService }
])('equipment return device scope: $path', ({ path, register, service }) => {
  let app: ReturnType<typeof Fastify>;
  beforeEach(async () => {
    vi.mocked(prisma.clientDevice.findUnique).mockImplementation(async args => {
      if (args.where.apiKey === 'key') return { id: ownId, canProxyOtherDevices: false } as never;
      if (args.where.id === otherId) return { id: otherId } as never;
      return null;
    });
    vi.spyOn(service.prototype, 'return').mockResolvedValue({ id: loanId } as never);
    app = Fastify();
    registerErrorHandler(app);
    await register(app);
  });
  afterEach(async () => { await app.close(); vi.restoreAllMocks(); });

  it('requires matching body clientId for a device key', async () => {
    const response = await app.inject({ method: 'POST', url: path, headers: { 'x-client-key': 'key' }, payload: { loanId, clientId: otherId } });
    expect(response.statusCode).toBe(403);
    expect(service.prototype.return).not.toHaveBeenCalled();
  });
  it.each([undefined, ownId])('accepts own or omitted clientId (%s)', async clientId => {
    const response = await app.inject({ method: 'POST', url: path, headers: { 'x-client-key': 'key' }, payload: { loanId, clientId } });
    expect(response.statusCode).toBe(200);
    expect(service.prototype.return).toHaveBeenCalledWith(expect.objectContaining({ clientId: ownId }));
  });
  it('allows a proxy device to select another registered device', async () => {
    vi.mocked(prisma.clientDevice.findUnique).mockResolvedValueOnce({ id: ownId, canProxyOtherDevices: true } as never)
      .mockResolvedValueOnce({ id: ownId, canProxyOtherDevices: true } as never);
    const response = await app.inject({ method: 'POST', url: path, headers: { 'x-client-key': 'key' }, payload: { loanId, clientId: otherId } });
    expect(response.statusCode).toBe(200);
    expect(service.prototype.return).toHaveBeenCalledWith(expect.objectContaining({ clientId: otherId }));
  });
  it('checks the device key when a VIEWER JWT falls back to device authentication', async () => {
    const token = tokenForUser({ id: 'viewer', username: 'viewer', role: 'VIEWER' } as User);
    const response = await app.inject({ method: 'POST', url: path, headers: { authorization: `Bearer ${token}`, 'x-client-key': 'key' }, payload: { loanId, clientId: otherId } });
    expect(response.statusCode).toBe(403);
    expect(service.prototype.return).not.toHaveBeenCalled();
  });
  it.each(['ADMIN', 'MANAGER'] as const)('allows %s JWT with an unrelated device key', async role => {
    const token = tokenForUser({ id: 'user', username: 'user', role } as User);
    const response = await app.inject({ method: 'POST', url: path, headers: { authorization: `Bearer ${token}`, 'x-client-key': 'key' }, payload: { loanId, clientId: otherId } });
    expect(response.statusCode).toBe(200);
    expect(service.prototype.return).toHaveBeenCalledWith(expect.objectContaining({ clientId: otherId }));
  });
});
