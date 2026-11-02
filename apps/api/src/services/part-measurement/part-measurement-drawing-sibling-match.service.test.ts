import sharp from 'sharp';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  prisma: {
    partMeasurementDrawingSiblingMatch: { findUnique: vi.fn(), upsert: vi.fn(), update: vi.fn() },
    partMeasurementVisualTemplate: { findUniqueOrThrow: vi.fn(), findMany: vi.fn() }
  },
  ocr: { getCurrentStatus: vi.fn() }, maps: { getCompletedPayload: vi.fn() }
}));
vi.mock('../../lib/prisma.js', () => ({ prisma: mocks.prisma }));
vi.mock('../../config/env.js', () => ({ env: { LOG_LEVEL: 'silent' } }));
vi.mock('../inference/inference-runtime.js', () => ({ getInferenceRuntime: vi.fn() }));
vi.mock('./part-measurement-drawing-ocr.service.js', () => ({ getPartMeasurementDrawingOcrService: () => mocks.ocr }));
vi.mock('./part-measurement-drawing-dimension-map.service.js', () => ({ getPartMeasurementDrawingDimensionMapService: () => mocks.maps }));

import { InferenceDeferredError } from '../inference/ports/text-completion.port.js';
import { PartMeasurementDrawingSiblingMatchService } from './part-measurement-drawing-sibling-match.service.js';
import {
  encodePartMeasurementDrawingDimensionMapPayload, PART_MEASUREMENT_DRAWING_DIMENSION_MAP_VERSION,
  type PartMeasurementDrawingDimensionMapPayload
} from './part-measurement-drawing-dimension-map-payload.js';

const payload: PartMeasurementDrawingDimensionMapPayload = {
  schemaVersion: 1, analysisVersion: PART_MEASUREMENT_DRAWING_DIMENSION_MAP_VERSION, createdAt: '', tiles: [],
  image: { width: 2000, height: 1000 }, dimensions: [{ text: '10', nominal: 10, kind: 'len', depth: null,
    upperTolerance: null, lowerTolerance: null, xRatio: 0.5, yRatio: 0.5, tileId: 'tile' }]
};
const db = mocks.prisma;
const completeMany = vi.fn();
const deps = {
  enabled: vi.fn(() => true), vision: () => ({ completeMany }),
  candidateLimit: () => 8,
  readDrawing: vi.fn(async (_path: string) => ({ buffer: await sharp({ create: {
    width: 2000, height: 1000, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 }
  } }).png().toBuffer(), contentType: 'image/png' }))
};
const service = new PartMeasurementDrawingSiblingMatchService(deps);
const response = (shapeSimilarity: number) => ({ rawText: JSON.stringify({ shapeSimilarity }) });

beforeEach(async () => {
  vi.clearAllMocks();
  deps.enabled.mockReturnValue(true);
  mocks.ocr.getCurrentStatus.mockResolvedValue({ drawingImageFingerprint: 'hash' });
  mocks.maps.getCompletedPayload.mockResolvedValue(payload);
  db.partMeasurementDrawingSiblingMatch.findUnique.mockResolvedValue(null);
  let attempts = 0;
  db.partMeasurementDrawingSiblingMatch.upsert.mockImplementation(async () => ({ id: 'match', attempts: ++attempts }));
  db.partMeasurementDrawingSiblingMatch.update.mockImplementation(async ({ data }) => ({ id: 'match', ...data }));
  db.partMeasurementVisualTemplate.findUniqueOrThrow.mockResolvedValue({ id: 'target', name: 'スタンド', drawingImageRelativePath: 'target.png' });
  db.partMeasurementVisualTemplate.findMany.mockResolvedValue([{
    id: 'source', name: '足', drawingImageRelativePath: 'source.png', dimensionMaps: [{ status: 'COMPLETED',
      payloadCompressed: await encodePartMeasurementDrawingDimensionMapPayload(payload), payloadEncoding: 'gzip+json' }]
  }]);
  completeMany.mockResolvedValue(response(0.9));
});

