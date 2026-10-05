import { access, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ProcedureVideoProcessingService } from '../procedure-video-processing.service.js';
import { ProcedureVideoTranscodeError } from '../procedure-video-transcoder.port.js';

type VideoRow = { id: string; status: string; attempts: number; sourceStorageKey: string | null; discardedAt: null; updatedAt: Date };
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
    findMany: vi.fn(async () => rows.filter((video) => video.status === 'READY' && video.sourceStorageKey).map((video) => ({ ...video }))),
    updateMany: vi.fn(async ({ where, data }) => {
      const matches = rows.filter((video) => video.status === where.status && (!where.id || video.id === where.id) && (!where.updatedAt || video.updatedAt < where.updatedAt.lt));
      for (const video of matches) { Object.assign(video, data); states.push(video.status); }
      return { count: matches.length };
    }), update,
  }, $transaction: vi.fn() };
  const tx = { $queryRaw: vi.fn().mockResolvedValue([]), procedureVideo: {
    findUnique: vi.fn(async ({ where }) => rows.find((video) => video.id === where.id)),
    count: vi.fn(async ({ where }) => rows.filter((video) => video.sourceStorageKey === where.sourceStorageKey).length),
    update: vi.fn(async (args) => { expect(inTransaction).toBe(true); return update(args); }),
  } };
  db.$transaction.mockImplementation(async (work) => {
    const snapshots = rows.map((video) => ({ ...video }));
    inTransaction = true;
    try {
      const result = await work(tx);
      events.push('cleanup commit');
      return result;
    } catch (error) {
      rows.forEach((video, index) => Object.assign(video, snapshots[index]));
      throw error;
    } finally { inTransaction = false; }
  });
  const store = { read: vi.fn().mockResolvedValue(Buffer.from('original')), write: vi.fn(), delete: vi.fn(async () => {
    expect(inTransaction).toBe(false);
    events.push('delete');
  }) };
  const transcoder = { probe: vi.fn().mockResolvedValue({ durationSeconds: 12, width: 640, height: 360 }), transcode: vi.fn(async (input, output, poster) => {
    expect(inTransaction).toBe(false);
    expect(await readFile(input, 'utf8')).toBe('original');
    await writeFile(output, 'converted'); await writeFile(poster, 'poster');
  }) };
  return { row, rows, states, events, db, tx, store, transcoder, service: new ProcedureVideoProcessingService(transcoder, db as never, store as never) };
}

describe('procedure-video processing', () => {
  afterEach(() => vi.restoreAllMocks());
  it('claims PENDING, converts outside a transaction, commits READY and clears the last reference before deletion', async () => {
    const h = harness();
    h.db.procedureVideo.update.mockImplementationOnce(async ({ data }) => {
      expect(data).not.toHaveProperty('sourceStorageKey');
      expect(h.db.$transaction).not.toHaveBeenCalled();
      Object.assign(h.row, data); h.states.push(h.row.status); h.events.push('READY commit');
      return h.row;
    });
    await h.service.runOnce();
    expect(h.states).toEqual(['PROCESSING', 'READY', 'READY']);
    expect(h.events).toEqual(['READY commit', 'clear reference', 'cleanup commit', 'delete']);
    expect(h.row).toMatchObject({ status: 'READY', sourceStorageKey: null, attempts: 0, durationSeconds: 12, width: 640, height: 360 });
    expect(h.store.write.mock.calls.map(([request]) => request.key)).toEqual([expect.stringMatching(/procedure-videos\/[a-f0-9]{64}\/video.mp4/), expect.stringMatching(/procedure-videos\/[a-f0-9]{64}\/poster.jpg/)]);
    expect(h.store.delete).toHaveBeenCalledWith('procedure-videos/incoming/hash/original', { integrity: true });
    expect(h.tx.$queryRaw.mock.calls[0]).toEqual([expect.arrayContaining(['SELECT pg_advisory_xact_lock(hashtext(', '))']), 'procedure-videos/incoming/hash/original']);
    expect(h.tx.procedureVideo.update).toHaveBeenCalledWith({ where: { id: 'video' }, data: { sourceStorageKey: null } });
    expect(h.db.procedureVideo.findFirst).toHaveBeenCalledWith({ where: { status: 'PENDING', discardedAt: null }, orderBy: [{ receivedAt: 'asc' }, { id: 'asc' }] });
    expect(h.db.procedureVideo.updateMany).toHaveBeenLastCalledWith({ where: { id: 'video', status: 'PENDING', discardedAt: null }, data: { status: 'PROCESSING' } });
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
    const h = harness(); h.tx.procedureVideo.update.mockRejectedValueOnce(new Error('database failure'));
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
    expect(h.db.$transaction).not.toHaveBeenCalled(); expect(h.store.delete).not.toHaveBeenCalled();
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
});
