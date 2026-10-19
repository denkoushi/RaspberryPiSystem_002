import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { readMock, statMock, clientMock, authorizeMock } = vi.hoisted(() => ({
  readMock: vi.fn(), statMock: vi.fn(), clientMock: vi.fn(), authorizeMock: vi.fn(),
}));
vi.mock('fs', () => ({ promises: { stat: statMock, readFile: readMock } }));
vi.mock('../../../lib/pdf-storage.js', () => ({ PDF_PAGES_DIR: '/storage/pdf-pages' }));
vi.mock('../../../services/clients/client-device-auth.service.js', () => ({ findClientDeviceByApiKey: clientMock }));
vi.mock('../../../lib/auth.js', () => ({ authorizeRoles: () => authorizeMock }));

import { ApiError } from '../../../lib/errors.js';
import { registerPdfPageRoutes } from '../pdf-pages.js';

const logError = vi.fn();

async function getFile(url = '/api/storage/pdf-pages/document/page-1.png') {
  const app = Fastify({ logger: false });
  app.addHook('onRequest', async (request) => {
    vi.spyOn(request.log, 'error').mockImplementation(logError);
  });
  await app.register(async (instance) => registerPdfPageRoutes(instance), { prefix: '/api' });
  try {
    return await app.inject({ method: 'GET', url, headers: { 'x-client-key': 'kiosk-key' } });
  } finally {
    await app.close();
    vi.restoreAllMocks();
  }
}

describe('pdf-pages error replies', () => {
  beforeEach(() => {
    readMock.mockReset();
    statMock.mockReset().mockResolvedValue({ size: 12, mtimeMs: 34 });
    clientMock.mockReset().mockResolvedValue({ id: 'client' });
    authorizeMock.mockReset().mockResolvedValue(undefined);
    logError.mockReset();
  });

  it.each([
    'document/%25',
    '%25/page.png',
    'document/a..png',
    'a..b/page.png',
    'document/%252Foutside.png',
  ])('rejects invalid path %s', async (suffix) => {
    const response = await getFile(`/api/storage/pdf-pages/${suffix}`);
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ message: '無効なパスです' });
    expect(readMock).not.toHaveBeenCalled();
  });

  it('returns 404 for ENOENT', async () => {
    readMock.mockRejectedValue(Object.assign(new Error('missing'), { code: 'ENOENT' }));
    const response = await getFile();
    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ message: '画像が見つかりません' });
    expect(logError).not.toHaveBeenCalled();
  });

  it('logs the exact context and returns 500 for read failures', async () => {
    const error = new Error('read failed');
    readMock.mockRejectedValue(error);
    const response = await getFile();
    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({ message: '画像の読み込みに失敗しました' });
    expect(logError).toHaveBeenCalledExactlyOnceWith({ err: error, filePath: '/storage/pdf-pages/document/page-1.png' }, '画像の読み込みに失敗しました');
  });

  it('handles ApiError as a read failure', async () => {
    readMock.mockRejectedValue(new ApiError(503, 'x'));
    const response = await getFile();
    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({ message: '画像の読み込みに失敗しました' });
  });

});
