import { Prisma } from '@prisma/client';
import sharp from 'sharp';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  env: { INSPECTION_DRAWING_REFERENCE_PLACEMENT_ENABLED: false, INSPECTION_DRAWING_SEMANTIC_PLACEMENT_ENABLED: false },
  warn: vi.fn(),
  vision: { completeMany: vi.fn() },
  readDrawing: vi.fn(),
  prisma: {
    partMeasurementDrawingSiblingMatch: { findUnique: vi.fn() },
    partMeasurementDrawingPlacementRun: { findUnique: vi.fn(), create: vi.fn() },
    partMeasurementDrawingPlacementProposal: { updateMany: vi.fn() },
    partMeasurementVisualTemplate: { findUnique: vi.fn(), findMany: vi.fn() },
    partMeasurementTemplate: { findMany: vi.fn() },
    partMeasurementTemplateItem: { findMany: vi.fn() },
    $transaction: vi.fn(),
    $queryRaw: vi.fn()
  },
  ocr: { getCurrentStatus: vi.fn(), getCurrentFingerprint: vi.fn() },
  maps: { getCompletedPayload: vi.fn() }
}));
vi.mock('../../lib/logger.js', () => ({ logger: { child: () => ({ warn: mocks.warn }) } }));
vi.mock('../../config/env.js', () => ({ env: mocks.env }));
vi.mock('../inference/inference-runtime.js', () => ({ getInferenceRuntime: () => ({ createMultiImageVisionCompletionPort: () => mocks.vision }) }));
vi.mock('../../lib/part-measurement-drawing-storage.js', () => ({ PartMeasurementDrawingStorage: { readDrawing: mocks.readDrawing } }));
vi.mock('../../lib/prisma.js', () => ({ prisma: mocks.prisma }));
vi.mock('./part-measurement-drawing-ocr.service.js', () => ({ getPartMeasurementDrawingOcrService: () => mocks.ocr }));
vi.mock('./part-measurement-drawing-dimension-map.service.js', () => ({ getPartMeasurementDrawingDimensionMapService: () => mocks.maps }));

vi.mock('./part-measurement-drawing-sibling-match.service.js', () => ({ PartMeasurementDrawingSiblingMatchService: class {} }));

import { InferenceDeferredError } from '../inference/ports/text-completion.port.js';
import { PartMeasurementDrawingPlacementService, currentPlacementVersion, placementVersionFor } from './part-measurement-drawing-placement.service.js';
import { PART_MEASUREMENT_DRAWING_DIMENSION_MAP_VERSION } from './part-measurement-drawing-dimension-map-payload.js';
import type { PlacementCandidate, PlacementSourceItem } from './part-measurement-drawing-placement-transfer.js';

const db = mocks.prisma;
const decimal = (n: number | string) => new Prisma.Decimal(n);
const target = { id: 'target', name: 'スタンド', drawingImageRelativePath: 'target.png' };
const source = { id: 'source', name: '足', drawingImageRelativePath: 'source.png' };
const payload = {
  image: { width: 2000, height: 1000 },
  dimensions: [{ text: '10', nominal: 10, kind: 'len', depth: null, xRatio: 0.5, yRatio: 0.5 }]
};
const sourceItem = () => ({
  id: 'source-item', sortOrder: 1, measurementPoint: '穴A', decimalPlaces: 3, measurementLabel: '長さ', nominalValue: decimal(10),
  lowerLimit: decimal('9.123456'), upperLimit: decimal('10.987654'), depthMode: 'MEASURED', valueKind: 'NUMERIC',
  markerXRatio: decimal(0.5), markerYRatio: decimal(0.5), calloutTipXRatio: null, calloutTipYRatio: null
});
const proposal = () => ({
  ...sourceItem(), id: 'proposal', status: 'PROPOSED', dimension: { text: '10' }
});
const run = (overrides = {}) => ({
  id: 'run', sourceTemplateId: 'template', sourceVisualTemplate: { name: source.name },
  proposals: [proposal()], ...overrides
});
const service = new PartMeasurementDrawingPlacementService();

