import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { env } from '../../../config/env.js';
import { ApiError } from '../../../lib/errors.js';
import { registerErrorHandler } from '../../../plugins/error-handler.js';
import { ProcedureVideoService } from '../../../services/assembly/procedure-video.service.js';
import { registerProcedureVideoRoutes } from '../procedure-videos.js';

const id = '00000000-0000-4000-8000-000000000001';
const suggestionId = '00000000-0000-4000-8000-000000000002';
const base = `/assembly/procedure-videos/${id}/auto-edit`;
const originalFlag = env.PROCEDURE_VIDEO_AUTO_EDIT_ENABLED;
const apps: ReturnType<typeof Fastify>[] = [];
function setup(deny?: 'view' | 'write') {
  const video = { id, title: '動画', origin: null, status: 'READY', durationSeconds: 10.5, storageKey: 'video.mp4', discardedAt: null, _count: { links: 0, scenes: 1 }, trimRequest: null };
  const row: any = { id: suggestionId, videoId: id, status: 'READY', decision: null, suggestion: { comments: [{ atSeconds: 0, text: '動きなし' }], scenes: [{ title: '場面', startSeconds: 0, endSeconds: 10 }] } };
  let comments: any[] = [{ atSeconds: 1, text: '前の字幕', sortOrder: 0 }];
  let scenes: any[] = [{ id: 'old-scene', title: '前の場面', startSeconds: 0, endSeconds: 3, posterStorageKey: 'old.jpg' }];
  let inTransaction = false;
  const writing = () => expect(inTransaction).toBe(true);
  const db = {
    $transaction: vi.fn(async (work) => {
      const snapshot = structuredClone({ row, comments, scenes });
      inTransaction = true;
      try { return await work(db); }
      catch (error) { Object.assign(row, snapshot.row); comments = snapshot.comments; scenes = snapshot.scenes; throw error; }
      finally { inTransaction = false; }
    }),
    $queryRaw: vi.fn(async () => { writing(); return [{ id }]; }),
    procedureVideo: { findUnique: vi.fn(async () => video), findMany: vi.fn(async () => [{ ...video, autoEditSuggestions: [{ status: row.status, decision: row.decision }] }]) },
    procedureVideoAutoEditSuggestion: {
      findFirst: vi.fn(async ({ where }) => where.status ? null : row),
      findMany: vi.fn(async () => [{ suggestion: row.suggestion, confirmed: row.confirmed }]),
      create: vi.fn(async ({ data }) => { writing(); return { id: 'new-suggestion', ...data }; }),
      update: vi.fn(async ({ data }) => { writing(); Object.assign(row, data); return row; }),
    },
    procedureVideoLink: { count: vi.fn().mockResolvedValue(0) },
    procedureVideoComment: {
      deleteMany: vi.fn(async () => { writing(); comments = []; }),
      createMany: vi.fn(async ({ data }) => { writing(); comments = data; }),
    },
    procedureVideoScene: {
      findMany: vi.fn(async () => scenes.map(({ title, startSeconds, endSeconds, id, posterStorageKey }) => ({ title, startSeconds, endSeconds, id, posterStorageKey }))),
      deleteMany: vi.fn(async () => { writing(); scenes = []; }),
      createMany: vi.fn(async ({ data }) => { writing(); scenes = data; }),
    },
  };
  const store = { delete: vi.fn(async () => { expect(inTransaction).toBe(false); }) };
  const service = new ProcedureVideoService(db as never, store as never, {} as never, {} as never);
  const app = Fastify(); apps.push(app); registerErrorHandler(app);
  registerProcedureVideoRoutes(app, { service, allowView: async () => { if (deny === 'view') throw new ApiError(403, '閲覧禁止'); }, allowWriteKiosk: async () => { if (deny === 'write') throw new ApiError(403, '更新禁止'); } });
  return { app, db, row, video, store, contents: () => ({ comments, scenes }) };
}
afterEach(async () => { env.PROCEDURE_VIDEO_AUTO_EDIT_ENABLED = originalFlag; await Promise.all(apps.splice(0).map((app) => app.close())); });

