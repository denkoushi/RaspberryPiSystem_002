import type { LeaderboardShellPhasedReadResult } from '../production-schedule-query.service.js';

type LightShellRow = LeaderboardShellPhasedReadResult['rows'][number];
type CachedSnapshotRows = {
  expiresAtMs: number;
  rowsById: Map<string, LightShellRow>;
};

const DEFAULT_PREFIX_ROW_CACHE_TTL_MS = 5 * 60 * 1000;

/** snapshot ごとの hydrate 済み light 行（continue prefix 再 hydrate 抑制） */
const rowsBySnapshotId = new Map<string, CachedSnapshotRows>();

function resolvePrefixRowCacheTtlMs(): number {
  const raw = process.env.LEADERBOARD_SHELL_SNAPSHOT_TTL_MS;
  if (raw == null || raw.trim() === '') {
    return DEFAULT_PREFIX_ROW_CACHE_TTL_MS;
  }
  const n = Number(raw);
  return Number.isFinite(n) && n >= 30_000 ? n : DEFAULT_PREFIX_ROW_CACHE_TTL_MS;
}

function gcExpiredPrefixRows(now = Date.now()): void {
  for (const [snapshotId, entry] of rowsBySnapshotId) {
    if (entry.expiresAtMs < now) {
      rowsBySnapshotId.delete(snapshotId);
    }
  }
}

export function seedLeaderboardBoardPrefixRowCache(
  snapshotId: string,
  rows: readonly LightShellRow[]
): void {
  const id = snapshotId.trim();
  if (!id.length || rows.length === 0) return;
  const now = Date.now();
  gcExpiredPrefixRows(now);
  let entry = rowsBySnapshotId.get(id);
  if (!entry) {
    entry = {
      expiresAtMs: now + resolvePrefixRowCacheTtlMs(),
      rowsById: new Map()
    };
    rowsBySnapshotId.set(id, entry);
  }
  for (const row of rows) {
    entry.rowsById.set(row.id, row);
  }
  entry.expiresAtMs = now + resolvePrefixRowCacheTtlMs();
}

export function resolveLeaderboardBoardPrefixRowsFromCache(
  snapshotId: string,
  orderedIds: readonly string[]
): { cachedRows: LightShellRow[]; missingIds: string[] } {
  gcExpiredPrefixRows();
  const id = snapshotId.trim();
  const entry = id.length ? rowsBySnapshotId.get(id) : undefined;
  if (!entry || orderedIds.length === 0) {
    return { cachedRows: [], missingIds: [...orderedIds] };
  }
  const cachedRows: LightShellRow[] = [];
  const missingIds: string[] = [];
  for (const rowId of orderedIds) {
    const hit = entry.rowsById.get(rowId);
    if (hit) {
      cachedRows.push(hit);
    } else {
      missingIds.push(rowId);
    }
  }
  return { cachedRows, missingIds };
}

export function putLeaderboardBoardPrefixRowsInCache(
  snapshotId: string,
  rows: readonly LightShellRow[]
): void {
  seedLeaderboardBoardPrefixRowCache(snapshotId, rows);
}

/** テスト用 */
export function clearLeaderboardBoardPrefixRowCacheForTests(): void {
  rowsBySnapshotId.clear();
}
