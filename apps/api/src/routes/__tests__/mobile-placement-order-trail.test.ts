import Fastify, { type FastifyError, type FastifyReply, type FastifyRequest } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ZodError } from 'zod';

import { ApiError } from '../../lib/errors.js';
import { getHaizenOrderTrail } from '../../services/mobile-placement/order-trail.service.js';
import { requireClientDevice } from '../kiosk/shared.js';
import { registerOrderTrailRoutes } from '../mobile-placement/order-trail.js';

vi.mock('../../config/env/load-dotenv.js', () => ({}));
vi.mock('../kiosk/shared.js', () => ({ requireClientDevice: vi.fn() }));
vi.mock('../../services/mobile-placement/order-trail.service.js', () => ({ getHaizenOrderTrail: vi.fn() }));
let app: ReturnType<typeof Fastify>;
beforeEach(async () => {
  vi.resetAllMocks();
  vi.mocked(requireClientDevice).mockImplementation(async key => {
    if (key !== 'test-device') throw new ApiError(401, 'unauthorized');
    return { clientDevice: { id: 'device' } } as never;
  });
  vi.mocked(getHaizenOrderTrail).mockResolvedValue(null);
  app = Fastify();
  app.setErrorHandler((error: FastifyError, _request: FastifyRequest, reply: FastifyReply) => {
    reply.code(error instanceof ZodError ? 400 : error.statusCode ?? 500).send({ message: error.message });
  });
  await registerOrderTrailRoutes(app);
});
afterEach(async () => { await app.close(); });

describe('GET order-trail', () => {
  it.each(['', '?order=123', '?order=12345678901', '?order=123456789a', '?order=１２３４５６７８９０', '?order=%201234567890', '?order=0002178005%0A'])('rejects malformed order %s', async query => {
    expect((await app.inject({ url: `/mobile-placement/order-trail${query}`, headers: { 'x-client-key': 'test-device' } })).statusCode).toBe(400);
    expect(getHaizenOrderTrail).not.toHaveBeenCalled();
  });
  it.each([undefined, 'wrong'])('requires a valid device key (%s)', async key => {
    expect((await app.inject({ url: '/mobile-placement/order-trail?order=0002178005', headers: key ? { 'x-client-key': key } : {} })).statusCode).toBe(401);
    expect(getHaizenOrderTrail).not.toHaveBeenCalled();
  });
  it('returns null for an unknown order, preserving leading zeroes', async () => {
    const response = await app.inject({ url: '/mobile-placement/order-trail?order=0002178005', headers: { 'x-client-key': 'test-device' } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ trail: null });
    expect(getHaizenOrderTrail).toHaveBeenCalledWith('0002178005');
  });
});