beforeEach(async () => {
  vi.resetAllMocks();
  mocks.env.INSPECTION_DRAWING_REFERENCE_PLACEMENT_ENABLED = false;
  mocks.env.INSPECTION_DRAWING_SEMANTIC_PLACEMENT_ENABLED = false;
  mocks.readDrawing.mockResolvedValue({ buffer: await sharp({ create: {
    width: 100, height: 100, channels: 3, background: 'white'
  } }).png().toBuffer() });
  mocks.vision.completeMany.mockResolvedValue({ rawText: '{"items":[{"n":1,"role":"上面図 全幅","target":"D1"}]}' });
  mocks.ocr.getCurrentFingerprint.mockImplementation(async (id) => `${id}-hash`);
  mocks.ocr.getCurrentStatus.mockImplementation(async (id) => ({ drawingImageFingerprint: `${id}-hash` }));
  mocks.maps.getCompletedPayload.mockImplementation(async (id) => id === 'target' ? payload : null);
  db.partMeasurementDrawingSiblingMatch.findUnique.mockResolvedValue({ status: 'MATCHED', siblings: [{ visualTemplateId: 'source', confidence: 0.9 }] });
  db.partMeasurementDrawingPlacementRun.findUnique.mockResolvedValue(null);
  db.partMeasurementVisualTemplate.findUnique.mockResolvedValue(target);
  db.partMeasurementVisualTemplate.findMany.mockResolvedValue([source]);
  db.partMeasurementTemplate.findMany.mockResolvedValue([{
    id: 'template', visualTemplateId: 'source', isActive: true, updatedAt: new Date(), items: [sourceItem()]
  }]);
  db.partMeasurementTemplateItem.findMany.mockResolvedValue([]);
  db.$transaction.mockImplementation(async (callback) => callback(db));
  db.partMeasurementDrawingPlacementRun.create.mockResolvedValue(run());
});

