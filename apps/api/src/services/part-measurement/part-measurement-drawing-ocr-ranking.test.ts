import { describe, expect, it } from 'vitest';

import {
  PART_MEASUREMENT_DRAWING_OCR_PAYLOAD_SCHEMA_VERSION,
  PART_MEASUREMENT_DRAWING_OCR_VERSION,
  type PartMeasurementDrawingOcrPassKind,
  type PartMeasurementDrawingOcrPreprocessKind,
  type PartMeasurementDrawingOcrPayload,
  type PartMeasurementDrawingOcrToken
} from './part-measurement-drawing-ocr-payload.js';
import {
  canonicalNumericText,
  extractDepthNoteValues,
  rankPartMeasurementDrawingOcrCandidates,
  splitConcatNumericCandidates
} from './part-measurement-drawing-ocr-ranking.js';

function token(
  text: string,
  xRatio: number,
  yRatio: number,
  confidence = 90,
  passKind: PartMeasurementDrawingOcrPassKind = 'full',
  preprocessKind: PartMeasurementDrawingOcrPreprocessKind = 'raw',
  size: { widthRatio: number; heightRatio: number } = { widthRatio: 0.03, heightRatio: 0.02 }
): PartMeasurementDrawingOcrToken {
  return {
    text,
    confidence,
    xRatio,
    yRatio,
    widthRatio: size.widthRatio,
    heightRatio: size.heightRatio,
    passId: `${passKind}-${text}`,
    passKind,
    preprocessKind,
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

  it('does not synthesize one-digit-deletion candidates from raw line noise', () => {
    const candidates = rankPartMeasurementDrawingOcrCandidates(
      payload([token('1180', 0.4, 0.4, 90)]),
      { xRatio: 0.4, yRatio: 0.4, markerNo: 1, limit: 5 }
    );

    expect(candidates.map((candidate) => candidate.valueText)).toEqual(['1180']);
  });

  it('prefers a line-suppressed token over a conflicting raw token in the same region', () => {
    const candidates = rankPartMeasurementDrawingOcrCandidates(
      payload([
        token('1180', 0.4, 0.4, 90, 'full', 'raw', { widthRatio: 0.05, heightRatio: 0.02 }),
        token('180', 0.4, 0.4, 88, 'full', 'lineSuppressed', { widthRatio: 0.04, heightRatio: 0.02 })
      ]),
      { xRatio: 0.4, yRatio: 0.4, markerNo: 1, limit: 5 }
    );

    expect(candidates[0]?.valueText).toBe('180');
  });

  it('does not suppress a raw value when line suppression reads a different same-length value', () => {
    const candidates = rankPartMeasurementDrawingOcrCandidates(
      payload([
        token('37', 0.628, 0.385, 72, 'tile', 'raw', { widthRatio: 0.004, heightRatio: 0.008 }),
        token('31', 0.628, 0.385, 84, 'full', 'lineSuppressed', { widthRatio: 0.004, heightRatio: 0.008 })
      ]),
      { xRatio: 0.632, yRatio: 0.357, markerNo: 7, limit: 5 }
    );

    expect(candidates.map((candidate) => candidate.valueText)).toContain('37');
  });

  it('splits stacked four-digit dimension text into two two-digit candidates', () => {
    const candidates = rankPartMeasurementDrawingOcrCandidates(
      payload([token('1322', 0.5, 0.4, 86, 'tile', 'raw', { widthRatio: 0.015, heightRatio: 0.07 })]),
      { xRatio: 0.5, yRatio: 0.4, markerNo: 3, limit: 5 }
    );

    expect(candidates.map((candidate) => candidate.valueText)).toEqual(['13', '22']);
  });

  it('splits concatenated OCR values into shorter dimension-like candidates', () => {
    expect(splitConcatNumericCandidates('210201')).toEqual(expect.arrayContaining(['210201', '210', '21']));
    expect(splitConcatNumericCandidates('3220.05')).toEqual(expect.arrayContaining(['3220.05', '32']));
    expect(splitConcatNumericCandidates('124.54')).toEqual(expect.arrayContaining(['124.54', '124.5']));
    expect(splitConcatNumericCandidates('1180')).toEqual(['1180']);

    const candidates = rankPartMeasurementDrawingOcrCandidates(
      payload([token('210201', 0.5, 0.5, 80)]),
      { xRatio: 0.5, yRatio: 0.5, markerNo: 1, limit: 10 }
    );
    expect(candidates.map((c) => c.valueText)).toEqual(expect.arrayContaining(['210', '21']));
  });

  it('dedupes canonical numeric forms such as 0.030 and 0.03', () => {
    expect(canonicalNumericText('0.030')).toBe('0.03');
    const candidates = rankPartMeasurementDrawingOcrCandidates(
      payload([token('0.030', 0.5, 0.5, 90), token('0.03', 0.501, 0.5, 88)]),
      { xRatio: 0.5, yRatio: 0.5, markerNo: 1, limit: 5 }
    );
    expect(candidates.filter((c) => c.valueText === '0.03')).toHaveLength(1);
  });

  it('extracts depth-note values and prefers them for depth labels', () => {
    expect(extractDepthNoteValues('深サ8')).toEqual(['8']);
    expect(extractDepthNoteValues('深さ 12.5')).toEqual(['12.5']);

    const candidates = rankPartMeasurementDrawingOcrCandidates(
      payload([
        token('深サ8', 0.52, 0.5, 70),
        token('25', 0.5, 0.5, 95)
      ]),
      {
        xRatio: 0.5,
        yRatio: 0.5,
        markerNo: 3,
        limit: 5,
        measurementLabel: 'ネジ穴深さ',
        depthMode: 'measured'
      }
    );
    expect(candidates.map((c) => c.valueText)).toContain('8');
  });
});
