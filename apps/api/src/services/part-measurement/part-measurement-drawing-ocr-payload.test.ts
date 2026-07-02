import { describe, expect, it } from 'vitest';

import {
  decodePartMeasurementDrawingOcrPayload,
  encodePartMeasurementDrawingOcrPayload,
  PART_MEASUREMENT_DRAWING_OCR_PAYLOAD_SCHEMA_VERSION,
  PART_MEASUREMENT_DRAWING_OCR_VERSION,
  type PartMeasurementDrawingOcrPayload
} from './part-measurement-drawing-ocr-payload.js';

describe('part measurement drawing OCR payload', () => {
  it('round-trips gzip json payload', async () => {
    const payload: PartMeasurementDrawingOcrPayload = {
      schemaVersion: PART_MEASUREMENT_DRAWING_OCR_PAYLOAD_SCHEMA_VERSION,
      ocrVersion: PART_MEASUREMENT_DRAWING_OCR_VERSION,
      engine: 'test',
      createdAt: '2026-07-02T00:00:00.000Z',
      image: { width: 1000, height: 700 },
      tokens: [
        {
          text: '360',
          confidence: 92,
          xRatio: 0.69,
          yRatio: 0.45,
          widthRatio: 0.04,
          heightRatio: 0.02,
          passId: 'tile-2-1-r0',
          passKind: 'tile',
          preprocessKind: 'raw',
          rotation: 0
        }
      ]
    };

    const compressed = await encodePartMeasurementDrawingOcrPayload(payload);
    expect(compressed.length).toBeGreaterThan(0);
    await expect(decodePartMeasurementDrawingOcrPayload(compressed)).resolves.toEqual(payload);
  });
});
