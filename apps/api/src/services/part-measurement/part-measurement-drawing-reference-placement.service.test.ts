import { Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  db: { partMeasurementDrawingPlacementRun: { findUnique: vi.fn(), create: vi.fn() },
    partMeasurementVisualTemplate: { findUnique: vi.fn(), findMany: vi.fn() }, $transaction: vi.fn() },
  ocr: { getCurrentFingerprint: vi.fn() }, maps: { getCompletedPayload: vi.fn() },
  text: { complete: vi.fn() }, settings: { listSettings: vi.fn() }
}));
vi.mock('../../lib/prisma.js', () => ({ prisma: mocks.db }));
vi.mock('../inference/inference-runtime.js', () => ({ getInferenceRuntime: () => ({ createTextCompletionPort: () => mocks.text }) }));
vi.mock('./part-measurement-drawing-ocr.service.js', () => ({ getPartMeasurementDrawingOcrService: () => mocks.ocr }));
vi.mock('./part-measurement-drawing-dimension-map.service.js', () => ({ getPartMeasurementDrawingDimensionMapService: () => mocks.maps }));

import { InferenceDeferredError } from '../inference/ports/text-completion.port.js';
import { PartMeasurementDrawingReferencePlacementService } from './part-measurement-drawing-reference-placement.service.js';
import {
  encodePartMeasurementDrawingDimensionMapPayload, PART_MEASUREMENT_DRAWING_DIMENSION_MAP_VERSION,
  type PartMeasurementDrawingDimensionMapPayload
} from './part-measurement-drawing-dimension-map-payload.js';

const map: PartMeasurementDrawingDimensionMapPayload = {
  schemaVersion: 1, analysisVersion: PART_MEASUREMENT_DRAWING_DIMENSION_MAP_VERSION,
  createdAt: '2026-10-26', image: { width: 100, height: 100 }, tiles: [],
  dimensions: [{ text: '64', nominal: 64, kind: 'len', depth: null, lowerTolerance: null, upperTolerance: null, xRatio: 0.5, yRatio: 0.6, tileId: 'tile' }]
};
const service = new PartMeasurementDrawingReferencePlacementService(mocks.text, mocks.ocr, mocks.maps, mocks.settings);
const db = mocks.db;

beforeEach(() => {
  vi.resetAllMocks();
  mocks.ocr.getCurrentFingerprint.mockResolvedValue('current');
  mocks.maps.getCompletedPayload.mockResolvedValue(map);
  mocks.settings.listSettings.mockResolvedValue([{ label: '幅', toleranceKind: 'dimension' }]);
  mocks.text.complete.mockResolvedValue({ rawText: '{"items":[{"i":0,"use":"nominal","label":"幅"}]}', model: 'fake' });
  db.partMeasurementDrawingPlacementRun.findUnique.mockResolvedValue(null);
  db.partMeasurementDrawingPlacementRun.create.mockResolvedValue({ id: 'reference' });
  db.partMeasurementVisualTemplate.findUnique.mockResolvedValue({ id: 'target', name: '3351-MD1 台' });
  db.partMeasurementVisualTemplate.findMany.mockResolvedValue([]);
  db.$transaction.mockImplementation(async (callback) => callback(db));
});

