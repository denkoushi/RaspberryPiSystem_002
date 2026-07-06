/**
 * キオスク端末ごとの起動先設定。
 * defaultMode(TAG/PHOTO) は既存互換として残し、こちらを明示設定として扱う。
 */

export const KIOSK_INITIAL_ROUTE_IDS = [
  'borrow_tag',
  'borrow_photo',
  'production_schedule',
  'leader_order_board',
  'assembly'
] as const;

export type KioskInitialRouteId = (typeof KIOSK_INITIAL_ROUTE_IDS)[number];

export const KIOSK_SELECTABLE_INITIAL_ROUTE_IDS = [
  'borrow_tag',
  'borrow_photo',
  'leader_order_board',
  'assembly'
] as const satisfies readonly KioskInitialRouteId[];

export type KioskSelectableInitialRouteId = (typeof KIOSK_SELECTABLE_INITIAL_ROUTE_IDS)[number];

export type KioskLegacyDefaultMode = 'PHOTO' | 'TAG';

export const KIOSK_INITIAL_ROUTE_LABELS: Record<KioskInitialRouteId, string> = {
  borrow_tag: '2タグスキャン',
  borrow_photo: '写真撮影持出',
  production_schedule: '生産スケジュール',
  leader_order_board: '順位ボード',
  assembly: '組立'
};

export const KIOSK_INITIAL_ROUTE_PATHS: Record<KioskInitialRouteId, string> = {
  borrow_tag: '/kiosk/tag',
  borrow_photo: '/kiosk/photo',
  production_schedule: '/kiosk/production-schedule',
  leader_order_board: '/kiosk/production-schedule/leader-order-board',
  assembly: '/kiosk/assembly'
};

const KNOWN_KIOSK_INITIAL_ROUTE_ID_SET = new Set<string>(KIOSK_INITIAL_ROUTE_IDS);
const SELECTABLE_KIOSK_INITIAL_ROUTE_ID_SET = new Set<string>(KIOSK_SELECTABLE_INITIAL_ROUTE_IDS);

export function isKioskInitialRouteId(value: string): value is KioskInitialRouteId {
  return KNOWN_KIOSK_INITIAL_ROUTE_ID_SET.has(value);
}

export function isKioskSelectableInitialRouteId(value: string): value is KioskSelectableInitialRouteId {
  return SELECTABLE_KIOSK_INITIAL_ROUTE_ID_SET.has(value);
}

export function normalizeKioskInitialRoute(value: unknown): KioskInitialRouteId | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return isKioskInitialRouteId(trimmed) ? trimmed : null;
}

export function resolveKioskDefaultModePath(defaultMode: unknown): string {
  return defaultMode === 'PHOTO' ? KIOSK_INITIAL_ROUTE_PATHS.borrow_photo : KIOSK_INITIAL_ROUTE_PATHS.borrow_tag;
}

export function resolveKioskInitialPath(input: {
  initialRoute?: unknown;
  defaultMode?: unknown;
}): string {
  const route = normalizeKioskInitialRoute(input.initialRoute);
  return route ? KIOSK_INITIAL_ROUTE_PATHS[route] : resolveKioskDefaultModePath(input.defaultMode);
}
