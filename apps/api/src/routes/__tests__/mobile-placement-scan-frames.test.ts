import { Prisma } from '@prisma/client';
import Fastify from 'fastify';
import jwt from 'jsonwebtoken';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ZodError } from 'zod';

import { ApiError } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import { FileStorageCapacityExhaustedError } from '../../services/file-storage/file-storage-errors.js';
import { requireClientDevice } from '../kiosk/shared.js';
import { registerMobileScanFrameRoutes } from '../mobile-placement/scan-frames.js';

vi.mock('../../config/env/load-dotenv.js', () => ({}));
vi.mock('../../config/env.js', () => ({ env: { JWT_ACCESS_SECRET: 'scan-frame-test-signing-key', ADMIN_MFA_REQUIRED: false } }));
vi.mock('../kiosk/shared.js', () => ({ requireClientDevice: vi.fn() }));
vi.mock('../../lib/prisma.js', () => ({ prisma: {
  mobileScanFrame: { findUnique: vi.fn(), create: vi.fn(), findMany: vi.fn() },
  orderPlacementEvent: { findUnique: vi.fn() }
} }));
const files = vi.hoisted(() => ({ writeBatch: vi.fn(), read: vi.fn(), delete: vi.fn() }));
vi.mock('../../services/file-storage/file-storage-runtime.js', () => ({ getFileStorageRuntime: () => ({ store: files }) }));

let app: ReturnType<typeof Fastify>;
const frameId = '9df8a3d0-77bd-40d4-9c05-2cf86f06c734';
const placementId = '7df8a3d0-77bd-40d4-9c05-2cf86f06c734';
const jpeg = (size = 5) => { const bytes = Buffer.alloc(size); bytes.set([0xff, 0xd8, 0xff]); return bytes.toString('base64'); };
const body = () => ({ clientFrameId: frameId, kind: 'scan_frame', outcome: 'decoded', decodedValue: '001', decodeMs: 100, retryCount: 0,
  engine: 'native', camera: { width: 1280 }, cropBox: null, capturedAt: '2026-10-29T03:00:00.000Z', fullJpeg: jpeg() });
const post = (payload: object) => app.inject({ method: 'POST', url: '/mobile-placement/scan-frames', headers: { 'x-client-key': 'device-test-key' }, payload });
const authorization = (role: string) => ({ authorization: `Bearer ${jwt.sign({ sub: 'user', username: 'test', role }, 'scan-frame-test-signing-key')}` });
beforeEach(async () => {
  vi.resetAllMocks();
  vi.mocked(requireClientDevice).mockResolvedValue({ clientDevice: { id: 'device' } } as never);
  vi.mocked(prisma.mobileScanFrame.create).mockResolvedValue({ id: frameId } as never);
  vi.mocked(prisma.mobileScanFrame.findMany).mockResolvedValue([]);
  app = Fastify();
  app.setErrorHandler((error, _request, reply) => {
    reply.code(error instanceof ZodError ? 400 : error.statusCode ?? 500).send({ message: error.message });
  });
  await registerMobileScanFrameRoutes(app);
});
afterEach(async () => { await app.close(); });

