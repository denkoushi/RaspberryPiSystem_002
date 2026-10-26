import { createPrismaClient } from '../../../lib/prisma-client.js';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { env } from '../../../config/env.js';
import { enqueueProcedureVideoAutoEdit, recoverProcedureVideoAutoEdit, ProcedureVideoAutoEditService } from '../procedure-video-auto-edit.service.js';
import { ProcedureVideoService } from '../procedure-video.service.js';

const db = createPrismaClient();
const other = createPrismaClient();
// Local PostgreSQL is optional; CI must connect and exercise the actual migrated schema.
let available = true;
try { await db.$connect(); }
catch (error) {
  if (process.env.CI || (error as { errorCode?: string }).errorCode !== 'P1001') throw error;
  available = false;
}
const prefix = `auto-edit-test-${randomUUID()}`;
const originalFlag = env.PROCEDURE_VIDEO_AUTO_EDIT_ENABLED;
const scene = { title: '元の場面', startSeconds: 0, endSeconds: 5 };
const comment = { atSeconds: 1, text: '元の字幕' };
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}
function service(client = db) { return new ProcedureVideoService(client, { delete: vi.fn() } as never, {} as never, {} as never); }
async function fixture(withSuggestion = true) {
  const video = await db.procedureVideo.create({ data: {
    title: prefix, gmailDedupeKey: `${prefix}-${randomUUID()}`, status: 'READY', receivedAt: new Date(),
    sourceFileName: 'test.mp4', sourceContentType: 'video/mp4', sourceByteSize: 1,
    storageKey: `${prefix}/video.mp4`, durationSeconds: 10, processedAt: new Date('2026-01-01'),
    scenes: { create: scene }, comments: { create: { ...comment, sortOrder: 0 } },
  } });
  const suggestion = withSuggestion ? await db.procedureVideoAutoEditSuggestion.create({ data: {
    videoId: video.id, status: 'READY', promptVersion: 'test', suggestion: { scenes: [scene], comments: [comment] },
  } }) : null;
  return { video, suggestion };
}
const cleanup = () => db.procedureVideo.deleteMany({ where: { gmailDedupeKey: { startsWith: prefix } } });
afterAll(async () => { await Promise.all([db.$disconnect(), other.$disconnect()]); });