describe('ensureRun', () => {
  it('requires a map for the current fingerprint before looking up or creating a run', async () => {
    mocks.maps.getCompletedPayload.mockResolvedValue(null);
    expect(await service.ensureRun('target', { processGroup: 'CUTTING' })).toEqual({ status: 'map-pending', run: null });
    expect(mocks.maps.getCompletedPayload).toHaveBeenCalledWith('target', 'target-hash');
    expect(db.partMeasurementDrawingPlacementRun.findUnique).not.toHaveBeenCalled();
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it('returns the cached versioned run without re-ranking', async () => {
    const cached = run();
    db.partMeasurementDrawingPlacementRun.findUnique.mockResolvedValue(cached);
    const reorder = vi.fn();
    expect(await service.ensureRun('target', { processGroup: 'CUTTING', reorder })).toEqual({ status: 'ready', run: cached });
    expect(db.partMeasurementDrawingPlacementRun.findUnique).toHaveBeenCalledWith(expect.objectContaining({
      where: { visualTemplateId_drawingImageFingerprint_analysisVersion_placementVersion: {
        visualTemplateId: 'target', drawingImageFingerprint: 'target-hash',
        analysisVersion: PART_MEASUREMENT_DRAWING_DIMENSION_MAP_VERSION, placementVersion: 'transfer-v2:CUTTING'
      } }
    }));
    expect(db.partMeasurementVisualTemplate.findMany).not.toHaveBeenCalled();
    expect(reorder).not.toHaveBeenCalled();
  });

  it.each([null, { status: 'PENDING' }])('waits for sibling matching without running inference', async (match) => {
    db.partMeasurementDrawingSiblingMatch.findUnique.mockResolvedValue(match);
    expect(await service.ensureRun('target', { processGroup: 'CUTTING' })).toEqual({ status: 'map-pending', run: null });
    expect(db.partMeasurementDrawingPlacementRun.findUnique).not.toHaveBeenCalled();
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it('uses only matched visuals and templates of the requested process, irrespective of names', async () => {
    await service.ensureRun('target', { processGroup: 'GRINDING' });
    expect(db.partMeasurementVisualTemplate.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: { in: ['source'] }, isActive: true }
    }));
    expect(db.partMeasurementTemplate.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ visualTemplateId: { in: ['source'] }, processGroup: 'GRINDING', isActive: true })
    }));
    expect(db.partMeasurementTemplateItem.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { template: { visualTemplateId: 'target', isActive: true, processGroup: 'GRINDING' } }
    }));
    expect(db.partMeasurementDrawingPlacementRun.create.mock.calls[0][0].data).toMatchObject({ sourceTemplateId: 'template', placementVersion: 'transfer-v2:GRINDING' });
  });

  it('does not fall back to another process when no template is available', async () => {
    db.partMeasurementTemplate.findMany.mockResolvedValue([]);
    await service.ensureRun('target', { processGroup: 'GRINDING' });
    expect(db.partMeasurementTemplate.findMany).toHaveBeenCalledOnce();
    expect(db.partMeasurementDrawingPlacementRun.create.mock.calls[0][0].data).toMatchObject({ sourceTemplateId: null, placementVersion: 'transfer-v2:GRINDING' });
  });

  it('persists NO_MATCH without searching templates', async () => {
    db.partMeasurementDrawingSiblingMatch.findUnique.mockResolvedValue({ status: 'NO_MATCH', siblings: [] });
    await service.ensureRun('target', { processGroup: 'CUTTING' });
    expect(db.partMeasurementTemplate.findMany).not.toHaveBeenCalled();
    expect(db.partMeasurementDrawingPlacementRun.create.mock.calls[0][0].data.sourceTemplateId).toBeNull();
  });

  it('creates the run and proposals atomically and copies Decimal limits without conversion', async () => {
    const original = sourceItem();
    original.upperLimit = decimal('999999999999.123456');
    db.partMeasurementTemplate.findMany.mockResolvedValue([{
      id: 'template', visualTemplateId: 'source', isActive: true, updatedAt: new Date(), items: [
        original, { ...sourceItem(), id: 'missing', nominalValue: decimal(99) },
        { ...sourceItem(), id: 'no-nominal', nominalValue: null },
        { ...sourceItem(), id: 'no-marker', markerYRatio: null }
      ]
    }]);
    await service.ensureRun('target', { processGroup: 'CUTTING' });
    expect(db.$transaction).toHaveBeenCalledOnce();
    const data = db.partMeasurementDrawingPlacementRun.create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      sourceVisualTemplateId: 'source', sourceTemplateId: 'template', rankingMethod: 'position',
      proposalCount: 1, unplacedCount: 1
    });
    expect(data.proposals.create).toHaveLength(2);
    expect(data.proposals.create).toEqual(expect.arrayContaining([
      expect.objectContaining({ measurementPoint: '穴A', decimalPlaces: 3, status: 'PROPOSED' }),
      expect.objectContaining({ measurementPoint: '穴A', decimalPlaces: 3, status: 'UNPLACED' })
    ]));
    expect(data.proposals.create[0].upperLimit).toBe(original.upperLimit);
    expect(data.proposals.create[1]).toMatchObject({
      status: 'UNPLACED', markerXRatio: null, markerYRatio: null, dimension: Prisma.DbNull, candidates: []
    });
    expect(mocks.maps.getCompletedPayload).toHaveBeenCalledWith('source', 'source-hash');
  });

  it('skips existing active target items when creating proposals', async () => {
    db.partMeasurementTemplateItem.findMany.mockResolvedValue([{ measurementLabel: '長さ', nominalValue: decimal(10) }]);
    await service.ensureRun('target', { processGroup: 'CUTTING' });
    expect(db.partMeasurementDrawingPlacementRun.create.mock.calls[0][0].data.proposals.create).toEqual([]);
    expect(db.partMeasurementTemplateItem.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { template: { visualTemplateId: 'target', isActive: true, processGroup: 'CUTTING' } }
    }));
  });

  it('persists an empty no-sibling run and reuses it', async () => {
    db.partMeasurementVisualTemplate.findMany.mockResolvedValue([]);
    const empty = run({ sourceTemplateId: null, sourceVisualTemplate: null, proposals: [] });
    db.partMeasurementDrawingPlacementRun.create.mockResolvedValue(empty);
    expect(await service.ensureRun('target', { processGroup: 'CUTTING' })).toEqual({ status: 'no-sibling', run: empty });
    expect(db.partMeasurementDrawingPlacementRun.create.mock.calls[0][0].data).toMatchObject({
      sourceVisualTemplateId: null, sourceTemplateId: null, proposalCount: 0, unplacedCount: 0, proposals: { create: [] }
    });
    db.partMeasurementDrawingPlacementRun.findUnique.mockResolvedValue(empty);
    expect((await service.ensureRun('target', { processGroup: 'CUTTING' })).status).toBe('no-sibling');
    expect(db.partMeasurementDrawingPlacementRun.create).toHaveBeenCalledOnce();
  });

  it('re-reads the winning run on a concurrent unique violation', async () => {
    const winner = run({ id: 'winner' });
    db.partMeasurementDrawingPlacementRun.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(winner);
    db.$transaction.mockRejectedValue(new Prisma.PrismaClientKnownRequestError('duplicate', { code: 'P2002', clientVersion: '5' }));
    expect(await service.ensureRun('target', { processGroup: 'CUTTING' })).toEqual({ status: 'ready', run: winner });
  });

  it('does not swallow a transaction failure', async () => {
    db.$transaction.mockRejectedValue(new Error('storage failed'));
    await expect(service.ensureRun('target', { processGroup: 'CUTTING' })).rejects.toThrow('storage failed');
  });

  it('records the optional reorder method', async () => {
    await service.ensureRun('target', { processGroup: 'CUTTING', reorder: async (_item, candidates) => candidates });
    expect(db.partMeasurementDrawingPlacementRun.create.mock.calls[0][0].data.rankingMethod).toBe('jev');
  });

  it('supplies the selected source to the provider and stores candidate probabilities', async () => {
    mocks.maps.getCompletedPayload.mockResolvedValue({
      ...payload, dimensions: [...payload.dimensions, { ...payload.dimensions[0], xRatio: 0.8 }]
    });
    const reorder = vi.fn(async (_item: PlacementSourceItem, candidates: PlacementCandidate[]) => candidates.map((candidate, i) => ({
      ...candidate, score: i ? 0.8 : 0.2
    })).reverse());
    const reorderProvider = vi.fn(() => reorder);
    await service.ensureRun('target', { processGroup: 'CUTTING', reorderProvider });
    expect(reorderProvider).toHaveBeenCalledWith('target', {
      sourceVisualTemplateId: 'source', sourceMap: expect.objectContaining({ image: payload.image })
    });
    const data = db.partMeasurementDrawingPlacementRun.create.mock.calls[0][0].data;
    expect(data.rankingMethod).toBe('jev');
    expect(data.proposals.create[0].candidates.map((candidate: PlacementCandidate) => candidate.score)).toEqual([0.8, 0.2]);
    expect(data.proposals.create[0].dimension.xRatio).toBe(0.8);
  });
});

