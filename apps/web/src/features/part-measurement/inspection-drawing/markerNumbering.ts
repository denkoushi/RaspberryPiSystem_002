import {
  dbAbsoluteBoundsToToleranceRawFields,
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
    name: `測定点${markerNo}`,
    markerNo,
    xRatio,
    yRatio,
    nominalRaw: '',
    upperToleranceRaw: '',
    lowerToleranceRaw: '',
    testValue: ''
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
  if (bounds.kind === 'legacyAbsoluteOnly') {
    return {
      sortOrder,
      datumSurface: '—',
      measurementPoint: label,
      measurementLabel: label,
      displayMarker: String(pt.markerNo),
      unit: null,
      allowNegative: true,
      decimalPlaces: 3,
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
    decimalPlaces: 3,
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

/** 公差欄の明示編集時に legacy スナップショットを外す */
export function mergeInspectionDrawingPointPatch(
  point: InspectionDrawingPoint,
  patch: Partial<InspectionDrawingPoint>
): InspectionDrawingPoint {
  const next: InspectionDrawingPoint = { ...point, ...patch };
  if (!point.legacyAbsoluteBounds) {
    return next;
  }
  const toleranceTouched =
    (patch.lowerToleranceRaw !== undefined && patch.lowerToleranceRaw.trim() !== '') ||
    (patch.upperToleranceRaw !== undefined && patch.upperToleranceRaw.trim() !== '');
  if (toleranceTouched) {
    const rest = { ...next };
    delete rest.legacyAbsoluteBounds;
    return rest;
  }
  return next;
}
