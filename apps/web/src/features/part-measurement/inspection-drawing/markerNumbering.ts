import {
  dbAbsoluteBoundsToToleranceRawFields,
  formatToleranceRawNumber,
  inferDecimalPlacesFromToleranceRaw,
  parseToleranceRawFields,
  type ParsedToleranceBounds
} from './toleranceFields';

import type { PartMeasurementTemplateItemDto } from '../types';
import type { InspectionDrawingPoint } from './types';

export function parseDisplayMarkerAsMarkerNo(displayMarker: string | null | undefined): number | null {
  if (displayMarker == null) return null;
  const trimmed = displayMarker.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const n = Number(trimmed);
  return Number.isInteger(n) && n >= 1 ? n : null;
}

export function nextAvailableMarkerNo(points: Array<{ markerNo: number }>): number {
  const used = new Set(points.map((p) => p.markerNo));
  let candidate = 1;
  while (used.has(candidate)) {
    candidate += 1;
  }
  return candidate;
}

export function createInspectionDrawingPoint(
  xRatio: number,
  yRatio: number,
  markerNo: number
): InspectionDrawingPoint {
  return {
    id: crypto.randomUUID(),
    name: '',
    markerNo,
    xRatio,
    yRatio,
    nominalRaw: '',
    upperToleranceRaw: '',
    lowerToleranceRaw: '',
    testValue: '',
    decimalPlaces: 3
  };
}

export function templateItemToDrawingPoint(
  item: PartMeasurementTemplateItemDto,
  testValue = ''
): InspectionDrawingPoint {
  const fromMarker = parseDisplayMarkerAsMarkerNo(item.displayMarker);
  const markerNo = fromMarker ?? item.sortOrder + 1;
  const toleranceFields = dbAbsoluteBoundsToToleranceRawFields({
    nominalValue: parseOptionalNumber(item.nominalValue),
    lowerLimit: parseOptionalNumber(item.lowerLimit),
    upperLimit: parseOptionalNumber(item.upperLimit)
  });
  const { legacyAbsoluteBounds, ...raw } = toleranceFields;
  return {
    id: item.id,
    name: item.measurementLabel,
    markerNo,
    xRatio: parseOptionalNumber(item.markerXRatio) ?? 0,
    yRatio: parseOptionalNumber(item.markerYRatio) ?? 0,
    ...raw,
    testValue,
    decimalPlaces: item.decimalPlaces,
    ...(legacyAbsoluteBounds ? { legacyAbsoluteBounds } : {})
  };
}