describe('listForEditor', () => {
  it('serializes numeric fields and exposes only pending proposals missing from active items', async () => {
    db.partMeasurementDrawingPlacementRun.findUnique.mockResolvedValue(run({ proposals: [
      proposal(),
      { ...proposal(), id: 'saved', measurementLabel: '幅' },
      { ...proposal(), id: 'approved', status: 'APPROVED' },
      { ...proposal(), id: 'rejected', status: 'REJECTED' },
      { ...proposal(), id: 'unplaced', status: 'UNPLACED' }
    ] }));
    db.partMeasurementTemplateItem.findMany.mockResolvedValue([{ measurementLabel: '幅', nominalValue: decimal(10) }]);
    expect(await service.listForEditor('target', 'CUTTING')).toEqual({
      status: 'ready', sourceDrawingName: source.name,
      proposals: [{
        id: 'proposal', sortOrder: 1, measurementPoint: '穴A', decimalPlaces: 3, measurementLabel: '長さ', nominalValue: 10,
        lowerLimit: 9.123456, upperLimit: 10.987654, depthMode: 'measured', valueKind: 'numeric',
        markerXRatio: 0.5, markerYRatio: 0.5, dimensionText: '10'
      }],
      unplaced: [{ id: 'unplaced', measurementLabel: '長さ', measurementPoint: '穴A', decimalPlaces: 3, nominalValue: 10,
        lowerLimit: 9.123456, upperLimit: 10.987654, depthMode: 'measured', valueKind: 'numeric', reason: 'no-candidate' }]
    });
  });

  it('returns the empty response while the map is pending', async () => {
    mocks.maps.getCompletedPayload.mockResolvedValue(null);
    expect(await service.listForEditor('target', 'CUTTING')).toEqual({
      status: 'map-pending', sourceDrawingName: null, proposals: [], unplaced: []
    });
  });

  it('handles nullable fields and a deleted source drawing without changing run status', async () => {
    db.partMeasurementDrawingPlacementRun.findUnique.mockResolvedValue(run({
      sourceVisualTemplate: null, proposals: [{
        ...proposal(), measurementPoint: null, decimalPlaces: 0, depthMode: 'THROUGH', valueKind: 'JUDGEMENT', lowerLimit: null, upperLimit: null, dimension: null
      }]
    }));
    expect(await service.listForEditor('target', 'CUTTING')).toMatchObject({
      status: 'ready', sourceDrawingName: null,
      proposals: [{ measurementPoint: null, decimalPlaces: 0, depthMode: 'through', valueKind: 'judgement', lowerLimit: null, upperLimit: null, dimensionText: null }]
    });
  });
});

