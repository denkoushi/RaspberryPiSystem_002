import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { env } from '../../../config/env.js';
import { prisma } from '../../../lib/prisma.js';
import { deleteSampleSession, labelSampleFrame, listSampleCameras, listSampleFrames, listSampleSessions, readSampleFrame,
  receiveSampleFrame, sampleStartSchema, startSampleSession, stopSampleSession } from '../watch-camera-sample.service.js';

vi.mock('../../../config/env.js', () => ({ env: { WATCH_CAMERA_SAMPLE_MAX_BYTES: 2 * 1024 ** 3 } }));
vi.mock('../../../lib/prisma.js', () => ({ prisma: {
  clientDevice: { findMany: vi.fn(), findUnique: vi.fn() },
  watchCameraSampleSession: { findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn(), findMany: vi.fn(), aggregate: vi.fn(), delete: vi.fn() },
  watchCameraSampleFrame: { findMany: vi.fn(), findUnique: vi.fn(), groupBy: vi.fn(), updateMany: vi.fn() },
} }));
const files = vi.hoisted(() => ({ writeBatch: vi.fn(), delete: vi.fn(), read: vi.fn() }));
vi.mock('../../file-storage/file-storage-runtime.js', () => ({ getFileStorageRuntime: () => ({ store: files }) }));
const sessions = vi.mocked(prisma.watchCameraSampleSession);
const frames = vi.mocked(prisma.watchCameraSampleFrame);
const now = new Date('2026-10-31T00:00:00Z');
const session = { id: 'session', clientDeviceId: 'camera', intervalSec: 10, durationSec: 300, maxFrames: 10,
  status: 'running', startedAt: now, endsAt: new Date(now.getTime() + 300000), endedAt: null, lastCapturedAt: null,
  frameCount: 0, byteSize: 0, createdAt: now } as const;
const input = { clientDeviceId: '9df8a3d0-77bd-40d4-9c05-2cf86f06c734', intervalSec: 10 as const, durationSec: 300 as const, maxFrames: 10 };
const bytes = Buffer.from('jpeg');

beforeEach(() => {
  vi.resetAllMocks(); vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(now);
  env.WATCH_CAMERA_SAMPLE_MAX_BYTES = 2 * 1024 ** 3;
  sessions.findFirst.mockResolvedValue({ ...session });
  sessions.findUnique.mockResolvedValue({ ...session });
  sessions.aggregate.mockResolvedValue({ _sum: { byteSize: 0 } } as never);
  vi.mocked(prisma.clientDevice.findUnique).mockResolvedValue({ name: 'zero-edge-cam-1' } as never);
});
afterEach(() => vi.useRealTimers());

