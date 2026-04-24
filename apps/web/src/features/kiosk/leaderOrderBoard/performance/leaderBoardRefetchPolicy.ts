/**
 * Pi4 順位ボード向けポーリング間隔（性能優先）。
 * 他端末からの更新反映は遅れうる（手動操作は mutation / invalidate で整合）。
 */
export const LEADER_BOARD_SCHEDULE_REFETCH_MS = 120_000;
/**
 * 順位候補の占有状況は他端末更新と競合しやすいため、一覧より短く保つ。
 */
export const LEADER_BOARD_ORDER_USAGE_REFETCH_MS = 15_000;
export const LEADER_BOARD_HISTORY_PROGRESS_REFETCH_MS = 120_000;
export const LEADER_BOARD_SEARCH_STATE_REFETCH_MS = 60_000;
export const LEADER_BOARD_RESOURCES_REFETCH_MS = 180_000;
export const LEADER_BOARD_DEVICE_SNAPSHOT_REFETCH_MS = 180_000;

/** これを超えた行数は仮想スクロール化（DOM 削減） */
export const LEADER_BOARD_VIRTUAL_ROW_THRESHOLD = 14;

export const LEADER_BOARD_ROW_ESTIMATE_PX = 80;
