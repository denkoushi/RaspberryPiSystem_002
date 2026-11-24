/**
 * キオスク端末ごとの起動先設定。
 * defaultMode(TAG/PHOTO) は既存互換として残し、こちらを明示設定として扱う。
 */

export const KIOSK_INITIAL_ROUTE_IDS = [
  'portal',
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
  'call',
  'inventory_dashboard',
  'inventory_haizen',
  'inventory_haizen_verify_history',
  'inventory_haizen_trail',
  'assembly_check_sheets',
  'assembly_manuals',
  'assembly_training',
  'part_measurement_finalized',
  'self_inspection_record_approvals',
  'self_inspection_reduction',
  'procedure_board',
  'mobile_placement',
  'mobile_placement_schedule_seibans',
  'mobile_placement_part_search',
  'mobile_placement_zero2w_status',
  'mobile_placement_pallet_viz'
] as const;

export type KioskInitialRouteId = (typeof KIOSK_INITIAL_ROUTE_IDS)[number];

export const KIOSK_SELECTABLE_INITIAL_ROUTE_IDS = KIOSK_INITIAL_ROUTE_IDS;

export type KioskSelectableInitialRouteId = (typeof KIOSK_SELECTABLE_INITIAL_ROUTE_IDS)[number];

export type KioskLegacyDefaultMode = 'PHOTO' | 'TAG';

export const KIOSK_INITIAL_ROUTE_LABELS: Record<KioskInitialRouteId, string> = {
  portal: 'ポータル',
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
  call: '通話',
  inventory_dashboard: '在庫＞集計',
  inventory_haizen: '在庫＞配膳の場所',
  inventory_haizen_verify_history: '在庫＞照合の記録',
  inventory_haizen_trail: '在庫＞足取り',
  assembly_check_sheets: '組立＞組立チェックシート',
  assembly_manuals: '組立＞要領書 見る',
  assembly_training: '組立＞締付トルク訓練',
  part_measurement_finalized: '部品測定＞確定記録の検索',
  self_inspection_record_approvals: '自主検査＞検査記録確認',
  self_inspection_reduction: '自主検査＞減らせる検査',
  procedure_board: '手順づくり',
  mobile_placement: '配膳',
  mobile_placement_schedule_seibans: '配膳＞日程',
  mobile_placement_part_search: '配膳＞部品',
  mobile_placement_zero2w_status: '配膳＞Zero2W 配膳',
  mobile_placement_pallet_viz: '配膳＞パレット'
};

export const KIOSK_INITIAL_ROUTE_PATHS: Record<KioskInitialRouteId, string> = {
  portal: '/kiosk/portal',
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
  call: '/kiosk/call',
  inventory_dashboard: '/kiosk/inventory/dashboard',
  inventory_haizen: '/kiosk/inventory/haizen',
  inventory_haizen_verify_history: '/kiosk/inventory/haizen/verify-history',
  inventory_haizen_trail: '/kiosk/inventory/haizen/trail',
  assembly_check_sheets: '/kiosk/assembly/check-sheets',
  assembly_manuals: '/kiosk/assembly/manuals',
  assembly_training: '/kiosk/assembly/training',
  part_measurement_finalized: '/kiosk/part-measurement/finalized',
  self_inspection_record_approvals: '/kiosk/part-measurement/self-inspection/record-approvals',
  self_inspection_reduction: '/kiosk/part-measurement/self-inspection/reduction',
  procedure_board: '/kiosk/procedure-board',
  mobile_placement: '/kiosk/mobile-placement',
  mobile_placement_schedule_seibans: '/kiosk/mobile-placement/schedule-seibans',
  mobile_placement_part_search: '/kiosk/mobile-placement/part-search',
  mobile_placement_zero2w_status: '/kiosk/mobile-placement/zero2w-status',
  mobile_placement_pallet_viz: '/kiosk/mobile-placement/pallet-viz'
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
