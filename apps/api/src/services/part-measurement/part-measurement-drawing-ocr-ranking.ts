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

export type PartMeasurementDrawingOcrRankInput = {
  xRatio: number;
  yRatio: number;
  markerNo?: number | null;
  limit?: number;
  measurementLabel?: string | null;
  depthMode?: 'measured' | 'through' | null;
};

const NUMERIC_PATTERN = /[+-]?\d+(?:[.,]\d+)?/g;
const DEPTH_NOTE_PATTERN = /深[さサ]\s*([0-9]+(?:[.,][0-9]+)?)/g;
const DEPTH_LABEL_PATTERN = /深さ|深サ/;

function normalizeNumericText(raw: string): string | null {
  const normalized = raw.replace(/,/g, '.').trim();
  if (!/^[+-]?\d+(?:\.\d+)?$/.test(normalized)) return null;
  const asNumber = Number(normalized);
  if (!Number.isFinite(asNumber)) return null;
  return normalized;
}

/** Canonical form for dedupe/compare: 0.030 -> 0.03, 12.0 -> 12 */
export function canonicalNumericText(valueText: string): string | null {
  const normalized = normalizeNumericText(valueText);
  if (normalized == null) return null;
  const asNumber = Number(normalized);
  if (!Number.isFinite(asNumber)) return null;
  if (Number.isInteger(asNumber)) return String(asNumber);
  let s = String(asNumber);
  if (/e/i.test(s)) {
    s = asNumber.toFixed(6).replace(/\.?0+$/, '');
  }
  return s;
}

function isStackedDimensionLikeToken(token: PartMeasurementDrawingOcrToken): boolean {
  const digitsOnly = token.text.replace(/\D/g, '');
  if (!/^\d{4}$/.test(digitsOnly)) return false;
  const tallBbox = token.heightRatio > token.widthRatio * 1.35;
  const rotatedPass = token.rotation === 90 || token.rotation === 270;
  return tallBbox || rotatedPass;
}

/** Split concatenated OCR values such as 210201 -> 210, 3220.05 -> 32, 124.54 -> 124.5 */
export function splitConcatNumericCandidates(valueText: string): string[] {
  const normalized = normalizeNumericText(valueText);
  if (!normalized) return [];
  const out = new Set<string>([normalized]);
  const hasDot = normalized.includes('.');
  const digits = normalized.replace(/[+-.]/g, '');

  // 4-digit integers stay intact here (stacked tall-bbox split is separate).
  // 5–6 digit concatenations often glue two dimensions (e.g. 210201 -> 210).
  if (!hasDot && /^\d{5,6}$/.test(digits)) {
    out.add(digits.slice(0, 2));
    out.add(digits.slice(0, 3));
  }
  if (hasDot) {
    const unsigned = normalized.replace(/^[+-]/, '');
    const [intPart = '', frac = ''] = unsigned.split('.');
    if (frac.length >= 2) {
      const trimmed = normalizeNumericText(`${intPart}.${frac.slice(0, -1)}`);
      if (trimmed) out.add(trimmed);
    }
    // e.g. 3220.05 -> OCR glued "32" + "20.05"
    if (/^\d{3,5}$/.test(intPart) && /^0\d+$/.test(frac)) {
      out.add(intPart.slice(0, 2));
    }
  }

  return [...out].map((value) => normalizeNumericText(value)).filter((value): value is string => value != null);
}

export function extractDepthNoteValues(text: string): string[] {
  const values: string[] = [];
  for (const match of text.matchAll(DEPTH_NOTE_PATTERN)) {
    const normalized = normalizeNumericText(match[1] ?? '');
    if (normalized) values.push(normalized);
  }
  return values;
}

export function isDepthMeasurementLabel(measurementLabel: string | null | undefined): boolean {
  if (!measurementLabel) return false;
  return DEPTH_LABEL_PATTERN.test(measurementLabel);
}