beforeEach(() => { env.PROCEDURE_VIDEO_AUTO_EDIT_ENABLED = true; });

describe('procedure-video auto edit routes', () => {
  it('gets the latest suggestion, null if absent, and includes latest state in the shelf', async () => {
    const h = setup();
    expect((await h.app.inject(base)).json()).toMatchObject({ id: suggestionId, status: 'READY' });
    expect(h.db.procedureVideoAutoEditSuggestion.findFirst).toHaveBeenCalledWith({ where: { videoId: id }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] });
    expect((await h.app.inject('/assembly/procedure-videos')).json().videos[0].autoEdit).toEqual({ status: 'READY', decision: null });
    h.db.procedureVideoAutoEditSuggestion.findFirst.mockResolvedValue(null);
    expect((await h.app.inject(base)).json()).toBeNull();
    h.db.procedureVideo.findUnique.mockResolvedValue(null as never);
    expect((await h.app.inject(base)).statusCode).toBe(404);
  });
  it('applies normalized comments and scenes and records confirmed/decision in one transaction', async () => {
    const h = setup();
    const response = await h.app.inject({ method: 'POST', url: `${base}/apply`, payload: { suggestionId, comments: [{ atSeconds: 4, text: ' 後 ' }, { atSeconds: 0, text: ' 先 ' }], scenes: [{ title: ' 場面 ', startSeconds: 0.04, endSeconds: 5.06 }] } });
    expect(response.statusCode).toBe(200);
    expect(h.db.$transaction).toHaveBeenCalledOnce();
    expect(h.db.$queryRaw.mock.calls[0]).toEqual([expect.arrayContaining(['SELECT "id" FROM "ProcedureVideo" WHERE "id" = ', ' FOR UPDATE']), id]);
    expect(h.contents().comments).toEqual([{ videoId: id, atSeconds: 0, text: '先', sortOrder: 0 }, { videoId: id, atSeconds: 4, text: '後', sortOrder: 1 }]);
    expect(h.row).toMatchObject({ decision: 'APPLIED', decidedAt: expect.any(Date), confirmed: { comments: [{ atSeconds: 0, text: '先' }, { atSeconds: 4, text: '後' }], scenes: [{ title: '場面', startSeconds: 0, endSeconds: 5.1 }] } });
    expect(h.db.procedureVideoLink.count).toHaveBeenCalledWith({ where: { videoId: id, sceneId: { not: null } } });
    expect(h.store.delete).toHaveBeenCalledWith('old.jpg', { integrity: true });
    expect((await h.app.inject({ method: 'POST', url: `${base}/apply`, payload: { suggestionId, comments: [] } })).statusCode).toBe(409);
  });
  it('preserves scenes when omitted, including linked ones, and permits clearing comments', async () => {
    const h = setup(); h.db.procedureVideoLink.count.mockResolvedValue(1);
    expect((await h.app.inject({ method: 'POST', url: `${base}/apply`, payload: { suggestionId, comments: [] } })).statusCode).toBe(200);
    expect(h.contents().comments).toEqual([]); expect(h.contents().scenes[0].title).toBe('前の場面');
    expect(h.db.procedureVideoScene.deleteMany).not.toHaveBeenCalled();
    expect(h.row.confirmed.scenes[0]).toMatchObject({ title: '前の場面', startSeconds: 0, endSeconds: 3 });
  });
  it('rejects replacing linked scenes with 409 before changing anything', async () => {
    const h = setup(); h.db.procedureVideoLink.count.mockResolvedValue(1);
    expect((await h.app.inject({ method: 'POST', url: `${base}/apply`, payload: { suggestionId, comments: [], scenes: [] } })).statusCode).toBe(409);
    expect(h.db.procedureVideoComment.deleteMany).not.toHaveBeenCalled(); expect(h.db.procedureVideoScene.deleteMany).not.toHaveBeenCalled(); expect(h.db.procedureVideoAutoEditSuggestion.update).not.toHaveBeenCalled();
  });
  it.each([
    { comments: [{ atSeconds: -1, text: '文' }] }, { comments: [{ atSeconds: 11, text: '文' }] },
    { comments: [{ atSeconds: 0, text: ' ' }] }, { comments: [{ atSeconds: 0, text: '文'.repeat(81) }] },
    { comments: Array(6).fill({ atSeconds: 0, text: '文' }) },
    { comments: [], scenes: [{ title: '場面', startSeconds: 0, endSeconds: 0.4 }] },
    { comments: [], scenes: [{ title: '場面', startSeconds: 0, endSeconds: 11 }] },
    { comments: [], scenes: [{ title: '文'.repeat(81), startSeconds: 0, endSeconds: 1 }] },
    { comments: [], scenes: Array(21).fill({ title: '場面', startSeconds: 0, endSeconds: 1 }) },
    { comments: [], unexpected: true },
  ])('rejects invalid apply input %j without writes', async (payload) => {
    const h = setup(); expect((await h.app.inject({ method: 'POST', url: `${base}/apply`, payload: { suggestionId, ...payload } })).statusCode).toBe(400);
    expect(h.db.procedureVideoComment.deleteMany).not.toHaveBeenCalled(); expect(h.db.procedureVideoAutoEditSuggestion.update).not.toHaveBeenCalled();
  });
  it.each(['PENDING', 'RUNNING', 'FAILED', 'SKIPPED', 'APPLIED', 'DISMISSED', 'missing'])('rejects applying %s suggestion', async (state) => {
    const h = setup();
    if (['APPLIED', 'DISMISSED'].includes(state)) h.row.decision = state;
    else if (state === 'missing') h.db.procedureVideoAutoEditSuggestion.findFirst.mockResolvedValue(null);
    else h.row.status = state;
    expect((await h.app.inject({ method: 'POST', url: `${base}/apply`, payload: { suggestionId, comments: [] } })).statusCode).toBe(409);
    expect(h.db.procedureVideoComment.deleteMany).not.toHaveBeenCalled();
  });
  it('rolls back comments and scenes if recording confirmed fails', async () => {
    const h = setup(); const before = structuredClone(h.contents());
    h.db.procedureVideoAutoEditSuggestion.update.mockRejectedValue(new Error('database failure'));
    expect((await h.app.inject({ method: 'POST', url: `${base}/apply`, payload: { suggestionId, comments: [], scenes: [] } })).statusCode).toBe(500);
    expect(h.contents()).toEqual(before); expect(h.row.decision).toBeNull(); expect(h.store.delete).not.toHaveBeenCalled(); expect(h.db.$transaction).toHaveBeenCalledOnce();
  });
  it('dismisses without saving comments, scenes or confirmed, and rejects a second decision', async () => {
    const h = setup(); expect((await h.app.inject({ method: 'POST', url: `${base}/dismiss`, payload: { suggestionId } })).statusCode).toBe(200);
    expect(h.row).toMatchObject({ decision: 'DISMISSED', decidedAt: expect.any(Date) }); expect(h.row.confirmed).toBeUndefined();
    expect(h.db.procedureVideoComment.deleteMany).not.toHaveBeenCalled(); expect(h.db.procedureVideoScene.deleteMany).not.toHaveBeenCalled();
    expect((await h.app.inject({ method: 'POST', url: `${base}/dismiss`, payload: { suggestionId } })).statusCode).toBe(409);
  });
  it('regenerates a fresh PENDING row, preserving old decisions', async () => {
    env.PROCEDURE_VIDEO_AUTO_EDIT_ENABLED = true;
    const h = setup(); h.row.decision = 'DISMISSED';
    const response = await h.app.inject({ method: 'POST', url: `${base}/regenerate` });
    expect(response.statusCode).toBe(200); expect(response.json()).toMatchObject({ id: 'new-suggestion', videoId: id, status: 'PENDING', promptVersion: 'procedure-video-auto-edit-v1' });
    expect(h.row.decision).toBe('DISMISSED'); expect(h.db.$transaction).toHaveBeenCalledOnce();
  });
  it.each(['PENDING', 'RUNNING', 'disabled'])('rejects regeneration for %s with 409', async (state) => {
    env.PROCEDURE_VIDEO_AUTO_EDIT_ENABLED = state !== 'disabled';
    const h = setup(); if (state !== 'disabled') h.db.procedureVideoAutoEditSuggestion.findFirst.mockResolvedValue({ status: state } as any);
    expect((await h.app.inject({ method: 'POST', url: `${base}/regenerate` })).statusCode).toBe(409);
    expect(h.db.procedureVideoAutoEditSuggestion.create).not.toHaveBeenCalled();
    if (state === 'disabled') expect(h.db.$transaction).not.toHaveBeenCalled();
  });
  it('reads applied-only statistics through the static route', async () => {
    const h = setup(); h.row.confirmed = h.row.suggestion;
    const response = await h.app.inject('/assembly/procedure-videos/auto-edit/stats');
    expect(response.statusCode).toBe(200); expect(response.json().comments.unchanged).toBe(1);
    expect(h.db.procedureVideoAutoEditSuggestion.findMany).toHaveBeenCalledWith({ where: { decision: 'APPLIED' }, select: { suggestion: true, confirmed: true } });
  });
  it.each(['view', 'write'] as const)('uses existing %s permissions', async (permission) => {
    const h = setup(permission);
    if (permission === 'view') {
      expect((await h.app.inject(base)).statusCode).toBe(403);
      expect((await h.app.inject('/assembly/procedure-videos/auto-edit/stats')).statusCode).toBe(403);
    } else {
      for (const action of ['apply', 'dismiss', 'regenerate']) expect((await h.app.inject({ method: 'POST', url: `${base}/${action}`, payload: { suggestionId, comments: [] } })).statusCode).toBe(403);
    }
    expect(h.db.$transaction).not.toHaveBeenCalled(); expect(h.db.procedureVideoAutoEditSuggestion.findFirst).not.toHaveBeenCalled();
  });
});

