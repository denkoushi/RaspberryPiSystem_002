import type {
  PartMeasurementDrawingOcrPayload,
  PartMeasurementDrawingOcrToken
} from './part-measurement-drawing-ocr-payload.js';

export type PartMeasurementDrawingOcrCandidate = {
  valueText: string;
  rawText: string;
  confidence: number | null;
  score: number;
  distanceRatio: number;
  xRatio: number;
  yRatio: number;
  widthRatio: number;
  heightRatio: number;
  passKind: 'full' | 'tile';
  rotation: number;
};

const NUMERIC_PATTERN = /[+-]?\d+(?:[.,]\d+)?/g;

function normalizeNumericText(raw: string): string | null {
  const normalized = raw.replace(/,/g, '.').trim();
  if (!/^[+-]?\d+(?:\.\d+)?$/.test(normalized)) return null;
  const asNumber = Number(normalized);
  if (!Number.isFinite(asNumber)) return null;
  return normalized;
}

function extractNumericValues(text: string): string[] {
  return Array.from(text.matchAll(NUMERIC_PATTERN))
    .map((match) => normalizeNumericText(match[0]))
    .filter((value): value is string => value != null);
}

function confidencePenalty(confidence: number | null): number {
  if (confidence == null) return 0.04;
  const normalized = Math.max(0, Math.min(100, confidence)) / 100;
  return (1 - normalized) * 0.04;
}

function markerNumberPenalty(valueText: string, markerNo: number | null | undefined): number {
  if (markerNo == null) return 0;
  return valueText === String(markerNo) ? 0.3 : 0;
}

function scoreCandidate(input: {
  token: PartMeasurementDrawingOcrToken;
  valueText: string;
  xRatio: number;
  yRatio: number;
  markerNo?: number | null;
}): number {
  const distance = Math.hypot(input.token.xRatio - input.xRatio, input.token.yRatio - input.yRatio);
  const tileBonus = input.token.passKind === 'tile' ? -0.015 : 0;
  return Math.max(
    0,
    distance +
      confidencePenalty(input.token.confidence) +
      markerNumberPenalty(input.valueText, input.markerNo) +
      tileBonus
  );
}

function buildCandidate(input: {
  token: PartMeasurementDrawingOcrToken;
  valueText: string;
  xRatio: number;
  yRatio: number;
  markerNo?: number | null;
}): PartMeasurementDrawingOcrCandidate {
  const distance = Math.hypot(input.token.xRatio - input.xRatio, input.token.yRatio - input.yRatio);
  return {
    valueText: input.valueText,
    rawText: input.token.text,
    confidence: input.token.confidence,
    score: scoreCandidate(input),
    distanceRatio: distance,
    xRatio: input.token.xRatio,
    yRatio: input.token.yRatio,
    widthRatio: input.token.widthRatio,
    heightRatio: input.token.heightRatio,
    passKind: input.token.passKind,
    rotation: input.token.rotation
  };
}

export function rankPartMeasurementDrawingOcrCandidates(
  payload: PartMeasurementDrawingOcrPayload,
  input: {
    xRatio: number;
    yRatio: number;
    markerNo?: number | null;
    limit?: number;
  }
): PartMeasurementDrawingOcrCandidate[] {
  const limit = Math.min(Math.max(input.limit ?? 5, 1), 20);
  const bestByValue = new Map<string, PartMeasurementDrawingOcrCandidate>();

  for (const token of payload.tokens) {
    const values = extractNumericValues(token.text);
    for (const valueText of values) {
      const candidate = buildCandidate({
        token,
        valueText,
        xRatio: input.xRatio,
        yRatio: input.yRatio,
        markerNo: input.markerNo
      });
      const existing = bestByValue.get(valueText);
      if (!existing || candidate.score < existing.score) {
        bestByValue.set(valueText, candidate);
      }
    }
  }

  return Array.from(bestByValue.values())
    .sort((a, b) => a.score - b.score || a.distanceRatio - b.distanceRatio || a.valueText.localeCompare(b.valueText))
    .slice(0, limit);
}
