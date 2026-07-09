import {
  extractDepthNoteValues,
  type PartMeasurementDrawingOcrCandidate
} from './part-measurement-drawing-ocr-ranking.js';

export type WeakLocalOcrCandidatesContext = {
  depthSearch: boolean;
  /** Lower score is better. Secondary OCR runs when top1 score exceeds this. */
  weakScoreThreshold: number;
};

export function readRapidOcrWeakScoreThreshold(): number {
  const parsed = Number.parseFloat(process.env.PART_MEASUREMENT_DRAWING_OCR_RAPIDOCR_WEAK_SCORE || '0.12');
  if (!Number.isFinite(parsed) || parsed < 0) return 0.12;
  return parsed;
}

export function isDrawingLocalRapidOcrEnabled(): boolean {
  const raw = process.env.PART_MEASUREMENT_DRAWING_OCR_RAPIDOCR_ENABLED;
  if (raw == null || raw.trim() === '') return false;
  return ['1', 'true', 'on', 'yes'].includes(raw.trim().toLowerCase());
}

/**
 * Decide whether primary (cache + tesseract local) candidates are weak enough
 * to justify a secondary RapidOCR local pass.
 */
export function isWeakLocalOcrCandidates(
  candidates: PartMeasurementDrawingOcrCandidate[],
  ctx: WeakLocalOcrCandidatesContext
): boolean {
  if (candidates.length === 0) return true;
  const top = candidates[0];
  if (!top) return true;
  if (top.score > ctx.weakScoreThreshold) return true;
  if (ctx.depthSearch) {
    const hasDepthNote = candidates.some((candidate) => extractDepthNoteValues(candidate.rawText).length > 0);
    if (!hasDepthNote) return true;
  }
  return false;
}
