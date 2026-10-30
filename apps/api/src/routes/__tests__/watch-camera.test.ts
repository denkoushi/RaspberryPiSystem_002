import rateLimit from '@fastify/rate-limit';
import Fastify from 'fastify';
import jwt from 'jsonwebtoken';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ZodError } from 'zod';

import { ApiError } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import { judgeWatchCameraFrame, saveWatchCameraFrame } from '../../services/watch-camera/watch-camera.service.js';
import { requireClientDevice } from '../kiosk/shared.js';
import { registerWatchCameraRoutes } from '../watch-camera/index.js';

vi.mock('../../config/env/load-dotenv.js', () => ({}));
vi.mock('../../config/env.js', () => ({ env: {
  JWT_ACCESS_SECRET: 'watch-camera-test-signing-key', ADMIN_MFA_REQUIRED: false,
  WATCH_CAMERA_JUDGE_INTERVAL_SEC: 30, WATCH_CAMERA_UNJUDGED_INTERVAL_SEC: 60, WATCH_CAMERA_MAX_BYTES: 10000000,
} }));
vi.mock('../kiosk/shared.js', async () => ({
  normalizeClientKey: (await import('../../lib/client-key.js')).normalizeClientKey, requireClientDevice: vi.fn(),
}));
vi.mock('../../lib/logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn() } }));
vi.mock('../../lib/prisma.js', () => ({ prisma: {
  watchCameraFrame: { aggregate: vi.fn(), create: vi.fn(), findMany: vi.fn(), findUnique: vi.fn() },
} }));
const files = vi.hoisted(() => ({ writeBatch: vi.fn(), delete: vi.fn(), read: vi.fn() }));
const inference = vi.hoisted(() => ({ complete: vi.fn(), configured: vi.fn() }));
vi.mock('../../services/file-storage/file-storage-runtime.js', () => ({ getFileStorageRuntime: () => ({ store: files }) }));
vi.mock('../../services/inference/inference-runtime.js', () => ({ getInferenceRuntime: () => ({
  isPhotoLabelInferenceConfigured: inference.configured, createVisionCompletionPort: () => ({ complete: inference.complete }),
}) }));

let app: ReturnType<typeof Fastify>;
let device = 0;
const id = '9df8a3d0-77bd-40d4-9c05-2cf86f06c734';
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0, 1]);
const authorization = (role: string) => ({ authorization: `Bearer ${jwt.sign({ sub: 'user', username: 'test', role }, 'watch-camera-test-signing-key')}` });
const post = (payload = jpeg, contentType = 'image/jpeg', key = 'camera-key') => app.inject({ method: 'POST', url: '/watch-camera/frames',
  headers: { 'content-type': contentType, 'x-client-key': key }, payload });
beforeEach(async () => {
  vi.resetAllMocks(); device += 1;
  vi.mocked(requireClientDevice).mockResolvedValue({ clientDevice: { id: `device-${device}`, name: 'zero-edge-cam-1' } } as never);
  vi.mocked(prisma.watchCameraFrame.aggregate).mockResolvedValue({ _sum: { byteSize: 0 } } as never);
  vi.mocked(prisma.watchCameraFrame.findMany).mockResolvedValue([]);
  inference.configured.mockReturnValue(true);
  inference.complete.mockResolvedValue({ rawText: '{"person":false}' });
  app = Fastify();
  app.setErrorHandler((error, _request, reply) => {
    reply.code(error instanceof ZodError ? 400 : error.statusCode ?? 500).send({ message: 'error' });
  });
  await app.register(rateLimit, { global: false });
  await registerWatchCameraRoutes(app);
  app.post('/json-control', async (request) => request.body);
});
afterEach(async () => { await app.close(); });

