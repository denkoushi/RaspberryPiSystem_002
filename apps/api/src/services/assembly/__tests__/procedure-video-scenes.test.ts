import { writeFile } from 'node:fs/promises';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { logger } from '../../../lib/logger.js';
import { ProcedureVideoService } from '../procedure-video.service.js';

function harness() {
  const video = { status: 'READY', discardedAt: null, trimRequest: null, durationSeconds: 60, storageKey: 'procedure-videos/video/video.mp4' };
  const scene = { id: 'scene', title: '場面 1', startSeconds: 0.1, endSeconds: 0.6, posterStorageKey: null as string | null };
  const db = {
    $transaction: vi.fn(), $queryRaw: vi.fn().mockResolvedValue([{ id: 'video' }]),
    procedureVideo: { findUnique: vi.fn().mockResolvedValue(video), update: vi.fn() },
    procedureVideoScene: { count: vi.fn().mockResolvedValue(0), findFirst: vi.fn().mockResolvedValue(scene), create: vi.fn(async ({ data }) => ({ ...scene, ...data })), update: vi.fn(async ({ data }) => ({ ...scene, ...data })), delete: vi.fn(), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    procedureVideoLink: { count: vi.fn().mockResolvedValue(0) },
  };
  let inTransaction = false;
  db.$transaction.mockImplementation(async (work) => {
    inTransaction = true;
    try { return await work(db); }
    finally { inTransaction = false; }
  });
  const store = { read: vi.fn().mockResolvedValue(Buffer.from('mp4')), write: vi.fn(async (_request: { key: string; data: Buffer; mode: string; integrity: boolean }) => undefined), delete: vi.fn() };
  const transcoder = { posterAt: vi.fn(async (_input: string, poster: string, _startSeconds: number) => {
    expect(inTransaction).toBe(false);
    await writeFile(poster, Buffer.from('scene jpeg'));
  }) };
  return { db, scene, store, transcoder, service: new ProcedureVideoService(db as never, store as never, undefined, transcoder as never) };
}
afterEach(() => vi.restoreAllMocks());
describe('procedure-video scenes service', () => {
  it('rounds ranges and accepts a half second despite floating point subtraction', async () => {
    const h = harness();
    expect(await h.service.createScene('video', { startSeconds: 0.12, endSeconds: 0.62, title: '  確認  ' })).toEqual({ id: 'scene', title: '確認', startSeconds: 0.1, endSeconds: 0.6, linkCount: 0, hasScenePoster: true });
    expect(h.db.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(h.db.procedureVideoScene.create.mock.invocationCallOrder[0]);
  });
  it.each([NaN, Infinity, -Infinity])('rejects non-finite scene endpoints %s', async (value) => {
    const h = harness();
    await expect(h.service.createScene('video', { startSeconds: value, endSeconds: 10 })).rejects.toMatchObject({ statusCode: 400 });
    await expect(h.service.createScene('video', { startSeconds: 0, endSeconds: value })).rejects.toMatchObject({ statusCode: 400 });
    expect(h.db.procedureVideoScene.create).not.toHaveBeenCalled();
  });
  it('defaults titles, accepts the complete video and enforces the scene cap', async () => {
    const h = harness(); h.db.procedureVideoScene.count.mockResolvedValue(19);
    expect(await h.service.createScene('video', { startSeconds: 0, endSeconds: 60 })).toMatchObject({ title: '場面 20', startSeconds: 0, endSeconds: 60 });
    h.db.procedureVideoScene.count.mockResolvedValue(20);
    await expect(h.service.createScene('video', { startSeconds: 0, endSeconds: 60 })).rejects.toThrow('場面は20件までです');
    expect(h.db.procedureVideo.update).not.toHaveBeenCalled();
  });
  it('updates an unlinked range and deletes it only after locking the video', async () => {
    const h = harness();
    expect(await h.service.updateScene('video', 'scene', { endSeconds: 12.12 })).toMatchObject({ startSeconds: 0.1, endSeconds: 12.1 });
    await h.service.deleteScene('video', 'scene');
    expect(h.db.procedureVideoScene.findFirst).toHaveBeenCalledWith({ where: { id: 'scene', videoId: 'video' } });
    expect(h.db.$queryRaw.mock.invocationCallOrder[1]).toBeLessThan(h.db.procedureVideoScene.delete.mock.invocationCallOrder[0]);
  });
  it('renames linked scenes and permits unchanged ranges while refusing range changes/deletion', async () => {
    const h = harness(); h.db.procedureVideoLink.count.mockResolvedValue(1);
    expect(await h.service.updateScene('video', 'scene', { title: '名前', startSeconds: 0.1 })).toMatchObject({ title: '名前', linkCount: 1 });
    await expect(h.service.updateScene('video', 'scene', { endSeconds: 10 })).rejects.toThrow('ページに紐づいている場面の範囲は変えられません');
    await expect(h.service.deleteScene('video', 'scene')).rejects.toThrow('ページに紐づいている場面は削除できません');
    expect(h.db.procedureVideoScene.delete).not.toHaveBeenCalled();
  });
  it('generates the start frame after create commits, stores it in the protected prefix and exposes its flag', async () => {
    const h = harness();
    expect(await h.service.createScene('video', { startSeconds: 2.14, endSeconds: 8 })).toMatchObject({ hasScenePoster: true });
    expect(h.store.read).toHaveBeenCalledWith('procedure-videos/video/video.mp4', { verifyIntegrity: true });
    expect(h.transcoder.posterAt).toHaveBeenCalledWith(expect.stringMatching(/video\.mp4$/), expect.stringMatching(/poster\.jpg$/), 2.1);
    const key = h.store.write.mock.calls[0][0].key;
    expect(key).toMatch(/^procedure-videos\/scenes\/scene\/[a-f0-9-]+\/poster.jpg$/);
    expect(h.store.write).toHaveBeenCalledWith({ key, data: Buffer.from('scene jpeg'), mode: 'create', integrity: true });
    expect(h.db.procedureVideoScene.updateMany).toHaveBeenCalledWith({ where: { id: 'scene', videoId: 'video', startSeconds: 2.1, posterStorageKey: null }, data: { posterStorageKey: key } });
  });
  it('regenerates on either endpoint change, clears and deletes the old file, and preserves it on rename', async () => {
    const h = harness(); h.scene.posterStorageKey = 'procedure-videos/scenes/old.jpg';
    await h.service.updateScene('video', 'scene', { startSeconds: 0.2, endSeconds: 2 });
    expect(h.db.procedureVideoScene.update).toHaveBeenCalledWith(expect.objectContaining({ data: { startSeconds: 0.2, endSeconds: 2, posterStorageKey: null } }));
    expect(h.store.delete).toHaveBeenCalledWith('procedure-videos/scenes/old.jpg', { integrity: true });
    expect(h.transcoder.posterAt.mock.calls[0][2]).toBe(0.2);
    h.transcoder.posterAt.mockClear(); h.store.delete.mockClear();
    await h.service.updateScene('video', 'scene', { endSeconds: 4 });
    expect(h.transcoder.posterAt.mock.calls[0][2]).toBe(0.1);
    h.transcoder.posterAt.mockClear(); h.store.delete.mockClear();
    expect(await h.service.updateScene('video', 'scene', { title: '名前' })).toMatchObject({ hasScenePoster: true });
    expect(h.transcoder.posterAt).not.toHaveBeenCalled(); expect(h.store.delete).not.toHaveBeenCalled();
  });
  it.each(['extract', 'read', 'store', 'publish'])('logs %s failure without failing creation or range update and leaves the flag false', async (stage) => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    const h = harness(); const error = new Error(stage);
    if (stage === 'extract') h.transcoder.posterAt.mockRejectedValue(error);
    if (stage === 'read') h.store.read.mockRejectedValue(error);
    if (stage === 'store') h.store.write.mockRejectedValue(error);
    if (stage === 'publish') h.db.procedureVideoScene.updateMany.mockRejectedValue(error);
    expect(await h.service.createScene('video', { startSeconds: 0, endSeconds: 2 })).toMatchObject({ hasScenePoster: false });
    h.scene.posterStorageKey = 'procedure-videos/scenes/old.jpg';
    expect(await h.service.updateScene('video', 'scene', { endSeconds: 3 })).toMatchObject({ hasScenePoster: false });
    expect(h.db.procedureVideoScene.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ posterStorageKey: null }) }));
    expect(warn).toHaveBeenCalledWith(expect.objectContaining({ videoId: 'video', sceneId: 'scene', err: error }), 'Procedure video scene poster generation failed');
  });
  it.each(['range changed', 'scene deleted', 'poster already published'])('skips stale publication when %s and removes only its own file', async (race) => {
    const h = harness(); let exists = true;
    h.db.procedureVideoScene.create.mockImplementation(async ({ data }) => Object.assign(h.scene, data));
    h.transcoder.posterAt.mockImplementation(async (_input, poster) => {
      await writeFile(poster, 'stale frame');
      if (race === 'range changed') h.scene.startSeconds = 1;
      if (race === 'scene deleted') exists = false;
      if (race === 'poster already published') h.scene.posterStorageKey = 'procedure-videos/scenes/winner.jpg';
    });
    h.db.procedureVideoScene.updateMany.mockImplementation(async ({ where }: { where: { startSeconds: number; posterStorageKey: string | null } }) => ({ count: Number(exists && h.scene.startSeconds === where.startSeconds && h.scene.posterStorageKey === where.posterStorageKey) }));
    expect(await h.service.createScene('video', { startSeconds: 0, endSeconds: 2 })).toMatchObject({ hasScenePoster: false });
    expect(h.store.delete).toHaveBeenCalledWith(h.store.write.mock.calls[0][0].key, { integrity: true });
  });
  it('deletes the poster after scene deletion commits, and logs cleanup failures without failing deletion', async () => {
    const h = harness(); h.scene.posterStorageKey = 'procedure-videos/scenes/old.jpg';
    await h.service.deleteScene('video', 'scene');
    expect(h.db.procedureVideoScene.delete.mock.invocationCallOrder[0]).toBeLessThan(h.store.delete.mock.invocationCallOrder[0]);
    expect(h.store.delete).toHaveBeenCalledWith(h.scene.posterStorageKey, { integrity: true });
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    h.store.delete.mockRejectedValue(new Error('storage down'));
    await expect(h.service.deleteScene('video', 'scene')).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
  });

});
