/**
 * `continueLeaderboardCompositeBoard` 向けの純粋ロジックと hydrate 組み立て。
 * オーケストレーション（HTTP/ルート）は `leaderboard-composite-board.service.ts` に残す。
 */
import { Prisma } from '@prisma/client';

import type { LeaderboardShellPhasedReadResult } from '../production-schedule-query.service.js';
import {
  putLeaderboardBoardPrefixRowsInCache,
  resolveLeaderboardBoardPrefixRowsFromCache
} from './leaderboard-composite-board-prefix-row-cache.js';
import { fetchLeaderboardScheduleHydratedRowsOrderedByIds } from './leaderboard-shell-hydrate.service.js';
import type { LeaderboardShellSnapshotRecord, LeaderboardShellSnapshotStore } from './leaderboard-shell-snapshot.store.js';

export type LightShellRow = LeaderboardShellPhasedReadResult['rows'][number];

export type ContinueResourceSliceInput = {
  resourceCd: string;
  snapshotId?: string;
  cursor?: number;
  hasMore: boolean;
};

/**
 * continue 応答構築: 資源スロットごとのマージ済み行と、このラウンドで追加されたcontinuationチャンク行。
 *
 * `incrementalRows`:
 * - `[]` … continuation を取らなかった（または既に総件すべて取得済み）ため差分チャンクは無いが、差分運用自体は許容。
 * - `undefined` … 軽量差分チャンクの意味を持てない／安全側フォールバックで hydrate した等。親は `deltaRows` を付与しない。
 */
export type ContinueAssembledResourceSlice = {
  merged: LightShellRow[];
  incrementalRows: LightShellRow[] | undefined;
};

export function deriveStateFromSnapshot(
  snap: LeaderboardShellSnapshotRecord | undefined,
  totalForResource: number
): { nextCursor: number; hasMore: boolean } {
  if (!snap) {
    return { nextCursor: 0, hasMore: false };
  }
  const nextCursor = snap.orderedRowIds.length;
  const hasMore = snap.partialOrdering || nextCursor < totalForResource;
  return { nextCursor, hasMore };
}

async function hydrateLightShellRowsFromOrderedIds(params: {
  orderedRowIds: readonly string[];
  locationKey: string;
  siteKey?: string;
  leaderboardMaterializedBaseWhere: Prisma.Sql;
}): Promise<LightShellRow[]> {
  if (params.orderedRowIds.length === 0) return [];

  const siteScopedGlobalRankLocation = params.siteKey?.trim().length ? params.siteKey!.trim() : params.locationKey;

  const raw = await fetchLeaderboardScheduleHydratedRowsOrderedByIds({
    orderedRowIds: params.orderedRowIds,
    locationKey: params.locationKey,
    siteScopedGlobalRankLocation,
    leaderboardMaterializedBaseWhere: params.leaderboardMaterializedBaseWhere
  });

  return raw.map(
    (r) =>
      ({
        ...r,
        actualPerPieceMinutes: null,
        customerName: null
      }) as LightShellRow
  );
}

/**
 * continue 応答向け: snapshot の確定 prefix はそのままに、続きチャンクのみ continuation が hydrate 済みであれば差分合成する。
 * ID 整合が取れない場合は安全側にフォールバック（対象範囲をまとめて hydrate）。
 *
 * `leaderboardMaterializedBaseWhere` は同一 HTTP リクエスト内で 1 回だけ resolve して渡す（winner materialization の重複クエリを避ける）。
 */