describe('recordDecisions', () => {
  it('scopes decisions, preserves decided rows, and is idempotent (approval wins overlaps)', async () => {
    const rows = [
      { id: 'approve', visualTemplateId: 'target', status: 'PROPOSED', decidedAt: null },
      { id: 'reject', visualTemplateId: 'target', status: 'PROPOSED', decidedAt: null },
      { id: 'other', visualTemplateId: 'other', status: 'PROPOSED', decidedAt: null },
      { id: 'unplaced', visualTemplateId: 'target', status: 'UNPLACED', decidedAt: null },
      { id: 'decided', visualTemplateId: 'target', status: 'REJECTED', decidedAt: null }
    ];
    db.partMeasurementDrawingPlacementProposal.updateMany.mockImplementation(async ({ where, data }) => {
      const selected = rows.filter((row) => row.visualTemplateId === where.visualTemplateId &&
        row.status === where.status && where.id.in.includes(row.id));
      selected.forEach((row) => Object.assign(row, data));
      return { count: selected.length };
    });
    const decisions = { approvedIds: ['approve', 'other', 'unplaced', 'decided'], rejectedIds: ['reject', 'approve'] };
    expect(await service.recordDecisions('target', decisions)).toEqual({ updated: 2 });
    const decidedAt = rows[0].decidedAt;
    expect(decidedAt).toBeInstanceOf(Date);
    expect(await service.recordDecisions('target', decisions)).toEqual({ updated: 0 });
    expect(rows.map((row) => row.status)).toEqual(['APPROVED', 'REJECTED', 'PROPOSED', 'UNPLACED', 'REJECTED']);
    expect(rows[0].decidedAt).toBe(decidedAt);
  });
});

