import Fastify from 'fastify';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ZodError } from 'zod';
import type { User } from '@prisma/client';
import { signTestAccessToken as signAccessToken } from '../../../test/auth-session-fixture.js';
import { ApiError } from '../../../lib/errors.js';

import { prisma } from '../../../lib/prisma.js';
import { registerClientCoreRoutes } from '../core.js';

vi.mock('../../../lib/prisma.js', () => ({
  prisma: { authSession: { findUnique: vi.fn(async ({ where }) => ({ userId: where.id, expiresAt: new Date(Date.now() + 86400000), revokedAt: null, id: where.id })) }, user: { findUnique: vi.fn() }, clientDevice: { findMany: vi.fn(), upsert: vi.fn(), update: vi.fn(), findUnique: vi.fn(), findFirst: vi.fn() } }
}));

function tokenForUser(user: User): string {
  const activeUser = { ...user, status: 'ACTIVE' as const, mfaEnabled: true };
  vi.mocked(prisma.user.findUnique).mockResolvedValue(activeUser);
  return signAccessToken(activeUser);
}

const body = { apiKey: 'test-client-key', name: 'factory-pi' };

describe('client registration routes', () => {
  const app = Fastify();
  app.setErrorHandler((error, _request, reply) => {
    reply.code(error instanceof ZodError ? 400 : error instanceof ApiError ? error.statusCode : 500).send({ error: 'Invalid request' });
  });
  app.addHook('onRequest', async request => {
    request.headers.authorization ??= `Bearer ${tokenForUser({ id: 'admin', username: 'admin', role: 'ADMIN' } as User)}`;
  });
  void app.register(registerClientCoreRoutes);
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.user.findUnique).mockImplementation(async ({ where }) => ({
      id: where.id, username: where.id, role: where.id === 'manager' ? 'MANAGER' : where.id === 'viewer' ? 'VIEWER' : 'ADMIN',
      status: 'ACTIVE', mfaEnabled: false,
    }) as never);
    vi.mocked(prisma.clientDevice.upsert).mockResolvedValue({ id: 'device-1' } as never);
    vi.mocked(prisma.clientDevice.update).mockResolvedValue({ id: 'device-1' } as never);
    vi.mocked(prisma.clientDevice.findUnique).mockResolvedValue({ canProxyOtherDevices: false } as never);
  });
  afterAll(async () => { await app.close(); });

  it('ignores heartbeat location and lets managers update it through PUT', async () => {
    const heartbeat = await app.inject({ method: 'POST', url: '/clients/heartbeat', headers: { 'x-client-key': body.apiKey }, payload: { location: 'stale location' } });
    expect(heartbeat.statusCode).toBe(200);
    expect(prisma.clientDevice.update).toHaveBeenCalledWith({ where: { apiKey: body.apiKey }, data: { lastSeenAt: expect.any(Date) } });
    const updated = await app.inject({ method: 'PUT', url: '/clients/device-1', payload: { location: 'a'.repeat(100) } });
    expect(updated.statusCode).toBe(200);
    expect(prisma.clientDevice.update).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ location: 'a'.repeat(100) }) }));
  });

  it.each(['/clients', '/clients/heartbeat', '/clients/device-1'])('rejects excessive location length at %s', async url => {
    const response = await app.inject({ method: url.endsWith('device-1') ? 'PUT' : 'POST', url, headers: { 'x-client-key': body.apiKey }, payload: { ...body, location: 'a'.repeat(101) } });
    expect(response.statusCode).toBe(400);
    expect(prisma.clientDevice.update).not.toHaveBeenCalled();
    expect(prisma.clientDevice.upsert).not.toHaveBeenCalled();
  });

  it('requires ADMIN for registration', async () => {
    const token = tokenForUser({ id: 'manager', username: 'manager', role: 'MANAGER' } as User);
    const response = await app.inject({ method: 'POST', url: '/clients', headers: { authorization: `Bearer ${token}` }, payload: body });
    expect(response.statusCode).toBe(403);
    expect(prisma.clientDevice.upsert).not.toHaveBeenCalled();
  });

  it.each([false, true])('requires ADMIN to change canProxyOtherDevices (current %s)', async current => {
    vi.mocked(prisma.clientDevice.findUnique).mockResolvedValue({ canProxyOtherDevices: current } as never);
    const token = tokenForUser({ id: 'manager', username: 'manager', role: 'MANAGER' } as User);
    const response = await app.inject({ method: 'PUT', url: '/clients/device-1', headers: { authorization: `Bearer ${token}` }, payload: { canProxyOtherDevices: !current } });
    expect(response.statusCode).toBe(403);
    expect(prisma.clientDevice.update).not.toHaveBeenCalled();
    const admin = await app.inject({ method: 'PUT', url: '/clients/device-1', payload: { canProxyOtherDevices: !current } });
    expect(admin.statusCode).toBe(200);
  });

  it.each([false, true])('allows MANAGER to save an unchanged canProxyOtherDevices value (%s)', async current => {
    vi.mocked(prisma.clientDevice.findUnique).mockResolvedValue({ canProxyOtherDevices: current } as never);
    const token = tokenForUser({ id: 'manager', username: 'manager', role: 'MANAGER' } as User);
    const response = await app.inject({ method: 'PUT', url: '/clients/device-1', headers: { authorization: `Bearer ${token}` }, payload: { name: 'updated', canProxyOtherDevices: current } });
    expect(response.statusCode).toBe(200);
    expect(prisma.clientDevice.update).toHaveBeenCalled();
  });

  it('allows MANAGER to update ordinary fields', async () => {
    const token = tokenForUser({ id: 'manager', username: 'manager', role: 'MANAGER' } as User);
    const response = await app.inject({ method: 'PUT', url: '/clients/device-1', headers: { authorization: `Bearer ${token}` }, payload: { name: 'updated' } });
    expect(response.statusCode).toBe(200);
    expect(prisma.clientDevice.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ name: 'updated' }) }));
  });

  it.each(['ADMIN', 'MANAGER'] as const)('allows %s to set signage fields and stores the preview ID in both fields', async (role) => {
    const target = { id: '11111111-1111-4111-8111-111111111111', apiKey: 'fixture-only-signage-target', isSignage: true };
    vi.mocked(prisma.clientDevice.findUnique).mockResolvedValue(target as never);
    vi.mocked(prisma.clientDevice.update).mockImplementation(async ({ data }) => ({ id: 'device-1', apiKey: body.apiKey, ...data }) as never);
    const token = signAccessToken({ id: role === 'ADMIN' ? 'admin' : 'manager', username: 'user', role } as User);
    const response = await app.inject({ method: 'PUT', url: '/clients/device-1', headers: { authorization: `Bearer ${token}` }, payload: {
      isSignage: true, signagePreviewTargetDeviceId: target.id,
    } });
    expect(response.statusCode).toBe(200);
    expect(response.json().client).toMatchObject({ isSignage: true, signagePreviewTargetDeviceId: target.id });
    expect(response.json().client).not.toHaveProperty('apiKey');
    expect(prisma.clientDevice.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      isSignage: true, signagePreviewTargetDeviceId: target.id, signagePreviewTargetApiKey: target.id,
    }) }));
  });

  it('rejects the legacy preview field and clears both fields using an ID', async () => {
    const response = await app.inject({ method: 'PUT', url: '/clients/device-1', payload: { signagePreviewTargetApiKey: 'legacy-key' } });
    expect(response.statusCode).toBe(400);
    expect(prisma.clientDevice.update).not.toHaveBeenCalled();
    const cleared = await app.inject({ method: 'PUT', url: '/clients/device-1', payload: { signagePreviewTargetDeviceId: null } });
    expect(cleared.statusCode).toBe(200);
    expect(prisma.clientDevice.update).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({
      signagePreviewTargetDeviceId: null, signagePreviewTargetApiKey: null,
    }) }));
  });

  it('rejects a non-signage preview target even if its credential contains signage', async () => {
    vi.mocked(prisma.clientDevice.findUnique).mockResolvedValue({ id: '11111111-1111-4111-8111-111111111111', apiKey: 'fixture-signage-key', isSignage: false } as never);
    const response = await app.inject({ method: 'PUT', url: '/clients/device-1', payload: { signagePreviewTargetDeviceId: '11111111-1111-4111-8111-111111111111' } });
    expect(response.statusCode).toBe(400);
    expect(prisma.clientDevice.update).not.toHaveBeenCalled();
  });

  it('keeps signage edits unavailable to VIEWER', async () => {
    const token = signAccessToken({ id: 'viewer', username: 'viewer', role: 'VIEWER' } as User);
    const response = await app.inject({ method: 'PUT', url: '/clients/device-1', headers: { authorization: `Bearer ${token}` }, payload: { isSignage: true } });
    expect(response.statusCode).toBe(403);
    expect(prisma.clientDevice.update).not.toHaveBeenCalled();
  });

  it('includes signage fields without the API key in the client list', async () => {
    const row = { id: 'device-1', isSignage: true, signagePreviewTargetDeviceId: null };
    vi.mocked(prisma.clientDevice.findMany).mockResolvedValue([row] as never);
    const response = await app.inject({ method: 'GET', url: '/clients' });
    expect(response.statusCode).toBe(200);
    expect(response.json().clients).toEqual([row]);
    expect(response.json().clients[0]).not.toHaveProperty('apiKey');
    expect(prisma.clientDevice.findMany).toHaveBeenCalledWith({ orderBy: { name: 'asc' }, omit: { apiKey: true } });
  });

  it('omits the API key from PUT responses', async () => {
    vi.mocked(prisma.clientDevice.update).mockResolvedValue({ id: 'device-1', apiKey: body.apiKey, name: 'updated' } as never);
    const response = await app.inject({ method: 'PUT', url: '/clients/device-1', payload: { name: 'updated' } });
    expect(response.statusCode).toBe(200);
    expect(response.json().client).toEqual({ id: 'device-1', name: 'updated' });
  });

  it('returns the API key only on demand for ADMIN without caching', async () => {
    const id = '11111111-1111-4111-8111-111111111111';
    vi.mocked(prisma.clientDevice.findUnique).mockResolvedValue({ apiKey: body.apiKey } as never);
    const response = await app.inject({ method: 'GET', url: `/clients/${id}/api-key` });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ apiKey: body.apiKey });
    expect(response.headers['cache-control']).toBe('no-store');
    expect(prisma.clientDevice.findUnique).toHaveBeenCalledWith({ where: { id }, select: { apiKey: true } });
  });

  it.each(['MANAGER', 'VIEWER'] as const)('denies API key access to %s', async role => {
    const token = tokenForUser({ id: role.toLowerCase(), username: 'user', role } as User);
    const response = await app.inject({ method: 'GET', url: '/clients/11111111-1111-4111-8111-111111111111/api-key', headers: { authorization: `Bearer ${token}` } });
    expect(response.statusCode).toBe(403);
    expect(prisma.clientDevice.findUnique).not.toHaveBeenCalled();
  });

  it('returns 404 for an unknown API key device', async () => {
    vi.mocked(prisma.clientDevice.findUnique).mockResolvedValue(null);
    const response = await app.inject({ method: 'GET', url: '/clients/11111111-1111-4111-8111-111111111111/api-key' });
    expect(response.statusCode).toBe(404);
  });

  it('rejects a non-uuid API key device id', async () => {
    const response = await app.inject({ method: 'GET', url: '/clients/not-a-uuid/api-key' });
    expect(response.statusCode).toBe(400);
    expect(prisma.clientDevice.findUnique).not.toHaveBeenCalled();
  });

  it('keeps the API key in the registration response', async () => {
    vi.mocked(prisma.clientDevice.upsert).mockResolvedValue({ id: 'device-1', apiKey: body.apiKey } as never);
    const response = await app.inject({ method: 'POST', url: '/clients', payload: body });
    expect(response.statusCode).toBe(200);
    expect(response.json().client.apiKey).toBe(body.apiKey);
  });

  it('saves the initial location and preserves it on re-registration', async () => {
    let stored: Record<string, unknown> | undefined;
    vi.mocked(prisma.clientDevice.upsert).mockImplementation(async ({ create, update }) => {
      stored = stored ? { ...stored, ...update } : { id: 'device-1', ...create };
      return stored as never;
    });
    const initial = await app.inject({ method: 'POST', url: '/clients', payload: { ...body, location: 'initial location' } });
    expect(initial.statusCode).toBe(200);
    expect(initial.json().client.location).toBe('initial location');
    const repeated = await app.inject({ method: 'POST', url: '/clients', payload: { ...body, location: 'changed location' } });
    expect(repeated.statusCode).toBe(200);
    expect(repeated.json().client.location).toBe('initial location');
    expect(vi.mocked(prisma.clientDevice.upsert).mock.calls[1][0].update).not.toHaveProperty('location');
  });

  it('stores statusClientId on create and on upsert update', async () => {
    const response = await app.inject({ method: 'POST', url: '/clients', payload: {
      ...body, statusClientId: 'raspi4-factory'
    } });
    expect(response.statusCode).toBe(200);
    expect(prisma.clientDevice.upsert).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      where: { apiKey: body.apiKey },
      create: expect.objectContaining({ ...body, statusClientId: 'raspi4-factory' }),
      update: expect.objectContaining({ statusClientId: 'raspi4-factory' })
    }));
  });

  it('preserves the previous payload when statusClientId is omitted', async () => {
    const response = await app.inject({ method: 'POST', url: '/clients', payload: body });
    expect(response.statusCode).toBe(200);
    const args = vi.mocked(prisma.clientDevice.upsert).mock.calls[0][0];
    expect(args.create).toEqual({ ...body, location: undefined, siteKey: undefined, isSignage: false, lastSeenAt: expect.any(Date) });
    expect(args.update).toEqual({ lastSeenAt: expect.any(Date) });
  });

  it.each(['', ' ', ' raspi4', 'raspi4 ', 'a'.repeat(256), 'raspi\n4', 'raspi\u00004', 'raspi\u007f4', null, 123])(
    'rejects invalid statusClientId (%j)', async (statusClientId) => {
      const response = await app.inject({ method: 'POST', url: '/clients', payload: { ...body, statusClientId } });
      expect(response.statusCode).toBe(400);
      expect(prisma.clientDevice.upsert).not.toHaveBeenCalled();
    }
  );

  it('accepts the maximum identifier length', async () => {
    const response = await app.inject({ method: 'POST', url: '/clients', payload: { ...body, statusClientId: 'a'.repeat(255) } });
    expect(response.statusCode).toBe(200);
  });

  it('allows updating statusClientId with PUT', async () => {
    const response = await app.inject({ method: 'PUT', url: '/clients/device-1', payload: { statusClientId: 'raspi4-new' } });
    expect(response.statusCode).toBe(200);
    expect(prisma.clientDevice.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'device-1' }, data: expect.objectContaining({ statusClientId: 'raspi4-new' })
    }));
  });
});
