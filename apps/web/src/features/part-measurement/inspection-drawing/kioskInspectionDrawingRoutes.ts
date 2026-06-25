import { INSPECTION_DRAWING_PRINT_MAX_ENTRY_COUNT } from './inspectionDrawingPrintConstants';

import type { InspectionDrawingLocationReturn } from './inspectionDrawingReturnNavigation';

/** キオスクヘッダー「検査図面」タブのルート接頭辞 */
export const KIOSK_INSPECTION_DRAWING_PATH_PREFIX = '/kiosk/part-measurement/inspection';

export const KIOSK_INSPECTION_DRAWING_LIBRARY_PATH = KIOSK_INSPECTION_DRAWING_PATH_PREFIX;
export const KIOSK_INSPECTION_DRAWING_CREATE_PATH = `${KIOSK_INSPECTION_DRAWING_PATH_PREFIX}/create`;
export const KIOSK_INSPECTION_DRAWING_TEMPLATE_EDIT_PATH_PREFIX =
  `${KIOSK_INSPECTION_DRAWING_PATH_PREFIX}/templates`;

/** 検査図面一覧へ戻る route state（キオスク本番） */
export const INSPECTION_DRAWING_RETURN_TO_LIBRARY_STATE: InspectionDrawingLocationReturn = {
  inspectionDrawingReturnTo: KIOSK_INSPECTION_DRAWING_LIBRARY_PATH,
  inspectionDrawingReturnLabel: '一覧へ戻る'
};

const KIOSK_PART_MEASUREMENT_PREFIX = '/kiosk/part-measurement';

function normalizePathname(pathname: string): string {
  const trimmed = pathname.trim();
  if (!trimmed) return '/';
  const noTrail = trimmed.replace(/\/+$/, '');
  return noTrail || '/';
}

export function isKioskInspectionDrawingPath(pathname: string): boolean {
  const p = normalizePathname(pathname);
  return (
    p === KIOSK_INSPECTION_DRAWING_PATH_PREFIX ||
    p.startsWith(`${KIOSK_INSPECTION_DRAWING_PATH_PREFIX}/`)
  );
}

export function isKioskPartMeasurementHubPath(pathname: string): boolean {
  const p = normalizePathname(pathname);
  if (p !== KIOSK_PART_MEASUREMENT_PREFIX && !p.startsWith(`${KIOSK_PART_MEASUREMENT_PREFIX}/`)) {
    return false;
  }
  return !isKioskInspectionDrawingPath(pathname);
}

export function kioskInspectionDrawingTemplateEditPath(templateId: string): string {
  return `${KIOSK_INSPECTION_DRAWING_TEMPLATE_EDIT_PATH_PREFIX}/${templateId}/edit`;
}

const KIOSK_INSPECTION_DRAWING_PRINT_PLANNED_QUANTITY_QUERY = 'plannedQuantity';

export function kioskInspectionDrawingTemplatePrintPath(
  templateId: string,
  options: { plannedQuantity?: number | null } = {}
): string {
  const path = `${KIOSK_INSPECTION_DRAWING_TEMPLATE_EDIT_PATH_PREFIX}/${templateId}/print`;
  const plannedQuantity = normalizeInspectionDrawingPrintPlannedQuantity(options.plannedQuantity);
  if (plannedQuantity == null) return path;
  const params = new URLSearchParams({
    [KIOSK_INSPECTION_DRAWING_PRINT_PLANNED_QUANTITY_QUERY]: String(plannedQuantity)
  });
  return `${path}?${params.toString()}`;
}

export function kioskInspectionDrawingPaperReportPrintPath(reportId: string): string {
  return `${KIOSK_INSPECTION_DRAWING_PATH_PREFIX}/paper-reports/${reportId}/print`;
}

export function parseInspectionDrawingPrintPlannedQuantityFromSearch(search: string): number | null {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  return normalizeInspectionDrawingPrintPlannedQuantity(
    Number(params.get(KIOSK_INSPECTION_DRAWING_PRINT_PLANNED_QUANTITY_QUERY))
  );
}

function normalizeInspectionDrawingPrintPlannedQuantity(value: number | null | undefined): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const count = Math.floor(value);
  if (count <= 0) return null;
  return Math.min(count, INSPECTION_DRAWING_PRINT_MAX_ENTRY_COUNT);
}

const KIOSK_INSPECTION_DRAWING_SOURCE_TEMPLATE_ID_QUERY = 'sourceTemplateId';
const KIOSK_INSPECTION_DRAWING_VISUAL_TEMPLATE_ID_QUERY = 'visualTemplateId';

export function parseInspectionDrawingSourceTemplateIdFromSearch(search: string): string | null {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const raw = params.get(KIOSK_INSPECTION_DRAWING_SOURCE_TEMPLATE_ID_QUERY)?.trim();
  return raw && raw.length > 0 ? raw : null;
}

export function parseInspectionDrawingVisualTemplateIdFromSearch(search: string): string | null {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const raw = params.get(KIOSK_INSPECTION_DRAWING_VISUAL_TEMPLATE_ID_QUERY)?.trim();
  return raw && raw.length > 0 ? raw : null;
}

export function kioskInspectionDrawingCreatePathWithSource(sourceTemplateId: string): string {
  const params = new URLSearchParams({
    [KIOSK_INSPECTION_DRAWING_SOURCE_TEMPLATE_ID_QUERY]: sourceTemplateId
  });
  return `${KIOSK_INSPECTION_DRAWING_CREATE_PATH}?${params.toString()}`;
}

export function kioskInspectionDrawingCreatePathWithVisual(visualTemplateId: string): string {
  const params = new URLSearchParams({
    [KIOSK_INSPECTION_DRAWING_VISUAL_TEMPLATE_ID_QUERY]: visualTemplateId
  });
  return `${KIOSK_INSPECTION_DRAWING_CREATE_PATH}?${params.toString()}`;
}
