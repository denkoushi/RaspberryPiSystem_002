import { access, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { env } from '../../../config/env.js';
import { InferenceDeferredError } from '../../inference/ports/text-completion.port.js';
import { InferenceUnavailableError } from '../../inference/ports/multi-image-vision-completion.port.js';
import { enqueueProcedureVideoAutoEdit, recoverProcedureVideoAutoEdit, ProcedureVideoAutoEditService } from '../procedure-video-auto-edit.service.js';

function harness() {
  const now = new Date('2026-10-16T00:00:00Z');
  const row = { id: 'suggestion', videoId: 'video', status: 'PENDING', decision: null, attempts: 0, updatedAt: new Date(now), createdAt: new Date(now), processingToken: null as string | null };
  const rows = [row];
  const video = { id: 'video', title: '動画', subjectHint: '工程', status: 'READY', durationSeconds: 5, storageKey: 'video.mp4' as string | null, discardedAt: null as Date | null };
  let inTransaction = false;
  const matches = (item: typeof row, where: any) => Object.entries(where).every(([key, value]: [string, any]) => key === 'updatedAt' ? value instanceof Date ? item.updatedAt.getTime() === value.getTime() : item.updatedAt < value.lt : (item as any)[key] === value);
  const db = { $transaction: vi.fn(async (work) => { inTransaction = true; try { return await work(db); } finally { inTransaction = false; } }), $executeRaw: vi.fn(), $queryRaw: vi.fn(),
    procedureVideo: { findUnique: vi.fn(async () => ({ ...video })) },
    procedureVideoAutoEditSuggestion: {
      create: vi.fn(),
      findFirst: vi.fn(async ({ where }: any) => {
        if (where.videoId) return { ...rows[rows.length - 1] };
        return rows.filter((row) => matches(row, where)).map((row) => ({ ...row }))[0] ?? null;
      }),
      updateMany: vi.fn(async ({ where, data }) => {
        const found = rows.filter((row) => matches(row, where));
        for (const row of found) Object.assign(row, data);
        return { count: found.length };
      }),
    },
  };
  const transcoder = { extractFrames: vi.fn(async (input, directory) => {
    expect(inTransaction).toBe(false);
    const frame = path.join(directory, 'frame-001.jpg'); await writeFile(frame, 'jpeg');
    return [{ path: frame, atSeconds: 0 }];
  }) };
  const vision = { completeMany: vi.fn(async () => {
    expect(inTransaction).toBe(false);
    return { rawText: JSON.stringify({ scenes: [{ startSeconds: 0, endSeconds: 5, title: '場面', caption: '動きなし' }] }), modelRoute: 'photo_label:business', modelName: 'dgx-background-preparation' };
  }) };
  const verifier = { verify: vi.fn(async () => ({ status: 'disabled', scenes: [] })) };
  const runtime = { ensureReady: vi.fn().mockResolvedValue(undefined), release: vi.fn().mockResolvedValue(undefined) };
  const deps = { db: db as never, store: { copyToFile: vi.fn(async (_key, destination) => { await writeFile(destination, 'mp4'); }) }, transcoder: transcoder as never,
    vision, verifier, localLlmRuntime: runtime, enabled: () => true, isVisionConfigured: () => true, now: () => now };
  return { row, rows, video, db, transcoder, vision, verifier, runtime, deps, service: new ProcedureVideoAutoEditService(deps) };
}
const originalFlag = env.PROCEDURE_VIDEO_AUTO_EDIT_ENABLED;
afterEach(() => { env.PROCEDURE_VIDEO_AUTO_EDIT_ENABLED = originalFlag; vi.restoreAllMocks(); vi.useRealTimers(); });
describe('procedure-video auto edit worker', () => {
  it('does not create rows or touch storage, DB, runtime or inference when disabled', async () => {
    env.PROCEDURE_VIDEO_AUTO_EDIT_ENABLED = false;
    const h = harness(); h.deps.enabled = () => false;
    expect(await enqueueProcedureVideoAutoEdit('video', h.db as never)).toBeNull();
    await recoverProcedureVideoAutoEdit(h.db as never);
    await h.service.runOnce();
    expect(h.db.procedureVideoAutoEditSuggestion.create).not.toHaveBeenCalled();
    expect(h.db.$transaction).not.toHaveBeenCalled(); expect(h.vision.completeMany).not.toHaveBeenCalled(); expect(h.runtime.ensureReady).not.toHaveBeenCalled();
  });
  it('cleans only expired owned temporary directories left by a crashed process', async () => {
    const h = harness();
    const expired = await mkdtemp(path.join(tmpdir(), 'procedure-video-auto-edit-'));
    const fresh = await mkdtemp(path.join(tmpdir(), 'procedure-video-auto-edit-'));
    const unrelated = await mkdtemp(path.join(tmpdir(), 'procedure-video-other-'));
    const old = new Date(h.deps.now().getTime() - 25 * 60 * 60_000);
    await utimes(expired, old, old); await utimes(unrelated, old, old); await utimes(fresh, h.deps.now(), h.deps.now());
    try {
      await h.service.runOnce();
      await expect(access(expired)).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(access(fresh)).resolves.toBeUndefined(); await expect(access(unrelated)).resolves.toBeUndefined();
    } finally { await Promise.all([expired, fresh, unrelated].map((directory) => rm(directory, { recursive: true, force: true }))); }
  });
  it('claims oldest with id/status/updatedAt, sends timestamped frames in background and publishes only a suggestion', async () => {
    const h = harness(); await h.service.runOnce();
    expect(h.db.procedureVideoAutoEditSuggestion.findFirst).toHaveBeenCalledWith({ where: { status: 'PENDING' }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
    expect(h.db.procedureVideoAutoEditSuggestion.updateMany).toHaveBeenNthCalledWith(2, { where: { id: 'suggestion', status: 'PENDING', updatedAt: expect.any(Date) }, data: { status: 'RUNNING', processingToken: expect.any(String) } });
    expect(h.vision.completeMany).toHaveBeenCalledWith(expect.objectContaining({ background: true, timeoutMs: 120000, temperature: 0, images: [{ imageBytes: Buffer.from('jpeg'), mimeType: 'image/jpeg', label: '0秒' }] }));
    expect(h.row).toMatchObject({ status: 'READY', processingToken: null, attempts: 0, modelRoute: 'photo_label:business', modelName: 'dgx-background-preparation', suggestion: { comments: [{ atSeconds: 0, text: '動きなし' }] } });
    expect(h.runtime.release).toHaveBeenCalledWith('photo_label');
    await expect(access(path.dirname(h.transcoder.extractFrames.mock.calls[0][0]))).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('retries three ordinary failures and fails the fourth, cleaning every temporary directory', async () => {
    const h = harness(); h.vision.completeMany.mockRejectedValue(new Error('bad response'));
    for (let i = 1; i <= 4; i++) {
      await h.service.runOnce();
      expect(h.row).toMatchObject({ status: i <= 3 ? 'PENDING' : 'FAILED', attempts: i });
    }
    for (const [input] of h.transcoder.extractFrames.mock.calls) await expect(access(path.dirname(input))).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it.each([new InferenceUnavailableError(), new InferenceDeferredError()])('does not charge attempts when the business model is unavailable (%s)', async (error) => {
    const h = harness(); h.row.attempts = 2; h.vision.completeMany.mockRejectedValue(error);
    await h.service.runOnce();
    expect(h.row).toMatchObject({ status: 'PENDING', attempts: 2, errorCode: 'MODEL_UNAVAILABLE' });
  });
  it('does not charge attempts for runtime readiness failures or unconfigured inference', async () => {
    const h = harness(); h.runtime.ensureReady.mockRejectedValue(new Error('connection refused'));
    await h.service.runOnce(); expect(h.row).toMatchObject({ status: 'PENDING', attempts: 0 });
    h.deps.isVisionConfigured = () => false;
    await h.service.runOnce(); expect(h.row).toMatchObject({ status: 'PENDING', attempts: 0 });
    expect(h.vision.completeMany).not.toHaveBeenCalled();
  });
  it('publishes READY even if JEV rejects', async () => {
    const h = harness(); h.verifier.verify.mockRejectedValue(new Error('JEV offline'));
    await h.service.runOnce(); expect(h.row).toMatchObject({ status: 'READY', verification: { status: 'unavailable' } });
  });
  it.each(['not-ready', 'discarded', 'no-key', 'missing-file', 'superseded'])('skips %s video without inference or consuming attempts', async (state) => {
    const h = harness();
    if (state === 'not-ready') h.video.status = 'PENDING';
    if (state === 'discarded') h.video.discardedAt = new Date();
    if (state === 'no-key') h.video.storageKey = null;
    if (state === 'missing-file') h.deps.store.copyToFile.mockRejectedValue(Object.assign(new Error('missing'), { code: 'ENOENT' }));
    if (state === 'superseded') h.rows.push({ ...h.row, id: 'newer', status: 'READY' });
    await h.service.runOnce(); expect(h.row).toMatchObject({ status: 'SKIPPED', attempts: 0 }); expect(h.vision.completeMany).not.toHaveBeenCalled();
  });
  it('recovers an expired RUNNING token and leaves fresh RUNNING alone', async () => {
    const h = harness(); h.row.status = 'RUNNING'; h.row.updatedAt = new Date(h.deps.now().getTime() - 10 * 60_000 - 1); h.row.processingToken = 'old';
    await h.service.runOnce(); expect(h.row.status).toBe('READY');
    const fresh = harness(); fresh.row.status = 'RUNNING';
    await fresh.service.runOnce(); expect(fresh.row.status).toBe('RUNNING'); expect(fresh.vision.completeMany).not.toHaveBeenCalled();
  });
  it('does not process a lost conditional claim', async () => {
    const h = harness(); h.db.procedureVideoAutoEditSuggestion.updateMany.mockResolvedValue({ count: 0 });
    await h.service.runOnce(); expect(h.vision.completeMany).not.toHaveBeenCalled();
  });
  it('does not publish or fail an attempt after losing its token', async () => {
    const h = harness(); h.vision.completeMany.mockImplementation(async () => {
      h.row.processingToken = 'recovered';
      return { rawText: '{}', modelRoute: 'business', modelName: 'model' };
    });
    await h.service.runOnce(); expect(h.row).toMatchObject({ status: 'RUNNING', processingToken: 'recovered', attempts: 0 });
  });
  it('rechecks video storage after inference and skips if it changed', async () => {
    const h = harness(); h.verifier.verify.mockImplementation(async () => { h.video.storageKey = 'trimmed.mp4'; return { status: 'disabled', scenes: [] }; });
    await h.service.runOnce(); expect(h.row.status).toBe('SKIPPED');
  });
  it('allows only one concurrent run in this process', async () => {
    const h = harness(); await Promise.all([h.service.runOnce(), h.service.runOnce()]); expect(h.vision.completeMany).toHaveBeenCalledOnce();
  });
});

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}
describe('procedure-video worker ownership and timeout regressions', () => {
  it('heartbeats every 30 seconds throughout readiness, including beyond the recovery threshold, then stops', async () => {
    vi.useFakeTimers(); const h = harness(), entered = deferred(), ready = deferred();
    vi.setSystemTime(h.deps.now()); h.deps.now = () => new Date();
    h.runtime.ensureReady.mockImplementation(async () => { entered.resolve(); await ready.promise; });
    const job = h.service.runOnce(); await entered.promise;
    const before = h.db.procedureVideoAutoEditSuggestion.updateMany.mock.calls.length;
    await vi.advanceTimersByTimeAsync(11 * 60_000);
    expect(h.db.procedureVideoAutoEditSuggestion.updateMany.mock.calls.length - before).toBe(22);
    expect(h.row.updatedAt).toEqual(new Date());
    expect(h.vision.completeMany).not.toHaveBeenCalled();
    ready.resolve(); await job;
    expect(h.row.status).toBe('READY');
    const after = h.db.procedureVideoAutoEditSuggestion.updateMany.mock.calls.length;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(h.db.procedureVideoAutoEditSuggestion.updateMany).toHaveBeenCalledTimes(after);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('abandons lost ownership during readiness and releases a late runtime acquisition without inference', async () => {
    vi.useFakeTimers(); const h = harness(), entered = deferred(), ready = deferred();
    h.runtime.ensureReady.mockImplementation(async () => { entered.resolve(); await ready.promise; });
    const job = h.service.runOnce(); await entered.promise;
    h.row.processingToken = 'new-owner';
    await vi.advanceTimersByTimeAsync(30_000); await job;
    expect(h.row).toMatchObject({ processingToken: 'new-owner', status: 'RUNNING', attempts: 0 });
    expect(h.vision.completeMany).not.toHaveBeenCalled();
    ready.resolve(); await vi.advanceTimersByTimeAsync(0);
    expect(h.runtime.release).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
  });
  it('checks ownership immediately before inference even before the next periodic heartbeat', async () => {
    const h = harness(); h.runtime.ensureReady.mockImplementation(async () => { h.row.processingToken = 'new-owner'; });
    await h.service.runOnce();
    expect(h.vision.completeMany).not.toHaveBeenCalled();
    expect(h.row.attempts).toBe(0); expect(h.runtime.release).toHaveBeenCalledOnce();
  });
  it('charges each 120-second inference timeout, fails the fourth and then processes the next video', async () => {
    vi.useFakeTimers(); const h = harness();
    const successful = h.vision.completeMany.getMockImplementation()!;
    for (let attempt = 1; attempt <= 4; attempt++) {
      const entered = deferred();
      h.vision.completeMany.mockImplementation(() => { entered.resolve(); return new Promise(() => {}); });
      const job = h.service.runOnce(); await entered.promise;
      await vi.advanceTimersByTimeAsync(120_000); await job;
      expect(h.row).toMatchObject({ status: attempt < 4 ? 'PENDING' : 'FAILED', attempts: attempt });
      const input = h.vision.completeMany.mock.calls.at(-1)![0] as unknown as { signal: AbortSignal };
      expect(input.signal.aborted).toBe(true); expect(vi.getTimerCount()).toBe(0);
    }
    h.rows.push({ ...h.row, id: 'next', status: 'PENDING', attempts: 0 });
    h.vision.completeMany.mockImplementation(successful);
    await h.service.runOnce();
    expect(h.rows[1]).toMatchObject({ status: 'READY', attempts: 0 });
  });
});
