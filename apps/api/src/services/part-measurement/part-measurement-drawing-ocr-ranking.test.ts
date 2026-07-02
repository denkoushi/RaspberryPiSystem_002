import { describe, expect, it } from 'vitest';

import {
  PART_MEASUREMENT_DRAWING_OCR_PAYLOAD_SCHEMA_VERSION,
  PART_MEASUREMENT_DRAWING_OCR_VERSION,
  type PartMeasurementDrawingOcrPayload,
  type PartMeasurementDrawingOcrToken
} from './part-measurement-drawing-ocr-payload.js';
import { rankPartMeasurementDrawingOcrCandidates } from './part-measurement-drawing-ocr-ranking.js';

function token(
  text: string,
  xRatio: number,
  yRatio: number,
  confidence = 90,
  passKind: 'full' | 'tile' = 'full'
): PartMeasurementDrawingOcrToken {
  return {
    text,
    confidence,
    xRatio,
    yRatio,
    widthRatio: 0.03,
    heightRatio: 0.02,
    passId: `${passKind}-${text}`,
    passKind,
    rotation: 0
  };
}

function payload(tokens: PartMeasurementDrawingOcrToken[]): PartMeasurementDrawingOcrPayload {
  return {
    schemaVersion: PART_MEASUREMENT_DRAWING_OCR_PAYLOAD_SCHEMA_VERSION,
    ocrVersion: PART_MEASUREMENT_DRAWING_OCR_VERSION,
    engine: 'test',
    createdAt: '2026-07-02T00:00:00.000Z',
    image: { width: 1600, height: 1000 },
    tokens
  };
}

describe('part measurement drawing OCR ranking', () => {
  it('penalizes the clicked marker number and returns nearby dimension first', () => {
    const candidates = rankPartMeasurementDrawingOcrCandidates(
      payload([
        token('2', 0.692, 0.458, 99, 'tile'),
        token('360', 0.685, 0.452, 88, 'tile'),
        token('25', 0.61, 0.4, 95)
      ]),
      { xRatio: 0.69219961, yRatio: 0.45765024, markerNo: 2, limit: 5 }
    );

    expect(candidates[0]?.valueText).toBe('360');
  });

  it('keeps dense-area expected values in the top five for markers 5 and 7', () => {
    const source = payload([
      token('17', 0.604, 0.535, 94),
      token('20', 0.616, 0.532, 92),
      token('24', 0.635, 0.55, 91),
      token('25', 0.621, 0.542, 84, 'tile'),
      token('36', 0.626, 0.362, 89),
      token('25', 0.63, 0.355, 78),
      token('37', 0.632, 0.357, 45, 'tile')
    ]);

    const marker5 = rankPartMeasurementDrawingOcrCandidates(source, {
      xRatio: 0.62076284,
      yRatio: 0.54146658,
      markerNo: 5,
      limit: 5
    });
    const marker7 = rankPartMeasurementDrawingOcrCandidates(source, {
      xRatio: 0.63200415,
      yRatio: 0.35721812,
      markerNo: 7,
      limit: 5
    });

    expect(marker5.map((candidate) => candidate.valueText)).toContain('25');
    expect(marker7.map((candidate) => candidate.valueText)).toContain('37');
  });
});
