/** API 契約に合わせる（`apps/api/src/routes/kiosk/production-schedule/shared.ts`） */
export const LEADER_ORDER_BOARD_ORDER_NUMBER_MAX = 10;

export const LEADER_ORDER_BOARD_PAGE_SIZE = 400;

/** 順位ボードの資源スロット（進捗一覧の seiban ページ上限とは別物） */
export const LEADER_BOARD_MIN_RESOURCE_SLOTS = 1;
export const LEADER_BOARD_MAX_RESOURCE_SLOTS = 12;
export const LEADER_BOARD_DEFAULT_SLOT_COUNT = 6;

export const LEADER_BOARD_SLOT_SCHEMA_VERSION = 1;
const LEADER_BOARD_SLOT_STORAGE_PREFIX = 'kiosk-leader-order-board-resource-slots';

export function leaderBoardSlotStorageKey(scopeKey: string): string {
  const trimmed = scopeKey.trim();
  return trimmed.length > 0 ? `${LEADER_BOARD_SLOT_STORAGE_PREFIX}:${trimmed}` : LEADER_BOARD_SLOT_STORAGE_PREFIX;
}

/** スロット数に応じて 1 ページ完全性をとりやすくする（単一クエリ方針） */
export function leaderOrderBoardQueryPageSize(uniqueResourceSlotCount: number): number {
  const n = Math.max(1, uniqueResourceSlotCount);
  const bump = (n - 1) * 120;
  return Math.min(2000, LEADER_ORDER_BOARD_PAGE_SIZE + bump);
}
