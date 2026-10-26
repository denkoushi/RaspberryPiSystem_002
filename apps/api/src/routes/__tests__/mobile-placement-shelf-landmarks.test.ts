import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ZodError } from 'zod';

import { ApiError } from '../../lib/errors.js';
import { addShelfLandmark, deleteShelfLandmark, listShelfLandmarks, requireShelfMachines } from '../../services/mobile-placement/shelf-landmark.service.js';
import { requireClientDevice } from '../kiosk/shared.js';
import { registerMobilePlacementRoutes } from '../mobile-placement/index.js';

vi.mock('../../config/env/load-dotenv.js', () => ({}));
vi.mock('../kiosk/shared.js', () => ({ requireClientDevice: vi.fn() }));
vi.mock('../../services/mobile-placement/shelf-landmark.service.js', () => ({
  addShelfLandmark: vi.fn(), deleteShelfLandmark: vi.fn(), listShelfLandmarks: vi.fn(), requireShelfMachines: vi.fn()
}));

let app: ReturnType<typeof Fastify>;
beforeEach(async () => {
  vi.resetAllMocks();
  vi.mocked(requireClientDevice).mockResolvedValue({ clientDevice: { id: 'device' } } as never);
  app = Fastify();
  app.setErrorHandler((error, _request, reply) => {
    reply.code(error instanceof ZodError ? 400 : error.statusCode ?? 500).send({ message: error.message });
  });
  await registerMobilePlacementRoutes(app);
});
afterEach(async () => { await app.close(); });

const requests = [
  { method: 'GET' as const, url: '/mobile-placement/shelf-machines' },
  { method: 'POST' as const, url: '/mobile-placement/shelf-landmarks', payload: { name: '電気室' } },
  { method: 'DELETE' as const, url: `/mobile-placement/shelf-landmarks/${encodeURIComponent('電気室')}` }
];
describe('shelf landmark routes', () => {
  it.each(requests)('requires authentication for $method $url', async (request) => {
    vi.mocked(requireClientDevice).mockRejectedValue(new ApiError(401, 'unauthorized'));
    const response = await app.inject(request);
    expect(response.statusCode).toBe(401);
    expect(addShelfLandmark).not.toHaveBeenCalled();
    expect(deleteShelfLandmark).not.toHaveBeenCalled();
    expect(listShelfLandmarks).not.toHaveBeenCalled();
  });
  it('preserves machines and adds a separate landmarks array', async () => {
    vi.mocked(requireShelfMachines).mockResolvedValue(['DAD-3220']);
    vi.mocked(listShelfLandmarks).mockResolvedValue(['電気室']);
    const response = await app.inject({ ...requests[0], headers: { 'x-client-key': 'key' } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ machines: ['DAD-3220'], landmarks: ['電気室'] });
    expect(requireClientDevice).toHaveBeenCalledWith('key');
  });
  it('passes the authenticated client ID when adding a name', async () => {
    vi.mocked(addShelfLandmark).mockResolvedValue({ name: '電気室' });
    const response = await app.inject(requests[1]);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ name: '電気室' });
    expect(addShelfLandmark).toHaveBeenCalledWith('電気室', 'device');
  });
  it('decodes the name once when deleting', async () => {
    vi.mocked(deleteShelfLandmark).mockResolvedValue({ name: '倉庫 / 100%' });
    const response = await app.inject({ method: 'DELETE', url: `/mobile-placement/shelf-landmarks/${encodeURIComponent('倉庫 / 100%')}` });
    expect(response.statusCode).toBe(200);
    expect(deleteShelfLandmark).toHaveBeenCalledWith('倉庫 / 100%');
  });
  it.each([null, {}, { name: 123 }])('rejects malformed add body %s', async (payload) => {
    const response = await app.inject({ method: 'POST', url: '/mobile-placement/shelf-landmarks', payload: payload ?? undefined });
    expect(response.statusCode).toBe(400);
    expect(addShelfLandmark).not.toHaveBeenCalled();
  });
  it('keeps conflict messages for the UI', async () => {
    vi.mocked(deleteShelfLandmark).mockRejectedValue(new ApiError(409, '棚が使っている目安は消せません'));
    const response = await app.inject(requests[2]);
    expect(response.statusCode).toBe(409);
    expect(response.json().message).toBe('棚が使っている目安は消せません');
  });
});