describe('mobile scan frame POST', () => {
  it('saves JPEGs with integrity and links a placement by clientRecordId', async () => {
    vi.mocked(prisma.orderPlacementEvent.findUnique).mockResolvedValue({ id: 'event', clientDeviceId: 'device' } as never);
    const response = await post({ ...body(), kind: 'placement_photo', clientRecordId: placementId, shelfCodeRaw: '北-1', slipKind: 'manufacturing_order', cropJpeg: jpeg() });
    expect(response.statusCode).toBe(201);
    expect(requireClientDevice).toHaveBeenCalledWith('device-test-key');
    expect(prisma.orderPlacementEvent.findUnique).toHaveBeenCalledWith({ where: { clientRecordId: placementId } });
    expect(prisma.mobileScanFrame.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ orderPlacementEventId: 'event', clientDeviceId: 'device', fullBytes: 5, cropBytes: 5 }) }));
    expect(files.writeBatch.mock.calls[0][0]).toEqual([
      expect.objectContaining({ key: expect.stringMatching(/^photos\/mobile-scan-frames\/2026\/10\/[\da-f-]+-full.jpg$/), integrity: true, mode: 'create' }),
      expect.objectContaining({ key: expect.stringMatching(/-crop.jpg$/), integrity: true })
    ]);
  });
  it('rejects a cancelled placement with 422 without saving photos', async () => {
    vi.mocked(prisma.orderPlacementEvent.findUnique).mockResolvedValue(null);
    const response = await post({ ...body(), kind: 'placement_photo', clientRecordId: placementId, shelfCodeRaw: '北-1' });
    expect(response.statusCode).toBe(422);
    expect(files.writeBatch).not.toHaveBeenCalled();
    expect(prisma.mobileScanFrame.create).not.toHaveBeenCalled();
  });
  it('saves scan frames without a crop or placement', async () => {
    expect((await post(body())).statusCode).toBe(201);
    expect(files.writeBatch.mock.calls[0][0]).toHaveLength(1);
    expect(prisma.orderPlacementEvent.findUnique).not.toHaveBeenCalled();
  });
  it('returns 409 without writing files for an already saved clientFrameId', async () => {
    vi.mocked(prisma.mobileScanFrame.findUnique).mockResolvedValue({ id: frameId } as never);
    expect((await post(body())).statusCode).toBe(409);
    expect(files.writeBatch).not.toHaveBeenCalled();
  });
  it('handles a concurrent duplicate with 409 and cleans only its own files', async () => {
    vi.mocked(prisma.mobileScanFrame.create).mockRejectedValue(new Prisma.PrismaClientKnownRequestError('duplicate', { code: 'P2002', clientVersion: '7' }));
    expect((await post(body())).statusCode).toBe(409);
    expect(files.delete).toHaveBeenCalledWith(files.writeBatch.mock.calls[0][0][0].key, { integrity: true });
  });
  it.each(['aGVsbG8=', '/9j/==', ''])('rejects invalid JPEG/base64 %s with 400', async (fullJpeg) => {
    expect((await post({ ...body(), fullJpeg })).statusCode).toBe(400);
    expect(files.writeBatch).not.toHaveBeenCalled();
  });
  it.each([{ fullJpeg: jpeg(600 * 1024 + 1) }, { cropJpeg: jpeg(300 * 1024 + 1) }])('rejects oversized image with 413', async (oversize) => {
    expect((await post({ ...body(), ...oversize })).statusCode).toBe(413);
    expect(files.writeBatch).not.toHaveBeenCalled();
  });
  it('accepts exact JPEG byte limits', async () => {
    expect((await post({ ...body(), fullJpeg: jpeg(600 * 1024), cropJpeg: jpeg(300 * 1024) })).statusCode).toBe(201);
  });
  it('enforces the 1.5MB request body limit', async () => {
    expect((await post({ ...body(), fullJpeg: 'a'.repeat(1.5 * 1024 * 1024) })).statusCode).toBe(413);
  });
  it.each([{ kind: 'placement_photo' }, { kind: 'placement_photo', clientRecordId: placementId }, { kind: 'placement_photo', shelfCodeRaw: '北-1' }])('requires placement ID and shelf %j', async (missing) => {
    expect((await post({ ...body(), ...missing })).statusCode).toBe(400);
    expect(files.writeBatch).not.toHaveBeenCalled();
  });
  it('returns 507 from durable store capacity protection without creating a row', async () => {
    files.writeBatch.mockRejectedValue(new FileStorageCapacityExhaustedError());
    expect((await post(body())).statusCode).toBe(507);
    expect(prisma.mobileScanFrame.create).not.toHaveBeenCalled();
  });
  it('requires a valid client key', async () => {
    vi.mocked(requireClientDevice).mockRejectedValue(new ApiError(401, 'unauthorized'));
    expect((await post(body())).statusCode).toBe(401);
    expect(files.writeBatch).not.toHaveBeenCalled();
  });
  it('does not link another device placement', async () => {
    vi.mocked(prisma.orderPlacementEvent.findUnique).mockResolvedValue({ id: 'other', clientDeviceId: 'other-device' } as never);
    expect((await post({ ...body(), kind: 'placement_photo', clientRecordId: placementId, shelfCodeRaw: '北-1' })).statusCode).toBe(400);
  });
});

