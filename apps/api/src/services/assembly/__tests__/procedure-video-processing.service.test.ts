import { access, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ProcedureVideoProcessingService } from '../procedure-video-processing.service.js';
import { ProcedureVideoTranscodeError } from '../procedure-video-transcoder.port.js';

type VideoRow = { id: string; status: string; attempts: number; sourceStorageKey: string | null; discardedAt: null; updatedAt: Date; storageKey?: string | null; posterStorageKey?: string | null; trimRequest?: { startSeconds: number; endSeconds: number; requestedAt: string } | null; sourceDurationSeconds?: number | null };
function harness() {
  const row: VideoRow = { id: 'video', status: 'PENDING', attempts: 0, sourceStorageKey: 'procedure-videos/incoming/hash/original', discardedAt: null, updatedAt: new Date() };
  const rows = [row];
  const states: string[] = [];
  const events: string[] = [];
  let inTransaction = false;
  const update = vi.fn(async ({ where, data }) => {
    const target = rows.find((video) => video.id === where.id)!;
    Object.assign(target, data);
    states.push(target.status);
    events.push(data.status === 'READY' ? 'READY commit' : 'clear reference');
    return target;
  });
  const db = { procedureVideo: {
    findFirst: vi.fn(async () => {
      const pending = rows.find((video) => video.status === 'PENDING');
      return pending ? { ...pending } : null;
    }),
    findUnique: vi.fn(async ({ where }) => { const video = rows.find((video) => video.id === where.id); return video ? { ...video } : null; }),
    findMany: vi.fn(async () => rows.filter((video) => video.status === 'READY' && video.sourceStorageKey).map((video) => ({ ...video }))),
    updateMany: vi.fn(async ({ where, data }) => {
      const matches = rows.filter((video) => video.status === where.status && (!where.id || video.id === where.id) && (!where.updatedAt || (where.updatedAt instanceof Date ? video.updatedAt.getTime() === where.updatedAt.getTime() : video.updatedAt < where.updatedAt.lt)));
      for (const video of matches) { Object.assign(video, data); states.push(video.status); }
      return { count: matches.length };
    }), update,
  }, $transaction: vi.fn() };
  const tx = { $queryRaw: vi.fn().mockResolvedValue([]), procedureVideo: {
    findUnique: vi.fn(async ({ where }) => rows.find((video) => video.id === where.id)),
    count: vi.fn(async ({ where }) => rows.filter((video) => 'storageKey' in where ? video.storageKey === where.storageKey : video.sourceStorageKey === where.sourceStorageKey).length),
    update: vi.fn(async (args) => { expect(inTransaction).toBe(true); return update(args); }),
  }, procedureVideoComment: { findMany: vi.fn().mockResolvedValue([]), deleteMany: vi.fn(), createMany: vi.fn() } };
  db.$transaction.mockImplementation(async (work) => {
    const snapshots = rows.map((video) => ({ ...video }));
    inTransaction = true;
    try {
      const result = await work(tx);
      if (rows.some((video, index) => video.sourceStorageKey !== snapshots[index].sourceStorageKey)) events.push('cleanup commit');
      return result;
    } catch (error) {
      rows.forEach((video, index) => Object.assign(video, snapshots[index]));
      throw error;
    } finally { inTransaction = false; }
  });
  const store = { read: vi.fn().mockResolvedValue(Buffer.from('original')), write: vi.fn(), delete: vi.fn(async (key) => {
    expect(inTransaction).toBe(!key.includes('/incoming/'));
    events.push('delete');
  }) };
  const transcoder = { probe: vi.fn().mockResolvedValue({ durationSeconds: 12, width: 640, height: 360 }), transcode: vi.fn(async (input, output, poster) => {
    expect(inTransaction).toBe(false);
    expect(await readFile(input, 'utf8')).toBe('original');
    await writeFile(output, 'converted'); await writeFile(poster, 'poster');
  }), trim: vi.fn(async (input, output, poster) => {
    expect(inTransaction).toBe(false);
    expect(await readFile(input, 'utf8')).toBe('original');
    await writeFile(output, 'trimmed'); await writeFile(poster, 'trim-poster');
  }) };
  return { row, rows, states, events, db, tx, store, transcoder, service: new ProcedureVideoProcessingService(transcoder, db as never, store as never) };
}

