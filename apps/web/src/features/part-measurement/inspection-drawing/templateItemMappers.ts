import type { PartMeasurementTemplateItemDto } from '../types';

export {
  createInspectionDrawingPoint,
  drawingPointToTemplateItemInput,
  mergeInspectionDrawingPointPatch,
  nextAvailableMarkerNo,
  templateItemToDrawingPoint,
  toleranceBoundsFromPoint
} from './markerNumbering';

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

function parseOptionalNumber(raw: string | null | undefined): number | null {
  if (raw == null || String(raw).trim() === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/** 図面中心UIの編集ルート（本番 quantity=1 / 評価用） */
export function kioskPartMeasurementInspectionEditPath(sheetId: string): string {
  return `/kiosk/part-measurement/inspection/edit/${sheetId}`;
}
