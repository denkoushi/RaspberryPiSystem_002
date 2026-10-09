/**
 * キオスク端末ごとの起動先設定。
 * defaultMode(TAG/PHOTO) は既存互換として残し、こちらを明示設定として扱う。
 */

export const KIOSK_INITIAL_ROUTE_IDS = [
  'borrow_tag',
  'borrow_photo',
  'production_schedule',
  'leader_order_board',
  'assembly',
  'self_inspection',
  'inventory_settings',
  'instruments_borrow',
  'rigging_borrow',
  'manual_order',
  'grinding_planning_board',
  'progress_overview',
  'load_balancing',
  'purchase_order_lookup',
  'pallet_visualization',
  'shelf_master',
  'documents',
  'part_measurement',
  'inspection_drawing',
  'rigging_analytics',
  'machine_signal',
  'call'
] as const;

export type KioskInitialRouteId = (typeof KIOSK_INITIAL_ROUTE_IDS)[number];

export const KIOSK_SELECTABLE_INITIAL_ROUTE_IDS = KIOSK_INITIAL_ROUTE_IDS;

export type KioskSelectableInitialRouteId = (typeof KIOSK_SELECTABLE_INITIAL_ROUTE_IDS)[number];

export type KioskLegacyDefaultMode = 'PHOTO' | 'TAG';

export const KIOSK_INITIAL_ROUTE_LABELS: Record<KioskInitialRouteId, string> = {
  borrow_tag: '2タグスキャン',
  borrow_photo: '写真撮影持出',
  production_schedule: '生産スケジュール',
  leader_order_board: '順位ボード',
  assembly: '組立',
  self_inspection: '自主検査',
  inventory_settings: '在庫',
  instruments_borrow: '計測機器 持出',
  rigging_borrow: '吊具 持出',
  manual_order: '手動順番',
  grinding_planning_board: '製番ボード',
  progress_overview: '進捗一覧',
  load_balancing: '負荷調整',
  purchase_order_lookup: '購買照会',
  pallet_visualization: 'パレット',
  shelf_master: '棚マスタ',
  documents: '要領書',
  part_measurement: '部品測定',
  inspection_drawing: '検査図面',
  rigging_analytics: '集計',
  machine_signal: '設備稼働',
  call: '通話'
};

export const KIOSK_INITIAL_ROUTE_PATHS: Record<KioskInitialRouteId, string> = {
  borrow_tag: '/kiosk/tag',
  borrow_photo: '/kiosk/photo',
  production_schedule: '/kiosk/production-schedule',
  leader_order_board: '/kiosk/production-schedule/leader-order-board',
  assembly: '/kiosk/assembly',
  self_inspection: '/kiosk/part-measurement/self-inspection',
  inventory_settings: '/kiosk/inventory',
  instruments_borrow: '/kiosk/instruments/borrow',
  rigging_borrow: '/kiosk/rigging/borrow',
  manual_order: '/kiosk/production-schedule/manual-order',
  grinding_planning_board: '/kiosk/production-schedule/planning-board',
  progress_overview: '/kiosk/production-schedule/progress-overview',
  load_balancing: '/kiosk/production-schedule/load-balancing',
  purchase_order_lookup: '/kiosk/purchase-order-lookup',
  pallet_visualization: '/kiosk/pallet-visualization',
  shelf_master: '/kiosk/mobile-placement/shelf-master',
  documents: '/kiosk/documents',
  part_measurement: '/kiosk/part-measurement',
  inspection_drawing: '/kiosk/part-measurement/inspection',
  rigging_analytics: '/kiosk/rigging-analytics',
  machine_signal: '/kiosk/machine-signal',
  call: '/kiosk/call'
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