describe('procedure-video auto edit decision contract regressions', () => {
  it.each(['apply', 'dismiss'])('requires a valid suggestionId for %s', async (action) => {
    const h = setup();
    for (const invalid of [undefined, '', 'invalid']) {
      const payload = { ...(action === 'apply' ? { comments: [] } : {}), ...(invalid === undefined ? {} : { suggestionId: invalid }) };
      expect((await h.app.inject({ method: 'POST', url: `${base}/${action}`, payload })).statusCode).toBe(400);
    }
    expect(h.db.$transaction).not.toHaveBeenCalled();
  });
  it.each(['apply', 'dismiss'])('rejects a stale ID for %s even if the latest suggestion is READY', async (action) => {
    const h = setup();
    const payload = { suggestionId: id, ...(action === 'apply' ? { comments: [] } : {}) };
    expect((await h.app.inject({ method: 'POST', url: `${base}/${action}`, payload })).statusCode).toBe(409);
    expect(h.db.procedureVideoAutoEditSuggestion.update).not.toHaveBeenCalled();
  });
  it('returns 409 for disabled individual APIs and does not read suggestions for the shelf', async () => {
    env.PROCEDURE_VIDEO_AUTO_EDIT_ENABLED = false; const h = setup();
    for (const url of [base, '/assembly/procedure-videos/auto-edit/stats']) expect((await h.app.inject(url)).statusCode).toBe(409);
    for (const action of ['apply', 'dismiss']) {
      expect((await h.app.inject({ method: 'POST', url: `${base}/${action}`, payload: { suggestionId, ...(action === 'apply' ? { comments: [] } : {}) } })).statusCode).toBe(409);
    }
    expect((await h.app.inject('/assembly/procedure-videos')).json().videos[0].autoEdit).toBeNull();
    expect(h.db.procedureVideo.findMany).toHaveBeenCalledWith(expect.objectContaining({ include: expect.objectContaining({ autoEditSuggestions: false }) }));
    expect(h.db.procedureVideoAutoEditSuggestion.findFirst).not.toHaveBeenCalled();
    expect(h.db.procedureVideoAutoEditSuggestion.findMany).not.toHaveBeenCalled();
    expect(h.db.$transaction).not.toHaveBeenCalled();
  });
});