describe('backfill', () => {
  it('matches sequentially before creating process-specific runs and continues after failures', async () => {
    db.$queryRaw.mockResolvedValueOnce([{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }])
      .mockResolvedValueOnce([{ id: 'a', processGroup: 'CUTTING' }, { id: 'a', processGroup: 'GRINDING' }, { id: 'd', processGroup: 'CUTTING' }]);
    const events: string[] = [];
    const matcher = { match: vi.fn(async (id) => {
      events.push(`${id}-start`);
      await Promise.resolve();
      events.push(`${id}-end`);
      if (id === 'b') throw new Error('bad map');
      return { status: id === 'c' ? 'PENDING' : id === 'd' ? 'NO_MATCH' : 'MATCHED', method: id === 'a' ? 'jev-vision' : 'name' };
    }) };
    const worker = new PartMeasurementDrawingPlacementService(undefined, undefined, matcher as never);
    const ensure = vi.spyOn(worker, 'ensureRun').mockImplementation(async (id) => {
      events.push(`${id}-run`);
      return { status: id === 'd' ? 'no-sibling' : 'ready', run: run() as never };
    });
    const provider = vi.fn();
    expect(await worker.backfill(4, provider)).toEqual({ scanned: 4, matched: 1, noMatch: 1, deferred: 1, jev: 1,
      ready: 2, noSibling: 1, mapPending: 0, failed: 1 });
    expect(events).toEqual(['a-start', 'a-end', 'b-start', 'b-end', 'c-start', 'c-end', 'd-start', 'd-end', 'a-run', 'a-run', 'd-run']);
    expect(ensure).toHaveBeenCalledWith('a', { processGroup: 'GRINDING', reorderProvider: provider });
    const sql = db.$queryRaw.mock.calls[1][0].join('');
    expect(sql).toContain('r."drawingImageFingerprint" = m."drawingImageFingerprint"');
    expect(sql).toContain('|| p."processGroup"::text');
  });
});


