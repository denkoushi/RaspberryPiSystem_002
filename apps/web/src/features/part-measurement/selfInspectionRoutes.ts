export const KIOSK_SELF_INSPECTION_PATH_PREFIX = '/kiosk/part-measurement/self-inspection';
export const KIOSK_SELF_INSPECTION_LIST_PATH = KIOSK_SELF_INSPECTION_PATH_PREFIX;
export const KIOSK_SELF_INSPECTION_START_PATH = `${KIOSK_SELF_INSPECTION_PATH_PREFIX}/start`;
export const KIOSK_SELF_INSPECTION_RECORD_APPROVALS_PATH =
  `${KIOSK_SELF_INSPECTION_PATH_PREFIX}/record-approvals`;

function normalizePathname(pathname: string): string {
  const trimmed = pathname.trim();
  if (!trimmed) return '/';
  const noTrail = trimmed.replace(/\/+$/, '');
  return noTrail || '/';
}

export function isKioskSelfInspectionPath(pathname: string): boolean {
  const p = normalizePathname(pathname);
  return p === KIOSK_SELF_INSPECTION_PATH_PREFIX || p.startsWith(`${KIOSK_SELF_INSPECTION_PATH_PREFIX}/`);
}

export function kioskSelfInspectionSessionPath(sessionId: string): string {
  return `${KIOSK_SELF_INSPECTION_PATH_PREFIX}/sessions/${sessionId}`;
}

export function kioskSelfInspectionInspectorSessionPath(sessionId: string): string {
  return `${kioskSelfInspectionSessionPath(sessionId)}/inspector`;
}