export async function assembleContinueMergedRowsForResource(params: {
  slice: ContinueResourceSliceInput;
  cont: LeaderboardShellPhasedReadResult | null;
  deps: { snapshotStore: LeaderboardShellSnapshotStore };
  locationKey: string;
  siteKey?: string;
  leaderboardMaterializedBaseWhere: Prisma.Sql;
}): Promise<ContinueAssembledResourceSlice> {
  const { slice, cont, deps, locationKey, siteKey, leaderboardMaterializedBaseWhere } = params;

  const hydrateOrdered = async (ids: readonly string[]) =>
    hydrateLightShellRowsFromOrderedIds({
      orderedRowIds: ids,
      locationKey,
      siteKey,
      leaderboardMaterializedBaseWhere
    });

  const hydrateOrderedWithPrefixCache = async (ids: readonly string[]): Promise<LightShellRow[]> => {
    if (ids.length === 0) return [];
    const snapshotId = slice.snapshotId?.trim() ?? '';
    if (snapshotId.length > 0) {
      const { cachedRows, missingIds } = resolveLeaderboardBoardPrefixRowsFromCache(snapshotId, ids);
      if (missingIds.length === 0) {
        return cachedRows;
      }
      const hydratedMissing = await hydrateOrdered(missingIds);
      const byId = new Map<string, LightShellRow>();
      for (const row of cachedRows) {
        byId.set(row.id, row);
      }
      for (const row of hydratedMissing) {
        byId.set(row.id, row);
      }
      const ordered = ids.map((id) => byId.get(id)).filter((r): r is LightShellRow => r != null);
      if (ordered.length === ids.length) {
        putLeaderboardBoardPrefixRowsInCache(snapshotId, ordered);
        return ordered;
      }
    }
    return hydrateOrdered(ids);
  };

  const snap = slice.snapshotId?.trim() ? deps.snapshotStore.get(slice.snapshotId.trim()) : undefined;
  const snapIds = snap?.orderedRowIds ?? [];

  if (!slice.hasMore) {
    const merged = await hydrateOrderedWithPrefixCache(snapIds);
    if (slice.snapshotId?.trim()) {
      putLeaderboardBoardPrefixRowsInCache(slice.snapshotId.trim(), merged);
    }
    return { merged, incrementalRows: [] };
  }

  if (!cont) {
    const merged = await hydrateOrderedWithPrefixCache(snapIds);
    if (slice.snapshotId?.trim()) {
      putLeaderboardBoardPrefixRowsInCache(slice.snapshotId.trim(), merged);
    }
    return { merged, incrementalRows: undefined };
  }

  const cursorStart = Math.max(0, Math.floor(slice.cursor ?? 0));
  const rawNext =
    cont.nextCursor != null ? Math.max(0, Math.floor(cont.nextCursor)) : snapIds.length;
  const boundNext = Math.min(rawNext, snapIds.length);
  const targetIds = snapIds.slice(0, boundNext);

  const chunkRows = cont.rows ?? [];

  if (chunkRows.length === 0) {
    const merged = await hydrateOrderedWithPrefixCache(targetIds);
    if (slice.snapshotId?.trim()) {
      putLeaderboardBoardPrefixRowsInCache(slice.snapshotId.trim(), merged);
    }
    const incrementalRows = boundNext === cursorStart ? [] : undefined;
    return { merged, incrementalRows };
  }

  const chunkTargetIds = snapIds.slice(cursorStart, boundNext);
  const idsAligned =
    chunkTargetIds.length === chunkRows.length &&
    chunkTargetIds.every((id, i) => id === chunkRows[i]!.id);

  if (!idsAligned) {
    const merged = await hydrateOrderedWithPrefixCache(targetIds);
    if (slice.snapshotId?.trim()) {
      putLeaderboardBoardPrefixRowsInCache(slice.snapshotId.trim(), merged);
    }
    return { merged, incrementalRows: undefined };
  }

  const prefixIds = snapIds.slice(0, cursorStart);
  const prefixHydrated = prefixIds.length > 0 ? await hydrateOrderedWithPrefixCache(prefixIds) : [];
  const chunkLight = chunkRows.map(
    (r) =>
      ({
        ...r,
        actualPerPieceMinutes: null,
        customerName: null
      }) as LightShellRow
  );
  const merged = [...prefixHydrated, ...chunkLight];

  const mergedIds = merged.map((r) => r.id);
  if (mergedIds.length !== targetIds.length || mergedIds.some((id, i) => id !== targetIds[i])) {
    const mergedHydrated = await hydrateOrderedWithPrefixCache(targetIds);
    if (slice.snapshotId?.trim()) {
      putLeaderboardBoardPrefixRowsInCache(slice.snapshotId.trim(), mergedHydrated);
    }
    return { merged: mergedHydrated, incrementalRows: undefined };
  }

  if (slice.snapshotId?.trim()) {
    putLeaderboardBoardPrefixRowsInCache(slice.snapshotId.trim(), merged);
  }

  return { merged, incrementalRows: chunkLight };
}
