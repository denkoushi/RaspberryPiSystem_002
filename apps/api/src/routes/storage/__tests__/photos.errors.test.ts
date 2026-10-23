import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { readMock, statMock, clientMock, authorizeMock } = vi.hoisted(() => ({
  readMock: vi.fn(), statMock: vi.fn(), clientMock: vi.fn(), authorizeMock: vi.fn(),
}));
vi.mock('../../../lib/photo-storage.js', () => ({ PhotoStorage: { readPhoto: readMock } }));
vi.mock('../../../services/clients/client-device-auth.service.js', () => ({ findClientDeviceByApiKey: clientMock }));
vi.mock('../../../lib/auth.js', () => ({ authorizeRoles: () => authorizeMock }));

import { ApiError } from '../../../lib/errors.js';
import { registerPhotoStorageRoutes } from '../photos.js';

const logError = vi.fn();

async function getFile(url = '/api/storage/photos/file.png') {
  const app = Fastify({ logger: false });
  app.addHook('onRequest', async (request) => {
    vi.spyOn(request.log, 'error').mockImplementation(logError);
  });
  await app.register(async (instance) => registerPhotoStorageRoutes(instance), { prefix: '/api' });
  try {
    return await app.inject({ method: 'GET', url, headers: { 'x-client-key': 'kiosk-key' } });
  } finally {
    await app.close();
    vi.restoreAllMocks();
  }
}

describe('photos error replies', () => {
  beforeEach(() => {
    readMock.mockReset();
    statMock.mockReset().mockResolvedValue({ size: 12, mtimeMs: 34 });
    clientMock.mockReset().mockResolvedValue({ id: 'client' });
    authorizeMock.mockReset().mockResolvedValue(undefined);
    logError.mockReset();
  });

  it('rejects an empty path', async () => {
    const response = await getFile('/api/storage/photos/');
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ message: '写真のパスが指定されていません' });
    expect(readMock).not.toHaveBeenCalled();
  });

  it('returns 404 for ENOENT', async () => {
    readMock.mockRejectedValue(Object.assign(new Error('missing'), { code: 'ENOENT' }));
    const response = await getFile();
    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ message: '写真が見つかりません' });
    expect(logError).not.toHaveBeenCalled();
  });

  it('logs the exact context and returns 500 for read failures', async () => {
    const error = new Error('read failed');
    readMock.mockRejectedValue(error);
    const response = await getFile();
    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({ message: '写真の読み込みに失敗しました' });
    expect(logError).toHaveBeenCalledExactlyOnceWith({ err: error, photoUrl: '/api/storage/photos/file.png' }, '写真の読み込みに失敗しました');
  });

  it('rethrows ApiError', async () => {
    readMock.mockRejectedValue(new ApiError(503, 'x'));
    const response = await getFile();
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ statusCode: 503, error: 'Service Unavailable', message: 'x' });
  });

});
