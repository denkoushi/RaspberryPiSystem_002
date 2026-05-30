/** キオスクヘッダー「検査図面」タブのルート接頭辞 */
export const KIOSK_INSPECTION_DRAWING_PATH_PREFIX = '/kiosk/part-measurement/inspection';

export const KIOSK_INSPECTION_DRAWING_LIBRARY_PATH = KIOSK_INSPECTION_DRAWING_PATH_PREFIX;
export const KIOSK_INSPECTION_DRAWING_CREATE_PATH = `${KIOSK_INSPECTION_DRAWING_PATH_PREFIX}/create`;
export const KIOSK_INSPECTION_DRAWING_TEMPLATE_EDIT_PATH_PREFIX =
  `${KIOSK_INSPECTION_DRAWING_PATH_PREFIX}/templates`;

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