describe('drawing sibling match', () => {
  it('persists a shape match across names and uses resized background images', async () => {
    expect(await service.match('target')).toMatchObject({ status: 'MATCHED', method: 'dgx-vision', siblings: [{ visualTemplateId: 'source', confidence: 0.9 }] });
    expect(completeMany).toHaveBeenCalledOnce();
    const input = completeMany.mock.calls[0][0];
    expect(input).toMatchObject({ background: true, jsonOutput: true, timeoutMs: 115000, maxTokens: 600 });
    expect(input.images.map((image: { label: string }) => image.label)).toEqual(['target', 'candidate_1']);
    expect(await sharp(input.images[0].imageBytes).metadata()).toMatchObject({ width: 1280, height: 640, format: 'jpeg' });
    const { data } = await sharp(input.images[0].imageBytes).raw().toBuffer({ resolveWithObject: true });
    expect([...data.subarray(0, 3)]).toEqual([255, 255, 255]);
    expect(db.partMeasurementDrawingSiblingMatch.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: {
      visualTemplateId_drawingImageFingerprint_matchVersion: { visualTemplateId: 'target', drawingImageFingerprint: 'hash', matchVersion: 'sibling-shape-v1' }
    } }));
    expect(db.partMeasurementVisualTemplate.findMany).toHaveBeenCalledOnce();
  });

  it.each([{ score: 0.79, status: 'NO_MATCH' }, { score: 0.8, status: 'MATCHED' }])('applies the shape threshold ($score)', async ({ score, status }) => {
    completeMany.mockResolvedValue(response(score));
    expect(await service.match('target')).toMatchObject({ status, method: 'dgx-vision' });
  });

  it('calls each candidate separately and persists descending scores', async () => {
    const [source] = await db.partMeasurementVisualTemplate.findMany();
    db.partMeasurementVisualTemplate.findMany.mockClear().mockResolvedValue([source, { ...source, id: 'second' }]);
    completeMany.mockResolvedValueOnce(response(0.8)).mockResolvedValueOnce(response(0.9));
    expect(await service.match('target')).toMatchObject({ siblings: [
      { visualTemplateId: 'source', confidence: 0.9 }, { visualTemplateId: 'second', confidence: 0.8 }
    ] });
    expect(completeMany).toHaveBeenCalledTimes(2);
    expect(db.partMeasurementVisualTemplate.findMany).toHaveBeenCalledOnce();
  });

  it('keeps deferred inference PENDING beyond three attempts', async () => {
    completeMany.mockRejectedValue(new InferenceDeferredError());
    for (let i = 0; i < 4; i++) {
      // eslint-disable-next-line no-await-in-loop
      expect(await service.match('target')).toMatchObject({ status: 'PENDING', siblings: [], lastError: 'DGX background admission deferred' });
    }
    expect(db.partMeasurementDrawingSiblingMatch.upsert).toHaveBeenLastCalledWith(expect.objectContaining({ update: { attempts: { increment: 1 } } }));
  });

  it.each(['error', 'invalid'])('retries %s then persists NO_MATCH without using matching names', async (mode) => {
    if (mode === 'error') completeMany.mockRejectedValue(new Error('timeout'));
    else completeMany.mockResolvedValue({ rawText: '{}' });
    db.partMeasurementVisualTemplate.findUniqueOrThrow.mockResolvedValue({ id: 'target', name: '足(左)', drawingImageRelativePath: 'target.png' });
    expect(await service.match('target')).toMatchObject({ status: 'PENDING' });
    expect(await service.match('target')).toMatchObject({ status: 'PENDING' });
    expect(await service.match('target')).toMatchObject({ status: 'NO_MATCH', method: 'dgx-vision', siblings: [], lastError: expect.any(String) });
  });

  it('records an unreadable target image and stops after three attempts', async () => {
    for (let i = 0; i < 3; i++) deps.readDrawing.mockRejectedValueOnce(new Error('missing drawing'));
    expect(await service.match('target')).toMatchObject({ status: 'PENDING', lastError: 'missing drawing' });
    expect(await service.match('target')).toMatchObject({ status: 'PENDING' });
    expect(await service.match('target')).toMatchObject({ status: 'NO_MATCH', siblings: [], lastError: 'missing drawing' });
    expect(completeMany).not.toHaveBeenCalled();
  });

  it('does not use names or read images when vision is disabled', async () => {
    deps.enabled.mockReturnValue(false);
    db.partMeasurementVisualTemplate.findUniqueOrThrow.mockResolvedValue({ id: 'target', name: '足(左)' });
    expect(await service.match('target')).toMatchObject({ status: 'NO_MATCH', method: 'dgx-vision', siblings: [] });
    expect(completeMany).not.toHaveBeenCalled();
    expect(deps.readDrawing).not.toHaveBeenCalled();
  });

  it('finishes without vision when there are no eligible completed maps', async () => {
    db.partMeasurementVisualTemplate.findMany.mockResolvedValue([{ id: 'source', name: '足', dimensionMaps: [] }]);
    expect(await service.match('target')).toMatchObject({ status: 'NO_MATCH', method: 'dgx-vision' });
    expect(completeMany).not.toHaveBeenCalled();
  });
});
