import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '../../../lib/errors.js';
import { registerErrorHandler } from '../../../plugins/error-handler.js';
import { ProcedureVideoService } from '../../../services/assembly/procedure-video.service.js';
import { registerProcedureVideoRoutes } from '../procedure-videos.js';

const id = '00000000-0000-4000-8000-000000000001';
const secondId = '00000000-0000-4000-8000-000000000002';
const base = `/assembly/procedure-videos/${id}`;
const pagePath = `/assembly/procedure-documents/${id}/pages/0/videos`;
function harness(deny: 'view' | 'write' | null = null) {
  const video = { id, title: '動画', status: 'READY', durationSeconds: 10.5, storageKey: 'video.mp4', posterStorageKey: 'poster.jpg', discardedAt: null, _count: { links: 2 } };
  const db = { $transaction: vi.fn(), $queryRaw: vi.fn().mockResolvedValue([{ status: 'DRAFT', isActive: true, isRevisionHead: true }]),
    procedureVideo: { findFirst: vi.fn().mockResolvedValue(null), findUnique: vi.fn().mockResolvedValue(video), findMany: vi.fn().mockResolvedValue([video]), count: vi.fn().mockResolvedValue(2), update: vi.fn(), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    procedureVideoLink: { count: vi.fn().mockResolvedValue(0), findMany: vi.fn().mockResolvedValue([{ video }]), deleteMany: vi.fn(), createMany: vi.fn() },
    procedureVideoComment: { findMany: vi.fn().mockResolvedValue([]), deleteMany: vi.fn(), createMany: vi.fn() },
    assemblyProcedureDocumentPage: { findUnique: vi.fn().mockResolvedValue({ pageIndex: 0 }) },
  };
  db.$transaction.mockImplementation((work) => work(db));
  const store = { read: vi.fn().mockResolvedValue(Buffer.from('0123456789')) };
  const access = { requireAccessPassword: vi.fn().mockResolvedValue(undefined) };
  const app = Fastify(); registerErrorHandler(app);
  registerProcedureVideoRoutes(app, { service: new ProcedureVideoService(db as never, store as never, access as never),
    allowView: async () => { if (deny === 'view') throw new ApiError(403, '権限がありません'); },
    allowWriteKiosk: async () => { if (deny === 'write') throw new ApiError(403, '権限がありません'); },
  });
  return { app, db, store, access, video };
}
const apps: ReturnType<typeof Fastify>[] = [];
function setup(deny: 'view' | 'write' | null = null) { const h = harness(deny); apps.push(h.app); return h; }
afterEach(async () => { await Promise.all(apps.splice(0).map((app) => app.close())); });

describe('procedure-video routes', () => {
  it('lists active by default with poster presence and link count, and filters discarded/search/limit', async () => {
    const h = setup(); const response = await h.app.inject('/assembly/procedure-videos');
    expect(response.json().videos[0]).toMatchObject({ status: 'READY', hasPoster: true, linkCount: 2 });
    expect(h.db.procedureVideo.findMany.mock.calls[0][0].where).toEqual({ discardedAt: null });
    await h.app.inject('/assembly/procedure-videos?state=discarded&q=手順&limit=8');
    expect(h.db.procedureVideo.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ take: 8, where: { discardedAt: { not: null }, OR: expect.any(Array) } }));
  });
  it.each([['bytes=2-5', '2345', 'bytes 2-5/10'], ['bytes=6-', '6789', 'bytes 6-9/10'], ['bytes=-3', '789', 'bytes 7-9/10'], ['bytes=7-999', '789', 'bytes 7-9/10']])('responds to %s with authenticated 206', async (range, body, contentRange) => {
    const h = setup(); const response = await h.app.inject({ url: `${base}/file`, headers: { range } });
    expect(response.statusCode).toBe(206); expect(response.body).toBe(body);
    expect(response.headers).toMatchObject({ 'content-type': 'video/mp4', 'accept-ranges': 'bytes', 'cache-control': 'private, no-store', 'content-range': contentRange, 'content-length': String(body.length) });
  });
  it.each(['bytes=10-', 'bytes=6-2', 'bytes=-0', 'bytes=0-1,3-4', 'bytes=-', 'unknown'])('rejects invalid ranges %s with 416', async (range) => {
    const h = setup(); const response = await h.app.inject({ url: `${base}/file`, headers: { range } });
    expect(response.statusCode).toBe(416); expect(response.headers['content-range']).toBe('bytes */10');
  });
  it('serves a complete file and poster and refuses non-READY video', async () => {
    const h = setup(); expect((await h.app.inject(`${base}/file`)).body).toBe('0123456789');
    expect((await h.app.inject(`${base}/poster`)).headers['content-type']).toBe('image/jpeg');
    h.video.status = 'PROCESSING'; expect((await h.app.inject(`${base}/file`)).statusCode).toBe(404);
  });
  it('retries FAILED originals and rejects others; guards discard references and restores', async () => {
    const h = setup(); expect((await h.app.inject({ method: 'POST', url: `${base}/retry` })).statusCode).toBe(200);
    expect(h.db.procedureVideo.updateMany).toHaveBeenCalledWith({ where: { id, status: 'FAILED', sourceStorageKey: { not: null } }, data: { status: 'PENDING', attempts: 0, errorCode: null, errorMessage: null } });
    h.db.procedureVideo.updateMany.mockResolvedValue({ count: 0 }); expect((await h.app.inject({ method: 'POST', url: `${base}/retry` })).statusCode).toBe(409);
    h.db.procedureVideoLink.count.mockResolvedValue(1); expect((await h.app.inject({ method: 'POST', url: `${base}/discard` })).statusCode).toBe(409);
    expect(h.db.procedureVideo.update).not.toHaveBeenCalled();
    h.db.procedureVideoLink.count.mockResolvedValue(0); await h.app.inject({ method: 'POST', url: `${base}/discard` });
    expect(h.db.procedureVideo.update).toHaveBeenLastCalledWith({ where: { id }, data: { discardedAt: expect.any(Date) } });
    await h.app.inject({ method: 'POST', url: `${base}/restore` });
    expect(h.db.procedureVideo.update).toHaveBeenLastCalledWith({ where: { id }, data: { discardedAt: null } });
  });
  it('replaces page video ordering under a document lock with the overlay access password', async () => {
    const h = setup(); const response = await h.app.inject({ method: 'PUT', url: pagePath, payload: { videoIds: [secondId, id], accessPassword: 'secret' } });
    expect(response.statusCode).toBe(200); expect(h.access.requireAccessPassword).toHaveBeenCalledExactlyOnceWith('secret');
    expect(h.db.procedureVideoLink.deleteMany).toHaveBeenCalledWith({ where: { assemblyProcedureDocumentId: id, pageIndex: 0 } });
    expect(h.db.procedureVideoLink.createMany).toHaveBeenCalledWith({ data: [{ videoId: secondId, assemblyProcedureDocumentId: id, pageIndex: 0, sortOrder: 0 }, { videoId: id, assemblyProcedureDocumentId: id, pageIndex: 0, sortOrder: 1 }] });
    expect((await h.app.inject(pagePath)).json().videos).toHaveLength(1);
    h.db.procedureVideo.count.mockResolvedValue(0);
    expect((await h.app.inject({ method: 'PUT', url: pagePath, payload: { videoIds: [] } })).statusCode).toBe(200);
  });
  it.each([{ status: 'PUBLISHED', isActive: true, isRevisionHead: true }, { status: 'DRAFT', isActive: false, isRevisionHead: true }, { status: 'DRAFT', isActive: true, isRevisionHead: false }])('refuses non-editable document %j', async (document) => {
    const h = setup(); h.db.$queryRaw.mockResolvedValue([document]);
    expect((await h.app.inject({ method: 'PUT', url: pagePath, payload: { videoIds: [id] } })).statusCode).toBe(409);
    expect(h.db.procedureVideoLink.deleteMany).not.toHaveBeenCalled();
  });
  it('refuses password denial, duplicate IDs, missing pages and discarded/missing videos without replacing links', async () => {
    const h = setup(); h.access.requireAccessPassword.mockRejectedValueOnce(new ApiError(403, 'パスワードが違います'));
    expect((await h.app.inject({ method: 'PUT', url: pagePath, payload: { videoIds: [] } })).statusCode).toBe(403);
    expect((await h.app.inject({ method: 'PUT', url: pagePath, payload: { videoIds: [id, id] } })).statusCode).toBe(400);
    h.db.procedureVideo.count.mockResolvedValue(0);
    expect((await h.app.inject({ method: 'PUT', url: pagePath, payload: { videoIds: [id] } })).statusCode).toBe(409);
    h.db.assemblyProcedureDocumentPage.findUnique.mockResolvedValue(null);
    expect((await h.app.inject({ method: 'PUT', url: pagePath, payload: { videoIds: [] } })).statusCode).toBe(400);
    expect(h.db.procedureVideoLink.deleteMany).not.toHaveBeenCalled();
  });
  it('enforces view/write authorization before storage/database operations', async () => {
    const view = setup('view'); expect((await view.app.inject(`${base}/file`)).statusCode).toBe(403); expect(view.store.read).not.toHaveBeenCalled();
    const write = setup('write'); expect((await write.app.inject({ method: 'PUT', url: pagePath, payload: { videoIds: [] } })).statusCode).toBe(403); expect(write.db.$transaction).not.toHaveBeenCalled();
  });
  it('records a trim request without changing the original file and resets attempts', async () => {
    const h = setup();
    const response = await h.app.inject({ method: 'POST', url: `${base}/trim`, payload: { startSeconds: 1, endSeconds: 10.5 } });
    expect(response.statusCode).toBe(200);
    expect(h.db.procedureVideo.update).toHaveBeenCalledWith({ where: { id }, data: { status: 'PENDING', trimRequest: { startSeconds: 1, endSeconds: 10.5, requestedAt: expect.any(String) }, attempts: 0, errorCode: null, errorMessage: null } });
    expect(h.store.read).not.toHaveBeenCalled();
  });
  it.each(['PENDING', 'PROCESSING', 'FAILED'])('refuses trim of %s', async (status) => {
    const h = setup(); h.video.status = status;
    expect((await h.app.inject({ method: 'POST', url: `${base}/trim`, payload: { startSeconds: 0, endSeconds: 1 } })).statusCode).toBe(409);
    expect(h.db.procedureVideo.update).not.toHaveBeenCalled();
  });
  it.each([{ startSeconds: -0.1, endSeconds: 1 }, { startSeconds: 1, endSeconds: 1 }, { startSeconds: 2, endSeconds: 1 }, { startSeconds: 0, endSeconds: 10.6 }, { startSeconds: 1, endSeconds: 1.49 }, { startSeconds: '0', endSeconds: 1 }])('refuses invalid trim %j', async (payload) => {
    const h = setup();
    expect((await h.app.inject({ method: 'POST', url: `${base}/trim`, payload })).statusCode).toBe(400);
    expect(h.db.procedureVideo.update).not.toHaveBeenCalled();
  });
  it('accepts a half-second trim and refuses linked or missing videos', async () => {
    const h = setup();
    expect((await h.app.inject({ method: 'POST', url: `${base}/trim`, payload: { startSeconds: 0, endSeconds: 0.5 } })).statusCode).toBe(200);
    expect((await h.app.inject({ method: 'POST', url: `${base}/trim`, payload: { startSeconds: 0.2, endSeconds: 0.7 } })).statusCode).toBe(200);
    h.db.procedureVideoLink.count.mockResolvedValue(1);
    const linked = await h.app.inject({ method: 'POST', url: `${base}/trim`, payload: { startSeconds: 0, endSeconds: 1 } });
    expect(linked.statusCode).toBe(409); expect(linked.body).toContain('紐づけを外してからトリミングしてください');
    h.db.procedureVideo.findUnique.mockResolvedValue(null);
    expect((await h.app.inject({ method: 'POST', url: `${base}/trim`, payload: { startSeconds: 0, endSeconds: 1 } })).statusCode).toBe(404);
  });
  it('refuses >10.5-second page links without hiding existing links on reads', async () => {
    const h = setup(); h.db.procedureVideo.count.mockResolvedValue(1);
    expect((await h.app.inject({ method: 'PUT', url: pagePath, payload: { videoIds: [id] } })).statusCode).toBe(200);
    h.db.procedureVideoLink.deleteMany.mockClear();
    h.video.durationSeconds = 10.51; h.db.procedureVideo.findFirst.mockResolvedValue(h.video);
    const response = await h.app.inject({ method: 'PUT', url: pagePath, payload: { videoIds: [id] } });
    expect(response.statusCode).toBe(400); expect(response.body).toContain('10 秒以内にトリミングしてください');
    expect(h.db.procedureVideoLink.deleteMany).not.toHaveBeenCalled();
    expect((await h.app.inject(pagePath)).json().videos[0].durationSeconds).toBe(10.51);
  });
  it('refuses linking a pending trim from a stale shelf', async () => {
    const h = setup(); h.db.procedureVideo.count.mockResolvedValue(1);
    h.db.procedureVideo.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(h.video);
    expect((await h.app.inject({ method: 'PUT', url: pagePath, payload: { videoIds: [id] } })).statusCode).toBe(409);
    expect(h.db.procedureVideoLink.deleteMany).not.toHaveBeenCalled();
  });
  it('replaces comments with trimmed text and time ordering, including endpoints and clearing all', async () => {
    const h = setup();
    const response = await h.app.inject({ method: 'PUT', url: `${base}/comments`, payload: { comments: [{ atSeconds: 10.5, text: ' 最後 ' }, { atSeconds: 0, text: '開始' }, { atSeconds: 3, text: 'あ'.repeat(80) }] } });
    expect(response.statusCode).toBe(200);
    expect(h.db.procedureVideoComment.createMany).toHaveBeenCalledWith({ data: [{ videoId: id, atSeconds: 0, text: '開始', sortOrder: 0 }, { videoId: id, atSeconds: 3, text: 'あ'.repeat(80), sortOrder: 1 }, { videoId: id, atSeconds: 10.5, text: '最後', sortOrder: 2 }] });
    expect((await h.app.inject(`${base}/comments`)).statusCode).toBe(200);
    expect(h.db.procedureVideoComment.findMany).toHaveBeenCalledWith({ where: { videoId: id }, orderBy: { sortOrder: 'asc' } });
    h.db.procedureVideoComment.createMany.mockClear();
    expect((await h.app.inject({ method: 'PUT', url: `${base}/comments`, payload: { comments: [] } })).statusCode).toBe(200);
    expect(h.db.procedureVideoComment.createMany).not.toHaveBeenCalled();
  });
  it.each([
    Array.from({ length: 6 }, () => ({ atSeconds: 0, text: '文' })),
    [{ atSeconds: 0, text: 'あ'.repeat(81) }], [{ atSeconds: 0, text: '  ' }],
    [{ atSeconds: -0.1, text: '文' }], [{ atSeconds: 10.51, text: '文' }],
  ])('refuses invalid comments %j without deleting existing comments', async (...comments) => {
    const h = setup();
    expect((await h.app.inject({ method: 'PUT', url: `${base}/comments`, payload: { comments } })).statusCode).toBe(400);
    expect(h.db.procedureVideoComment.deleteMany).not.toHaveBeenCalled();
  });
  it('refuses edits during processing and missing video comment reads/writes', async () => {
    const h = setup(); h.video.status = 'PROCESSING';
    expect((await h.app.inject({ method: 'PUT', url: `${base}/comments`, payload: { comments: [] } })).statusCode).toBe(409);
    h.db.procedureVideo.findUnique.mockResolvedValue(null);
    expect((await h.app.inject(`${base}/comments`)).statusCode).toBe(404);
    expect((await h.app.inject({ method: 'PUT', url: `${base}/comments`, payload: { comments: [] } })).statusCode).toBe(404);
  });
  it('guards trim and comments with the existing view/write permissions', async () => {
    const h = setup('write');
    expect((await h.app.inject({ method: 'POST', url: `${base}/trim`, payload: { startSeconds: 0, endSeconds: 1 } })).statusCode).toBe(403);
    expect((await h.app.inject({ method: 'PUT', url: `${base}/comments`, payload: { comments: [] } })).statusCode).toBe(403);
    expect(h.db.$transaction).not.toHaveBeenCalled();
    const view = setup('view');
    expect((await view.app.inject(`${base}/comments`)).statusCode).toBe(403);
    expect(view.db.procedureVideoComment.findMany).not.toHaveBeenCalled();
  });

});
