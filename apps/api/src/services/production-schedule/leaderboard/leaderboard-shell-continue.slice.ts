import type { LeaderboardShellSnapshotRecord } from './leaderboard-shell-snapshot.store.js';

export type SnapshotContinueStaleReason =
  | 'fingerprint'
  | 'location'
  | 'site'
  | 'generation'
  | 'missing'
  | 'cursor_overflow';

/**
 * snapshot が continue に使えるか（フィンガープリント・スコープ・世代）。
 * TTL 切れは store.get で既に弾かれる想定。
 */
export function isLeaderboardShellSnapshotStaleForContinue(params: {
  snap: LeaderboardShellSnapshotRecord;
  filterFingerprint: string;
  locationKey: string;
  siteKey: string | undefined;
  currentGenerationToken: string;
}): SnapshotContinueStaleReason | null {
  const { snap, filterFingerprint, locationKey, siteKey, currentGenerationToken } = params;
  if (snap.filterFingerprint !== filterFingerprint) return 'fingerprint';
  if (snap.locationKey !== locationKey) return 'location';
  if ((snap.siteKey ?? '') !== (siteKey ?? '')) return 'site';
  if (snap.generationToken !== currentGenerationToken) return 'generation';
  return null;
}

export type SnapshotSliceByCursorResult =
  | { kind: 'ok'; sliceIds: readonly string[]; nextCursor: number; hasMore: boolean }
  | { kind: 'cursor_overflow' };

/**
 * cursor ベースで orderedRowIds から次チャンクを切り出す。
 * cursor は「既に返却済み行数」＝次に読む先頭インデックス。
 */
export function sliceLeaderboardSnapshotIdsByCursor(
  orderedRowIds: readonly string[],
  cursor: number,
  chunkSize: number
): SnapshotSliceByCursorResult {
  if (!Number.isInteger(cursor) || cursor < 0) return { kind: 'cursor_overflow' };
  if (cursor > orderedRowIds.length) return { kind: 'cursor_overflow' };
  const sliceIds = orderedRowIds.slice(cursor, cursor + chunkSize);
  const nextCursor = cursor + sliceIds.length;
  const hasMore = nextCursor < orderedRowIds.length;
  return { kind: 'ok', sliceIds, nextCursor, hasMore };
}

export type SnapshotSliceByExcludePrefixResult =
  | { kind: 'ok'; sliceIds: readonly string[]; nextCursor: number; hasMore: boolean }
  | { kind: 'expired' };

/**
 * excludeRowIds が snapshot の先頭と一致するときだけ次チャンクを切り出す（後方互換）。
 */
export function sliceLeaderboardSnapshotIdsByExcludePrefix(
  orderedRowIds: readonly string[],
  excludeRowIds: readonly string[],
  chunkSize: number
): SnapshotSliceByExcludePrefixResult {
  if (excludeRowIds.length > orderedRowIds.length) return { kind: 'expired' };
  for (let i = 0; i < excludeRowIds.length; i++) {
    if (orderedRowIds[i] !== excludeRowIds[i]) return { kind: 'expired' };
  }
  const sliceIds = orderedRowIds.slice(excludeRowIds.length, excludeRowIds.length + chunkSize);
  const nextCursor = excludeRowIds.length + sliceIds.length;
  const hasMore = nextCursor < orderedRowIds.length;
  return { kind: 'ok', sliceIds, nextCursor, hasMore };
}