describe('procedure-video processing', () => {
  afterEach(() => vi.restoreAllMocks());
  it('claims PENDING, converts outside a transaction, commits READY and clears the last reference before deletion', async () => {
    const h = harness();
    h.db.procedureVideo.update.mockImplementationOnce(async ({ data }) => {
      expect(data).not.toHaveProperty('sourceStorageKey');
      expect(h.db.$transaction).toHaveBeenCalledOnce();
      Object.assign(h.row, data); h.states.push(h.row.status); h.events.push('READY commit');
      return h.row;
    });
    await h.service.runOnce();
    expect(h.states).toEqual(['PROCESSING', 'READY', 'READY']);
    expect(h.events).toEqual(['READY commit', 'clear reference', 'cleanup commit', 'delete']);
    expect(h.row).toMatchObject({ status: 'READY', sourceStorageKey: null, attempts: 0, durationSeconds: 12, sourceDurationSeconds: 12, width: 640, height: 360 });
    expect(h.store.write.mock.calls.map(([request]) => request.key)).toEqual([expect.stringMatching(/procedure-videos\/[a-f0-9]{64}\/video.mp4/), expect.stringMatching(/procedure-videos\/[a-f0-9]{64}\/poster.jpg/)]);
    expect(h.store.delete).toHaveBeenCalledWith('procedure-videos/incoming/hash/original', { integrity: true });
    expect(h.tx.$queryRaw.mock.calls[1]).toEqual([expect.arrayContaining(['SELECT pg_advisory_xact_lock(hashtext(', '))']), 'procedure-videos/incoming/hash/original']);
    expect(h.tx.procedureVideo.update).toHaveBeenCalledWith({ where: { id: 'video' }, data: { sourceStorageKey: null } });
    expect(h.db.procedureVideo.findFirst).toHaveBeenCalledWith({ where: { status: 'PENDING', discardedAt: null }, orderBy: [{ receivedAt: 'asc' }, { id: 'asc' }] });
    expect(h.db.procedureVideo.updateMany).toHaveBeenLastCalledWith({ where: { id: 'video', status: 'PENDING', updatedAt: h.row.updatedAt, discardedAt: null }, data: { status: 'PROCESSING' } });
  });
  it('keeps a shared original for the second row and deletes it only after both rows are READY', async () => {
    const h = harness(); h.rows.push({ ...h.row, id: 'second' });
    await h.service.runOnce();
    expect(h.row).toMatchObject({ status: 'READY', sourceStorageKey: null });
    expect(h.rows[1]).toMatchObject({ status: 'PENDING', sourceStorageKey: 'procedure-videos/incoming/hash/original' });
    expect(h.store.delete).not.toHaveBeenCalled();
    await h.service.runOnce();
    expect(h.rows[1]).toMatchObject({ status: 'READY', sourceStorageKey: null });
    expect(h.store.delete).toHaveBeenCalledOnce();
  });
  it('keeps READY when deleting an original fails after both commits', async () => {
    const h = harness(); h.store.delete.mockImplementation(async () => {
      expect(h.events).toEqual(['READY commit', 'clear reference', 'cleanup commit']);
      expect(h.row.status).toBe('READY');
      throw new Error('disk failure');
    });
    await h.service.runOnce();
    expect(h.row).toMatchObject({ status: 'READY', sourceStorageKey: null, attempts: 0 });
    expect(h.states).toEqual(['PROCESSING', 'READY', 'READY']);
  });
  it('recovers READY originals on the next run after a cleanup transaction fails', async () => {
    const h = harness(); h.tx.procedureVideo.update.mockImplementationOnce(async (args) => h.db.procedureVideo.update(args)).mockRejectedValueOnce(new Error('database failure'));
    await h.service.runOnce();
    expect(h.row).toMatchObject({ status: 'READY', sourceStorageKey: 'procedure-videos/incoming/hash/original', attempts: 0 });
    expect(h.store.delete).not.toHaveBeenCalled();
    await h.service.runOnce();
    expect(h.row).toMatchObject({ status: 'READY', sourceStorageKey: null });
    expect(h.store.delete).toHaveBeenCalledOnce();
    expect(h.transcoder.transcode).toHaveBeenCalledOnce();
  });
  it('never removes an original when the READY update fails', async () => {
    const h = harness(); h.db.procedureVideo.update.mockRejectedValueOnce(new Error('commit failure'));
    await h.service.runOnce();
    expect(h.row).toMatchObject({ status: 'PENDING', sourceStorageKey: 'procedure-videos/incoming/hash/original', attempts: 1 });
    expect(h.db.$transaction).toHaveBeenCalledOnce(); expect(h.store.delete).not.toHaveBeenCalled();
  });
  it('does not clear or delete a reference changed before the cleanup lock was acquired', async () => {
    const h = harness(); h.row.status = 'READY';
    h.tx.procedureVideo.findUnique.mockResolvedValue({ ...h.row, sourceStorageKey: 'another-original' });
    await h.service.runOnce();
    expect(h.tx.procedureVideo.count).not.toHaveBeenCalled();
    expect(h.tx.procedureVideo.update).not.toHaveBeenCalled(); expect(h.store.delete).not.toHaveBeenCalled();
  });
  it('fails TOO_LONG immediately without converting or removing the source', async () => {
    const h = harness(); h.transcoder.probe.mockResolvedValue({ durationSeconds: 60.01, width: 1920, height: 1080 });
    await h.service.runOnce();
    expect(h.row).toMatchObject({ status: 'FAILED', attempts: 1, errorCode: 'TOO_LONG' });
    expect(h.transcoder.transcode).not.toHaveBeenCalled(); expect(h.store.delete).not.toHaveBeenCalled();
  });
  it('accepts exactly 60 seconds', async () => {
    const h = harness(); h.transcoder.probe.mockResolvedValue({ durationSeconds: 60, width: 640, height: 360 });
    await h.service.runOnce(); expect(h.row.status).toBe('READY');
  });
  it('returns to PENDING for three failures and fails on the fourth', async () => {
    const h = harness(); h.transcoder.transcode.mockRejectedValue(new Error('transient'));
    for (let attempt = 1; attempt <= 4; attempt++) {
      await h.service.runOnce();
      expect(h.row).toMatchObject({ attempts: attempt, status: attempt <= 3 ? 'PENDING' : 'FAILED' });
    }
    await h.service.runOnce(); expect(h.transcoder.transcode).toHaveBeenCalledTimes(4);
  });
  it('retries TRANSCODE_TIMEOUT and removes the temporary directory including partial output', async () => {
    const h = harness(); let directory = '';
    h.transcoder.transcode.mockImplementation(async (input, output) => {
      directory = path.dirname(input);
      await writeFile(output, 'partial');
      throw new ProcedureVideoTranscodeError('TRANSCODE_TIMEOUT', 'timeout');
    });
    await h.service.runOnce();
    expect(h.row).toMatchObject({ status: 'PENDING', attempts: 1, errorCode: 'TRANSCODE_TIMEOUT' });
    await expect(access(directory)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(h.store.delete).not.toHaveBeenCalled();
  });
  it('does not retry FFMPEG_UNAVAILABLE', async () => {
    const h = harness(); h.transcoder.probe.mockRejectedValue(new ProcedureVideoTranscodeError('FFMPEG_UNAVAILABLE', 'missing binary'));
    await h.service.runOnce(); await h.service.runOnce();
    expect(h.row).toMatchObject({ status: 'FAILED', attempts: 1, errorCode: 'FFMPEG_UNAVAILABLE' }); expect(h.transcoder.probe).toHaveBeenCalledOnce();
  });
  it('refuses processing without a successful conditional claim', async () => {
    const h = harness(); h.db.procedureVideo.updateMany.mockResolvedValue({ count: 0 }); await h.service.runOnce();
    expect(h.transcoder.probe).not.toHaveBeenCalled(); expect(h.db.$transaction).not.toHaveBeenCalled();
  });
  it('serializes overlapping calls and recovers only PROCESSING rows older than ten minutes', async () => {
    const h = harness(); const now = Date.now(); vi.spyOn(Date, 'now').mockReturnValue(now);
    h.row.status = 'PROCESSING'; h.row.updatedAt = new Date(now - 10 * 60_000 - 1);
    h.rows.push({ ...h.row, id: 'fresh', updatedAt: new Date(now - 60_000) }, { ...h.row, id: 'boundary', updatedAt: new Date(now - 10 * 60_000) });
    await Promise.all([h.service.runOnce(), h.service.runOnce()]);
    expect(h.transcoder.transcode).toHaveBeenCalledOnce(); expect(h.states).toEqual(['PENDING', 'PROCESSING', 'READY', 'READY']);
    expect(h.rows.slice(1).map((video) => video.status)).toEqual(['PROCESSING', 'PROCESSING']);
    expect(h.db.procedureVideo.updateMany).toHaveBeenNthCalledWith(1, { where: { status: 'PROCESSING', updatedAt: { lt: new Date(now - 10 * 60_000) } }, data: { status: 'PENDING' } });
    expect(h.store.delete).not.toHaveBeenCalled();
  });
  function trimming() {
    const h = harness();
    Object.assign(h.row, { sourceStorageKey: null, storageKey: 'procedure-videos/old/video.mp4', posterStorageKey: 'procedure-videos/old/poster.jpg', trimRequest: { startSeconds: 2, endSeconds: 10, requestedAt: new Date().toISOString() }, sourceDurationSeconds: 12 });
    h.transcoder.probe.mockResolvedValueOnce({ durationSeconds: 12, width: 640, height: 360 }).mockResolvedValue({ durationSeconds: 8, width: 640, height: 360 });
    return h;
  }
  it('trims the SD file to a new hash, adjusts comments in the READY transaction and deletes unreferenced outputs after commit', async () => {
    const h = trimming();
    h.tx.procedureVideoComment.findMany.mockResolvedValue([0, 2, 5, 10, 11].map((atSeconds, index) => ({ id: String(index), videoId: 'video', atSeconds, text: String(atSeconds), sortOrder: index, createdAt: new Date() })));
    await h.service.runOnce();
    expect(h.transcoder.trim).toHaveBeenCalledWith(expect.any(String), expect.any(String), expect.any(String), 2, 10);
    expect(h.transcoder.transcode).not.toHaveBeenCalled();
    expect(h.store.read).toHaveBeenCalledWith('procedure-videos/old/video.mp4', { verifyIntegrity: true });
    expect(h.row).toMatchObject({ status: 'READY', durationSeconds: 8, sourceDurationSeconds: 12, trimmedAt: expect.any(Date), errorCode: null });
    expect(h.row.storageKey).toMatch(/^procedure-videos\/[a-f0-9]{64}\/video.mp4$/);
    expect(h.tx.procedureVideoComment.createMany).toHaveBeenCalledWith({ data: [expect.objectContaining({ id: '1', atSeconds: 0, sortOrder: 0 }), expect.objectContaining({ id: '2', atSeconds: 3, sortOrder: 1 }), expect.objectContaining({ id: '3', atSeconds: 8, sortOrder: 2 })] });
    expect(h.tx.procedureVideoComment.deleteMany).toHaveBeenCalledWith({ where: { videoId: 'video' } });
    expect(h.events).toEqual(['READY commit', 'delete', 'delete']);
    expect(h.db.$transaction).toHaveBeenCalledTimes(2);
    expect(h.store.delete.mock.calls.map(([key]) => key)).toEqual(['procedure-videos/old/video.mp4', 'procedure-videos/old/poster.jpg']);
  });
  it('does not claim a trim request replaced after the candidate was read', async () => {
    const h = trimming();
    const snapshot = { ...h.row };
    const replacement = { startSeconds: 1, endSeconds: 6, requestedAt: new Date().toISOString() };
    h.db.procedureVideo.findFirst.mockImplementationOnce(async () => {
      h.row.trimRequest = replacement;
      h.row.updatedAt = new Date(snapshot.updatedAt.getTime() + 1);
      return snapshot;
    });
    await h.service.runOnce();
    expect(h.row).toMatchObject({ status: 'PENDING', trimRequest: replacement });
    expect(h.db.procedureVideo.updateMany).toHaveBeenLastCalledWith({ where: { id: 'video', status: 'PENDING', updatedAt: snapshot.updatedAt, discardedAt: null }, data: { status: 'PROCESSING' } });
    expect(h.db.procedureVideo.findUnique).not.toHaveBeenCalled();
    expect(h.transcoder.trim).not.toHaveBeenCalled(); expect(h.store.read).not.toHaveBeenCalled();
    await h.service.runOnce();
    expect(h.transcoder.trim).toHaveBeenCalledExactlyOnceWith(expect.any(String), expect.any(String), expect.any(String), 1, 6);
  });
  it('processes the claimed row reread including trimRequest instead of the candidate snapshot', async () => {
    const h = trimming();
    h.db.procedureVideo.findFirst.mockResolvedValueOnce({ ...h.row, trimRequest: null });
    await h.service.runOnce();
    expect(h.db.procedureVideo.findUnique).toHaveBeenCalledExactlyOnceWith({ where: { id: 'video' } });
    expect(h.transcoder.trim).toHaveBeenCalledWith(expect.any(String), expect.any(String), expect.any(String), 2, 10);
    expect(h.transcoder.transcode).not.toHaveBeenCalled();
  });
  it('preserves old mp4 and poster while another row references their storageKey', async () => {
    const h = trimming(); h.rows.push({ ...h.row, id: 'shared', status: 'READY', trimRequest: null });
    await h.service.runOnce();
    expect(h.row.status).toBe('READY'); expect(h.store.delete).not.toHaveBeenCalled();
    expect(h.tx.procedureVideo.count).toHaveBeenCalledWith({ where: { storageKey: 'procedure-videos/old/video.mp4' } });
  });
  it('retries trim three times, then returns the unchanged original to READY with TRIM_FAILED', async () => {
    const h = trimming(); h.transcoder.trim.mockRejectedValue(new Error('trim encoder failed'));
    for (let attempt = 1; attempt <= 4; attempt++) {
      await h.service.runOnce();
      expect(h.row).toMatchObject({ attempts: attempt, status: attempt <= 3 ? 'PENDING' : 'READY', errorCode: 'TRIM_FAILED', errorMessage: 'trim encoder failed', storageKey: 'procedure-videos/old/video.mp4', posterStorageKey: 'procedure-videos/old/poster.jpg' });
    }
    expect(h.store.delete).not.toHaveBeenCalled(); expect(h.tx.procedureVideoComment.deleteMany).not.toHaveBeenCalled();
  });
  it('returns the original to READY immediately when ffmpeg is unavailable', async () => {
    const h = trimming(); h.transcoder.trim.mockRejectedValue(new ProcedureVideoTranscodeError('FFMPEG_UNAVAILABLE', 'ffmpeg missing'));
    await h.service.runOnce(); await h.service.runOnce();
    expect(h.row).toMatchObject({ status: 'READY', attempts: 1, errorCode: 'TRIM_FAILED', storageKey: 'procedure-videos/old/video.mp4' });
    expect(h.transcoder.trim).toHaveBeenCalledOnce(); expect(h.store.delete).not.toHaveBeenCalled();
  });
  it('keeps the original when the READY/comment transaction fails and does not delete its outputs', async () => {
    const h = trimming(); h.tx.procedureVideoComment.deleteMany.mockRejectedValueOnce(new Error('comment transaction failed'));
    await h.service.runOnce();
    expect(h.row).toMatchObject({ status: 'PENDING', attempts: 1, errorCode: 'TRIM_FAILED', storageKey: 'procedure-videos/old/video.mp4' });
    expect(h.store.delete).not.toHaveBeenCalled();
  });
  it('keeps successful trim READY when old-output deletion fails', async () => {
    const h = trimming(); h.store.delete.mockRejectedValueOnce(new Error('disk failure'));
    await h.service.runOnce();
    expect(h.row).toMatchObject({ status: 'READY', attempts: 0, durationSeconds: 8, errorCode: null });
    expect(h.row.storageKey).not.toBe('procedure-videos/old/video.mp4');
  });

});