describe('reference placement service', () => {
  it('findRun is read-only and keys by the current fingerprint and process', async () => {
    const run = { id: 'existing' };
    db.partMeasurementDrawingPlacementRun.findUnique.mockResolvedValue(run);
    expect(await service.findRun('target', 'GRINDING')).toBe(run);
    expect(db.partMeasurementDrawingPlacementRun.findUnique).toHaveBeenCalledWith(expect.objectContaining({
      where: { visualTemplateId_drawingImageFingerprint_analysisVersion_placementVersion: {
        visualTemplateId: 'target', drawingImageFingerprint: 'current', analysisVersion: map.analysisVersion, placementVersion: 'reference-v1:GRINDING'
      } }
    }));
    expect(mocks.text.complete).not.toHaveBeenCalled();
    expect(db.$transaction).not.toHaveBeenCalled();
  });
  it('returns cached runs and missing maps without inference', async () => {
    db.partMeasurementDrawingPlacementRun.findUnique.mockResolvedValueOnce({ id: 'existing' });
    expect(await service.ensureRun('target', 'CUTTING')).toEqual({ id: 'existing' });
    mocks.maps.getCompletedPayload.mockResolvedValue(null);
    expect(await service.ensureRun('target', 'CUTTING')).toBeNull();
    expect(mocks.maps.getCompletedPayload).toHaveBeenCalledWith('target', 'current');
    expect(mocks.text.complete).not.toHaveBeenCalled();
    expect(db.$transaction).not.toHaveBeenCalled();
  });
  it('uses human examples, settings and vocabulary, then saves proposals atomically', async () => {
    const payloadCompressed = await encodePartMeasurementDrawingDimensionMapPayload(map);
    const visual = (id: string, fingerprint = id, status = 'COMPLETED') => ({
      id, name: '7161台', dimensionMaps: [{ status, drawingImageFingerprint: fingerprint, payloadCompressed, payloadEncoding: 'gzip+json' }],
      businessTemplates: [{ items: [{ measurementLabel: '幅', nominalValue: new Prisma.Decimal(64), markerXRatio: new Prisma.Decimal(0.5), markerYRatio: new Prisma.Decimal(0.6) }] }]
    });
    db.partMeasurementVisualTemplate.findMany.mockResolvedValue([visual('example'), visual('copy', 'current'), visual('pending', 'pending', 'PENDING')]);
    const signal = new AbortController().signal;
    await service.ensureRun('target', 'CUTTING', { signal });
    expect(mocks.text.complete).toHaveBeenCalledWith(expect.objectContaining({
      useCase: 'business_hermes', maxTokens: 4000, temperature: 0, enableThinking: false, jsonOutput: true, background: true, signal
    }));
    const prompt = mocks.text.complete.mock.calls[0][0].messages[1].content;
    expect(prompt).toContain('ネジ穴深さ');
    expect(prompt).toContain('見本 1:');
    expect(prompt).not.toContain('見本 2:');
    expect(prompt).toContain('{"items":[{"i":0,"use":"nominal","label":"幅"}]}');
    expect(db.partMeasurementVisualTemplate.findMany.mock.calls[0][0]).toMatchObject({
      where: { isActive: true, businessTemplates: { some: { isActive: true, processGroup: 'CUTTING' } } },
      select: { dimensionMaps: { take: 1, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }] } }
    });
    expect(db.$transaction).toHaveBeenCalledOnce();
    expect(db.partMeasurementDrawingPlacementRun.create.mock.calls[0][0].data).toMatchObject({
      placementVersion: 'reference-v1:CUTTING', rankingMethod: 'reference', sourceVisualTemplateId: null, sourceTemplateId: null,
      proposalCount: 1, unplacedCount: 0, proposals: { create: [{
        visualTemplateId: 'target', sourceItemId: 'ref:0:nominal', status: 'PROPOSED', measurementLabel: '幅',
        nominalValue: 64, lowerLimit: 63.7, upperLimit: 64.3, markerXRatio: 0.5, markerYRatio: 0.6, candidates: []
      }] }
    });
  });
  it('propagates deferral without saving', async () => {
    mocks.text.complete.mockRejectedValueOnce(new InferenceDeferredError());
    await expect(service.ensureRun('target', 'CUTTING')).rejects.toBeInstanceOf(InferenceDeferredError);
    expect(db.$transaction).not.toHaveBeenCalled();
    expect(db.partMeasurementDrawingPlacementRun.create).not.toHaveBeenCalled();
  });

  it('saves an unusable answer as an empty run without exposing response text', async () => {
    mocks.text.complete.mockResolvedValueOnce({ rawText: 'private model text', model: 'fake' });
    await service.ensureRun('target', 'CUTTING');
    const data = db.partMeasurementDrawingPlacementRun.create.mock.calls[0]![0].data;
    expect(data).toMatchObject({ proposalCount: 0, proposals: { create: [] } });
    expect(JSON.stringify(data)).not.toContain('private model text');
  });
  it('does not save after cancellation during completion', async () => {
    const controller = new AbortController();
    mocks.text.complete.mockImplementation(async () => {
      controller.abort();
      return { rawText: '{"items":[]}', model: 'fake' };
    });
    await expect(service.ensureRun('target', 'CUTTING', { signal: controller.signal })).rejects.toThrow();
    expect(db.$transaction).not.toHaveBeenCalled();
  });
  it('re-reads a concurrent winner and propagates other storage failures', async () => {
    db.partMeasurementDrawingPlacementRun.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'winner' });
    db.$transaction.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError('duplicate', { code: 'P2002', clientVersion: '7' }));
    expect(await service.ensureRun('target', 'CUTTING')).toEqual({ id: 'winner' });
    db.$transaction.mockRejectedValueOnce(new Error('storage failed'));
    await expect(service.ensureRun('target', 'CUTTING')).rejects.toThrow('storage failed');
  });
});
