import { createHash } from 'node:crypto';

import { Prisma } from '@prisma/client';
import Fastify from 'fastify';
import sharp from 'sharp';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '../../../lib/errors.js';
import { registerErrorHandler } from '../../../plugins/error-handler.js';
import { ProcedureMaterialKnowledgeService } from '../../../services/assembly/procedure-material-knowledge.service.js';
import { ProcedureMaterialService } from '../../../services/assembly/procedure-material.service.js';
import { FileStorageAlreadyExistsError } from '../../../services/file-storage/file-storage-errors.js';
import { registerProcedureMaterialRoutes } from '../procedure-materials.js';

const base = '/assembly/procedure-materials';
const imageId = 'a'.repeat(64);
const originalId = 'b'.repeat(64);
const originalKey = `knowledge-assets/${originalId}/original`;
const stepPhotoKey = `knowledge:procedure:procedure-1:2:step-1:image:${imageId}`;
const sourceKey = 'knowledge:source:source-1:text';
const photoKey = `knowledge:source:source-1:image:${imageId}`;
const stepKey = 'knowledge:procedure:procedure-1:2:step-1:text';
const missing = () => Object.assign(new Error('missing'), { code: 'ENOENT' });

describe('procedure-material knowledge routes', () => {
  let app: ReturnType<typeof Fastify>;
  afterEach(async () => { await app?.close(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });
  async function harness(enabled = true, deny: 'view' | 'write' | null = null) {
    vi.stubEnv('HERMES_KNOWLEDGE_ENABLED', enabled ? 'true' : 'false');
    const bytes = await sharp({ create: { width: 2, height: 3, channels: 3, background: 'white' } }).png().toBuffer();
    const writes = { source: vi.fn(), procedure: vi.fn(), assets: vi.fn(), material: vi.fn() };
    const source = { source: { id: 'source-1', text: '元の投稿本文', capturedAt: '2026-10-01T00:00:00Z',
      images: [{ id: imageId, originalKey, displayKey: `knowledge-assets/${imageId}/display.jpg` }] },
      organized: { title: 'Chat タイトル', summary: '整理した要約', photos: [{ id: imageId, description: '工具の写真' }] } };
    const header = { id: 'procedure-1', title: '承認済み手順', partNumber: 'DFD1', processName: '組立', target: 'モータ', workType: '組立' };
    const document = { ...header, publishedRevision: { revisionNumber: 2, state: 'published', createdAt: new Date('2026-10-02T00:00:00Z'),
      content: { formatVersion: 1, steps: [{ id: 'step-1', title: '締める', body: 'ボルトを締める', cautions: ['指に注意'], needsReview: [],
        photos: [{ imageId, caption: 'ボルト' }], sources: [{ kind: 'note', ref: 'source-1', label: 'Chat 投稿' }] }] } } };
    const runtime = {
      repository: { readySources: vi.fn().mockResolvedValue([source]), create: writes.source },
      procedures: { listPublished: vi.fn(), getPublished: vi.fn(), publish: writes.procedure },
      assets: { readOriginal: vi.fn().mockResolvedValue(bytes), readDisplay: vi.fn().mockResolvedValue(bytes), save: writes.assets },
    };
    const db = {
      procedureMaterial: { findMany: vi.fn().mockResolvedValue([]), findUnique: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue({ id: 'material' }) },
      knowledgeProcedure: { findMany: vi.fn().mockResolvedValue([document]), update: writes.procedure },
      knowledgeProcedureMaterial: { findMany: vi.fn().mockResolvedValue([{ sourceId: 'source-1', procedure: header }]), update: writes.material },
    };
    const store = { write: vi.fn().mockResolvedValue({}), read: vi.fn().mockResolvedValue(bytes), stat: vi.fn().mockResolvedValue({}) };
    const factory = vi.fn(() => runtime);
    app = Fastify(); registerErrorHandler(app);
    const knowledge = new ProcedureMaterialKnowledgeService(db as never, store as never, factory as never);
    registerProcedureMaterialRoutes(app, { service: new ProcedureMaterialService(db as never, store as never),
      knowledge,
      allowView: async () => { if (deny === 'view') throw new ApiError(403, '権限がありません'); },
      allowWriteKiosk: async () => { if (deny === 'write') throw new ApiError(403, '権限がありません'); },
    });
    return { db, store, runtime, bytes, writes, factory, source, document, knowledge };
  }
  it('returns disabled without accessing the knowledge runtime and rejects import/images', async () => {
    const { factory, db } = await harness(false);
    expect((await app.inject(`${base}/knowledge-candidates`)).json()).toEqual({ enabled: false, items: [] });
    expect((await app.inject({ method: 'POST', url: `${base}/import-knowledge`, payload: { candidateKeys: [sourceKey] } })).statusCode).toBe(409);
    expect((await app.inject(`${base}/knowledge-candidates/images/${imageId}`)).statusCode).toBe(404);
    expect(factory).not.toHaveBeenCalled(); expect(db.procedureMaterial.findMany).not.toHaveBeenCalled();
  });
  it('lists source text/photos and published step text/photos with stable keys and imported status', async () => {
    const { db } = await harness(); db.procedureMaterial.findMany.mockResolvedValue([{ gmailDedupeKey: sourceKey }]);
    const response = await app.inject(`${base}/knowledge-candidates`);
    expect(response.statusCode).toBe(200);
    expect(response.json().items).toEqual([
      { candidateKey: sourceKey, kind: 'TEXT', title: 'Chat タイトル', summary: '整理した要約', preview: '元の投稿本文', sourceLabel: 'Chat 投稿', alreadyImported: true },
      { candidateKey: photoKey, kind: 'PHOTO', title: 'Chat タイトル', preview: '工具の写真', sourceLabel: 'Chat 投稿', imageId, alreadyImported: false },
      { candidateKey: stepKey, kind: 'TEXT', title: '締める', preview: '締める\nボルトを締める\n指に注意', sourceLabel: '手順書: 承認済み手順', alreadyImported: false },
      { candidateKey: `knowledge:procedure:procedure-1:2:step-1:image:${imageId}`, kind: 'PHOTO', title: '締める', preview: 'ボルト', sourceLabel: '手順書: 承認済み手順', imageId, alreadyImported: false },
    ]);
  });
  it.each([['dfd1', 4], ['組立', 4], ['モータ', 4], ['投稿本文', 2], ['ボルトを', 2], ['承認済み', 4], ['工具なし', 0]])('filters q=%s case insensitively before limiting', async (q, count) => {
    await harness();
    const response = await app.inject(`${base}/knowledge-candidates?q=${encodeURIComponent(q)}`);
    expect(response.json().items).toHaveLength(count);
  });
  it('limits after filtering and validates query/import bounds', async () => {
    await harness();
    expect((await app.inject(`${base}/knowledge-candidates?limit=1`)).json().items).toHaveLength(1);
    expect((await app.inject(`${base}/knowledge-candidates?limit=0`)).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: `${base}/import-knowledge`, payload: { candidateKeys: Array(51).fill(sourceKey) } })).statusCode).toBe(400);
  });
  it('imports original source TEXT and step body/cautions with provenance/date without knowledge writes', async () => {
    const { db, writes } = await harness();
    const response = await app.inject({ method: 'POST', url: `${base}/import-knowledge`, payload: { candidateKeys: [sourceKey, stepKey, 'unknown'] } });
    expect(response.json()).toEqual({ imported: 2, duplicate: 0, failed: [{ candidateKey: 'unknown', reason: '候補がありません' }] });
    expect(db.procedureMaterial.create).toHaveBeenNthCalledWith(1, { data: { kind: 'TEXT', origin: 'KNOWLEDGE', knowledgeRef: { kind: 'source', sourceId: 'source-1' },
      text: '元の投稿本文', gmailDedupeKey: sourceKey, subjectHint: 'Chat タイトル DFD1 組立', receivedAt: new Date('2026-10-01T00:00:00Z') } });
    expect(db.procedureMaterial.create).toHaveBeenNthCalledWith(2, { data: expect.objectContaining({ text: '締める\nボルトを締める\n指に注意',
      knowledgeRef: { kind: 'procedure_step', procedureId: 'procedure-1', revisionNumber: 2, stepId: 'step-1' }, receivedAt: new Date('2026-10-02T00:00:00Z') }) });
    Object.values(writes).forEach((write) => expect(write).not.toHaveBeenCalled());
  });
  it('copies PHOTO bytes to the shelf namespace, verifies existing bytes, and restores a GC race', async () => {
    const { db, store, bytes, runtime, writes } = await harness();
    store.write.mockRejectedValueOnce(new FileStorageAlreadyExistsError());
    store.stat.mockRejectedValueOnce(missing());
    const response = await app.inject({ method: 'POST', url: `${base}/import-knowledge`, payload: { candidateKeys: [photoKey] } });
    expect(response.json()).toEqual({ imported: 1, duplicate: 0, failed: [] });
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    expect(store.write).toHaveBeenCalledWith({ key: `procedure-materials/${sha256}/original`, data: bytes, mode: 'create', integrity: true });
    expect(store.write).toHaveBeenCalledTimes(2);
    expect(runtime.assets.readOriginal).toHaveBeenCalledWith(originalId); expect(runtime.assets.readDisplay).not.toHaveBeenCalled();
    expect(db.procedureMaterial.create).toHaveBeenCalledWith({ data: expect.objectContaining({ kind: 'PHOTO', origin: 'KNOWLEDGE', sha256, width: 2, height: 3,
      contentType: 'image/png', byteSize: bytes.length, knowledgeRef: { kind: 'source', sourceId: 'source-1', imageId } }) });
    Object.values(writes).forEach((write) => expect(write).not.toHaveBeenCalled());
  });
  it('falls back to display only for a missing original', async () => {
    const { runtime, db } = await harness(); runtime.assets.readOriginal.mockRejectedValueOnce(missing());
    expect((await app.inject({ method: 'POST', url: `${base}/import-knowledge`, payload: { candidateKeys: [photoKey] } })).json().imported).toBe(1);
    expect(runtime.assets.readOriginal).toHaveBeenCalledWith(originalId);
    expect(runtime.assets.readDisplay).toHaveBeenCalledWith(imageId);
    expect(db.procedureMaterial.create).toHaveBeenCalledWith({ data: expect.objectContaining({ knowledgeRef: { kind: 'source', sourceId: 'source-1', imageId, fromDisplay: true } }) });
  });
  it('resolves a published step photo to source originalKey when display and original hashes differ', async () => {
    const { runtime, db, store, bytes } = await harness();
    const display = await sharp(bytes).jpeg().toBuffer();
    runtime.assets.readDisplay.mockResolvedValue(display);
    runtime.assets.readOriginal.mockImplementation(async (id: string) => {
      if (id !== originalId) throw missing();
      return bytes;
    });
    const result = (await app.inject({ method: 'POST', url: `${base}/import-knowledge`, payload: { candidateKeys: [photoKey, stepPhotoKey] } })).json();
    expect(result).toEqual({ imported: 2, duplicate: 0, failed: [] });
    expect(runtime.assets.readOriginal.mock.calls).toEqual([[originalId], [originalId]]);
    expect(runtime.assets.readDisplay).not.toHaveBeenCalled();
    expect(store.write).toHaveBeenCalledWith(expect.objectContaining({ data: bytes }));
    expect(db.procedureMaterial.create).toHaveBeenNthCalledWith(2, { data: expect.objectContaining({ contentType: 'image/png',
      knowledgeRef: { kind: 'procedure_step', procedureId: 'procedure-1', revisionNumber: 2, stepId: 'step-1', imageId } }) });
  });
  it('marks published photos as fromDisplay when their source cannot be reverse resolved', async () => {
    const { runtime, source, db } = await harness();
    source.source.images = [];
    expect((await app.inject({ method: 'POST', url: `${base}/import-knowledge`, payload: { candidateKeys: [stepPhotoKey] } })).json()).toEqual({ imported: 1, duplicate: 0, failed: [] });
    expect(runtime.assets.readOriginal).not.toHaveBeenCalled();
    expect(runtime.assets.readDisplay).toHaveBeenCalledWith(imageId);
    expect(db.procedureMaterial.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      knowledgeRef: { kind: 'procedure_step', procedureId: 'procedure-1', revisionNumber: 2, stepId: 'step-1', imageId, fromDisplay: true },
    }) });
  });
  it('does not mask an original read failure with display fallback', async () => {
    const { runtime, db } = await harness();
    runtime.assets.readOriginal.mockRejectedValueOnce(Object.assign(new Error('integrity failed'), { code: 'EIO' }));
    expect((await app.inject({ method: 'POST', url: `${base}/import-knowledge`, payload: { candidateKeys: [photoKey] } })).json()).toEqual({
      imported: 0, duplicate: 0, failed: [{ candidateKey: photoKey, reason: 'integrity failed' }],
    });
    expect(runtime.assets.readDisplay).not.toHaveBeenCalled();
    expect(db.procedureMaterial.create).not.toHaveBeenCalled();
  });
  it.each([
    ['exactly 10000', '文'.repeat(10_000), [10_000]],
    ['10001 without a newline', '文'.repeat(10_001), [10_000, 1]],
    ['paragraphs before lines', `${'文'.repeat(6000)}\n\n${'行'.repeat(3000)}\n${'次'.repeat(2997)}`, [6002, 5998]],
    ['line boundary', `${'文'.repeat(8000)}\n${'次'.repeat(3999)}`, [8001, 3999]],
  ])('imports %s as text parts of at most 10000 characters', async (_name, text, lengths) => {
    const { source, db } = await harness(); source.source.text = text;
    const response = await app.inject({ method: 'POST', url: `${base}/import-knowledge`, payload: { candidateKeys: [sourceKey] } });
    expect(response.json()).toEqual({ imported: lengths.length, duplicate: 0, failed: [] });
    const parts = db.procedureMaterial.create.mock.calls.map(([{ data }]) => data);
    expect(parts.map((part) => part.text.length)).toEqual(lengths);
    expect(parts.map((part) => part.text).join('')).toBe(text);
    for (const [index, part] of parts.entries()) {
      expect(part).toMatchObject({ gmailDedupeKey: lengths.length === 1 ? sourceKey : `${sourceKey}:${index + 1}`,
        subjectHint: `Chat タイトル DFD1 組立${lengths.length === 1 ? '' : ` (${index + 1}/${lengths.length})`}`,
        knowledgeRef: { kind: 'source', sourceId: 'source-1' }, receivedAt: new Date(source.source.capturedAt) });
    }
  });
  it('splits a published step with long cautions without losing its text or provenance', async () => {
    const { document, db } = await harness();
    const step = document.publishedRevision.content.steps[0];
    step.title = '題'.repeat(120); step.body = '文'.repeat(4000);
    step.cautions = Array.from({ length: 10 }, (_, index) => `${index}${'注'.repeat(999)}`);
    const text = [step.title, step.body, ...step.cautions].join('\n');
    expect(text.length).toBeGreaterThan(14_000);
    expect((await app.inject({ method: 'POST', url: `${base}/import-knowledge`, payload: { candidateKeys: [stepKey] } })).json()).toEqual({ imported: 2, duplicate: 0, failed: [] });
    const parts = db.procedureMaterial.create.mock.calls.map(([{ data }]) => data);
    expect(parts.map((part) => part.text).join('')).toBe(text);
    expect(parts[0].text.endsWith('\n')).toBe(true);
    parts.forEach((part, index) => {
      expect(part.text.length).toBeLessThanOrEqual(10_000);
      expect(part).toMatchObject({ gmailDedupeKey: `${stepKey}:${index + 1}`, subjectHint: `承認済み手順 DFD1 組立 (${index + 1}/2)`,
        knowledgeRef: { kind: 'procedure_step', procedureId: 'procedure-1', revisionNumber: 2, stepId: 'step-1' } });
    });
  });
  it('uses the first split key for alreadyImported and deduplicates each part on retry', async () => {
    const { source, db } = await harness(); source.source.text = '文'.repeat(12_000);
    const saved = new Set<string>();
    db.procedureMaterial.findUnique.mockImplementation(async ({ where }) => saved.has(where.gmailDedupeKey) ? { id: 'saved' } : null);
    db.procedureMaterial.create.mockImplementation(async ({ data }) => { saved.add(data.gmailDedupeKey); return { id: 'saved' }; });
    const request = { method: 'POST' as const, url: `${base}/import-knowledge`, payload: { candidateKeys: [sourceKey] } };
    expect((await app.inject(request)).json()).toEqual({ imported: 2, duplicate: 0, failed: [] });
    expect((await app.inject(request)).json()).toEqual({ imported: 0, duplicate: 2, failed: [] });
    db.procedureMaterial.findMany.mockResolvedValue([{ gmailDedupeKey: `${sourceKey}:1` }]);
    const response = await app.inject(`${base}/knowledge-candidates`);
    expect(response.json().items[0]).toMatchObject({ candidateKey: sourceKey, alreadyImported: true });
    expect(db.procedureMaterial.findMany).toHaveBeenLastCalledWith({ where: { gmailDedupeKey: { in: [`${sourceKey}:1`, photoKey, stepKey, stepPhotoKey] } }, select: { gmailDedupeKey: true } });
    expect(db.procedureMaterial.create).toHaveBeenCalledTimes(2);
  });
  it.each([1, 5])('shares one bulk snapshot across list, multiple images and import with %i procedures', async (count) => {
    const { source, runtime, document, db } = await harness();
    const images = ['a', 'c', 'd', 'e'].map((char) => ({ id: char.repeat(64), originalKey, displayKey: `knowledge-assets/${char.repeat(64)}/display.jpg` }));
    source.source.images = images;
    document.publishedRevision.content.steps[0].photos = images.map((image) => ({ imageId: image.id, caption: '工具' }));
    db.knowledgeProcedure.findMany.mockResolvedValue(Array.from({ length: count }, (_, index) => ({ ...document, id: `procedure-${index + 1}` })));
    const responses = await Promise.all([
      app.inject(`${base}/knowledge-candidates`),
      ...images.map((image) => app.inject(`${base}/knowledge-candidates/images/${image.id}`)),
    ]);
    responses.forEach((response) => expect(response.statusCode).toBe(200));
    expect(responses[0].json().items).toHaveLength(5 + count * 5);
    expect((await app.inject(`${base}/knowledge-candidates?q=DFD1&limit=1`)).json().items).toHaveLength(1);
    expect((await app.inject({ method: 'POST', url: `${base}/import-knowledge`, payload: { candidateKeys: [sourceKey, photoKey, stepKey] } })).json()).toEqual({ imported: 3, duplicate: 0, failed: [] });
    expect(runtime.repository.readySources).toHaveBeenCalledTimes(1);
    expect(db.knowledgeProcedure.findMany).toHaveBeenCalledTimes(1);
    expect(db.knowledgeProcedureMaterial.findMany).toHaveBeenCalledTimes(1);
    expect(db.knowledgeProcedure.findMany).toHaveBeenCalledWith({ where: { publishedRevisionId: { not: null } }, orderBy: { title: 'asc' }, select: expect.objectContaining({
      publishedRevision: { select: { revisionNumber: true, state: true, content: true, createdAt: true } },
    }) });
    expect(runtime.procedures.listPublished).not.toHaveBeenCalled();
    expect(runtime.procedures.getPublished).not.toHaveBeenCalled();
    await app.inject(`${base}/knowledge-candidates`);
    expect(runtime.repository.readySources).toHaveBeenCalledTimes(2);
    expect(db.knowledgeProcedure.findMany).toHaveBeenCalledTimes(2);
  });
  it('expires the shared candidate snapshot after 30 seconds', async () => {
    const { runtime, db } = await harness();
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
    await app.inject(`${base}/knowledge-candidates`);
    now.mockReturnValue(1_029_999);
    await app.inject(`${base}/knowledge-candidates/images/${imageId}`);
    expect(runtime.repository.readySources).toHaveBeenCalledTimes(1);
    now.mockReturnValue(1_030_000);
    await app.inject(`${base}/knowledge-candidates`);
    expect(runtime.repository.readySources).toHaveBeenCalledTimes(2);
    expect(db.knowledgeProcedure.findMany).toHaveBeenCalledTimes(2);
  });
  it('invalidates the snapshot even after a partially failed import', async () => {
    const { runtime, source } = await harness();
    await app.inject(`${base}/knowledge-candidates`);
    source.source.images = [];
    await app.inject({ method: 'POST', url: `${base}/import-knowledge`, payload: { candidateKeys: [sourceKey, 'unknown'] } });
    expect((await app.inject(`${base}/knowledge-candidates/images/${imageId}`)).statusCode).toBe(200);
    expect(runtime.repository.readySources).toHaveBeenCalledTimes(2);
  });
  it('does not retain a failed candidate load in the cache', async () => {
    const { runtime } = await harness();
    runtime.repository.readySources.mockRejectedValueOnce(new Error('temporary failure'));
    expect((await app.inject(`${base}/knowledge-candidates`)).statusCode).toBe(500);
    expect((await app.inject(`${base}/knowledge-candidates`)).statusCode).toBe(200);
    expect(runtime.repository.readySources).toHaveBeenCalledTimes(2);
  });
  it('defaults to 100, caps at 300, and filters before applying either limit', async () => {
    const { runtime, source, knowledge } = await harness();
    runtime.repository.readySources.mockResolvedValue(Array.from({ length: 350 }, (_, index) => ({
      ...source, source: { ...source.source, id: `source-${index + 1}`, text: index < 340 ? '一般投稿' : '検索対象', images: [] },
    })));
    expect((await app.inject(`${base}/knowledge-candidates`)).json().items).toHaveLength(100);
    expect((await app.inject(`${base}/knowledge-candidates?limit=300`)).json().items).toHaveLength(300);
    expect((await app.inject(`${base}/knowledge-candidates?limit=301`)).statusCode).toBe(400);
    expect((await app.inject(`${base}/knowledge-candidates?q=${encodeURIComponent('検索対象')}&limit=3`)).json().items.map((item: { candidateKey: string }) => item.candidateKey)).toEqual([
      'knowledge:source:source-341:text', 'knowledge:source:source-342:text', 'knowledge:source:source-343:text',
    ]);
    expect((await knowledge.list()).items).toHaveLength(100);
    expect((await knowledge.list({ limit: 500 })).items).toHaveLength(300);
  });
  it('reports integrity conflict as failed without creating a material', async () => {
    const { db, store } = await harness();
    store.write.mockRejectedValueOnce(new FileStorageAlreadyExistsError()); store.read.mockResolvedValueOnce(Buffer.from('different'));
    const result = (await app.inject({ method: 'POST', url: `${base}/import-knowledge`, payload: { candidateKeys: [photoKey] } })).json();
    expect(result).toMatchObject({ imported: 0, duplicate: 0, failed: [{ candidateKey: photoKey, reason: 'Procedure material identity conflict' }] });
    expect(db.procedureMaterial.create).not.toHaveBeenCalled();
  });
  it('counts existing and concurrent unique-key imports as duplicates', async () => {
    const { db, store } = await harness();
    db.procedureMaterial.findUnique.mockResolvedValueOnce({ id: 'old' }).mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'raced' });
    db.procedureMaterial.create.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError('duplicate', { code: 'P2002', clientVersion: '5' }));
    expect((await app.inject({ method: 'POST', url: `${base}/import-knowledge`, payload: { candidateKeys: [photoKey, sourceKey] } })).json()).toEqual({ imported: 0, duplicate: 2, failed: [] });
    expect(store.write).not.toHaveBeenCalled();
  });
  it('rejects a stale revision key and excludes documents that are no longer published', async () => {
    const { document } = await harness(); document.publishedRevision.state = 'superseded';
    const response = await app.inject({ method: 'POST', url: `${base}/import-knowledge`, payload: { candidateKeys: [stepKey] } });
    expect(response.json().failed).toEqual([{ candidateKey: stepKey, reason: '候補がありません' }]);
  });
  it('serves only candidate images privately and returns 404 for unknown or missing images', async () => {
    const { runtime } = await harness();
    const response = await app.inject(`${base}/knowledge-candidates/images/${imageId}`);
    expect(response.statusCode).toBe(200); expect(response.headers['cache-control']).toBe('private, no-store');
    expect((await app.inject(`${base}/knowledge-candidates/images/${'b'.repeat(64)}`)).statusCode).toBe(404);
    runtime.assets.readDisplay.mockRejectedValueOnce(missing());
    expect((await app.inject(`${base}/knowledge-candidates/images/${imageId}`)).statusCode).toBe(404);
  });
  it.each([['GET', '/knowledge-candidates'], ['GET', `/knowledge-candidates/images/${imageId}`], ['POST', '/import-knowledge']] as const)('authorizes %s %s before reading knowledge', async (method, path) => {
    const { factory } = await harness(true, method === 'GET' ? 'view' : 'write');
    expect((await app.inject({ method, url: `${base}${path}`, ...(method === 'POST' ? { payload: { candidateKeys: [sourceKey] } } : {}) })).statusCode).toBe(403);
    expect(factory).not.toHaveBeenCalled();
  });
});