describe.skipIf(!available)('procedure-video auto edit (real PostgreSQL)', () => {
  beforeEach(() => { env.PROCEDURE_VIDEO_AUTO_EDIT_ENABLED = true; });
  afterEach(async () => { env.PROCEDURE_VIDEO_AUTO_EDIT_ENABLED = originalFlag; await cleanup(); });

  it('allows only one RUNNING claim across two independent service instances and DB connections', async () => {
    const first = await fixture(), second = await fixture();
    await db.procedureVideoAutoEditSuggestion.updateMany({ where: { videoId: { in: [first.video.id, second.video.id] } }, data: { status: 'PENDING' } });
    const entered = deferred(), finish = deferred();
    const vision = { completeMany: vi.fn(async () => {
      entered.resolve(); await finish.promise;
      return { rawText: JSON.stringify({ scenes: [{ ...scene, caption: '動きなし' }] }), modelRoute: 'test', modelName: 'test' };
    }) };
    const worker = (client: PrismaClient) => new ProcedureVideoAutoEditService({
      db: client, enabled: () => true, isVisionConfigured: () => true,
      store: { copyToFile: vi.fn(async (_key, destination) => { await writeFile(destination, 'video'); }) },
      transcoder: { extractFrames: vi.fn(async (_input, directory) => {
        const frame = path.join(directory, 'frame.jpg'); await writeFile(frame, 'jpeg'); return [{ path: frame, atSeconds: 0 }];
      }) } as never,
      vision, verifier: { verify: vi.fn().mockResolvedValue({ status: 'disabled', scenes: [] }) },
      localLlmRuntime: { ensureReady: vi.fn().mockResolvedValue(undefined), release: vi.fn().mockResolvedValue(undefined) },
    });
    const jobs = [worker(db).runOnce(), worker(other).runOnce()];
    try {
      await entered.promise;
      await Promise.race(jobs);
      expect(await db.procedureVideoAutoEditSuggestion.count({ where: { status: 'RUNNING' } })).toBe(1);
      expect(vision.completeMany).toHaveBeenCalledOnce();
    } finally { finish.resolve(); await Promise.all(jobs); }
    expect(await db.procedureVideoAutoEditSuggestion.count({ where: { videoId: { in: [first.video.id, second.video.id] }, status: 'READY' } })).toBe(1);
  });

  it('commits exactly one of two simultaneous applies', async () => {
    const { video, suggestion } = await fixture();
    const input = { suggestionId: suggestion!.id, scenes: [scene], comments: [comment] };
    const results = await Promise.allSettled([service().applyAutoEdit(video.id, input), service(other).applyAutoEdit(video.id, input)]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.find((result) => result.status === 'rejected')).toMatchObject({ reason: { statusCode: 409 } });
    expect(await db.procedureVideoComment.count({ where: { videoId: video.id } })).toBe(1);
    expect(await db.procedureVideoAutoEditSuggestion.findUnique({ where: { id: suggestion!.id } })).toMatchObject({ decision: 'APPLIED' });
  });

  it('rejects an old suggestion ID when apply races with an uncommitted regeneration', async () => {
    const { video, suggestion } = await fixture();
    const created = deferred(), commit = deferred(), applying = deferred();
    const regeneratingDb = db.$extends({ query: { procedureVideoAutoEditSuggestion: { async create({ args, query }) {
      const row = await query(args); created.resolve(); await commit.promise; return row;
    } } } });
    const applyingDb = other.$extends({ query: { async $queryRaw({ args, query }) { applying.resolve(); return query(args); } } });
    const regeneration = service(regeneratingDb as unknown as PrismaClient).regenerateAutoEdit(video.id);
    await created.promise;
    const application = service(applyingDb as unknown as PrismaClient).applyAutoEdit(video.id, { suggestionId: suggestion!.id, comments: [] });
    const assertion = expect(application).rejects.toMatchObject({ statusCode: 409 });
    try { await applying.promise; }
    finally { commit.resolve(); }
    await regeneration; await assertion;
    expect(await db.procedureVideoComment.findMany({ where: { videoId: video.id } })).toMatchObject([comment]);
  });

  it('rolls back real scene/comment writes when recording the decision fails', async () => {
    const { video, suggestion } = await fixture();
    const beforeScenes = await db.procedureVideoScene.findMany({ where: { videoId: video.id } });
    const beforeComments = await db.procedureVideoComment.findMany({ where: { videoId: video.id } });
    const failingDb = db.$extends({ query: { procedureVideoAutoEditSuggestion: { async update() { throw new Error('injected decision failure'); } } } });
    await expect(service(failingDb as unknown as PrismaClient).applyAutoEdit(video.id, {
      suggestionId: suggestion!.id, scenes: [{ ...scene, title: '変更' }], comments: [{ ...comment, text: '変更' }],
    })).rejects.toThrow('injected decision failure');
    expect(await db.procedureVideoScene.findMany({ where: { videoId: video.id } })).toEqual(beforeScenes);
    expect(await db.procedureVideoComment.findMany({ where: { videoId: video.id } })).toEqual(beforeComments);
    expect(await db.procedureVideoAutoEditSuggestion.findUnique({ where: { id: suggestion!.id } })).toMatchObject({ decision: null, confirmed: null });
  });

  it('deduplicates concurrent recovery and normal enqueue for the same READY publication', async () => {
    const { video } = await fixture(false);
    await Promise.all([recoverProcedureVideoAutoEdit(db), recoverProcedureVideoAutoEdit(other), enqueueProcedureVideoAutoEdit(video.id, db)]);
    expect(await db.procedureVideoAutoEditSuggestion.findMany({ where: { videoId: video.id } })).toMatchObject([{ status: 'PENDING' }]);
    expect(await db.procedureVideoAutoEditSuggestion.count({ where: { videoId: video.id } })).toBe(1);
  });

  it('recovers a newer READY publication but ignores unrelated updatedAt edits and respects the batch limit', async () => {
    const { video, suggestion } = await fixture();
    await db.procedureVideo.update({ where: { id: video.id }, data: { title: '題名だけ変更' } });
    await recoverProcedureVideoAutoEdit(db);
    expect(await db.procedureVideoAutoEditSuggestion.count({ where: { videoId: video.id } })).toBe(1);
    await db.procedureVideoAutoEditSuggestion.update({ where: { id: suggestion!.id }, data: { createdAt: new Date('2025-01-01') } });
    await recoverProcedureVideoAutoEdit(db);
    expect(await db.procedureVideoAutoEditSuggestion.count({ where: { videoId: video.id } })).toBe(2);
    const videos = await Promise.all(Array.from({ length: 6 }, () => fixture(false)));
    await recoverProcedureVideoAutoEdit(db);
    expect(await db.procedureVideoAutoEditSuggestion.count({ where: { videoId: { in: videos.map(({ video }) => video.id) } } })).toBe(5);
  });
});
