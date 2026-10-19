import Fastify from 'fastify';
import sharp from 'sharp';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '../../../lib/errors.js';
import { registerErrorHandler } from '../../../plugins/error-handler.js';
import { ProcedureMaterialService } from '../../../services/assembly/procedure-material.service.js';
import { ProcedureMaterialWorkInstructionService } from '../../../services/assembly/procedure-material-work-instruction.service.js';
import { registerProcedureMaterialRoutes } from '../procedure-materials.js';

const id = '00000000-0000-4000-8000-000000000001';
const base = '/assembly/procedure-materials';
const paths = [`${base}/${id}/thumbnail`, `${base}/knowledge-candidates/images/${'a'.repeat(64)}/thumbnail`, `${base}/work-instruction-candidates/images/${id}/thumbnail`];

describe('procedure material thumbnails', () => {
  let app: ReturnType<typeof Fastify>;
  afterEach(async () => { await app?.close(); vi.restoreAllMocks(); });
  function harness(bytes: Buffer, denied = false) {
    const material = { findUnique: vi.fn().mockResolvedValue({ kind: 'PHOTO', storageKey: 'original', contentType: 'image/jpeg' }) };
    const store = { read: vi.fn().mockResolvedValue(bytes) };
    const knowledge = { readImage: vi.fn().mockResolvedValue(bytes) };
    const read = { readAsset: vi.fn().mockResolvedValue({ bytes, asset: { status: 'ACTIVE' } }) };
    const routes: Array<{ url: string; rateLimit: unknown }> = [];
    app = Fastify(); registerErrorHandler(app);
    app.addHook('onRoute', (route) => { routes.push({ url: route.url, rateLimit: route.config?.rateLimit }); });
    registerProcedureMaterialRoutes(app, { service: new ProcedureMaterialService({ procedureMaterial: material } as never, store as never),
      knowledge: knowledge as never, workInstructions: new ProcedureMaterialWorkInstructionService({} as never, store as never, () => read as never),
      allowView: async () => { if (denied) throw new ApiError(403, '権限がありません'); }, allowWriteKiosk: async () => {} });
    return { material, store, knowledge, read, routes };
  }
  it.each(paths)('shrinks, caches conversions, coalesces concurrent requests and sends private headers: %s', async (path) => {
    const bytes = await sharp({ create: { width: 1200, height: 800, channels: 3, background: 'white' } }).jpeg().toBuffer();
    const { routes } = harness(bytes);
    const resize = vi.spyOn(sharp.prototype, 'resize');
    const responses = await Promise.all([app.inject(path), app.inject(path)]);
    for (const response of responses) {
      expect(response.statusCode).toBe(200);
      expect(response.headers).toMatchObject({ 'content-type': 'image/webp', 'cache-control': 'private, max-age=3600', 'x-content-type-options': 'nosniff' });
      expect(await sharp(response.rawPayload).metadata()).toMatchObject({ width: 640, height: 427, format: 'webp' });
    }
    expect((await app.inject(path)).rawPayload).toEqual(responses[0].rawPayload);
    expect(resize).toHaveBeenCalledOnce();
    for (const route of routes.filter((route) => route.url.endsWith('/thumbnail'))) expect(route.rateLimit).toEqual({ max: 600, timeWindow: '1 minute' });
  });
  it.each(paths)('does not enlarge and applies EXIF orientation: %s', async (path) => {
    const bytes = await sharp({ create: { width: 120, height: 80, channels: 3, background: 'white' } }).jpeg().withMetadata({ orientation: 6 }).toBuffer();
    harness(bytes);
    const response = await app.inject(path);
    expect(await sharp(response.rawPayload).metadata()).toMatchObject({ width: 80, height: 120 });
  });
  it.each(paths)('checks view authorization before reading bytes: %s', async (path) => {
    const { store, knowledge, read } = harness(Buffer.from('unused'), true);
    expect((await app.inject(path)).statusCode).toBe(403);
    expect(store.read).not.toHaveBeenCalled(); expect(knowledge.readImage).not.toHaveBeenCalled(); expect(read.readAsset).not.toHaveBeenCalled();
  });
  it('revalidates existence and ACTIVE status even after caching and retains original headers', async () => {
    const bytes = await sharp({ create: { width: 20, height: 30, channels: 3, background: 'white' } }).jpeg().toBuffer();
    const { material, knowledge, read, routes } = harness(bytes);
    for (const path of paths) expect((await app.inject(path)).statusCode).toBe(200);
    const original = await app.inject(`${base}/${id}/file`);
    expect(original.rawPayload).toEqual(bytes); expect(original.headers['cache-control']).toBe('private, no-store');
    expect(routes.find((route) => route.url === `${base}/:id/file`)?.rateLimit).toEqual({ max: 120, timeWindow: '1 minute' });
    material.findUnique.mockResolvedValue(null);
    knowledge.readImage.mockRejectedValue(new ApiError(404, '写真がありません'));
    read.readAsset.mockResolvedValue(null);
    for (const path of paths) expect((await app.inject(path)).statusCode).toBe(404);
    for (const status of ['STAGED', 'DELETED']) {
      read.readAsset.mockResolvedValue({ bytes, asset: { status } });
      const response = await app.inject(paths[2]);
      expect(response.statusCode).toBe(404); expect(response.json().errorCode ?? response.json().code).toBe('WORK_INSTRUCTION_ASSET_NOT_FOUND');
    }
  });
  it('does not cache failures and converts changed bytes again', async () => {
    const { store } = harness(Buffer.from('invalid'));
    expect((await app.inject(paths[0])).statusCode).toBe(500);
    for (const width of [20, 30]) {
      store.read.mockResolvedValue(await sharp({ create: { width, height: 10, channels: 3, background: 'white' } }).png().toBuffer());
      const response = await app.inject(paths[0]);
      expect(response.statusCode).toBe(200); expect((await sharp(response.rawPayload).metadata()).width).toBe(width);
    }
  });
});
