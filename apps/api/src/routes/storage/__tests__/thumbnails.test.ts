import Fastify from 'fastify';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { registerErrorHandler } from '../../../plugins/error-handler.js';
import {
  getFileStorageRuntime,
  resetFileStorageRuntimesForTests,
} from '../../../services/file-storage/file-storage-runtime.js';
import { registerThumbnailStorageRoutes } from '../thumbnails.js';

describe('GET /api/storage/thumbnails/*', () => {
  let root: string;
  let app: ReturnType<typeof Fastify>;
  const originalRoot = process.env.FILE_STORAGE_ROOT;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'thumbnail-route-'));
    process.env.FILE_STORAGE_ROOT = root;
    resetFileStorageRuntimesForTests();
    const runtime = getFileStorageRuntime();
    await runtime.store.initialize(['thumbnails', '.integrity']);
    app = Fastify();
    registerErrorHandler(app);
    await app.register(async (instance) => {
      registerThumbnailStorageRoutes(instance);
    }, { prefix: '/api' });
  });

  afterEach(async () => {
    await app.close();
    resetFileStorageRuntimesForTests();
    if (originalRoot === undefined) delete process.env.FILE_STORAGE_ROOT;
    else process.env.FILE_STORAGE_ROOT = originalRoot;
    await fs.rm(root, { recursive: true, force: true });
  });

  it('keeps the public URL and verifies a cataloged thumbnail', async () => {
    await getFileStorageRuntime().store.write({
      key: 'thumbnails/2026/07/example_thumb.jpg',
      data: Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
      mode: 'create',
      integrity: true,
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/storage/thumbnails/2026/07/example_thumb.jpg',
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('public, max-age=86400');
    expect(response.headers['content-type']).toContain('image/jpeg');
  });

  it('returns the typed 503 without repairing a corrupted thumbnail', async () => {
    await getFileStorageRuntime().store.write({
      key: 'thumbnails/corrupt_thumb.jpg',
      data: Buffer.from('good'),
      mode: 'create',
      integrity: true,
    });
    await fs.writeFile(path.join(root, 'thumbnails', 'corrupt_thumb.jpg'), 'bad');

    const response = await app.inject({
      method: 'GET',
      url: '/api/storage/thumbnails/corrupt_thumb.jpg',
    });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({
      errorCode: 'FILE_STORAGE_INTEGRITY_MISMATCH',
    });
    await expect(
      fs.readFile(path.join(root, 'thumbnails', 'corrupt_thumb.jpg'), 'utf8')
    ).resolves.toBe('bad');
  });
});
