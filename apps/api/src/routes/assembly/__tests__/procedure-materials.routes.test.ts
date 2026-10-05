import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '../../../lib/errors.js';
import { registerErrorHandler } from '../../../plugins/error-handler.js';
import { defaultBackupConfig } from '../../../services/backup/backup-config.js';
import { ProcedureMaterialService } from '../../../services/assembly/procedure-material.service.js';
import { registerProcedureMaterialRoutes } from '../procedure-materials.js';

const id = '00000000-0000-4000-8000-000000000001';
const base = '/assembly/procedure-materials';
describe('procedure-material routes with mocked Prisma', () => {
  let app: ReturnType<typeof Fastify>;
  afterEach(async () => { await app?.close(); });
  function harness(deny: 'view' | 'write' | null = null) {
    const material = { id, kind: 'TEXT', text: '手順', documentId: null, placedAt: null, discardedAt: null, storageKey: null };
    const db = { procedureMaterial: {
      findMany: vi.fn().mockResolvedValue([material]), findUnique: vi.fn().mockResolvedValue(material),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    } };
    const store = { read: vi.fn().mockResolvedValue(Buffer.from('photo-original')) };
    const ingestion = { runOnce: vi.fn().mockResolvedValue({ scanned: 1, saved: 1, messages: [{ messageId: 'gmail-1', status: 'saved', trashed: true }] }) };
    const loadConfig = vi.fn().mockResolvedValue(defaultBackupConfig);
    app = Fastify(); registerErrorHandler(app);
    registerProcedureMaterialRoutes(app, {
      service: new ProcedureMaterialService(db as never, store as never), ingestion, loadConfig,
      allowView: async () => { if (deny === 'view') throw new ApiError(403, '権限がありません'); },
      allowWriteKiosk: async () => { if (deny === 'write') throw new ApiError(403, '権限がありません'); },
    });
    return { db, store, ingestion, loadConfig, material };
  }
  it.each([
    ['unplaced', { documentId: null, placedAt: null, discardedAt: null }],
    ['placed', { discardedAt: null, OR: [{ documentId: { not: null } }, { placedAt: { not: null } }] }],
    ['discarded', { discardedAt: { not: null } }], ['all', {}],
  ])('filters state=%s and hint with a newest-first limit', async (state, where) => {
    const { db } = harness();
    const response = await app.inject({ method: 'GET', url: `${base}?state=${state}&q=DFD1&limit=12` });
    expect(response.statusCode).toBe(200); expect(response.json().materials[0].text).toBe('手順');
    expect(db.procedureMaterial.findMany).toHaveBeenCalledWith({ where: { ...where, subjectHint: { contains: 'DFD1', mode: 'insensitive' } }, orderBy: [{ receivedAt: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }], take: 12 });
  });
  it('defaults to 100 unplaced materials and rejects invalid filters', async () => {
    const { db } = harness();
    expect((await app.inject({ method: 'GET', url: base })).statusCode).toBe(200);
    expect(db.procedureMaterial.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { documentId: null, placedAt: null, discardedAt: null }, take: 100 }));
    for (const query of ['state=invalid', 'limit=0', 'limit=501']) expect((await app.inject({ method: 'GET', url: `${base}?${query}` })).statusCode).toBe(400);
  });
  it('returns 404 for TEXT, missing materials, or a PHOTO without a storage key', async () => {
    const { db, store } = harness();
    expect((await app.inject({ method: 'GET', url: `${base}/${id}/file` })).statusCode).toBe(404);
    db.procedureMaterial.findUnique.mockResolvedValueOnce(null);
    expect((await app.inject({ method: 'GET', url: `${base}/${id}/file` })).statusCode).toBe(404);
    db.procedureMaterial.findUnique.mockResolvedValueOnce({ kind: 'PHOTO', storageKey: null });
    expect((await app.inject({ method: 'GET', url: `${base}/${id}/file` })).statusCode).toBe(404);
    expect(store.read).not.toHaveBeenCalled();
  });
  it('returns original PHOTO bytes privately without caching', async () => {
    const { db, store } = harness();
    db.procedureMaterial.findUnique.mockResolvedValue({ kind: 'PHOTO', storageKey: 'procedure-materials/hash/original', contentType: 'image/png' });
    const response = await app.inject({ method: 'GET', url: `${base}/${id}/file` });
    expect(response.statusCode).toBe(200); expect(response.body).toBe('photo-original');
    expect(response.headers['cache-control']).toBe('private, no-store'); expect(response.headers['content-type']).toBe('image/png');
    expect(store.read).toHaveBeenCalledWith('procedure-materials/hash/original', { verifyIntegrity: true });
  });
  it('discards/restores only unplaced materials and rejects missing or placed materials', async () => {
    const { db } = harness();
    expect((await app.inject({ method: 'POST', url: `${base}/${id}/discard` })).statusCode).toBe(200);
    expect(db.procedureMaterial.updateMany).toHaveBeenLastCalledWith({ where: { id, documentId: null, placedAt: null }, data: { discardedAt: expect.any(Date) } });
    expect((await app.inject({ method: 'POST', url: `${base}/${id}/restore` })).statusCode).toBe(200);
    expect(db.procedureMaterial.updateMany).toHaveBeenLastCalledWith({ where: { id, documentId: null, placedAt: null }, data: { discardedAt: null } });
    db.procedureMaterial.updateMany.mockResolvedValue({ count: 0 });
    for (const action of ['discard', 'restore']) expect((await app.inject({ method: 'POST', url: `${base}/${id}/${action}` })).statusCode).toBe(409);
    db.procedureMaterial.findUnique.mockResolvedValue(null);
    expect((await app.inject({ method: 'POST', url: `${base}/${id}/restore` })).statusCode).toBe(404);
  });
  it('manually ingests while disabled and returns per-message status/counts', async () => {
    const { ingestion } = harness();
    const response = await app.inject({ method: 'POST', url: `${base}/ingest-gmail`, payload: { messageId: 'gmail-1', forceRetry: true } });
    expect(response.statusCode).toBe(200); expect(response.json()).toMatchObject({ saved: 1, messages: [{ status: 'saved', trashed: true }] });
    expect(ingestion.runOnce).toHaveBeenCalledWith({ config: defaultBackupConfig, allowWait: true, manual: true, messageId: 'gmail-1', forceRetry: true });
  });
  it.each([['GET', base], ['GET', `${base}/${id}/file`], ['POST', `${base}/ingest-gmail`], ['POST', `${base}/${id}/discard`], ['POST', `${base}/${id}/restore`]] as const)('rejects unauthorized %s %s before touching materials', async (method, url) => {
    const { db, ingestion, loadConfig } = harness(method === 'GET' ? 'view' : 'write');
    expect((await app.inject({ method, url })).statusCode).toBe(403);
    expect(db.procedureMaterial.findMany).not.toHaveBeenCalled(); expect(db.procedureMaterial.findUnique).not.toHaveBeenCalled(); expect(db.procedureMaterial.updateMany).not.toHaveBeenCalled();
    expect(loadConfig).not.toHaveBeenCalled(); expect(ingestion.runOnce).not.toHaveBeenCalled();
  });
});