function extractNumericValues(token: PartMeasurementDrawingOcrToken): string[] {
  const out = new Set<string>();
  if (isStackedDimensionLikeToken(token)) {
    const digitsOnly = token.text.replace(/\D/g, '');
    for (const value of [digitsOnly.slice(0, 2), digitsOnly.slice(2)]) {
      const normalized = normalizeNumericText(value);
      if (normalized) out.add(normalized);
    }
    return [...out];
  }

  for (const match of token.text.matchAll(NUMERIC_PATTERN)) {
    for (const split of splitConcatNumericCandidates(match[0])) {
      out.add(split);
    }
  }
  for (const depthValue of extractDepthNoteValues(token.text)) {
    out.add(depthValue);
  }
  return [...out];
}

function confidencePenalty(confidence: number | null): number {
  if (confidence == null) return 0.04;
  const normalized = Math.max(0, Math.min(100, confidence)) / 100;
  return (1 - normalized) * 0.04;
}

function markerNumberPenalty(valueText: string, markerNo: number | null | undefined): number {
  if (markerNo == null) return 0;
  const canonical = canonicalNumericText(valueText);
  return canonical === String(markerNo) ? 0.3 : 0;
}

function shortDimensionBonus(valueText: string): number {
  const canonical = canonicalNumericText(valueText);
  if (!canonical) return 0;
  return /^[+-]?\d{2,3}(?:\.\d+)?$/.test(canonical) ? -0.008 : 0;
}

function scoreCandidate(input: {
  token: PartMeasurementDrawingOcrToken;
  valueText: string;
  xRatio: number;
  yRatio: number;
  markerNo?: number | null;
  rawOverlapPenalty?: number;
  depthNoteBonus?: number;
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
      shortDimensionBonus(input.valueText) +
      (input.rawOverlapPenalty ?? 0) +
      (input.depthNoteBonus ?? 0)
  );
}

function buildCandidate(input: {
  token: PartMeasurementDrawingOcrToken;
  valueText: string;
  xRatio: number;
  yRatio: number;
  markerNo?: number | null;
  rawOverlapPenalty?: number;
  depthNoteBonus?: number;
}): PartMeasurementDrawingOcrCandidate {
  const distance = Math.hypot(input.token.xRatio - input.xRatio, input.token.yRatio - input.yRatio);
  const displayValue = canonicalNumericText(input.valueText) ?? input.valueText;
  return {
    valueText: displayValue,
    rawText: input.token.text,
    confidence: input.token.confidence,
    score: scoreCandidate({ ...input, valueText: displayValue }),
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
  input: PartMeasurementDrawingOcrRankInput
): PartMeasurementDrawingOcrCandidate[] {
  const limit = Math.min(Math.max(input.limit ?? 5, 1), 20);
  const bestByValue = new Map<string, PartMeasurementDrawingOcrCandidate>();
  const lineSuppressedTokens = payload.tokens.filter((token) => token.preprocessKind === 'lineSuppressed');
  const preferDepthNotes =
    isDepthMeasurementLabel(input.measurementLabel) && input.depthMode !== 'through';

  for (const token of payload.tokens) {
    const values = extractNumericValues(token);
    for (const valueText of values) {
      const key = canonicalNumericText(valueText) ?? valueText;
      const rawOverlapPenalty = hasConflictingLineSuppressedToken(token, valueText, lineSuppressedTokens) ? 0.16 : 0;
      const depthNoteBonus =
        preferDepthNotes && extractDepthNoteValues(token.text).some((v) => canonicalNumericText(v) === key)
          ? -0.02
          : 0;
      const candidate = buildCandidate({
        token,
        valueText: key,
        xRatio: input.xRatio,
        yRatio: input.yRatio,
        markerNo: input.markerNo,
        rawOverlapPenalty,
        depthNoteBonus
      });
      const existing = bestByValue.get(key);
      if (!existing || candidate.score < existing.score) {
        bestByValue.set(key, candidate);
      }
    }
  }

  return Array.from(bestByValue.values())
    .sort((a, b) => a.score - b.score || a.distanceRatio - b.distanceRatio || a.valueText.localeCompare(b.valueText))
    .slice(0, limit);
}