describe('watch camera samples', () => {
  it('does nothing without a running session', async () => {
    sessions.findFirst.mockResolvedValue(null);
    await receiveSampleFrame('camera', bytes);
    expect(files.writeBatch).not.toHaveBeenCalled(); expect(sessions.aggregate).not.toHaveBeenCalled();
  });
  it('thins frames with two seconds of tolerance and writes original bytes atomically with counters', async () => {
    sessions.findFirst.mockResolvedValueOnce({ ...session, lastCapturedAt: new Date(now.getTime() - 7999) });
    await receiveSampleFrame('camera', bytes);
    expect(files.writeBatch).not.toHaveBeenCalled();
    sessions.findFirst.mockResolvedValueOnce({ ...session, lastCapturedAt: new Date(now.getTime() - 8000) });
    await receiveSampleFrame('camera', bytes);
    expect(files.writeBatch).toHaveBeenCalledWith([expect.objectContaining({ key: expect.stringMatching(/^photos\/watch-camera-samples\/session\/[\da-f-]+\.jpg$/), data: bytes, mode: 'create', integrity: true })]);
    expect(sessions.update).toHaveBeenCalledWith({ where: { id: 'session' }, data: expect.objectContaining({
      frames: { create: expect.objectContaining({ byteSize: 4, capturedAt: now }) }, frameCount: { increment: 1 }, byteSize: { increment: 4 }, lastCapturedAt: now,
    }) });
  });
  it('completes at the frame limit after saving the last frame', async () => {
    sessions.findFirst.mockResolvedValue({ ...session, frameCount: 9 });
    await receiveSampleFrame('camera', bytes);
    expect(sessions.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'completed', endedAt: now, frameCount: { increment: 1 } }) }));
  });
  it.each([{ endsAt: now }, { frameCount: 10 }])('completes without saving at an existing boundary %s', async (change) => {
    sessions.findFirst.mockResolvedValue({ ...session, ...change });
    await receiveSampleFrame('camera', bytes);
    expect(sessions.update).toHaveBeenCalledWith({ where: { id: 'session' }, data: { status: 'completed', endedAt: now } });
    expect(files.writeBatch).not.toHaveBeenCalled();
  });
  it('checks total sample capacity across sessions and stops before overflowing Int', async () => {
    sessions.aggregate.mockResolvedValueOnce({ _sum: { byteSize: env.WATCH_CAMERA_SAMPLE_MAX_BYTES - 3 } } as never);
    await receiveSampleFrame('camera', bytes);
    sessions.findFirst.mockResolvedValueOnce({ ...session, byteSize: 2147483646 });
    await receiveSampleFrame('camera', bytes);
    expect(files.writeBatch).not.toHaveBeenCalled(); expect(sessions.update).toHaveBeenCalledTimes(2);
  });
  it('drops overlapping receives for the same camera', async () => {
    let finish!: () => void;
    files.writeBatch.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));
    const first = receiveSampleFrame('camera', bytes);
    await vi.waitFor(() => expect(files.writeBatch).toHaveBeenCalledTimes(1));
    await receiveSampleFrame('camera', bytes);
    expect(sessions.findFirst).toHaveBeenCalledTimes(1);
    finish(); await first;
  });
  it('serializes capacity checks across cameras', async () => {
    let finish!: () => void;
    files.writeBatch.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));
    const first = receiveSampleFrame('camera', bytes);
    await vi.waitFor(() => expect(files.writeBatch).toHaveBeenCalledTimes(1));
    const second = receiveSampleFrame('camera-2', bytes);
    expect(sessions.aggregate).toHaveBeenCalledTimes(1);
    sessions.aggregate.mockResolvedValueOnce({ _sum: { byteSize: env.WATCH_CAMERA_SAMPLE_MAX_BYTES } } as never);
    finish(); await Promise.all([first, second]);
    expect(files.writeBatch).toHaveBeenCalledTimes(1);
  });
  it('cleans the written file on DB failure and releases the receive flag', async () => {
    sessions.update.mockRejectedValueOnce(new Error('db'));
    await expect(receiveSampleFrame('camera', bytes)).rejects.toThrow('db');
    expect(files.delete).toHaveBeenCalledWith(files.writeBatch.mock.calls[0][0][0].key, { integrity: true });
    await receiveSampleFrame('camera', bytes);
    expect(files.writeBatch).toHaveBeenCalledTimes(2);
  });
  it('does not update DB when storage fails', async () => {
    files.writeBatch.mockRejectedValueOnce(new Error('disk'));
    await expect(receiveSampleFrame('camera', bytes)).rejects.toThrow('disk');
    expect(sessions.update).not.toHaveBeenCalled();
  });
  it('rejects duplicate starts, including database uniqueness conflicts', async () => {
    await expect(startSampleSession(input)).rejects.toMatchObject({ statusCode: 409 });
    expect(sessions.create).not.toHaveBeenCalled();
    sessions.findFirst.mockResolvedValueOnce(null);
    sessions.create.mockRejectedValueOnce({ code: 'P2002' });
    await expect(startSampleSession(input)).rejects.toMatchObject({ statusCode: 409 });
  });
  it('serializes simultaneous starts for one camera', async () => {
    sessions.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ ...session });
    sessions.create.mockResolvedValueOnce({ ...session });
    const results = await Promise.allSettled([startSampleSession(input), startSampleSession(input)]);
    expect(results[0].status).toBe('fulfilled');
    expect(results[1]).toMatchObject({ status: 'rejected', reason: { statusCode: 409 } });
    expect(sessions.create).toHaveBeenCalledTimes(1);
  });
  it('starts only camera devices and calculates endsAt', async () => {
    sessions.findFirst.mockResolvedValueOnce(null);
    await startSampleSession(input);
    expect(sessions.create).toHaveBeenCalledWith({ data: { ...input, status: 'running', startedAt: now, endsAt: session.endsAt } });
    vi.mocked(prisma.clientDevice.findUnique).mockResolvedValueOnce({ name: 'kiosk-1' } as never);
    await expect(startSampleSession(input)).rejects.toMatchObject({ statusCode: 400 });
  });
  it.each([{ intervalSec: 20 }, { durationSec: 60 }, { maxFrames: 9 }, { maxFrames: 20001 }, { maxFrames: 10.5 }])('validates start options %s', (change) => {
    expect(sampleStartSchema.safeParse({ ...input, ...change }).success).toBe(false);
  });
  it('stops running sessions without changing completed sessions', async () => {
    await stopSampleSession('session');
    expect(sessions.update).toHaveBeenCalledWith({ where: { id: 'session' }, data: { status: 'stopped', endedAt: now } });
    sessions.findUnique.mockResolvedValueOnce({ ...session, status: 'completed' });
    await stopSampleSession('session');
    expect(sessions.update).toHaveBeenCalledTimes(1);
  });
  it('expires sessions on listing and returns label counts and public fields', async () => {
    sessions.findMany.mockResolvedValueOnce([{ ...session, clientDevice: { name: 'zero-edge-cam-1' } }] as never);
    frames.groupBy.mockResolvedValueOnce([{ sessionId: 'session', label: 'ok', _count: { _all: 2 } }, { sessionId: 'session', label: null, _count: { _all: 3 } }] as never);
    expect(await listSampleSessions('camera')).toEqual([expect.objectContaining({ deviceName: 'zero-edge-cam-1', counts: { ok: 2, ng: 0, later: 0, none: 3 } })]);
    expect(sessions.updateMany).toHaveBeenCalledWith({ where: { clientDeviceId: 'camera', status: 'running', endsAt: { lte: now } }, data: { status: 'completed', endedAt: now } });
    expect(sessions.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 20, orderBy: { startedAt: 'desc' } }));
  });
  it('filters labels including unselected frames', async () => {
    await listSampleFrames('session', { label: 'none', limit: 60 });
    expect(frames.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { sessionId: 'session', label: null }, take: 60, orderBy: { capturedAt: 'desc' } }));
    frames.updateMany.mockResolvedValueOnce({ count: 1 });
    await labelSampleFrame('frame', null);
    expect(frames.updateMany).toHaveBeenCalledWith({ where: { id: 'frame' }, data: { label: null } });
  });
  it('lists only camera names without keys', async () => {
    await listSampleCameras();
    expect(prisma.clientDevice.findMany).toHaveBeenCalledWith({ where: { name: { startsWith: 'zero-edge-cam-' } }, select: { id: true, name: true, location: true }, orderBy: { name: 'asc' } });
  });
  it('reads original images with integrity and handles missing files', async () => {
    frames.findUnique.mockResolvedValue({ fileKey: 'photos/watch-camera-samples/session/frame.jpg' } as never);
    files.read.mockResolvedValueOnce(bytes);
    expect(await readSampleFrame('frame', 'full')).toEqual(bytes);
    expect(files.read).toHaveBeenCalledWith('photos/watch-camera-samples/session/frame.jpg', { verifyIntegrity: true });
    files.read.mockRejectedValueOnce({ code: 'ENOENT' });
    await expect(readSampleFrame('frame', 'full')).rejects.toMatchObject({ statusCode: 404 });
  });
  it('stops before deleting files and keeps all rows if file deletion fails', async () => {
    frames.findMany.mockResolvedValueOnce([{ fileKey: 'a' }, { fileKey: 'b' }] as never);
    files.delete.mockResolvedValueOnce(undefined).mockRejectedValueOnce({ code: 'EIO' });
    await expect(deleteSampleSession('session')).rejects.toMatchObject({ statusCode: 500 });
    expect(sessions.update.mock.invocationCallOrder[0]).toBeLessThan(files.delete.mock.invocationCallOrder[0]);
    expect(sessions.delete).not.toHaveBeenCalled();
  });
  it('allows retry after missing files and deletes session rows last', async () => {
    frames.findMany.mockResolvedValueOnce([{ fileKey: 'a' }] as never);
    files.delete.mockRejectedValueOnce({ code: 'ENOENT' });
    await deleteSampleSession('session');
    expect(sessions.delete).toHaveBeenCalledWith({ where: { id: 'session' } });
    expect(files.delete.mock.invocationCallOrder[0]).toBeLessThan(sessions.delete.mock.invocationCallOrder[0]);
  });
});
