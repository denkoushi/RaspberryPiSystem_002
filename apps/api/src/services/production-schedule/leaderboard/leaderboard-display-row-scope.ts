/**
 * 順位ボード「表示中 rowId」スコープの正規化と hydrate 用チャンク分割。
 * 装飾・フッタ winner 選定で同一の境界入力を共有する（ADR-20260508 / KB-375 整合）。
 */

/** 1 回の hydrate SQL で束ねる ID 数の上限（バインド数・巨大 IN の实务上限。composite は既に同値で chunked hydrate を採用） */
export const LEADERBOARD_HYDRATE_SQL_BATCH_MAX = 900;

/**
 * 単一リクエストで扱う一意 rowId の硬上限（異常入力の暴れ防止。通常の board は pageSize×資源数程度）。
 */
export const LEADERBOARD_DISPLAY_ROW_SCOPE_ABS_MAX = 8000;

/**
 * 表示順を保ったまま trim・重複除去する。
 */
export function normalizeLeaderboardDisplayRowIdScope(orderedRowIds: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of orderedRowIds) {
    const id = raw.trim();
    if (!id.length || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    if (out.length >= LEADERBOARD_DISPLAY_ROW_SCOPE_ABS_MAX) {
      break;
    }
  }
  return out;
}

/**
 * hydrate / 同等のバッチ処理用に ID 列を固定長チャンクに分割する。
 */
export function chunkLeaderboardRowIdsForHydrate(
  uniqueOrdered: readonly string[],
  chunkSize: number = LEADERBOARD_HYDRATE_SQL_BATCH_MAX
): string[][] {
  const size = Math.max(1, Math.floor(chunkSize));
  const chunks: string[][] = [];
  for (let i = 0; i < uniqueOrdered.length; i += size) {
    chunks.push(uniqueOrdered.slice(i, i + size));
  }
  return chunks;
}
