import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '../../../lib/errors.js';
import { registerErrorHandler } from '../../../plugins/error-handler.js';
import { defaultBackupConfig } from '../../../services/backup/backup-config.js';
import { BackupConfigLoader } from '../../../services/backup/backup-config.loader.js';
import { ProcedureMaterialService } from '../../../services/assembly/procedure-material.service.js';
import { registerProcedureMaterialRoutes } from '../procedure-materials.js';

const id = '00000000-0000-4000-8000-000000000001';
const base = '/assembly/procedure-materials';
describe('procedure-material routes with mocked Prisma', () => {
  let app: ReturnType<typeof Fastify>;
  afterEach(async () => { await app?.close(); });
  function harness(deny: 'view' | 'write' | null = null) {
    const material = { id, kind: 'TEXT', text: '手順', documentId: null, placedAt: null, discardedAt: null, storageKey: null };
    const db = { $queryRaw: vi.fn(), $transaction: vi.fn(async (work: (tx: unknown) => Promise<unknown>) => work(db)), procedureMaterial: {
      findMany: vi.fn().mockResolvedValue([material]), findUnique: vi.fn().mockResolvedValue(material),
      update: vi.fn(async ({ data }: { data: object }) => Object.assign(material, data)),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    } };
    const importer = { importDraft: vi.fn().mockResolvedValue({ id: 'document-1', name: 'DFD1 組立' }) };
    const store = { read: vi.fn().mockResolvedValue(Buffer.from('photo-original')) };
    const gc = { collect: vi.fn().mockResolvedValue({ scanned: 3, deleted: 1 }) };
    const ingestion = { runOnce: vi.fn().mockResolvedValue({ scanned: 1, deferred: 0, saved: 1, messages: [{ messageId: 'gmail-1', status: 'saved', trashed: true }] }) };
    const loadConfig = vi.fn().mockResolvedValue(defaultBackupConfig);
    app = Fastify(); registerErrorHandler(app);
    registerProcedureMaterialRoutes(app, {
      service: new ProcedureMaterialService(db as never, store as never, importer as never), ingestion, loadConfig, gc: gc as never,
      allowView: async () => { if (deny === 'view') throw new ApiError(403, '権限がありません'); },
      allowWriteKiosk: async () => { if (deny === 'write') throw new ApiError(403, '権限がありません'); },
    });
    return { db, store, importer, ingestion, loadConfig, material, gc };
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
  it('creates a document from original PDF bytes and rejects a second request', async () => {
    const { material, db, store, importer } = harness();
    Object.assign(material, { kind: 'PDF', storageKey: 'procedure-materials/pdf/original', originalFileName: '素材.pdf', subjectHint: 'DFD1 組立' });
    const response = await app.inject({ method: 'POST', url: `${base}/${id}/create-document` });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ document: { id: 'document-1', name: 'DFD1 組立' } });
    expect(store.read).toHaveBeenCalledWith('procedure-materials/pdf/original', { verifyIntegrity: true });
    expect(importer.importDraft).toHaveBeenCalledExactlyOnceWith({
      name: 'DFD1 組立', avoidDuplicateName: true, buffer: Buffer.from('photo-original'),
      mimetype: 'application/pdf', filename: '素材.pdf', transaction: db,
      source: { sourceType: 'MANUAL', sourceAttachmentName: '素材.pdf' },
    });
    expect(material).toMatchObject({ documentId: 'document-1', placedAt: expect.any(Date) });
    db.procedureMaterial.updateMany.mockResolvedValueOnce({ count: 0 });
    const unplace = await app.inject({ method: 'POST', url: `${base}/${id}/unplace` });
    expect(unplace.statusCode).toBe(409);
    expect(unplace.json().message).toBe('要領書を作成済みの PDF は配置を取り消せません');
    expect(db.procedureMaterial.updateMany).toHaveBeenCalledWith({
      where: { id, OR: [{ kind: { not: 'PDF' } }, { documentId: null }] },
      data: { documentId: null, placedAt: null },
    });
    expect(material).toMatchObject({ documentId: 'document-1', placedAt: expect.any(Date) });
    const second = await app.inject({ method: 'POST', url: `${base}/${id}/create-document` });
    expect(second.statusCode).toBe(409);
    expect(second.json().message).toBe('この PDF からは作成済みです');
    expect(importer.importDraft).toHaveBeenCalledOnce();
  });
  it('uses the PDF filename without its extension when the hint is absent', async () => {
    const { material, importer } = harness();
    Object.assign(material, { kind: 'PDF', storageKey: 'pdf', originalFileName: '組立.v1.pdf' });
    expect((await app.inject({ method: 'POST', url: `${base}/${id}/create-document` })).statusCode).toBe(200);
    expect(importer.importDraft).toHaveBeenCalledWith(expect.objectContaining({ name: '組立.v1' }));
  });
  it.each(['TEXT', 'PHOTO'])('rejects creating a document from %s', async (kind) => {
    const { material, importer } = harness();
    material.kind = kind;
    expect((await app.inject({ method: 'POST', url: `${base}/${id}/create-document` })).statusCode).toBe(400);
    expect(importer.importDraft).not.toHaveBeenCalled();
  });
  it('rejects discarded or missing PDFs and preserves the shelf when import fails', async () => {
    const { material, db, importer } = harness();
    Object.assign(material, { kind: 'PDF', storageKey: 'pdf', discardedAt: new Date() });
    expect((await app.inject({ method: 'POST', url: `${base}/${id}/create-document` })).statusCode).toBe(409);
    expect(importer.importDraft).not.toHaveBeenCalled();
    Object.assign(material, { discardedAt: null });
    importer.importDraft.mockRejectedValueOnce(new Error('import failed'));
    expect((await app.inject({ method: 'POST', url: `${base}/${id}/create-document` })).statusCode).toBe(500);
    expect(db.procedureMaterial.update).not.toHaveBeenCalled();
    expect(material.documentId).toBeNull();
    db.procedureMaterial.findUnique.mockResolvedValueOnce(null);
    expect((await app.inject({ method: 'POST', url: `${base}/${id}/create-document` })).statusCode).toBe(404);
  });
  it('manually collects unreferenced original files', async () => {
    const { gc } = harness();
    const response = await app.inject({ method: 'POST', url: `${base}/gc` });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ scanned: 3, deleted: 1 });
    expect(gc.collect).toHaveBeenCalledOnce();
  });
  it.each(['TEXT', 'PHOTO', 'PDF'])('returns %s to the shelf and handles missing materials (PDF without a document)', async (kind) => {
    const { db, material } = harness();
    Object.assign(material, { kind, documentId: kind === 'PDF' ? null : 'document-1', placedAt: new Date() });
    expect((await app.inject({ method: 'POST', url: `${base}/${id}/unplace` })).statusCode).toBe(200);
    expect(db.procedureMaterial.updateMany).toHaveBeenCalledWith({ where: { id, OR: [{ kind: { not: 'PDF' } }, { documentId: null }] }, data: { documentId: null, placedAt: null } });
    db.procedureMaterial.updateMany.mockResolvedValueOnce({ count: 0 });
    db.procedureMaterial.findUnique.mockResolvedValueOnce(null);
    expect((await app.inject({ method: 'POST', url: `${base}/${id}/unplace` })).statusCode).toBe(404);
  });
  it('loads the backup config as a method when no loader is injected', async () => {
    const { ingestion } = harness();
    app = Fastify(); registerErrorHandler(app);
    registerProcedureMaterialRoutes(app, {
      service: new ProcedureMaterialService({ procedureMaterial: {} } as never, {} as never), ingestion, gc: { collect: vi.fn() } as never,
      allowView: async () => {}, allowWriteKiosk: async () => {},
    });
    const load = vi.spyOn(BackupConfigLoader, 'load').mockImplementation(async function (this: unknown) {
      if (this !== BackupConfigLoader) throw new TypeError("Cannot read properties of undefined (reading 'configPath')");
      return defaultBackupConfig;
    });
    const response = await app.inject({ method: 'POST', url: `${base}/ingest-gmail`, payload: {} });
    expect(response.statusCode).toBe(200);
    expect(load).toHaveBeenCalledTimes(1);
    expect(ingestion.runOnce).toHaveBeenCalledWith({ config: defaultBackupConfig, allowWait: true, manual: true });
    load.mockRestore();
  });
  it('manually ingests while disabled and returns per-message status/counts', async () => {
    const { ingestion } = harness();
    const response = await app.inject({ method: 'POST', url: `${base}/ingest-gmail`, payload: { messageId: 'gmail-1', forceRetry: true } });
    expect(response.statusCode).toBe(200); expect(response.json()).toMatchObject({ scanned: 1, deferred: 0, saved: 1, messages: [{ status: 'saved', trashed: true }] });
    expect(ingestion.runOnce).toHaveBeenCalledWith({ config: defaultBackupConfig, allowWait: true, manual: true, messageId: 'gmail-1', forceRetry: true });
  });
  it.each([['GET', base], ['GET', `${base}/${id}/file`], ['POST', `${base}/ingest-gmail`], ['POST', `${base}/${id}/discard`], ['POST', `${base}/${id}/restore`], ['POST', `${base}/${id}/unplace`], ['POST', `${base}/gc`], ['POST', `${base}/${id}/create-document`]] as const)('rejects unauthorized %s %s before touching materials', async (method, url) => {
    const { db, ingestion, loadConfig } = harness(method === 'GET' ? 'view' : 'write');
    expect((await app.inject({ method, url })).statusCode).toBe(403);
    expect(db.procedureMaterial.findMany).not.toHaveBeenCalled(); expect(db.procedureMaterial.findUnique).not.toHaveBeenCalled(); expect(db.procedureMaterial.updateMany).not.toHaveBeenCalled();
    expect(loadConfig).not.toHaveBeenCalled(); expect(ingestion.runOnce).not.toHaveBeenCalled();
  });
});
