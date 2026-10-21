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
const requestJevChoice = vi.fn();
const deps = {
  enabled: vi.fn(() => true), vision: () => ({ completeMany }),
  jevConfig: vi.fn(() => ({ enabled: true, apiKey: 'test-key', timeoutMs: 20000 })), requestJevChoice,
  readDrawing: vi.fn(async (_path: string) => ({ buffer: await sharp({ create: {
    width: 2000, height: 1000, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 }
  } }).png().toBuffer(), contentType: 'image/png' }))
};
const service = new PartMeasurementDrawingSiblingMatchService(deps);
const response = (confidence: number, sameFamily = true) => ({ rawText: JSON.stringify({ candidates: [
  { label: 'candidate_1', sameFamily, confidence }
] }) });

beforeEach(async () => {
  vi.clearAllMocks();
  deps.enabled.mockReturnValue(true);
  deps.jevConfig.mockReturnValue({ enabled: true, apiKey: 'test-key', timeoutMs: 20000 });
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
  requestJevChoice.mockResolvedValue({ candidate_1: 0.8, none: 0.2 });
});

describe('drawing sibling match', () => {
  it('uses one background multi-image call, resized whole drawings, and saves content matches across names', async () => {
    expect(await service.match('target')).toMatchObject({ status: 'MATCHED', method: 'dgx-vision', siblings: [{ visualTemplateId: 'source', confidence: 0.9 }] });
    expect(completeMany).toHaveBeenCalledOnce();
    const input = completeMany.mock.calls[0][0];
    expect(input).toMatchObject({ background: true, jsonOutput: true, timeoutMs: 115000 });
    expect(input.images.map((image) => image.label)).toEqual(['target', 'candidate_1']);
    expect(await sharp(input.images[0].imageBytes).metadata()).toMatchObject({ width: 1280, height: 640, format: 'jpeg' });
    const { data } = await sharp(input.images[0].imageBytes).raw().toBuffer({ resolveWithObject: true });
    expect([...data.subarray(0, 3)]).toEqual([255, 255, 255]);
    expect(requestJevChoice).not.toHaveBeenCalled();
  });

  it.each([
    { confidence: 0.49, sameFamily: true, status: 'NO_MATCH' },
    { confidence: 0.5, sameFamily: true, status: 'MATCHED' },
    { confidence: 0.9, sameFamily: false, status: 'NO_MATCH' }
  ])('applies the family and 0.5 thresholds ($confidence, $sameFamily)', async ({ confidence, sameFamily, status }) => {
    deps.jevConfig.mockReturnValue({ enabled: false, apiKey: '', timeoutMs: 20000 });
    completeMany.mockResolvedValue(response(confidence, sameFamily));
    expect(await service.match('target')).toMatchObject({ status, method: 'dgx-vision' });
  });

  it('ranks accepted siblings by confidence regardless of response order', async () => {
    const [source] = await db.partMeasurementVisualTemplate.findMany();
    db.partMeasurementVisualTemplate.findMany.mockResolvedValue([source, { ...source, id: 'second' }]);
    completeMany.mockResolvedValue({ rawText: JSON.stringify({ candidates: [
      { label: 'candidate_2', sameFamily: true, confidence: 0.8 },
      { label: 'candidate_1', sameFamily: true, confidence: 0.9 }
    ] }) });
    expect(await service.match('target')).toMatchObject({ siblings: [
      { visualTemplateId: 'second', confidence: 0.9 }, { visualTemplateId: 'source', confidence: 0.8 }
    ] });
  });

  it('keeps deferred inference PENDING for two attempts, then lets JEV decide', async () => {
    completeMany.mockRejectedValue(new InferenceDeferredError());
    for (let i = 0; i < 2; i++) {
      // eslint-disable-next-line no-await-in-loop
      expect(await service.match('target')).toMatchObject({ status: 'PENDING', siblings: [] });
    }
    expect(db.partMeasurementDrawingSiblingMatch.upsert).toHaveBeenLastCalledWith(expect.objectContaining({ update: { attempts: { increment: 1 } } }));
    expect(requestJevChoice).not.toHaveBeenCalled();
    expect(await service.match('target')).toMatchObject({ status: 'MATCHED', method: 'jev-vision' });
    expect(requestJevChoice).toHaveBeenCalledOnce();
  });

  it('keeps deferred inference PENDING until the third attempt when JEV is unavailable, then uses names', async () => {
    deps.jevConfig.mockReturnValue({ enabled: false, apiKey: '', timeoutMs: 20000 });
    completeMany.mockRejectedValue(new InferenceDeferredError());
    db.partMeasurementVisualTemplate.findUniqueOrThrow.mockResolvedValue({ id: 'target', name: '足(左)', drawingImageRelativePath: 'target.png' });
    expect(await service.match('target')).toMatchObject({ status: 'PENDING' });
    expect(await service.match('target')).toMatchObject({ status: 'PENDING' });
    expect(await service.match('target')).toMatchObject({ status: 'MATCHED', method: 'name' });
  });

  it.each(['error', 'invalid', 'uncertain'])('uses JEV for %s DGX output', async (mode) => {
    if (mode === 'error') completeMany.mockRejectedValue(new Error('timeout'));
    else completeMany.mockResolvedValue(mode === 'invalid' ? { rawText: '{}' } : response(0.6));
    expect(await service.match('target')).toMatchObject({ status: 'MATCHED', method: 'jev-vision', siblings: [{ visualTemplateId: 'source', confidence: 0.7 }] });
    expect(requestJevChoice).toHaveBeenCalledWith(expect.objectContaining({
      assets: { target: expect.any(Object), candidate_1: expect.any(Object) },
      criteria: { candidate_1: expect.any(String), none: expect.any(String) }
    }));
  });

  it('persists JEV none as NO_MATCH', async () => {
    completeMany.mockRejectedValue(new Error('timeout'));
    requestJevChoice.mockResolvedValue({ none: 0.8, candidate_1: 0.2 });
    expect(await service.match('target')).toMatchObject({ status: 'NO_MATCH', method: 'jev-vision', siblings: [] });
  });

  it.each(['disabled', 'missing-key', 'failed'])('retries DGX errors then falls back to names when JEV is %s', async (mode) => {
    deps.jevConfig.mockReturnValue({ enabled: mode !== 'disabled', apiKey: mode === 'missing-key' ? '' : 'test-key', timeoutMs: 20000 });
    requestJevChoice.mockRejectedValue(new Error('JEV failed'));
    completeMany.mockRejectedValue(new Error('timeout'));
    db.partMeasurementVisualTemplate.findUniqueOrThrow.mockResolvedValue({ id: 'target', name: '足(左)', drawingImageRelativePath: 'target.png' });
    expect(await service.match('target')).toMatchObject({ status: 'PENDING' });
    expect(await service.match('target')).toMatchObject({ status: 'PENDING' });
    expect(await service.match('target')).toMatchObject({ status: 'MATCHED', method: 'name', siblings: [{ visualTemplateId: 'source', confidence: 0.4 }] });
    if (mode !== 'failed') expect(requestJevChoice).not.toHaveBeenCalled();
  });

  it('falls back to NO_MATCH after three errors without a name sibling', async () => {
    deps.jevConfig.mockReturnValue({ enabled: false, apiKey: '', timeoutMs: 20000 });
    completeMany.mockRejectedValue(new Error('timeout'));
    db.partMeasurementDrawingSiblingMatch.upsert.mockResolvedValue({ id: 'match', attempts: 3 });
    expect(await service.match('target')).toMatchObject({ status: 'NO_MATCH', method: 'name', siblings: [] });
  });

  it('uses only name candidates when vision is disabled', async () => {
    deps.enabled.mockReturnValue(false);
    expect(await service.match('target')).toMatchObject({ status: 'NO_MATCH', method: 'name' });
    db.partMeasurementVisualTemplate.findUniqueOrThrow.mockResolvedValue({ id: 'target', name: '足(左)' });
    expect(await service.match('target')).toMatchObject({ status: 'MATCHED', method: 'name', siblings: [{ visualTemplateId: 'source', confidence: 0.4 }] });
    expect(completeMany).not.toHaveBeenCalled();
    expect(deps.readDrawing).not.toHaveBeenCalled();
  });

  it('finishes without vision when there are no eligible completed maps', async () => {
    db.partMeasurementVisualTemplate.findMany.mockResolvedValue([{ id: 'source', name: '足', dimensionMaps: [] }]);
    expect(await service.match('target')).toMatchObject({ status: 'NO_MATCH', method: 'name' });
    expect(completeMany).not.toHaveBeenCalled();
  });

  it('keeps a valid uncertain DGX result when JEV is unavailable', async () => {
    completeMany.mockResolvedValue(response(0.6));
    deps.jevConfig.mockReturnValue({ enabled: false, apiKey: '', timeoutMs: 20000 });
    expect(await service.match('target')).toMatchObject({ status: 'MATCHED', method: 'dgx-vision' });
  });
});
