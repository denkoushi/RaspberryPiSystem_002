import Fastify from 'fastify';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ZodError } from 'zod';

import { prisma } from '../../../lib/prisma.js';
import { registerClientCoreRoutes } from '../core.js';

vi.mock('../../../lib/prisma.js', () => ({
  prisma: { clientDevice: { upsert: vi.fn(), update: vi.fn() } }
}));
vi.mock('../../../lib/auth.js', () => ({ authorizeRoles: () => async () => {} }));

const body = { apiKey: 'test-client-key', name: 'factory-pi' };

describe('client registration routes', () => {
  const app = Fastify();
  app.setErrorHandler((error, _request, reply) => {
    reply.code(error instanceof ZodError ? 400 : 500).send({ error: 'Invalid request' });
  });
  void app.register(registerClientCoreRoutes);
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.clientDevice.upsert).mockResolvedValue({ id: 'device-1' } as never);
    vi.mocked(prisma.clientDevice.update).mockResolvedValue({ id: 'device-1' } as never);
  });
  afterAll(async () => { await app.close(); });

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
    expect(args.create).toEqual({ ...body, location: undefined, siteKey: undefined, lastSeenAt: expect.any(Date) });
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