function parseOptionalNumber(raw: string | null | undefined): number | null {
  if (raw == null || String(raw).trim() === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function toleranceFieldsEdited(pt: InspectionDrawingPoint): boolean {
  return pt.lowerToleranceRaw.trim() !== '' || pt.upperToleranceRaw.trim() !== '';
}

/** 表示用: DB 上 nominal なしで絶対上下限のみ維持する legacy 行 */
export function isLegacyAbsoluteOnlyPoint(pt: InspectionDrawingPoint): boolean {
  return Boolean(pt.legacyAbsoluteBounds && !pt.nominalRaw.trim() && !toleranceFieldsEdited(pt));
}

function resolveNominalForLegacySeed(pt: InspectionDrawingPoint): number {
  const parsed = parseOptionalNumber(pt.nominalRaw);
  if (parsed != null) return parsed;
  if (pt.legacyAbsoluteBounds) {
    const { lowerLimit, upperLimit } = pt.legacyAbsoluteBounds;
    return (lowerLimit + upperLimit) / 2;
  }
  return 0;
}

export type ResolvedPointToleranceBounds =
  | ({ kind: 'absolute' } & ParsedToleranceBounds)
  | {
      kind: 'legacyAbsoluteOnly';
      lowerLimit: number;
      upperLimit: number;
    };

/** 保存・判定用: legacy 絶対値のみのときは 0 基準へ変換しない */
export function resolvePointToleranceBoundsForSave(
  pt: InspectionDrawingPoint
): ResolvedPointToleranceBounds | { error: string } {
  if (pt.legacyAbsoluteBounds && !toleranceFieldsEdited(pt)) {
    if (!pt.nominalRaw.trim()) {
      return {
        kind: 'legacyAbsoluteOnly',
        lowerLimit: pt.legacyAbsoluteBounds.lowerLimit,
        upperLimit: pt.legacyAbsoluteBounds.upperLimit
      };
    }
    const nominalParsed = parseOptionalNumber(pt.nominalRaw);
    if (nominalParsed == null) {
      return { error: '基準値の形式が不正です' };
    }
    return {
      kind: 'absolute',
      nominal: nominalParsed,
      lowerLimit: pt.legacyAbsoluteBounds.lowerLimit,
      upperLimit: pt.legacyAbsoluteBounds.upperLimit
    };
  }

  const parsed = parseToleranceRawFields({
    nominalRaw: pt.nominalRaw,
    lowerToleranceRaw: pt.lowerToleranceRaw,
    upperToleranceRaw: pt.upperToleranceRaw
  });
  if ('error' in parsed) {
    return parsed;
  }
  return { kind: 'absolute', ...parsed };
}

export function drawingPointToTemplateItemInput(
  pt: InspectionDrawingPoint,
  sortOrder: number
): {
  sortOrder: number;
  datumSurface: string;
  measurementPoint: string;
  measurementLabel: string;
  displayMarker: string | null;
  unit: string | null;
  allowNegative: boolean;
  decimalPlaces: number;
  markerXRatio: number;
  markerYRatio: number;
  nominalValue: number | null;
  lowerLimit: number;
  upperLimit: number;
} {
  const label = pt.name.trim() || `測定点${pt.markerNo}`;
  const bounds = resolvePointToleranceBoundsForSave(pt);
  if ('error' in bounds) {
    throw new Error(bounds.error);
  }
  const inferredDp = inferDecimalPlacesFromToleranceRaw({
    nominalRaw: pt.nominalRaw,
    lowerToleranceRaw: pt.lowerToleranceRaw,
    upperToleranceRaw: pt.upperToleranceRaw
  });
  const decimalPlaces = Math.min(
    6,
    Math.max(pt.decimalPlaces ?? 0, inferredDp)
  );

  if (bounds.kind === 'legacyAbsoluteOnly') {
    return {
      sortOrder,
      datumSurface: '—',
      measurementPoint: label,
      measurementLabel: label,
      displayMarker: String(pt.markerNo),
      unit: null,
      allowNegative: true,
      decimalPlaces,
      markerXRatio: pt.xRatio,
      markerYRatio: pt.yRatio,
      nominalValue: null,
      lowerLimit: bounds.lowerLimit,
      upperLimit: bounds.upperLimit
    };
  }
  return {
    sortOrder,
    datumSurface: '—',
    measurementPoint: label,
    measurementLabel: label,
    displayMarker: String(pt.markerNo),
    unit: null,
    allowNegative: true,
    decimalPlaces,
    markerXRatio: pt.xRatio,
    markerYRatio: pt.yRatio,
    nominalValue: bounds.nominal,
    lowerLimit: bounds.lowerLimit,
    upperLimit: bounds.upperLimit
  };
}

export function toleranceBoundsFromPoint(
  pt: InspectionDrawingPoint
): ParsedToleranceBounds | { error: string } {
  if (pt.legacyAbsoluteBounds && !pt.nominalRaw.trim() && !toleranceFieldsEdited(pt)) {
    const { lowerLimit, upperLimit } = pt.legacyAbsoluteBounds;
    return {
      nominal: (lowerLimit + upperLimit) / 2,
      lowerLimit,
      upperLimit
    };
  }
  return parseToleranceRawFields({
    nominalRaw: pt.nominalRaw,
    lowerToleranceRaw: pt.lowerToleranceRaw,
    upperToleranceRaw: pt.upperToleranceRaw
  });
}

/** 公差欄の明示編集時に legacy スナップショットを外し、必要なら legacy から offset を seed */
export function mergeInspectionDrawingPointPatch(
  point: InspectionDrawingPoint,
  patch: Partial<InspectionDrawingPoint>
): InspectionDrawingPoint {
  const next: InspectionDrawingPoint = { ...point, ...patch };
  if (!point.legacyAbsoluteBounds) {
    return next;
  }

  const mergedLower = patch.lowerToleranceRaw ?? point.lowerToleranceRaw;
  const mergedUpper = patch.upperToleranceRaw ?? point.upperToleranceRaw;
  const startingSignedMode =
    mergedLower.trim() !== '' || mergedUpper.trim() !== '';

  if (!startingSignedMode) {
    return next;
  }

  const legacy = point.legacyAbsoluteBounds;
  const rest: InspectionDrawingPoint = { ...next };
  delete rest.legacyAbsoluteBounds;

  const nominal = resolveNominalForLegacySeed({
    ...rest,
    legacyAbsoluteBounds: legacy
  });
  if (!rest.lowerToleranceRaw.trim()) {
    rest.lowerToleranceRaw = formatToleranceRawNumber(legacy.lowerLimit - nominal);
  }
  if (!rest.upperToleranceRaw.trim()) {
    rest.upperToleranceRaw = formatToleranceRawNumber(legacy.upperLimit - nominal);
  }
  return rest;
}