describe('watch camera receiving', () => {
  it('accepts raw JPEG with 202 immediately while inference remains pending', async () => {
    let finish!: (value: { rawText: string }) => void;
    inference.complete.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const response = await post();
    expect(response.statusCode).toBe(202); expect(response.json()).toEqual({ accepted: true });
    expect(requireClientDevice).toHaveBeenCalledWith('camera-key');
    expect(inference.complete).toHaveBeenCalledWith(expect.objectContaining({ imageBytes: jpeg, mimeType: 'image/jpeg',
      maxTokens: 32, temperature: 0, background: true, jsonOutput: true, timeoutMs: 30000 }));
    finish({ rawText: '{"person":false}' }); await new Promise(setImmediate);
  });
  it('requires authentication', async () => {
    vi.mocked(requireClientDevice).mockRejectedValue(new ApiError(401, 'unauthorized'));
    expect((await post()).statusCode).toBe(401);
    expect(inference.complete).not.toHaveBeenCalled();
  });
  it('rejects other device prefixes with 403', async () => {
    vi.mocked(requireClientDevice).mockResolvedValue({ clientDevice: { id: 'other', name: 'zero-edge-other' } } as never);
    expect((await post()).statusCode).toBe(403);
  });
  it.each(['image/jpeg', 'image/png', 'text/plain', 'application/octet-stream'])('rejects non-JPEG as 400 (%s)', async (type) => {
    expect((await post(Buffer.from('invalid'), type)).statusCode).toBe(400);
    expect(inference.complete).not.toHaveBeenCalled();
  });
  it('keeps JSON parsing intact on other routes', async () => {
    const response = await app.inject({ method: 'POST', url: '/json-control', payload: { ok: true } });
    expect(response.json()).toEqual({ ok: true });
    expect((await post(Buffer.from('{"jpeg":true}'), 'application/json')).statusCode).toBe(400);
  });
  it('enforces 300KB and accepts exactly 300KB', async () => {
    const bytes = Buffer.alloc(300 * 1024 + 1); jpeg.copy(bytes);
    expect((await post(bytes)).statusCode).toBe(413);
    expect((await post(bytes.subarray(0, 300 * 1024))).statusCode).toBe(202);
  });
  it('rate limits per key at 12 per minute', async () => {
    for (let n = 0; n < 12; n += 1) expect((await post()).statusCode).toBe(202);
    expect((await post()).statusCode).toBe(429);
    expect((await post(jpeg, 'image/jpeg', 'another-key')).statusCode).toBe(429);
  });
  it('limits an IP even when invalid client keys rotate', async () => {
    vi.mocked(requireClientDevice).mockRejectedValue(new ApiError(401, 'unauthorized'));
    for (let n = 0; n < 12; n += 1) expect((await post(jpeg, 'image/jpeg', `fake-${n}`)).statusCode).toBe(401);
    expect((await post(jpeg, 'image/jpeg', 'fake-next')).statusCode).toBe(429);
    expect(requireClientDevice).toHaveBeenCalledTimes(12);
  });
  it('limits a normalized key across different IPs', async () => {
    for (let n = 0; n < 13; n += 1) {
      const response = await app.inject({ method: 'POST', url: '/watch-camera/frames', remoteAddress: `192.0.2.${n + 1}`,
        headers: { 'content-type': 'image/jpeg', 'x-client-key': n % 2 ? '"camera-key"' : 'camera-key' }, payload: jpeg });
      expect(response.statusCode).toBe(n < 12 ? 202 : 429);
    }
  });

});

