import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { readMock, statMock, clientMock, authorizeMock } = vi.hoisted(() => ({
  readMock: vi.fn(), statMock: vi.fn(), clientMock: vi.fn(), authorizeMock: vi.fn(),
}));
vi.mock('../../../services/assembly-procedure-assets/local-assembly-procedure-asset-storage.adapter.js', () => ({
  getAssemblyProcedureAssetStorage: () => ({ stat: statMock, read: readMock }),
  resolveAssemblyProcedureAssetStoragePath: () => ({ storageKey: 'file.png', contentType: 'image/png' }),
}));
vi.mock('../../../services/clients/client-device-auth.service.js', () => ({ findClientDeviceByApiKey: clientMock }));
vi.mock('../../../lib/auth.js', () => ({ authorizeRoles: () => authorizeMock }));

import { ApiError } from '../../../lib/errors.js';
import { registerAssemblyProcedureAssetStorageRoutes } from '../assembly-procedure-assets.js';

const logError = vi.fn();

async function getFile(url = '/api/storage/assembly-procedure-assets/file.png') {
  const app = Fastify({ logger: false });
  app.addHook('onRequest', async (request) => {
    vi.spyOn(request.log, 'error').mockImplementation(logError);
  });
  await app.register(async (instance) => registerAssemblyProcedureAssetStorageRoutes(instance), { prefix: '/api' });
  try {
    return await app.inject({ method: 'GET', url, headers: { 'x-client-key': 'kiosk-key' } });
  } finally {
    await app.close();
    vi.restoreAllMocks();
  }
}

describe('assembly-procedure-assets error replies', () => {
  beforeEach(() => {
    readMock.mockReset();
    statMock.mockReset().mockResolvedValue({ size: 12, mtimeMs: 34 });
    clientMock.mockReset().mockResolvedValue({ id: 'client' });
    authorizeMock.mockReset().mockResolvedValue(undefined);
    logError.mockReset();
  });

  it('rejects an empty path', async () => {
    const response = await getFile('/api/storage/assembly-procedure-assets/');
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ message: '手順書assetのパスが指定されていません' });
    expect(readMock).not.toHaveBeenCalled();
  });

  it('returns 404 for ENOENT', async () => {
    readMock.mockRejectedValue(Object.assign(new Error('missing'), { code: 'ENOENT' }));
    const response = await getFile();
    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ message: '手順書assetが見つかりません' });
    expect(logError).not.toHaveBeenCalled();
  });

  it('logs the exact context and returns 500 for read failures', async () => {
    const error = new Error('read failed');
    readMock.mockRejectedValue(error);
    const response = await getFile();
    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({ message: '手順書assetの読み込みに失敗しました' });
    expect(logError).toHaveBeenCalledExactlyOnceWith({ err: error, urlPath: 'file.png' }, '手順書assetの読み込みに失敗しました');
  });

  it('rethrows ApiError', async () => {
    readMock.mockRejectedValue(new ApiError(503, 'x'));
    const response = await getFile();
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ statusCode: 503, error: 'Service Unavailable', message: 'x' });
  });

  it.each(['Invalid assembly procedure asset path', 'Unsupported assembly procedure asset type'])(
    'rejects %s, but gives ENOENT priority', async (message) => {
      readMock.mockRejectedValue(new Error(message));
      const invalid = await getFile();
      expect(invalid.statusCode).toBe(400);
      expect(invalid.json()).toEqual({ message: '手順書assetのパスが不正です' });
      expect(logError).not.toHaveBeenCalled();

      readMock.mockRejectedValue(Object.assign(new Error(message), { code: 'ENOENT' }));
      const missing = await getFile();
      expect(missing.statusCode).toBe(404);
      expect(missing.json()).toEqual({ message: '手順書assetが見つかりません' });
    }
  );
});
