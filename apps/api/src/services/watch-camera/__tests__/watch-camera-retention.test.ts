import { beforeEach, describe, expect, it, vi } from 'vitest';

import { logger } from '../../../lib/logger.js';
import { prisma } from '../../../lib/prisma.js';
import { pruneWatchCameraFrames } from '../watch-camera-retention.js';
import { WatchCameraRetentionScheduler } from '../watch-camera-retention.scheduler.js';

vi.mock('../../../config/env.js', () => ({ env: { WATCH_CAMERA_RETENTION_DAYS: 30 } }));
vi.mock('../../../lib/logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn() } }));
vi.mock('../../../lib/prisma.js', () => ({ prisma: { watchCameraFrame: { findMany: vi.fn(), deleteMany: vi.fn() } } }));
const files = vi.hoisted(() => ({ delete: vi.fn() }));
const cron = vi.hoisted(() => ({ schedule: vi.fn(), stop: vi.fn() }));
vi.mock('../../file-storage/file-storage-runtime.js', () => ({ getFileStorageRuntime: () => ({ store: files }) }));
vi.mock('node-cron', () => ({ default: { schedule: cron.schedule } }));

beforeEach(() => {
  vi.resetAllMocks(); cron.schedule.mockReturnValue({ stop: cron.stop });
  vi.mocked(prisma.watchCameraFrame.deleteMany).mockResolvedValue({ count: 1 });
});

describe('watch camera retention', () => {
  it('deletes files before rows, including missing files, in batches of 200', async () => {
    const rows = Array.from({ length: 200 }, (_, index) => ({ id: String(index), fileKey: `photos/watch-camera/${index}` }));
    vi.mocked(prisma.watchCameraFrame.findMany).mockResolvedValueOnce(rows as never).mockResolvedValueOnce([]);
    files.delete.mockRejectedValueOnce(Object.assign(new Error('missing'), { code: 'ENOENT' }));
    expect(await pruneWatchCameraFrames(new Date('2026-10-30T00:00:00Z'))).toEqual({ deleted: 200, failed: 0 });
    expect(prisma.watchCameraFrame.findMany).toHaveBeenCalledTimes(2);
    expect(prisma.watchCameraFrame.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 200,
      where: { capturedAt: { lt: new Date('2026-09-30T00:00:00Z') } } }));
    expect(files.delete).toHaveBeenCalledWith(rows[0].fileKey, { integrity: true });
    expect(files.delete.mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(prisma.watchCameraFrame.deleteMany).mock.invocationCallOrder[0]);
  });
  it('continues past a failed file, excludes it from later batches, and retries next run', async () => {
    const rows = Array.from({ length: 201 }, (_, index) => ({ id: String(index), fileKey: `private-key/${index}` }));
    vi.mocked(prisma.watchCameraFrame.findMany)
      .mockResolvedValueOnce(rows.slice(0, 200) as never).mockResolvedValueOnce(rows.slice(200) as never);
    files.delete.mockRejectedValueOnce(new TypeError('private-key/image-data'));
    expect(await pruneWatchCameraFrames()).toEqual({ deleted: 200, failed: 1 });
    expect(prisma.watchCameraFrame.deleteMany).toHaveBeenCalledTimes(200);
    expect(prisma.watchCameraFrame.deleteMany).not.toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: '0' }) }));
    expect(prisma.watchCameraFrame.findMany).toHaveBeenNthCalledWith(2, expect.objectContaining({
      where: expect.objectContaining({ id: { notIn: ['0'] } }),
    }));
    expect(logger.warn).toHaveBeenCalledExactlyOnceWith({ errorName: 'TypeError', failed: 1 }, 'Watch camera file deletion failed');
    vi.mocked(prisma.watchCameraFrame.findMany).mockResolvedValueOnce([rows[0]] as never);
    expect(await pruneWatchCameraFrames()).toEqual({ deleted: 1, failed: 0 });
  });
  it('schedules 03:40 JST once and waits for active cleanup on stop', async () => {
    let finish!: () => void;
    const run = vi.fn(() => new Promise<{ deleted: number; failed: number }>((resolve) => { finish = () => resolve({ deleted: 1, failed: 0 }); }));
    const scheduler = new WatchCameraRetentionScheduler(run);
    scheduler.start(); scheduler.start();
    expect(cron.schedule).toHaveBeenCalledExactlyOnceWith('40 3 * * *', expect.any(Function), { timezone: 'Asia/Tokyo' });
    const pending = scheduler.runTick(); await scheduler.runTick();
    let stopped = false;
    const stop = scheduler.stop().then(() => { stopped = true; });
    expect(stopped).toBe(false); expect(run).toHaveBeenCalledTimes(1);
    finish(); await pending; await stop;
    expect(stopped).toBe(true); expect(cron.stop).toHaveBeenCalledTimes(1);
  });
});