describe('semantic placement', () => {
  beforeEach(() => {
    mocks.env.INSPECTION_DRAWING_SEMANTIC_PLACEMENT_ENABLED = true;
    mocks.maps.getCompletedPayload.mockImplementation(async (id) => id === 'target' ? {
      ...payload, dimensions: [{ ...payload.dimensions[0], text: '20', nominal: 20 }]
    } : null);
  });

  it('persists target values and shifted limits atomically, without calling JEV', async () => {
    const reorderProvider = vi.fn();
    const reorder = vi.fn();
    await service.ensureRun('target', { processGroup: 'CUTTING', reorder, reorderProvider });
    expect(db.$transaction).toHaveBeenCalledOnce();
    expect(reorderProvider).not.toHaveBeenCalled();
    expect(reorder).not.toHaveBeenCalled();
    expect(mocks.readDrawing.mock.calls).toEqual([['source.png'], ['target.png']]);
    const data = db.partMeasurementDrawingPlacementRun.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ placementVersion: 'semantic-v1:CUTTING', rankingMethod: 'semantic', proposalCount: 1, unplacedCount: 0 });
    expect(data.proposals.create[0]).toMatchObject({
      status: 'PROPOSED', nominalValue: 20, measurementLabel: '長さ', measurementPoint: '穴A', decimalPlaces: 3
    });
    expect(data.proposals.create[0].lowerLimit).toBeCloseTo(19.123456);
    expect(data.proposals.create[0].upperLimit).toBeCloseTo(20.987654);
  });

  it('chooses the first valid sibling and its newest template, irrespective of value matches', async () => {
    db.partMeasurementDrawingSiblingMatch.findUnique.mockResolvedValue({ status: 'MATCHED', siblings: [
      { visualTemplateId: 'empty', confidence: 0.99 }, { visualTemplateId: 'first', confidence: 0.95 },
      { visualTemplateId: 'source', confidence: 0.9 }
    ] });
    db.partMeasurementVisualTemplate.findMany.mockResolvedValue([
      source, { ...source, id: 'first', drawingImageRelativePath: 'first.png' }, { ...source, id: 'empty' }
    ]);
    db.partMeasurementTemplate.findMany.mockResolvedValue([
      { id: 'matching', visualTemplateId: 'source', isActive: true, updatedAt: new Date(300), items: [{ ...sourceItem(), nominalValue: decimal(20) }] },
      { id: 'older', visualTemplateId: 'first', isActive: true, updatedAt: new Date(0), items: [sourceItem()] },
      { id: 'newer', visualTemplateId: 'first', isActive: true, updatedAt: new Date(100), items: [sourceItem()] }
    ]);
    await service.ensureRun('target', { processGroup: 'CUTTING' });
    expect(db.partMeasurementDrawingPlacementRun.create.mock.calls[0][0].data).toMatchObject({
      sourceVisualTemplateId: 'first', sourceTemplateId: 'newer'
    });
    expect(mocks.readDrawing).toHaveBeenCalledWith('first.png');
  });

  it('checks existing items against the target nominal', async () => {
    db.partMeasurementTemplateItem.findMany.mockResolvedValue([{ measurementLabel: '長さ', nominalValue: decimal(20) }]);
    await service.ensureRun('target', { processGroup: 'CUTTING' });
    expect(db.partMeasurementDrawingPlacementRun.create.mock.calls[0][0].data.proposals.create).toEqual([]);
    db.partMeasurementTemplateItem.findMany.mockResolvedValue([{ measurementLabel: '長さ', nominalValue: decimal(10) }]);
    await service.ensureRun('target', { processGroup: 'CUTTING' });
    expect(db.partMeasurementDrawingPlacementRun.create.mock.calls[1][0].data.proposalCount).toBe(1);
  });

  it.each(['timeout', 'JSON', 'image'])('saves all items UNPLACED on %s failure and reuses the run', async (failure) => {
    db.partMeasurementTemplate.findMany.mockResolvedValue([{
      id: 'template', visualTemplateId: 'source', isActive: true, updatedAt: new Date(),
      items: [sourceItem(), { ...sourceItem(), id: 'second' }]
    }]);
    if (failure === 'timeout') mocks.vision.completeMany.mockRejectedValue(new Error('timeout'));
    if (failure === 'JSON') mocks.vision.completeMany.mockResolvedValue({ rawText: '{broken' });
    if (failure === 'image') mocks.readDrawing.mockRejectedValue(new Error('image unavailable'));
    await service.ensureRun('target', { processGroup: 'CUTTING' });
    const data = db.partMeasurementDrawingPlacementRun.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ placementVersion: 'semantic-v1:CUTTING', rankingMethod: 'semantic-failed', proposalCount: 0, unplacedCount: 2 });
    expect(data.proposals.create).toHaveLength(2);
    expect(data.proposals.create.every((row: { status: string; markerXRatio: number | null; markerYRatio: number | null }) => row.status === 'UNPLACED' && row.markerXRatio === null && row.markerYRatio === null)).toBe(true);
    expect(mocks.warn).toHaveBeenCalledWith(expect.objectContaining({ visualTemplateId: 'target' }), 'drawing semantic placement failed');
    const saved = run({ proposals: data.proposals.create });
    db.partMeasurementDrawingPlacementRun.findUnique.mockResolvedValue(saved);
    mocks.vision.completeMany.mockClear();
    expect((await service.ensureRun('target', { processGroup: 'CUTTING' })).run).toBe(saved);
    expect(db.partMeasurementDrawingPlacementRun.create).toHaveBeenCalledOnce();
    expect(mocks.vision.completeMany).not.toHaveBeenCalled();
  });

  it('rethrows deferred inference without saving a run', async () => {
    const deferred = new InferenceDeferredError();
    mocks.vision.completeMany.mockRejectedValue(deferred);
    await expect(service.ensureRun('target', { processGroup: 'CUTTING' })).rejects.toBe(deferred);
    expect(db.$transaction).not.toHaveBeenCalled();
    expect(db.partMeasurementDrawingPlacementRun.create).not.toHaveBeenCalled();
    expect(mocks.warn).not.toHaveBeenCalled();
  });

  it('persists M3 rejections and preserves the explanation in candidates', async () => {
    mocks.maps.getCompletedPayload.mockResolvedValue({ ...payload, dimensions: [{ ...payload.dimensions[0], kind: 'ref' }] });
    await service.ensureRun('target', { processGroup: 'CUTTING' });
    const data = db.partMeasurementDrawingPlacementRun.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ rankingMethod: 'semantic', proposalCount: 0, unplacedCount: 1 });
    expect(data.proposals.create[0]).toMatchObject({ status: 'UNPLACED', candidates: [{ rejectionReason: 'reference-dimension' }] });
  });

  it('uses the legacy version and numeric transfer when disabled', async () => {
    mocks.env.INSPECTION_DRAWING_SEMANTIC_PLACEMENT_ENABLED = false;
    await service.ensureRun('target', { processGroup: 'CUTTING' });
    expect(db.partMeasurementDrawingPlacementRun.create.mock.calls[0][0].data).toMatchObject({
      placementVersion: 'transfer-v2:CUTTING', rankingMethod: 'position', proposalCount: 0, unplacedCount: 1
    });
    expect(mocks.vision.completeMany).not.toHaveBeenCalled();
  });

  it('uses the active version for process keys and backfill SQL, stopping remaining transfers on deferral', async () => {
    expect(currentPlacementVersion()).toBe('semantic-v1');
    expect(placementVersionFor('GRINDING')).toBe('semantic-v1:GRINDING');
    db.$queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([
      { id: 'target', processGroup: 'CUTTING' }, { id: 'next', processGroup: 'GRINDING' }
    ]);
    const worker = new PartMeasurementDrawingPlacementService();
    const ensure = vi.spyOn(worker, 'ensureRun').mockRejectedValueOnce(new InferenceDeferredError());
    expect(await worker.backfill(30)).toMatchObject({ deferred: 1, failed: 0, ready: 0 });
    expect(ensure).toHaveBeenCalledOnce();
    expect(db.$queryRaw.mock.calls[1].slice(1)).toContain('semantic-v1:');
    mocks.env.INSPECTION_DRAWING_SEMANTIC_PLACEMENT_ENABLED = false;
    expect(currentPlacementVersion()).toBe('transfer-v2');
    expect(placementVersionFor('CUTTING')).toBe('transfer-v2:CUTTING');
  });
});