describe('placement photo administration', () => {
  it.each(['MANAGER', 'VIEWER'])('rejects %s for both list and image', async (role) => {
    for (const url of ['/mobile-placement/admin/placement-photos', `/mobile-placement/admin/scan-frames/${frameId}/full`]) {
      expect((await app.inject({ method: 'GET', url, headers: authorization(role) })).statusCode).toBe(403);
    }
    expect(files.read).not.toHaveBeenCalled();
    expect(prisma.mobileScanFrame.findMany).not.toHaveBeenCalled();
  });
  it('filters placement photos using Tokyo date boundaries and a default limit of 50', async () => {
    const response = await app.inject({ method: 'GET', url: '/mobile-placement/admin/placement-photos?q=001&shelf=A&date=2026-10-29', headers: authorization('ADMIN') });
    expect(response.statusCode).toBe(200);
    expect(prisma.mobileScanFrame.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 50, where: expect.objectContaining({ kind: 'placement_photo', shelfCodeRaw: 'A', AND: expect.arrayContaining([
      expect.objectContaining({ OR: expect.arrayContaining([{ orderPlacementEvent: { placedAt: { gte: new Date('2026-10-28T15:00:00Z'), lt: new Date('2026-10-29T15:00:00Z') } } }]) })
    ]) }) }));
  });
  it('returns display fields without exposing file keys', async () => {
    vi.mocked(prisma.mobileScanFrame.findMany).mockResolvedValue([{ id: frameId, cropKey: 'crop', clientDevice: { name: 'スマホ' }, orderPlacementEvent: { manufacturingOrderBarcodeRaw: '001', branchNo: 2, placedAt: new Date('2026-10-29T03:00:00Z') } }] as never);
    const response = await app.inject({ method: 'GET', url: '/mobile-placement/admin/placement-photos', headers: authorization('ADMIN') });
    expect(response.json().photos[0]).toMatchObject({ number: '001', branchNo: 2, hasCrop: true, deviceName: 'スマホ' });
    expect(response.json().photos[0].fullKey).toBeUndefined();
  });
  it.each(['full', 'crop'])('serves %s privately with integrity verification', async (variant) => {
    vi.mocked(prisma.mobileScanFrame.findUnique).mockResolvedValue({ fullKey: 'full', cropKey: 'crop' } as never);
    files.read.mockResolvedValue(Buffer.from(jpeg(), 'base64'));
    const response = await app.inject({ method: 'GET', url: `/mobile-placement/admin/scan-frames/${frameId}/${variant}`, headers: authorization('ADMIN') });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toBe('image/jpeg');
    expect(response.headers['cache-control']).toBe('private');
    expect(files.read).toHaveBeenCalledWith(variant, { verifyIntegrity: true });
  });
  it.each(['full-thumb', 'crop-thumb'])('resizes %s to a private cached JPEG without saving it', async (variant) => {
    vi.mocked(prisma.mobileScanFrame.findUnique).mockResolvedValue({ fullKey: 'full', cropKey: 'crop' } as never);
    const portrait = variant === 'crop-thumb';
    files.read.mockResolvedValue(await sharp({ create: { width: portrait ? 400 : 800, height: portrait ? 800 : 400, channels: 3, background: '#fff' } }).jpeg().toBuffer());
    const response = await app.inject({ method: 'GET', url: `/mobile-placement/admin/scan-frames/${frameId}/${variant}`, headers: authorization('ADMIN') });
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('private, max-age=86400');
    expect(response.headers['content-type']).toBe('image/jpeg');
    expect(await sharp(response.rawPayload).metadata()).toMatchObject({ format: 'jpeg', width: portrait ? 80 : 160, height: portrait ? 160 : 80 });
    expect(files.read).toHaveBeenCalledWith(portrait ? 'crop' : 'full', { verifyIntegrity: true });
    expect(files.writeBatch).not.toHaveBeenCalled();
  });
  it('returns 404 for absent crop', async () => {
    vi.mocked(prisma.mobileScanFrame.findUnique).mockResolvedValue({ fullKey: 'full', cropKey: null } as never);
    expect((await app.inject({ method: 'GET', url: `/mobile-placement/admin/scan-frames/${frameId}/crop`, headers: authorization('ADMIN') })).statusCode).toBe(404);
  });
});
