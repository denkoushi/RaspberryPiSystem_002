import type {
  PartMeasurementDrawingOcrPayload,
  PartMeasurementDrawingOcrPassKind,
  PartMeasurementDrawingOcrPreprocessKind,
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
  passKind: PartMeasurementDrawingOcrPassKind;
  preprocessKind: PartMeasurementDrawingOcrPreprocessKind;
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

function isStackedDimensionLikeToken(token: PartMeasurementDrawingOcrToken): boolean {
  const digitsOnly = token.text.replace(/\D/g, '');
  if (!/^\d{4}$/.test(digitsOnly)) return false;
  const tallBbox = token.heightRatio > token.widthRatio * 1.35;
  const rotatedPass = token.rotation === 90 || token.rotation === 270;
  return tallBbox || rotatedPass;
}

function extractNumericValues(token: PartMeasurementDrawingOcrToken): string[] {
  if (isStackedDimensionLikeToken(token)) {
    const digitsOnly = token.text.replace(/\D/g, '');
    return [digitsOnly.slice(0, 2), digitsOnly.slice(2)].map((value) => normalizeNumericText(value)).filter(
      (value): value is string => value != null
    );
  }
  return Array.from(token.text.matchAll(NUMERIC_PATTERN))
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
  rawOverlapPenalty?: number;
}): number {
  const distance = Math.hypot(input.token.xRatio - input.xRatio, input.token.yRatio - input.yRatio);
  const tileBonus = input.token.passKind === 'tile' ? -0.015 : 0;
  const preprocessBonus =
    input.token.preprocessKind === 'boxedFrame' ? -0.025 : input.token.preprocessKind === 'lineSuppressed' ? -0.01 : 0;
  return Math.max(
    0,
    distance +
      confidencePenalty(input.token.confidence) +
      markerNumberPenalty(input.valueText, input.markerNo) +
      tileBonus +
      preprocessBonus +
      (input.rawOverlapPenalty ?? 0)
  );
}

function buildCandidate(input: {
  token: PartMeasurementDrawingOcrToken;
  valueText: string;
  xRatio: number;
  yRatio: number;
  markerNo?: number | null;
  rawOverlapPenalty?: number;
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
    preprocessKind: input.token.preprocessKind,
    rotation: input.token.rotation
  };
}

function bboxOverlapRatio(a: PartMeasurementDrawingOcrToken, b: PartMeasurementDrawingOcrToken): number {
  const aLeft = a.xRatio - a.widthRatio / 2;
  const aRight = a.xRatio + a.widthRatio / 2;
  const aTop = a.yRatio - a.heightRatio / 2;
  const aBottom = a.yRatio + a.heightRatio / 2;
  const bLeft = b.xRatio - b.widthRatio / 2;
  const bRight = b.xRatio + b.widthRatio / 2;
  const bTop = b.yRatio - b.heightRatio / 2;
  const bBottom = b.yRatio + b.heightRatio / 2;
  const overlapWidth = Math.max(0, Math.min(aRight, bRight) - Math.max(aLeft, bLeft));
  const overlapHeight = Math.max(0, Math.min(aBottom, bBottom) - Math.max(aTop, bTop));
  const overlapArea = overlapWidth * overlapHeight;
  const smallerArea = Math.max(0.000001, Math.min(a.widthRatio * a.heightRatio, b.widthRatio * b.heightRatio));
  return overlapArea / smallerArea;
}

function compactNumericDigits(valueText: string): string {
  return valueText.replace(/\D/g, '');
}

function isLikelyLineArtifactValue(rawValueText: string, lineSuppressedValueText: string): boolean {
  const rawDigits = compactNumericDigits(rawValueText);
  const lineSuppressedDigits = compactNumericDigits(lineSuppressedValueText);
  if (rawDigits.length <= lineSuppressedDigits.length) return false;
  if (lineSuppressedDigits.length < 2) return false;
  if (rawDigits.length - lineSuppressedDigits.length > 2) return false;
  return rawDigits.startsWith(lineSuppressedDigits) || rawDigits.endsWith(lineSuppressedDigits);
}

function hasConflictingLineSuppressedToken(
  token: PartMeasurementDrawingOcrToken,
  valueText: string,
  lineSuppressedTokens: PartMeasurementDrawingOcrToken[]
): boolean {
  if (token.preprocessKind !== 'raw') return false;
  for (const other of lineSuppressedTokens) {
    if (Math.hypot(token.xRatio - other.xRatio, token.yRatio - other.yRatio) > 0.035) continue;
    if (bboxOverlapRatio(token, other) < 0.35) continue;
    const otherValues = extractNumericValues(other);
    if (otherValues.some((otherValue) => isLikelyLineArtifactValue(valueText, otherValue))) return true;
  }
  return false;
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
  const lineSuppressedTokens = payload.tokens.filter((token) => token.preprocessKind === 'lineSuppressed');

  for (const token of payload.tokens) {
    const values = extractNumericValues(token);
    for (const valueText of values) {
      const rawOverlapPenalty = hasConflictingLineSuppressedToken(token, valueText, lineSuppressedTokens) ? 0.16 : 0;
      const candidate = buildCandidate({
        token,
        valueText,
        xRatio: input.xRatio,
        yRatio: input.yRatio,
        markerNo: input.markerNo,
        rawOverlapPenalty
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