describe('disabled reference placement', () => {
  it('uses sibling runs even with the old reference flag enabled', async () => {
    mocks.env.INSPECTION_DRAWING_REFERENCE_PLACEMENT_ENABLED = true;
    db.partMeasurementDrawingPlacementRun.findUnique.mockResolvedValue(run());
    expect((await service.listForEditor('target', 'CUTTING')).sourceDrawingName).toBe(source.name);
    expect(db.partMeasurementDrawingSiblingMatch.findUnique).toHaveBeenCalledOnce();
  });

  it('leaves semantic runs to the nightly backfill when the editor opens', async () => {
    mocks.env.INSPECTION_DRAWING_SEMANTIC_PLACEMENT_ENABLED = true;
    expect(await service.listForEditor('target', 'CUTTING')).toEqual({
      status: 'map-pending', sourceDrawingName: null, proposals: [], unplaced: []
    });
    expect(mocks.vision.completeMany).not.toHaveBeenCalled();
    expect(db.partMeasurementDrawingPlacementRun.create).not.toHaveBeenCalled();
  });

  it('does not query or generate reference runs during backfill', async () => {
    mocks.env.INSPECTION_DRAWING_REFERENCE_PLACEMENT_ENABLED = true;
    db.$queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    await service.backfill(30);
    expect(db.$queryRaw).toHaveBeenCalledTimes(2);
    expect(mocks.vision.completeMany).not.toHaveBeenCalled();
  });
});
