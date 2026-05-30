import type { PartMeasurementTemplateItemDto } from '../types';
import type { InspectionDrawingPoint } from './types';

function parseOptionalNumber(raw: string | null | undefined): number | null {
  if (raw == null || String(raw).trim() === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

export function templateItemHasInspectionMarker(item: PartMeasurementTemplateItemDto): boolean {
  return (
    parseOptionalNumber(item.markerXRatio) != null &&
    parseOptionalNumber(item.markerYRatio) != null &&
    parseOptionalNumber(item.lowerLimit) != null &&
    parseOptionalNumber(item.upperLimit) != null
  );
}

/** テンプレ全体が図面中心エディタ対象か（全項目に座標と上下限がある） */
export function templateSupportsInspectionDrawing(
  items: PartMeasurementTemplateItemDto[] | undefined,
  drawingPath: string | null | undefined
): boolean {
  if (!drawingPath?.trim() || !items?.length) return false;
  return items.every(templateItemHasInspectionMarker);
}

export function templateItemToDrawingPoint(
  item: PartMeasurementTemplateItemDto,
  testValue = ''
): InspectionDrawingPoint {
  const lower = parseOptionalNumber(item.lowerLimit) ?? 0;
  const upper = parseOptionalNumber(item.upperLimit) ?? 0;
  return {
    id: item.id,
    name: item.measurementLabel,
    xRatio: parseOptionalNumber(item.markerXRatio) ?? 0,
    yRatio: parseOptionalNumber(item.markerYRatio) ?? 0,
    nominal: parseOptionalNumber(item.nominalValue) ?? 0,
    lower,
    upper,
    testValue
  };
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
  nominalValue: number;
  lowerLimit: number;
  upperLimit: number;
} {
  const label = pt.name.trim() || `測定点${sortOrder + 1}`;
  return {
    sortOrder,
    datumSurface: '—',
    measurementPoint: label,
    measurementLabel: label,
    displayMarker: String(sortOrder + 1),
    unit: null,
    allowNegative: true,
    decimalPlaces: 3,
    markerXRatio: pt.xRatio,
    markerYRatio: pt.yRatio,
    nominalValue: pt.nominal,
    lowerLimit: pt.lower,
    upperLimit: pt.upper
  };
}

/** 図面中心UIの編集ルート（本番 quantity=1 / 評価用） */
export function kioskPartMeasurementInspectionEditPath(sheetId: string): string {
  return `/kiosk/part-measurement/inspection/edit/${sheetId}`;
}
