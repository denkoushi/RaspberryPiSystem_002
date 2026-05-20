/** API 契約に合わせる（`apps/api/src/routes/kiosk/production-schedule/shared.ts`） */
export const LEADER_ORDER_BOARD_ORDER_NUMBER_MAX = 10;

/** 一覧の単一クエリ時代のページサイズ（順位ボードは shell 側で増分しない）。 */
export const LEADER_ORDER_BOARD_PAGE_SIZE = 320;

/** 順位ボード board 初回 GET の `pageSize`（スロットあたり）。API 上限 160。 */
export const LEADER_ORDER_BOARD_SHELL_INITIAL_PAGE_SIZE = 80;

/**
 * 順位ボード `leaderboard-board/continue` の 1 回あたり chunk（`body.pageSize`）。
 * Pi5 実データベンチで shell=80 と揃えて完走短縮（KB-374 §continue chunk 80/80）。
 * ロールバックは 40 に戻して Pi4 Web を再デプロイ。
 */
export const LEADER_ORDER_BOARD_CONTINUE_CHUNK_SIZE = 80;

/**
 * @deprecated `LEADER_ORDER_BOARD_SHELL_INITIAL_PAGE_SIZE` と `LEADER_ORDER_BOARD_CONTINUE_CHUNK_SIZE` を使う。
 * 初回 board GET 用のエイリアス。
 */
export const LEADER_ORDER_BOARD_SHELL_PAGE_SIZE = LEADER_ORDER_BOARD_SHELL_INITIAL_PAGE_SIZE;

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

/** 順位ボード・対象端末選択の localStorage スコープ（工場単位） */
export const LEADER_BOARD_PERSIST_DEVICE_SCOPE_SCHEMA_VERSION = 1;
const LEADER_BOARD_PERSIST_DEVICE_SCOPE_PREFIX = 'kiosk-leader-order-board-active-device-scope';

export type PersistedLeaderBoardActiveDeviceScope = {
  schemaVersion: typeof LEADER_BOARD_PERSIST_DEVICE_SCOPE_SCHEMA_VERSION;
  deviceScopeKey: string;
};

export function persistedLeaderBoardDeviceScopeStorageKey(siteKey: string): string {
  const trimmed = siteKey.trim();
  return trimmed.length > 0
    ? `${LEADER_BOARD_PERSIST_DEVICE_SCOPE_PREFIX}:${trimmed}`
    : LEADER_BOARD_PERSIST_DEVICE_SCOPE_PREFIX;
}

/** 製番順「評価モード」— 端末ローカルのみ（共有 search-state とは独立） */
export const LEADER_BOARD_SEIBAN_EVAL_SCHEMA_VERSION = 1;
const LEADER_BOARD_SEIBAN_EVAL_PREFIX = 'kiosk-leader-order-board-seiban-eval';

export type PersistedLeaderBoardSeibanEval = {
  schemaVersion: typeof LEADER_BOARD_SEIBAN_EVAL_SCHEMA_VERSION;
  enabled: boolean;
  /** `sharedHistory` に対する表示順（未登録キーは無視し、マージで正規化される） */
  localOrder: string[];
};

export function persistedLeaderBoardSeibanEvalStorageKey(siteKey: string, deviceScopeKey: string): string {
  const s = siteKey.trim();
  const d = deviceScopeKey.trim();
  const core = s.length > 0 && d.length > 0 ? `${s}\0${d}` : s.length > 0 ? s : d.length > 0 ? d : '';
  return core.length > 0 ? `${LEADER_BOARD_SEIBAN_EVAL_PREFIX}:${core}` : LEADER_BOARD_SEIBAN_EVAL_PREFIX;
}

/** スロット数に応じて 1 ページ完全性をとりやすくする（単一クエリ方針） */
export function leaderOrderBoardQueryPageSize(uniqueResourceSlotCount: number): number {
  const n = Math.max(1, uniqueResourceSlotCount);
  const bump = (n - 1) * 80;
  return Math.min(1200, LEADER_ORDER_BOARD_PAGE_SIZE + bump);
}
