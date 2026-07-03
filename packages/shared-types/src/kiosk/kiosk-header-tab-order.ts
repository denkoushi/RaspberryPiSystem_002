/**
 * キオスクヘッダー並び替え対象タブの安定 ID と正規化。
 * API / Web で共有する。
 */

export const KIOSK_HEADER_TAB_ORDER_SCOPE_SHARED = 'shared';

/** 画面遷移タブ + 納期管理 + 通話（サイネージ・管理・問い合わせは固定） */
export const KIOSK_REORDERABLE_HEADER_TAB_IDS = [
  'borrow',
  'self_inspection',
  'instruments_borrow',
  'rigging_borrow',
  'production_schedule',
  'manual_order',
  'leader_order_board',
  'progress_overview',
  'load_balancing',
  'purchase_order_lookup',
  'pallet_visualization',
  'shelf_master',
  'documents',
  'assembly',
  'part_measurement',
  'inspection_drawing',
  'rigging_analytics',
  'due_management',
  'call'
] as const;

export type KioskReorderableHeaderTabId = (typeof KIOSK_REORDERABLE_HEADER_TAB_IDS)[number];

export const DEFAULT_KIOSK_HEADER_TAB_ORDER: readonly KioskReorderableHeaderTabId[] =
  KIOSK_REORDERABLE_HEADER_TAB_IDS;

const KNOWN_TAB_ID_SET = new Set<string>(KIOSK_REORDERABLE_HEADER_TAB_IDS);

export function isKioskReorderableHeaderTabId(value: string): value is KioskReorderableHeaderTabId {
  return KNOWN_TAB_ID_SET.has(value);
}

/**
 * 未知 ID は捨てる、重複は先勝ち、欠落 ID は既定順の末尾に補完する。
 */
export function normalizeKioskHeaderTabOrder(input: readonly string[]): KioskReorderableHeaderTabId[] {
  const seen = new Set<string>();
  const result: KioskReorderableHeaderTabId[] = [];

  for (const raw of input) {
    const id = raw.trim();
    if (!isKioskReorderableHeaderTabId(id) || seen.has(id)) {
      continue;
    }
    seen.add(id);
    result.push(id);
  }

  for (const id of DEFAULT_KIOSK_HEADER_TAB_ORDER) {
    if (!seen.has(id)) {
      result.push(id);
    }
  }

  return result;
}
