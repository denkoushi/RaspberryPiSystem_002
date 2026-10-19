import {
  resolveDefaultInspectionDrawingToleranceKind,
  resolveInspectionDrawingGeneralToleranceForNominal
} from '@raspi-system/shared-types';

import type {
  PartMeasurementDrawingDimension,
  PartMeasurementDrawingDimensionMapPayload
} from './part-measurement-drawing-dimension-map-payload.js';

/**
 * 丸数字を置いた位置と項目名から、寸法マップの寸法を候補として並べる。
 * 画像 AI は呼ばない。並べ方は Milestone 2 の実験（30 図面 330 項目）で決めた:
 * 項目名に合う種類で絞り、丸数字（指差し先端があればその近い方）からの距離順、同じ値は 1 件にまとめる。
 */

export type PartMeasurementDrawingDimensionMapCandidate = {
  /** 候補として入力欄に入れる値（深さ項目では深さ、それ以外は基準値） */
  valueText: string;
  /** 図面のとおりの表記 */
  dimensionText: string;
  kind: PartMeasurementDrawingDimension['kind'];
  distanceRatio: number;
  xRatio: number;
  yRatio: number;
  /** 上下限の案（± の相対値）。導けないものは null */
  suggestedUpperTolerance: string | null;
  suggestedLowerTolerance: string | null;
};

export type PartMeasurementDrawingDimensionMapCandidateInput = {
  xRatio: number;
  yRatio: number;
  calloutTipXRatio?: number | null;
  calloutTipYRatio?: number | null;
  measurementLabel?: string | null;
  depthMode?: 'measured' | 'through' | null;
  limit?: number;
};

type WantedKind = 'depth' | 'hole' | 'gdt' | 'len';

const HOLE_LABELS = new Set(['穴径', '内径']);
const DEPTH_LABEL_PATTERN = /深さ|深サ/;

export function resolveWantedDimensionKind(
  measurementLabel: string | null | undefined,
  depthMode: 'measured' | 'through' | null | undefined
): WantedKind {
  const label = (measurementLabel ?? '').trim();
  if (!label) return 'len';
  if (DEPTH_LABEL_PATTERN.test(label) && depthMode !== 'through') return 'depth';
  if (HOLE_LABELS.has(label)) return 'hole';
  if (resolveDefaultInspectionDrawingToleranceKind(label) === 'geometric') return 'gdt';
  return 'len';
}

function matchesWantedKind(dimension: PartMeasurementDrawingDimension, wanted: WantedKind): boolean {
  switch (wanted) {
    case 'depth':
      return dimension.depth !== null;
    case 'hole':
      return dimension.kind === 'hole' || dimension.text.includes('φ');
    case 'gdt':
      return dimension.kind === 'gdt';
    default:
      return dimension.kind === 'len' || dimension.kind === 'ref' || dimension.kind === 'basic';
  }
}

function candidateValue(dimension: PartMeasurementDrawingDimension, wanted: WantedKind): number | null {
  const value = wanted === 'depth' ? dimension.depth : dimension.nominal;
  return value !== null && Number.isFinite(value) ? value : null;
}

export function formatDimensionValue(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(4)));
}

function formatSignedTolerance(value: number): string {
  const text = formatDimensionValue(Math.abs(value));
  if (value === 0) return '0';
  return value > 0 ? `+${text}` : `-${text}`;
}

/**
 * 上下限の案。図面に明記された公差があればそれを使い、無ければ普通公差表（中級）から導く。
 * 深さは社内ルール（下限は基準値、上限は +0・+3・+5 のいずれか）の境目が未整理なので下限だけ出す。
 * 幾何公差は 0〜指定値。
 */
export function suggestTolerances(
  dimension: PartMeasurementDrawingDimension,
  wanted: WantedKind,
  value: number
): { upper: string | null; lower: string | null } {
  if (wanted === 'depth') {
    return { upper: null, lower: '0' };
  }
  if (wanted === 'gdt' || dimension.kind === 'gdt') {
    return { upper: '0', lower: formatSignedTolerance(-value) };
  }
  if (dimension.upperTolerance !== null && dimension.lowerTolerance !== null) {
    return {
      upper: formatSignedTolerance(dimension.upperTolerance),
      lower: formatSignedTolerance(dimension.lowerTolerance)
    };
  }
  const general = resolveInspectionDrawingGeneralToleranceForNominal(value);
  if (general === null) return { upper: null, lower: null };
  return { upper: `+${general}`, lower: `-${general}` };
}

export function rankPartMeasurementDrawingDimensionMapCandidates(
  payload: Pick<PartMeasurementDrawingDimensionMapPayload, 'image' | 'dimensions'>,
  input: PartMeasurementDrawingDimensionMapCandidateInput
): PartMeasurementDrawingDimensionMapCandidate[] {
  const limit = Math.min(Math.max(input.limit ?? 5, 1), 20);
  const wanted = resolveWantedDimensionKind(input.measurementLabel, input.depthMode);
  // 距離は図面幅を 1 とし、縦は縦横比で補正する（実験と同じ尺度）。
  const aspect = payload.image.width > 0 && payload.image.height > 0 ? payload.image.width / payload.image.height : 1;
  const hasTip =
    typeof input.calloutTipXRatio === 'number' &&
    typeof input.calloutTipYRatio === 'number' &&
    Number.isFinite(input.calloutTipXRatio) &&
    Number.isFinite(input.calloutTipYRatio);
  const distanceFrom = (x: number, y: number, dimension: PartMeasurementDrawingDimension): number =>
    Math.hypot(dimension.xRatio - x, (dimension.yRatio - y) / aspect);
  const distance = (dimension: PartMeasurementDrawingDimension): number => {
    const fromMarker = distanceFrom(input.xRatio, input.yRatio, dimension);
    if (!hasTip) return fromMarker;
    return Math.min(fromMarker, distanceFrom(input.calloutTipXRatio as number, input.calloutTipYRatio as number, dimension));
  };

  const scored = payload.dimensions
    .map((dimension) => ({ dimension, value: candidateValue(dimension, wanted), distance: distance(dimension) }))
    .filter((entry): entry is { dimension: PartMeasurementDrawingDimension; value: number; distance: number } => entry.value !== null)
    .sort((a, b) => a.distance - b.distance || a.value - b.value);

  const preferred = scored.filter((entry) => matchesWantedKind(entry.dimension, wanted));
  const ordered = preferred.length >= limit ? preferred : [...preferred, ...scored.filter((entry) => !preferred.includes(entry))];

  const seen = new Set<number>();
  const candidates: PartMeasurementDrawingDimensionMapCandidate[] = [];
  for (const entry of ordered) {
    if (seen.has(entry.value)) continue;
    seen.add(entry.value);
    const tolerance = suggestTolerances(entry.dimension, wanted, entry.value);
    candidates.push({
      valueText: formatDimensionValue(entry.value),
      dimensionText: entry.dimension.text,
      kind: entry.dimension.kind,
      distanceRatio: entry.distance,
      xRatio: entry.dimension.xRatio,
      yRatio: entry.dimension.yRatio,
      suggestedUpperTolerance: tolerance.upper,
      suggestedLowerTolerance: tolerance.lower
    });
    if (candidates.length >= limit) break;
  }
  return candidates;
}
