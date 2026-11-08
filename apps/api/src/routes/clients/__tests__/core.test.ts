import Fastify from 'fastify';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ZodError } from 'zod';
import type { User } from '@prisma/client';
import { signAccessToken } from '../../../lib/auth.js';
import { ApiError } from '../../../lib/errors.js';

import { prisma } from '../../../lib/prisma.js';
import { registerClientCoreRoutes } from '../core.js';

vi.mock('../../../lib/prisma.js', () => ({
  prisma: { user: { findUnique: vi.fn() }, clientDevice: { findMany: vi.fn(), upsert: vi.fn(), update: vi.fn(), findUnique: vi.fn(), findFirst: vi.fn() } }
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
    expect(response.json().client).toMatchObject({ isSignage: true, signagePreviewTargetDeviceId: target.id, apiKey: body.apiKey });
    expect(prisma.clientDevice.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      isSignage: true, signagePreviewTargetDeviceId: target.id, signagePreviewTargetApiKey: target.id,
    }) }));
  });

  it('converts the legacy preview field and clears both fields', async () => {
    const target = { id: '11111111-1111-4111-8111-111111111111', apiKey: 'fixture-only-signage-target', isSignage: true };
    vi.mocked(prisma.clientDevice.findFirst).mockResolvedValue(target as never);
    const response = await app.inject({ method: 'PUT', url: '/clients/device-1', payload: { signagePreviewTargetApiKey: target.apiKey } });
    expect(response.statusCode).toBe(200);
    expect(prisma.clientDevice.findFirst).toHaveBeenCalledWith({ where: { OR: [{ apiKey: target.apiKey }, { id: target.apiKey }] }, select: { id: true, isSignage: true } });
    expect(prisma.clientDevice.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      signagePreviewTargetDeviceId: target.id, signagePreviewTargetApiKey: target.id,
    }) }));
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

  it('includes signage fields and the legacy credential in the client list', async () => {
    const row = { id: 'device-1', apiKey: body.apiKey, isSignage: true, signagePreviewTargetDeviceId: null };
    vi.mocked(prisma.clientDevice.findMany).mockResolvedValue([row] as never);
    const response = await app.inject({ method: 'GET', url: '/clients' });
    expect(response.statusCode).toBe(200);
    expect(response.json().clients).toEqual([row]);
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
    expect(args.update).toEqual({ location: undefined, lastSeenAt: expect.any(Date) });
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
