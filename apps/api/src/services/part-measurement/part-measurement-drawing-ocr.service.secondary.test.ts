import { afterEach, describe, expect, it, vi } from 'vitest';

import type { DrawingLocalOcrPort } from './drawing-local-ocr.port.js';
import {
  PART_MEASUREMENT_DRAWING_OCR_PAYLOAD_SCHEMA_VERSION,
  PART_MEASUREMENT_DRAWING_OCR_VERSION,
  type PartMeasurementDrawingOcrPayload
} from './part-measurement-drawing-ocr-payload.js';
import { PartMeasurementDrawingOcrEngine } from './part-measurement-drawing-ocr-engine.js';
import { PartMeasurementDrawingOcrService } from './part-measurement-drawing-ocr.service.js';

const basePayload: PartMeasurementDrawingOcrPayload = {
  schemaVersion: PART_MEASUREMENT_DRAWING_OCR_PAYLOAD_SCHEMA_VERSION,
  ocrVersion: PART_MEASUREMENT_DRAWING_OCR_VERSION,
  engine: 'test',
  createdAt: '2026-07-10T00:00:00.000Z',
  image: { width: 1000, height: 800 },
  tokens: [
    {
      text: '999',
      confidence: 99,
      xRatio: 0.9,
      yRatio: 0.9,
      widthRatio: 0.02,
      heightRatio: 0.02,
      passId: 'cache',
      passKind: 'full',
      preprocessKind: 'raw',
      rotation: 0
    }
  ]
};

type MergeFn = (
  visualTemplateId: string,
  payload: PartMeasurementDrawingOcrPayload,
  input: {
    xRatio: number;
    yRatio: number;
    markerNo?: number | null;
    limit?: number;
    measurementLabel?: string | null;
    depthMode?: 'measured' | 'through' | null;
  }
) => Promise<{ payload: PartMeasurementDrawingOcrPayload; candidates: Array<{ valueText: string }> }>;

async function stubDrawingRead(): Promise<void> {
  const { PartMeasurementDrawingStorage } = await import('../../lib/part-measurement-drawing-storage.js');
  vi.spyOn(PartMeasurementDrawingStorage, 'readDrawing').mockResolvedValue({
    buffer: Buffer.from('fake-image'),
    contentType: 'image/jpeg'
  });

  const { prisma } = await import('../../lib/prisma.js');
  vi.spyOn(prisma.partMeasurementVisualTemplate, 'findUnique').mockResolvedValue({
    drawingImageRelativePath: 'drawings/test.jpg'
  } as never);
}

function getMerge(service: PartMeasurementDrawingOcrService): MergeFn {
  return (
    service as unknown as { mergeLocalOcrTokensAndRank: MergeFn }
  ).mergeLocalOcrTokensAndRank.bind(service);
}

