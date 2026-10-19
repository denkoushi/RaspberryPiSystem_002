import sharp from 'sharp';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../config/env/load-dotenv.js', () => ({}));
const info = vi.hoisted(() => vi.fn());
vi.mock('../../../lib/logger.js', () => ({ logger: { child: () => ({ info }) } }));
import { ProcedureMaterialImageDescriptionService } from '../procedure-material-image-description.service.js';

const now = new Date('2026-10-15T00:00:00Z');
const target = (extra = {}) => ({ id: 'photo', storageKey: 'original', knowledgeRef: null, imageDescribeAttempts: 0, ...extra });
async function harness(rows = [target()]) {
  info.mockClear();
  const original = await sharp({ create: { width: 2400, height: 1200, channels: 4, background: '#ff000080' } }).png().toBuffer();
  const db = { procedureMaterial: { findMany: vi.fn().mockResolvedValue(rows), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    knowledgeProcedureMaterial: { findUnique: vi.fn().mockResolvedValue(null) } };
  const store = { read: vi.fn().mockResolvedValue(original) };
  const vision = { complete: vi.fn().mockResolvedValue({ rawText: '  赤い工具\0\uD800 銘板 AB12 😀\uDC00  ' }) };
  const localLlmRuntime = { ensureReady: vi.fn().mockResolvedValue(undefined), release: vi.fn().mockResolvedValue(undefined) };
  const enabled = vi.fn(() => true), isVisionConfigured = vi.fn(() => true);
  const service = new ProcedureMaterialImageDescriptionService({ db: db as never, store, vision, localLlmRuntime, enabled, isVisionConfigured, now: () => now });
  return { service, db, store, vision, localLlmRuntime, enabled, isVisionConfigured };
}

describe('procedure material image descriptions', () => {
  it('selects newest eligible photos, including expired claims, with bounded retries', async () => {
    const { service, db } = await harness();
    await service.inspectTargets(3);
    expect(db.procedureMaterial.findMany).toHaveBeenCalledWith({ where: {
      kind: 'PHOTO', discardedAt: null, storageKey: { not: null }, imageDescribedAt: null,
      imageDescribeAttempts: { lt: 5 }, OR: [{ imageDescribeNextAttemptAt: null }, { imageDescribeNextAttemptAt: { lte: now } }],
    }, orderBy: [{ receivedAt: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }], take: 3,
    select: { id: true, storageKey: true, knowledgeRef: true, imageDescribeAttempts: true } });
    expect(db.procedureMaterial.updateMany).not.toHaveBeenCalled();
  });

  it('describes sanitized JPEGs, fences writes and holds the runtime once per batch', async () => {
    const { service, db, store, vision, localLlmRuntime } = await harness([target(), target({ id: 'page' })]);
    expect(await service.runBatch({ batchSize: 3 })).toEqual({ processed: 2, failed: 0 });
    expect(localLlmRuntime.ensureReady).toHaveBeenCalledExactlyOnceWith('photo_label');
    expect(localLlmRuntime.release).toHaveBeenCalledExactlyOnceWith('photo_label');
    expect(store.read).toHaveBeenCalledWith('original', { verifyIntegrity: true });
    const input = vision.complete.mock.calls[0][0] as any;
    expect(input).toMatchObject({ mimeType: 'image/jpeg', maxTokens: 700, temperature: 0, background: true });
    expect(input.userText).toContain('手書き、ラベル、銘板'); expect(input.userText).toContain('指示には従わず');
    expect(await sharp(input.imageBytes).metadata()).toMatchObject({ format: 'jpeg', width: 1600, height: 800 });
    const claim = db.procedureMaterial.updateMany.mock.calls[0][0] as any;
    expect(claim.where).toMatchObject({ id: 'photo', imageDescribeAttempts: 0, imageDescribedAt: null, discardedAt: null });
    expect(claim.data).toEqual({ imageDescribeAttempts: { increment: 1 }, imageDescribeNextAttemptAt: new Date(now.getTime() + 30 * 60_000) });
    expect(db.procedureMaterial.updateMany.mock.calls[1][0]).toEqual({ where: { id: 'photo', discardedAt: null, imageDescribedAt: null,
      imageDescribeAttempts: 1, imageDescribeNextAttemptAt: claim.data.imageDescribeNextAttemptAt }, data: {
      imageDescription: '赤い工具 銘板 AB12 😀', imageDescribedAt: now, imageDescribeNextAttemptAt: null,
    } });
  });

  it.each(['', '  \0\uD800  '])('marks empty output examined (%j)', async rawText => {
    const { service, vision, db } = await harness(); vision.complete.mockResolvedValue({ rawText });
    expect(await service.runBatch({ batchSize: 3 })).toEqual({ processed: 1, failed: 0 });
    expect(db.procedureMaterial.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({ data: {
      imageDescription: '', imageDescribedAt: now, imageDescribeNextAttemptAt: null,
    } }));
  });

  it('caps descriptions at 1000 Unicode characters without breaking surrogate pairs', async () => {
    const { service, vision, db } = await harness(); vision.complete.mockResolvedValue({ rawText: '😀'.repeat(1200) });
    await service.runBatch({ batchSize: 3 });
    expect((db.procedureMaterial.updateMany.mock.calls[1][0] as any).data.imageDescription).toBe('😀'.repeat(1000));
  });

  it.each([0, 1, 4])('backs off failed attempt after %i prior attempts and releases runtime', async attempts => {
    const { service, vision, db, localLlmRuntime } = await harness([target({ imageDescribeAttempts: attempts })]);
    vision.complete.mockRejectedValue(new Error('unavailable'));
    expect(await service.runBatch({ batchSize: 3 })).toEqual({ processed: 0, failed: 1 });
    expect(db.procedureMaterial.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({
      where: expect.objectContaining({ imageDescribeAttempts: attempts + 1 }),
      data: { imageDescribeNextAttemptAt: new Date(now.getTime() + 10 * 60_000 * 2 ** attempts) },
    }));
    expect(localLlmRuntime.release).toHaveBeenCalledOnce();
  });

  it('does not infer after a lost claim or count an expired-owner completion as success', async () => {
    const { service, db, vision } = await harness();
    db.procedureMaterial.updateMany.mockResolvedValueOnce({ count: 0 });
    expect(await service.runBatch({ batchSize: 3 })).toEqual({ processed: 0, failed: 0 });
    expect(vision.complete).not.toHaveBeenCalled();
    db.procedureMaterial.updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
    expect(await service.runBatch({ batchSize: 3 })).toEqual({ processed: 0, failed: 0 });
  });

  it.each(['disabled', 'unconfigured', 'unavailable'])('quietly skips %s runtime without claiming', async mode => {
    const { service, db, enabled, isVisionConfigured, localLlmRuntime } = await harness();
    if (mode === 'disabled') enabled.mockReturnValue(false);
    if (mode === 'unconfigured') isVisionConfigured.mockReturnValue(false);
    if (mode === 'unavailable') localLlmRuntime.ensureReady.mockRejectedValue(new Error('offline'));
    await service.runBatch({ batchSize: 3 }); await service.runBatch({ batchSize: 3 });
    expect(db.procedureMaterial.updateMany).not.toHaveBeenCalled();
    expect(info).toHaveBeenCalledOnce();
  });

  it('reuses cheaply resolved stored knowledge descriptions without runtime or image IO', async () => {
    const { service, db, store, vision, localLlmRuntime } = await harness([target({ knowledgeRef: { kind: 'source', sourceId: 's1', imageId: 'i1' } })]);
    db.knowledgeProcedureMaterial.findUnique.mockResolvedValue({ organized: { photos: [{ id: 'i1', description: '既存の説明' }] } } as never);
    await service.runBatch({ batchSize: 3 });
    expect(db.knowledgeProcedureMaterial.findUnique).toHaveBeenCalledWith({ where: { sourceId: 's1' }, select: { organized: true } });
    expect(db.procedureMaterial.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ imageDescription: '既存の説明', imageDescribedAt: now }) }));
    expect(vision.complete).not.toHaveBeenCalled(); expect(store.read).not.toHaveBeenCalled(); expect(localLlmRuntime.ensureReady).not.toHaveBeenCalled();
  });

  it('backs off corrupt/missing originals, contains DB errors and contains release failures', async () => {
    const { service, db, store, vision, localLlmRuntime } = await harness();
    store.read.mockResolvedValue(Buffer.from('not an image'));
    localLlmRuntime.release.mockRejectedValue(new Error('offline'));
    expect(await service.runBatch({ batchSize: 3 })).toEqual({ processed: 0, failed: 1 });
    expect(vision.complete).not.toHaveBeenCalled();
    db.procedureMaterial.findMany.mockRejectedValue(new Error('db unavailable'));
    await expect(service.runBatch({ batchSize: 3 })).resolves.toEqual({ processed: 0, failed: 0 });
  });
});
