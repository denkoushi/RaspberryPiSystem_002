import { describe, expect, it } from 'vitest';

import {
  isWeakLocalOcrCandidates,
  readRapidOcrWeakScoreThreshold
} from './drawing-local-ocr-secondary-policy.js';
import type { PartMeasurementDrawingOcrCandidate } from './part-measurement-drawing-ocr-ranking.js';

function candidate(
  patch: Partial<PartMeasurementDrawingOcrCandidate> & Pick<PartMeasurementDrawingOcrCandidate, 'score' | 'rawText'>
): PartMeasurementDrawingOcrCandidate {
  return {
    valueText: patch.valueText ?? '8',
    rawText: patch.rawText,
    confidence: patch.confidence ?? 80,
    score: patch.score,
    distanceRatio: patch.distanceRatio ?? 0.02,
    xRatio: patch.xRatio ?? 0.5,
    yRatio: patch.yRatio ?? 0.5,
    widthRatio: patch.widthRatio ?? 0.02,
    heightRatio: patch.heightRatio ?? 0.02,
    passKind: patch.passKind ?? 'tile',
    preprocessKind: patch.preprocessKind ?? 'raw',
    rotation: patch.rotation ?? 0
  };
}

describe('isWeakLocalOcrCandidates', () => {
  it('treats empty candidates as weak', () => {
    expect(isWeakLocalOcrCandidates([], { depthSearch: false, weakScoreThreshold: 0.12 })).toBe(true);
  });

  it('treats high top1 score as weak', () => {
    expect(
      isWeakLocalOcrCandidates([candidate({ score: 0.2, rawText: '25' })], {
        depthSearch: false,
        weakScoreThreshold: 0.12
      })
    ).toBe(true);
  });

  it('treats strong nearby candidate as not weak', () => {
    expect(
      isWeakLocalOcrCandidates([candidate({ score: 0.05, rawText: '25' })], {
        depthSearch: false,
        weakScoreThreshold: 0.12
      })
    ).toBe(false);
  });

  it('requires depth note evidence when depthSearch is on', () => {
    expect(
      isWeakLocalOcrCandidates([candidate({ score: 0.05, rawText: '8' })], {
        depthSearch: true,
        weakScoreThreshold: 0.12
      })
    ).toBe(true);
    expect(
      isWeakLocalOcrCandidates([candidate({ score: 0.05, rawText: '深サ8' })], {
        depthSearch: true,
        weakScoreThreshold: 0.12
      })
    ).toBe(false);
  });
});

describe('readRapidOcrWeakScoreThreshold', () => {
  it('defaults to 0.12', () => {
    const previous = process.env.PART_MEASUREMENT_DRAWING_OCR_RAPIDOCR_WEAK_SCORE;
    delete process.env.PART_MEASUREMENT_DRAWING_OCR_RAPIDOCR_WEAK_SCORE;
    try {
      expect(readRapidOcrWeakScoreThreshold()).toBe(0.12);
    } finally {
      if (previous === undefined) delete process.env.PART_MEASUREMENT_DRAWING_OCR_RAPIDOCR_WEAK_SCORE;
      else process.env.PART_MEASUREMENT_DRAWING_OCR_RAPIDOCR_WEAK_SCORE = previous;
    }
  });
});
