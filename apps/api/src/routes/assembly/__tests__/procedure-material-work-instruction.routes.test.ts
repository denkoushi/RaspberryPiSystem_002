import { createHash } from 'node:crypto';

import { Prisma } from '@prisma/client';
import Fastify from 'fastify';
import sharp from 'sharp';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '../../../lib/errors.js';
import { registerErrorHandler } from '../../../plugins/error-handler.js';
import { ProcedureMaterialWorkInstructionService } from '../../../services/assembly/procedure-material-work-instruction.service.js';
import { ProcedureMaterialService } from '../../../services/assembly/procedure-material.service.js';
import { FileStorageAlreadyExistsError } from '../../../services/file-storage/file-storage-errors.js';
import { registerProcedureMaterialRoutes } from '../procedure-materials.js';

const base = '/assembly/procedure-materials';
const assetId = '11111111-1111-4111-8111-111111111111';
const key = `work-instruction:row-1:version-1:1:image:${assetId}`;
const item = { candidateKey: key, partNumber: 'DFD1', shootingTarget: '外径' };
const missing = () => Object.assign(new Error('missing'), { code: 'ENOENT' });

describe('procedure-material work-instruction routes', () => {
  let app: ReturnType<typeof Fastify>;
  afterEach(async () => { await app?.close(); vi.restoreAllMocks(); });
  async function harness(deny: 'view' | 'write' | null = null) {
    const bytes = await sharp({ create: { width: 2, height: 3, channels: 3, background: 'white' } }).png().toBuffer();
    const summary = { partNumber: 'DFD1', shootingTarget: '外径', latestModified: new Date('2026-10-01'), rowCount: 1, stepCount: 1 };
    const step = { id: 'step-1', step: 1, text: '原本メモ', memoOverride: '公開メモ', imageAssetId: assetId,
      imageStorageKey: 'work-instructions/original', imageName: '加工.png', imageMimeType: 'image/png', imageSha256: 'hash',
      overlays: [{ text: 'コピーしない注釈' }], overlayAssets: { overlay: { assetId: 'overlay' } } };
    const row = { id: 'row-1', source: { system: 'sharepoint', list: '加工', itemId: 1, modified: summary.latestModified },
      publication: { publishedVersionId: 'version-1' }, steps: [step] };
    const group = { partNumber: summary.partNumber, shootingTarget: summary.shootingTarget, rows: [row], steps: [step] };
    const read = { readPublishedGroups: vi.fn().mockResolvedValue([summary]), searchPublishedGroups: vi.fn().mockResolvedValue({ groups: [summary], hasMore: false, total: 1 }),
      readPublishedGroup: vi.fn().mockResolvedValue(group), readAsset: vi.fn().mockResolvedValue({ bytes, asset: { assetId, status: 'ACTIVE', mimeType: 'image/png' } }) };
    const db = { $queryRaw: vi.fn().mockResolvedValue([]), procedureMaterial: { findMany: vi.fn().mockResolvedValue([]), findUnique: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue({ id: 'material' }) } };
    const store = { write: vi.fn().mockResolvedValue({}), read: vi.fn().mockResolvedValue(bytes), stat: vi.fn().mockResolvedValue({}) };
    const reader = vi.fn(() => read);
    const service = new ProcedureMaterialWorkInstructionService(db as never, store as never, reader as never);
    app = Fastify(); registerErrorHandler(app);
    registerProcedureMaterialRoutes(app, { service: new ProcedureMaterialService(db as never, store as never), workInstructions: service,
      allowView: async () => { if (deny === 'view') throw new ApiError(403, '権限がありません'); },
      allowWriteKiosk: async () => { if (deny === 'write') throw new ApiError(403, '権限がありません'); } });
    const post = (candidateKeys = [key]) => app.inject({ method: 'POST', url: `${base}/import-work-instructions`, payload: { items: candidateKeys.map((candidateKey) => ({ ...item, candidateKey })) } });
    return { read, reader, db, store, bytes, summary, group, row, step, service, post };
  }
  it('lists public source photos with displayed memo and imported status without copying bytes', async () => {
    const { db, read, store } = await harness();
    db.procedureMaterial.findMany.mockResolvedValue([{ gmailDedupeKey: key }]);
    const response = await app.inject(`${base}/work-instruction-candidates`);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ items: [{ candidateKey: key, partNumber: 'DFD1', partName: null, shootingTarget: '外径', step: 1, memo: '公開メモ', assetId,
      sourceModified: '2026-10-01T00:00:00.000Z', alreadyImported: true }] });
    expect(read.readPublishedGroups).toHaveBeenCalledWith({ limit: 500, offset: 0 });
    expect(read.readAsset).not.toHaveBeenCalled(); expect(store.write).not.toHaveBeenCalled();
    expect(db.procedureMaterial.create).not.toHaveBeenCalled();
  });
  it('excludes missing/deleted/inactive source photos, unpublished groups and legacy rows without a version ID', async () => {
    const { group, row, step, read } = await harness();
    row.steps = [{ ...step, imageAssetId: null }, { ...step, imageStorageKey: null }] as never;
    expect((await app.inject(`${base}/work-instruction-candidates`)).json()).toEqual({ items: [] });
    row.steps = [step]; row.publication = undefined as never;
    expect((await app.inject(`${base}/work-instruction-candidates`)).json().items).toEqual([]);
    group.rows = [row]; read.readPublishedGroup.mockResolvedValue(null);
    expect((await app.inject(`${base}/work-instruction-candidates`)).json().items).toEqual([]);
  });
  it('uses original text for absent overrides, preserves an empty override and truncates only the preview', async () => {
    const { step } = await harness();
    step.memoOverride = undefined as never;
    expect((await app.inject(`${base}/work-instruction-candidates`)).json().items[0].memo).toBe('原本メモ');
    step.memoOverride = '';
    expect((await app.inject(`${base}/work-instruction-candidates`)).json().items[0].memo).toBe('');
    step.memoOverride = '長'.repeat(300);
    expect((await app.inject(`${base}/work-instruction-candidates`)).json().items[0].memo).toHaveLength(200);
  });
  it.each(['dfd', '外径'])('searches part number / target with the public search facade: %s', async (q) => {
    const { read } = await harness();
    expect((await app.inject(`${base}/work-instruction-candidates?q=${encodeURIComponent(q)}&limit=1`)).json().items).toHaveLength(1);
    expect(read.searchPublishedGroups).toHaveBeenCalledWith({ query: q, limit: 500, offset: 0 });
    expect(read.readPublishedGroups).not.toHaveBeenCalled();

  });
  it('searches public memos without reading unpublished details', async () => {
    const { read, summary } = await harness();
    read.searchPublishedGroups.mockImplementation(async ({ query }) => ({ groups: query === '公開メモ' ? [summary] : [], hasMore: false, total: query === '公開メモ' ? 1 : 0 }));
    expect((await app.inject(`${base}/work-instruction-candidates?q=${encodeURIComponent('公開メモ')}`)).json().items[0].memo).toBe('公開メモ');
    read.readPublishedGroup.mockClear();
    for (const query of ['下書きメモ', '非公開メモ']) {
      expect((await app.inject(`${base}/work-instruction-candidates?q=${encodeURIComponent(query)}`)).json().items).toEqual([]);
    }
    expect(read.readPublishedGroup).not.toHaveBeenCalled();
    expect(read.readPublishedGroups).not.toHaveBeenCalled();
  });
  it('resolves partial part names, merges public matches once and returns the name', async () => {
    const { read, db, summary } = await harness();
    db.$queryRaw.mockResolvedValueOnce([{ partNumber: 'DFD1' }]).mockResolvedValueOnce([{ partNumber: 'DFD1', partName: '軸受ホルダー' }]);
    read.searchPublishedGroups.mockResolvedValue({ groups: [], hasMore: false, total: 0 });
    const response = await app.inject(`${base}/work-instruction-candidates?q=${encodeURIComponent('ホル')}`);
    expect(response.statusCode).toBe(200);
    expect(response.json().items).toHaveLength(1);
    expect(response.json().items[0]).toMatchObject({ partNumber: 'DFD1', partName: '軸受ホルダー' });
    expect(read.readPublishedGroup).toHaveBeenCalledExactlyOnceWith(summary);
    db.$queryRaw.mockResolvedValueOnce([{ partNumber: 'DFD1' }]).mockResolvedValueOnce([{ partNumber: 'DFD1', partName: '軸受ホルダー' }]);
    read.searchPublishedGroups.mockResolvedValue({ groups: [summary], hasMore: false, total: 1 });
    expect((await app.inject(`${base}/work-instruction-candidates?q=${encodeURIComponent('ホル')}`)).json().items).toHaveLength(1);
  });
  it('paginates summaries before sorting newest groups and applies the photo limit after exclusions', async () => {
    const { read, summary, group } = await harness();
    const newer = { ...summary, partNumber: 'NEW', latestModified: new Date('2026-10-07') };
    read.readPublishedGroups.mockResolvedValueOnce(Array.from({ length: 500 }, (_, i) => ({ ...summary, partNumber: `old-${i}` }))).mockResolvedValueOnce([newer]);
    read.readPublishedGroup.mockImplementation(async (input) => input.partNumber === 'NEW' ? { ...group, partNumber: 'NEW' } : null);
    const response = await app.inject(`${base}/work-instruction-candidates?limit=1`);
    expect(response.json().items[0].partNumber).toBe('NEW');
    expect(read.readPublishedGroups).toHaveBeenLastCalledWith({ limit: 500, offset: 500 });
    expect(read.readPublishedGroup).toHaveBeenCalledOnce();
  });
  it('reads at most six groups concurrently and preserves summary order after reverse completion', async () => {
    const { read, summary, group, service } = await harness();
    const summaries = Array.from({ length: 8 }, (_, index) => ({ ...summary, partNumber: `part-${index}`, latestModified: new Date(1000 - index) }));
    read.readPublishedGroups.mockResolvedValue(summaries);
    const finish = new Map<string, () => void>();
    read.readPublishedGroup.mockImplementation((input) => new Promise((resolve) => {
      finish.set(input.partNumber, () => resolve({ ...group, partNumber: input.partNumber }));
    }));
    const result = service.list({ limit: 100 });
    await vi.waitFor(() => expect(read.readPublishedGroup).toHaveBeenCalledTimes(6));
    for (let index = 5; index >= 0; index--) finish.get(`part-${index}`)!();
    await vi.waitFor(() => expect(read.readPublishedGroup).toHaveBeenCalledTimes(8));
    finish.get('part-7')!(); finish.get('part-6')!();
    expect(await result).toEqual({ items: summaries.map(({ partNumber }) => ({ candidateKey: key, partNumber, partName: null, shootingTarget: '外径', step: 1,
      memo: '公開メモ', assetId, sourceModified: summary.latestModified, alreadyImported: false })) });
  });
  it('keeps exclusions and the partial-group limit, ignoring errors beyond the cutoff and stopping new batches', async () => {
    const { read, summary, group, row, step, service, db } = await harness();
    read.readPublishedGroups.mockResolvedValue(Array.from({ length: 10 }, (_, index) => ({ ...summary, partNumber: `part-${index}`, latestModified: new Date(1000 - index) })));
    read.readPublishedGroup.mockImplementation(async (input) => {
      if (input.partNumber === 'part-0') return null;
      if (input.partNumber === 'part-3') throw new Error('past cutoff');
      return { ...group, partNumber: input.partNumber, rows: [{ ...row, steps: [step, { ...step, step: 2 }, ...(input.partNumber === 'part-2' ? [{ ...step, step: 3 }] : [])] }] };
    });
    const result = await service.list({ limit: 4 });
    expect(result.items.map(({ partNumber, step }) => [partNumber, step])).toEqual([['part-1', 1], ['part-1', 2], ['part-2', 1], ['part-2', 2]]);
    expect(read.readPublishedGroup).toHaveBeenCalledTimes(4);
    expect(db.procedureMaterial.findMany).toHaveBeenCalledWith({ where: { gmailDedupeKey: { in: result.items.map((item) => item.candidateKey) } }, select: { gmailDedupeKey: true } });
  });
  it('defaults to 60, caps the route and service at 1000, validates list and import bounds', async () => {
    const { row, step, service } = await harness();
    row.steps = Array.from({ length: 1250 }, (_, i) => ({ ...step, step: i + 1 }));
    expect((await app.inject(`${base}/work-instruction-candidates`)).json().items).toHaveLength(60);
    expect((await app.inject(`${base}/work-instruction-candidates?limit=200`)).json().items).toHaveLength(200);
    const response = await app.inject(`${base}/work-instruction-candidates?limit=1000`);
    expect(response.statusCode).toBe(200);
    expect(response.json().items).toHaveLength(1000);
    expect((await service.list({ limit: 500 })).items).toHaveLength(500);
    expect((await service.list({ limit: 2000 })).items).toHaveLength(1000);
    for (const limit of [0, 1001]) expect((await app.inject(`${base}/work-instruction-candidates?limit=${limit}`)).statusCode).toBe(400);
    const invalidBodies = [
      { candidateKeys: [key] }, { items: [] }, { items: Array(51).fill(item) },
      { items: [item], memo: '偽メモ' }, { items: [{ ...item, memo: '偽メモ' }] },
      ...['candidateKey', 'partNumber', 'shootingTarget'].flatMap((field) => [
        { items: [{ ...item, [field]: '' }] },
        { items: [{ ...item, [field]: '長'.repeat(field === 'candidateKey' ? 501 : 201) }] },
        { items: [Object.fromEntries(Object.entries(item).filter(([name]) => name !== field))] },
      ]),
      { items: [{ ...item, partNumber: '   ' }] }, { items: [{ ...item, shootingTarget: '   ' }] },
    ];
    for (const payload of invalidBodies) {
      expect((await app.inject({ method: 'POST', url: `${base}/import-work-instructions`, payload })).statusCode).toBe(400);
    }
  });
  it('copies original bytes and a complete server snapshot without annotations, using the import time', async () => {
    const { bytes, db, store, step, post } = await harness();
    step.memoOverride = '長'.repeat(300);
    const before = Date.now();
    expect((await post()).json()).toEqual({ imported: 1, duplicate: 0, failed: [] });
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    expect(store.write).toHaveBeenCalledExactlyOnceWith({ key: `procedure-materials/${sha256}/original`, data: bytes, mode: 'create', integrity: true });
    const data = db.procedureMaterial.create.mock.calls[0][0].data;
    expect(data).toEqual({ origin: 'WORK_INSTRUCTION', kind: 'PHOTO', gmailDedupeKey: key, subjectHint: 'DFD1 外径 手順1', originalFileName: '加工.png',
      contentType: 'image/png', byteSize: bytes.length, sha256, storageKey: `procedure-materials/${sha256}/original`, width: 2, height: 3, receivedAt: expect.any(Date),
      workInstructionRef: { rowId: 'row-1', sourceVersionId: 'version-1', step: 1, assetId, partNumber: 'DFD1', shootingTarget: '外径', memo: step.memoOverride, sourceSystem: 'sharepoint', sourceList: '加工' } });
    expect(data.receivedAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(data.receivedAt.getTime()).toBeLessThanOrEqual(Date.now());
  });
  it('deduplicates retries and repeated keys without creating another row or writing bytes', async () => {
    const { db, post, store } = await harness();
    const saved = new Set<string>();
    db.procedureMaterial.findUnique.mockImplementation(async ({ where }) => saved.has(where.gmailDedupeKey) ? { id: 'saved' } : null);
    db.procedureMaterial.create.mockImplementation(async ({ data }) => { saved.add(data.gmailDedupeKey); return { id: 'saved' }; });
    expect((await post([key, key])).json()).toEqual({ imported: 1, duplicate: 1, failed: [] });
    expect((await post()).json()).toEqual({ imported: 0, duplicate: 1, failed: [] });
    expect(db.procedureMaterial.create).toHaveBeenCalledOnce(); expect(store.write).toHaveBeenCalledOnce();
  });
  it('handles concurrent unique-key imports as duplicates', async () => {
    const { db, post } = await harness();
    db.procedureMaterial.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'race' });
    db.procedureMaterial.create.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError('duplicate', { code: 'P2002', clientVersion: '5' }));
    expect((await post()).json()).toEqual({ imported: 0, duplicate: 1, failed: [] });
  });
  it('reports unknown and stale keys individually while importing valid selections', async () => {
    const { post } = await harness();
    const stale = key.replace('version-1', 'old-version');
    const response = await post(['unknown', stale, key]);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ imported: 1, duplicate: 0, failed: ['unknown', stale].map((candidateKey) => ({ candidateKey, reason: '候補がありません' })) });
  });
  it('re-resolves publication and memo after a previous candidate list', async () => {
    const { row, post, db } = await harness();
    await app.inject(`${base}/work-instruction-candidates`);
    row.publication.publishedVersionId = 'version-2';
    expect((await post()).json().failed).toEqual([{ candidateKey: key, reason: '候補がありません' }]);
    expect(db.procedureMaterial.create).not.toHaveBeenCalled();
  });
  it('reads only the selected group once for multiple photos, without scanning summaries', async () => {
    const { row, step, read, post } = await harness();
    row.steps = [step, { ...step, step: 2 }];
    expect((await post([key, key.replace(':1:image:', ':2:image:')])).json()).toEqual({ imported: 2, duplicate: 0, failed: [] });
    expect(read.readPublishedGroup).toHaveBeenCalledExactlyOnceWith({ partNumber: 'DFD1', shootingTarget: '外径' });
    expect(read.readPublishedGroups).not.toHaveBeenCalled();
    expect(read.searchPublishedGroups).not.toHaveBeenCalled();
  });
  it('rejects a key when hints point to a different group', async () => {
    const { read, group, row, db, store } = await harness();
    read.readPublishedGroup.mockResolvedValue({ ...group, partNumber: 'OTHER', shootingTarget: '内径', rows: [{ ...row, id: 'other-row' }] });
    const response = await app.inject({ method: 'POST', url: `${base}/import-work-instructions`,
      payload: { items: [{ candidateKey: key, partNumber: 'OTHER', shootingTarget: '内径' }] } });
    expect(response.json()).toEqual({ imported: 0, duplicate: 0, failed: [{ candidateKey: key, reason: '候補がありません' }] });
    expect(read.readPublishedGroup).toHaveBeenCalledExactlyOnceWith({ partNumber: 'OTHER', shootingTarget: '内径' });
    expect(read.readPublishedGroups).not.toHaveBeenCalled();
    expect(read.searchPublishedGroups).not.toHaveBeenCalled();
    expect(read.readAsset).not.toHaveBeenCalled();
    expect(db.procedureMaterial.create).not.toHaveBeenCalled();
    expect(store.write).not.toHaveBeenCalled();
  });
  it('saves server metadata even when lookup hints differ from the resolved group', async () => {
    const { read, db } = await harness();
    const response = await app.inject({ method: 'POST', url: `${base}/import-work-instructions`,
      payload: { items: [{ candidateKey: key, partNumber: 'lookup-part', shootingTarget: 'lookup-target' }] } });
    expect(response.json()).toEqual({ imported: 1, duplicate: 0, failed: [] });
    expect(read.readPublishedGroup).toHaveBeenCalledExactlyOnceWith({ partNumber: 'lookup-part', shootingTarget: 'lookup-target' });
    expect(db.procedureMaterial.create.mock.calls[0][0].data).toMatchObject({
      subjectHint: 'DFD1 外径 手順1',
      workInstructionRef: { partNumber: 'DFD1', shootingTarget: '外径', step: 1, memo: '公開メモ' },
    });
  });
  it('reports an absent group as a candidate failure', async () => {
    const { read, post, db } = await harness();
    read.readPublishedGroup.mockResolvedValue(null);
    expect((await post()).json().failed).toEqual([{ candidateKey: key, reason: '候補がありません' }]);
    expect(db.procedureMaterial.create).not.toHaveBeenCalled();
  });
  it.each([null, { bytes: Buffer.from('x'), asset: { status: 'DELETE_PENDING' } }])('reports a deleted/inactive asset as a per-key failure', async (asset) => {
    const { read, post, db, store } = await harness();
    read.readAsset.mockResolvedValue(asset);
    expect((await post()).json()).toEqual({ imported: 0, duplicate: 0, failed: [{ candidateKey: key, reason: '写真がありません' }] });
    expect(db.procedureMaterial.create).not.toHaveBeenCalled(); expect(store.write).not.toHaveBeenCalled();
  });
  it('verifies existing original bytes and restores a GC race', async () => {
    const { post, store } = await harness();
    store.write.mockRejectedValueOnce(new FileStorageAlreadyExistsError()); store.stat.mockRejectedValueOnce(missing());
    expect((await post()).json().imported).toBe(1);
    expect(store.read).toHaveBeenCalledWith(expect.stringContaining('procedure-materials/'), { verifyIntegrity: true });
    expect(store.write).toHaveBeenCalledTimes(2);
  });
  it('reports an integrity conflict without creating a row', async () => {
    const { post, store, db } = await harness();
    store.write.mockRejectedValueOnce(new FileStorageAlreadyExistsError()); store.read.mockResolvedValueOnce(Buffer.from('other'));
    expect((await post()).json().failed).toEqual([{ candidateKey: key, reason: 'Procedure material identity conflict' }]);
    expect(db.procedureMaterial.create).not.toHaveBeenCalled();
  });
  it.each([['GET', '/work-instruction-candidates', 'view'], ['POST', '/import-work-instructions', 'write']] as const)('uses the existing material authorization for %s', async (method, path, deny) => {
    const { reader } = await harness(deny);
    const response = await app.inject({ method, url: `${base}${path}`, ...(method === 'POST' ? { payload: { items: [item] } } : {}) });
    expect(response.statusCode).toBe(403); expect(reader).not.toHaveBeenCalled();
  });
});