describe('PartMeasurementDrawingOcrService secondary RapidOCR orchestration', () => {
  afterEach(() => {
    delete process.env.PART_MEASUREMENT_DRAWING_OCR_LOCAL_ENABLED;
    delete process.env.PART_MEASUREMENT_DRAWING_OCR_RAPIDOCR_ENABLED;
    delete process.env.PART_MEASUREMENT_DRAWING_OCR_RAPIDOCR_WEAK_SCORE;
    vi.restoreAllMocks();
  });

  it('calls secondary when enabled and primary candidates are weak', async () => {
    process.env.PART_MEASUREMENT_DRAWING_OCR_LOCAL_ENABLED = 'true';
    process.env.PART_MEASUREMENT_DRAWING_OCR_RAPIDOCR_ENABLED = 'true';
    process.env.PART_MEASUREMENT_DRAWING_OCR_RAPIDOCR_WEAK_SCORE = '0.01';
    await stubDrawingRead();

    const primary: DrawingLocalOcrPort = {
      runLocalOcr: vi.fn(async () => [
        {
          text: '1',
          confidence: 40,
          xRatio: 0.8,
          yRatio: 0.8,
          widthRatio: 0.02,
          heightRatio: 0.02,
          passId: 'local-0',
          passKind: 'tile',
          preprocessKind: 'raw',
          rotation: 0
        }
      ])
    };
    const secondary: DrawingLocalOcrPort = {
      runLocalOcr: vi.fn(async () => [
        {
          text: '深サ8',
          confidence: 70,
          xRatio: 0.51,
          yRatio: 0.5,
          widthRatio: 0.04,
          heightRatio: 0.02,
          passId: 'rapid-0',
          passKind: 'tile',
          preprocessKind: 'raw',
          rotation: 0
        }
      ])
    };

    const engine = { processVisualTemplate: vi.fn() } as unknown as PartMeasurementDrawingOcrEngine;
    const service = new PartMeasurementDrawingOcrService(engine, primary, secondary);
    const result = await getMerge(service)('visual-1', basePayload, {
      xRatio: 0.5,
      yRatio: 0.5,
      measurementLabel: 'ネジ穴深さ',
      depthMode: 'measured',
      limit: 5
    });

    expect(primary.runLocalOcr).toHaveBeenCalledTimes(1);
    expect(secondary.runLocalOcr).toHaveBeenCalledTimes(1);
    expect(result.candidates.map((c) => c.valueText)).toContain('8');
  });

  it('skips secondary when primary candidates are strong', async () => {
    process.env.PART_MEASUREMENT_DRAWING_OCR_LOCAL_ENABLED = 'true';
    process.env.PART_MEASUREMENT_DRAWING_OCR_RAPIDOCR_ENABLED = 'true';
    process.env.PART_MEASUREMENT_DRAWING_OCR_RAPIDOCR_WEAK_SCORE = '0.12';
    await stubDrawingRead();

    const primary: DrawingLocalOcrPort = {
      runLocalOcr: vi.fn(async () => [
        {
          text: '25',
          confidence: 95,
          xRatio: 0.5,
          yRatio: 0.5,
          widthRatio: 0.02,
          heightRatio: 0.02,
          passId: 'local-0',
          passKind: 'tile',
          preprocessKind: 'raw',
          rotation: 0
        }
      ])
    };
    const secondary: DrawingLocalOcrPort = {
      runLocalOcr: vi.fn(async () => [])
    };

    const engine = { processVisualTemplate: vi.fn() } as unknown as PartMeasurementDrawingOcrEngine;
    const service = new PartMeasurementDrawingOcrService(engine, primary, secondary);
    const result = await getMerge(service)('visual-1', basePayload, {
      xRatio: 0.5,
      yRatio: 0.5,
      limit: 5
    });

    expect(primary.runLocalOcr).toHaveBeenCalledTimes(1);
    expect(secondary.runLocalOcr).not.toHaveBeenCalled();
    expect(result.candidates[0]?.valueText).toBe('25');
  });

  it('keeps primary candidates when secondary throws', async () => {
    process.env.PART_MEASUREMENT_DRAWING_OCR_LOCAL_ENABLED = 'true';
    process.env.PART_MEASUREMENT_DRAWING_OCR_RAPIDOCR_ENABLED = 'true';
    process.env.PART_MEASUREMENT_DRAWING_OCR_RAPIDOCR_WEAK_SCORE = '0.01';
    await stubDrawingRead();

    const primary: DrawingLocalOcrPort = {
      runLocalOcr: vi.fn(async () => [
        {
          text: '1',
          confidence: 40,
          xRatio: 0.8,
          yRatio: 0.8,
          widthRatio: 0.02,
          heightRatio: 0.02,
          passId: 'local-0',
          passKind: 'tile',
          preprocessKind: 'raw',
          rotation: 0
        }
      ])
    };
    const secondary: DrawingLocalOcrPort = {
      runLocalOcr: vi.fn(async () => {
        throw new Error('worker down');
      })
    };

    const engine = { processVisualTemplate: vi.fn() } as unknown as PartMeasurementDrawingOcrEngine;
    const service = new PartMeasurementDrawingOcrService(engine, primary, secondary);
    const result = await getMerge(service)('visual-1', basePayload, {
      xRatio: 0.5,
      yRatio: 0.5,
      limit: 5
    });

    expect(secondary.runLocalOcr).toHaveBeenCalledTimes(1);
    expect(result.candidates.length).toBeGreaterThan(0);
  });
});