describe('watch camera administration', () => {
  it.each(['MANAGER', 'VIEWER'])('rejects %s on list and images', async (role) => {
    for (const url of ['/watch-camera/admin/frames', `/watch-camera/admin/frames/${id}/full`]) {
      expect((await app.inject({ url, headers: authorization(role) })).statusCode).toBe(403);
    }
    expect(prisma.watchCameraFrame.findMany).not.toHaveBeenCalled(); expect(files.read).not.toHaveBeenCalled();
  });
  it('requires authentication on list and images', async () => {
    for (const url of ['/watch-camera/admin/frames', `/watch-camera/admin/frames/${id}/thumb`]) {
      expect((await app.inject({ url })).statusCode).toBe(401);
    }
  });
  it('lists only public fields by descending capture time with JST boundaries', async () => {
    vi.mocked(prisma.watchCameraFrame.findMany).mockResolvedValue([{ id, capturedAt: new Date('2026-10-30T01:00:00Z'),
      judgement: 'person', clientDevice: { name: 'zero-edge-cam-1' } }] as never);
    const response = await app.inject({ url: '/watch-camera/admin/frames?date=2026-10-30', headers: authorization('ADMIN') });
    expect(response.json()).toEqual({ frames: [{ id, capturedAt: '2026-10-30T01:00:00.000Z', judgement: 'person', deviceName: 'zero-edge-cam-1' }] });
    expect(prisma.watchCameraFrame.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 60, orderBy: { capturedAt: 'desc' },
      where: { capturedAt: { gte: new Date('2026-10-29T15:00:00Z'), lt: new Date('2026-10-30T15:00:00Z') } } }));
  });
  it.each(['limit=0', 'limit=101', 'date=2026-02-30'])('rejects invalid query %s', async (query) => {
    expect((await app.inject({ url: `/watch-camera/admin/frames?${query}`, headers: authorization('ADMIN') })).statusCode).toBe(400);
  });
  it.each(['full', 'thumb'])('reads %s with integrity; thumbnail longest side is 160', async (variant) => {
    vi.mocked(prisma.watchCameraFrame.findUnique).mockResolvedValue({ fileKey: 'photos/watch-camera/image.jpg' } as never);
    const image = await sharp({ create: { width: 800, height: 400, channels: 3, background: '#fff' } }).jpeg().toBuffer();
    files.read.mockResolvedValue(image);
    const response = await app.inject({ url: `/watch-camera/admin/frames/${id}/${variant}`, headers: authorization('ADMIN') });
    expect(response.statusCode).toBe(200); expect(response.headers['content-type']).toBe('image/jpeg');
    expect(response.headers['cache-control']).toBe(variant === 'thumb' ? 'private, max-age=86400' : 'private');
    expect(files.read).toHaveBeenCalledWith('photos/watch-camera/image.jpg', { verifyIntegrity: true });
    if (variant === 'thumb') expect(await sharp(response.rawPayload).metadata()).toMatchObject({ width: 160, height: 80 });
    else expect(response.rawPayload).toEqual(image);
  });
  it.each(['full', 'thumb'])('returns 404 when the %s file is missing but the DB row remains', async (variant) => {
    vi.mocked(prisma.watchCameraFrame.findUnique).mockResolvedValue({ fileKey: 'photos/watch-camera/missing.jpg' } as never);
    files.read.mockRejectedValueOnce(Object.assign(new Error('missing'), { code: 'ENOENT' }));
    expect((await app.inject({ url: `/watch-camera/admin/frames/${id}/${variant}`, headers: authorization('ADMIN') })).statusCode).toBe(404);
  });
  it('preserves storage errors other than missing files as 500', async () => {
    vi.mocked(prisma.watchCameraFrame.findUnique).mockResolvedValue({ fileKey: 'photos/watch-camera/image.jpg' } as never);
    files.read.mockRejectedValueOnce(Object.assign(new Error('storage unavailable'), { code: 'EIO' }));
    expect((await app.inject({ url: `/watch-camera/admin/frames/${id}/full`, headers: authorization('ADMIN') })).statusCode).toBe(500);
  });
  it('returns 404 for missing images and 400 for invalid variants', async () => {
    vi.mocked(prisma.watchCameraFrame.findUnique).mockResolvedValue(null);
    expect((await app.inject({ url: `/watch-camera/admin/frames/${id}/full`, headers: authorization('ADMIN') })).statusCode).toBe(404);
    expect((await app.inject({ url: `/watch-camera/admin/frames/${id}/crop`, headers: authorization('ADMIN') })).statusCode).toBe(400);
  });
});

describe('watch camera durable storage and inference', () => {
  it('creates in the isolated namespace and cleans the file on DB failure', async () => {
    const frame = { bytes: jpeg, capturedAt: new Date('2026-10-30T01:00:00Z') };
    expect(await saveWatchCameraFrame('device', frame, 'person')).toBe(true);
    expect(files.writeBatch).toHaveBeenCalledWith([expect.objectContaining({ key: expect.stringMatching(/^photos\/watch-camera\/2026\/10\/30\/[\da-f-]+\.jpg$/),
      mode: 'create', integrity: true, data: jpeg })]);
    expect(prisma.watchCameraFrame.create).toHaveBeenCalledWith({ data: expect.objectContaining({ clientDeviceId: 'device', judgement: 'person', byteSize: jpeg.length, capturedAt: frame.capturedAt }) });
    vi.mocked(prisma.watchCameraFrame.create).mockRejectedValueOnce(new Error('db'));
    await expect(saveWatchCameraFrame('device', frame, 'unjudged')).rejects.toThrow('db');
    expect(files.delete).toHaveBeenCalledWith(files.writeBatch.mock.calls[1][0][0].key, { integrity: true });
  });
  it('does not create a row when writing fails', async () => {
    files.writeBatch.mockRejectedValueOnce(new Error('disk'));
    await expect(saveWatchCameraFrame('device', { bytes: jpeg, capturedAt: new Date() }, 'person')).rejects.toThrow('disk');
    expect(prisma.watchCameraFrame.create).not.toHaveBeenCalled();
  });
  it('treats unconfigured inference and malformed JSON as failures', async () => {
    inference.configured.mockReturnValue(false);
    await expect(judgeWatchCameraFrame(jpeg)).rejects.toThrow('unavailable');
    expect(inference.complete).not.toHaveBeenCalled();
    inference.configured.mockReturnValue(true); inference.complete.mockResolvedValue({ rawText: '{"person":"yes"}' });
    await expect(judgeWatchCameraFrame(jpeg)).rejects.toThrow('Invalid person judgement');
  });
});
