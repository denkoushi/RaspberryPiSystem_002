import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { readPhotoMock, clientMock, authorizeMock } = vi.hoisted(() => ({ readPhotoMock: vi.fn(), clientMock: vi.fn(), authorizeMock: vi.fn() }));
vi.mock('../../../lib/photo-storage.js', () => ({ PhotoStorage: { readPhoto: readPhotoMock } }));
vi.mock('../../../services/clients/client-device-auth.service.js', () => ({ findClientDeviceByApiKey: clientMock }));
vi.mock('../../../lib/auth.js', () => ({ authorizeRoles: () => authorizeMock }));

import { ApiError } from '../../../lib/errors.js';
import { registerPhotoStorageRoutes } from '../photos.js';

async function getPhoto() {
  const app = Fastify();
  await app.register(async (instance) => registerPhotoStorageRoutes(instance), { prefix: '/api' });
  try {
    return await app.inject({ method: 'GET', url: '/api/storage/photos/2026/10/photo.jpg', headers: { 'x-client-key': 'kiosk-key' } });
  } finally {
    await app.close();
  }
}

describe('authenticated photo cache', () => {
  beforeEach(() => {
    clientMock.mockReset().mockResolvedValue({ id: 'client' });
    authorizeMock.mockReset().mockResolvedValue(undefined);
    readPhotoMock.mockReset().mockResolvedValue(Buffer.from('jpeg'));
  });

  it('caches successful photos privately for one day', async () => {
    const response = await getPhoto();
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('private, max-age=86400');
    expect(response.headers['content-type']).toContain('image/jpeg');
    expect(readPhotoMock).toHaveBeenCalledWith('/api/storage/photos/2026/10/photo.jpg');
  });

  it.each([
    { error: Object.assign(new Error('missing'), { code: 'ENOENT' }), status: 404 },
    { error: new Error('read failed'), status: 500 },
    { error: new ApiError(503, 'integrity failed'), status: 503 },
  ])('does not cache photo error $status', async ({ error, status }) => {
    readPhotoMock.mockRejectedValue(error);
    const response = await getPhoto();
    expect(response.statusCode).toBe(status);
    expect(response.headers['cache-control']).toBeUndefined();
  });

  it('does not cache authentication failures or read the file', async () => {
    clientMock.mockResolvedValue(null);
    authorizeMock.mockRejectedValue(new ApiError(401, 'unauthorized'));
    const response = await getPhoto();
    expect(response.statusCode).toBe(401);
    expect(response.headers['cache-control']).toBeUndefined();
    expect(readPhotoMock).not.toHaveBeenCalled();
  });
});
