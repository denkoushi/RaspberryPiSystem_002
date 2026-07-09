import { describe, expect, it, vi } from 'vitest';

import type { DrawingLocalOcrPort } from './drawing-local-ocr.port.js';
import {
  PART_MEASUREMENT_DRAWING_OCR_PAYLOAD_SCHEMA_VERSION,
  PART_MEASUREMENT_DRAWING_OCR_VERSION,
  type PartMeasurementDrawingOcrPayload
} from './part-measurement-drawing-ocr-payload.js';
import { rankPartMeasurementDrawingOcrCandidates } from './part-measurement-drawing-ocr-ranking.js';

describe('drawing OCR local merge ranking', () => {
  it('includes local tokens in ranking input', () => {
    const payload: PartMeasurementDrawingOcrPayload = {
      schemaVersion: PART_MEASUREMENT_DRAWING_OCR_PAYLOAD_SCHEMA_VERSION,
      ocrVersion: PART_MEASUREMENT_DRAWING_OCR_VERSION,
      engine: 'test',
      createdAt: '2026-07-09T00:00:00.000Z',
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
    const localPort: DrawingLocalOcrPort = {
      runLocalOcr: vi.fn(async () => [
        {
          text: '深サ8',
          confidence: 70,
          xRatio: 0.51,
          yRatio: 0.5,
          widthRatio: 0.04,
          heightRatio: 0.02,
          passId: 'local-0',
          passKind: 'tile',
          preprocessKind: 'raw',
          rotation: 0
        }
      ])
    };
    void localPort;
    const merged: PartMeasurementDrawingOcrPayload = {
      ...payload,
      tokens: [
        ...payload.tokens,
        {
          text: '深サ8',
          confidence: 70,
          xRatio: 0.51,
          yRatio: 0.5,
          widthRatio: 0.04,
          heightRatio: 0.02,
          passId: 'local-0',
          passKind: 'tile',
          preprocessKind: 'raw',
          rotation: 0
        }
      ]
    };
    const candidates = rankPartMeasurementDrawingOcrCandidates(merged, {
      xRatio: 0.5,
      yRatio: 0.5,
      markerNo: 1,
      limit: 5,
      measurementLabel: 'ネジ穴深さ',
      depthMode: 'measured'
    });
    expect(candidates.map((c) => c.valueText)).toContain('8');
  });
});
