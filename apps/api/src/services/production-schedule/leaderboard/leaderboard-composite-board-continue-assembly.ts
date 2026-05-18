/**
 * `continueLeaderboardCompositeBoard` 向けの純粋ロジックと hydrate 組み立て。
 * オーケストレーション（HTTP/ルート）は `leaderboard-composite-board.service.ts` に残す。
 */
import { Prisma } from '@prisma/client';

import type { LeaderboardShellPhasedReadResult } from '../production-schedule-query.service.js';
import { fetchLeaderboardScheduleHydratedRowsOrderedByIds } from './leaderboard-shell-hydrate.service.js';
import type { LeaderboardShellSnapshotRecord, LeaderboardShellSnapshotStore } from './leaderboard-shell-snapshot.store.js';

export type LightShellRow = LeaderboardShellPhasedReadResult['rows'][number];

export type ContinueResourceSliceInput = {
  resourceCd: string;
  snapshotId?: string;
  cursor?: number;
  hasMore: boolean;
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
}): Promise<LightShellRow[]> {
  const { slice, cont, deps, locationKey, siteKey, leaderboardMaterializedBaseWhere } = params;

  const hydrateOrdered = async (ids: readonly string[]) =>
    hydrateLightShellRowsFromOrderedIds({
      orderedRowIds: ids,
      locationKey,
      siteKey,
      leaderboardMaterializedBaseWhere
    });

  const snap = slice.snapshotId?.trim() ? deps.snapshotStore.get(slice.snapshotId.trim()) : undefined;
  const snapIds = snap?.orderedRowIds ?? [];

  if (!slice.hasMore) {
    return hydrateOrdered(snapIds);
  }

  if (!cont) {
    return hydrateOrdered(snapIds);
  }

  const cursorStart = Math.max(0, Math.floor(slice.cursor ?? 0));
  const rawNext =
    cont.nextCursor != null ? Math.max(0, Math.floor(cont.nextCursor)) : snapIds.length;
  const boundNext = Math.min(rawNext, snapIds.length);
  const targetIds = snapIds.slice(0, boundNext);

  const chunkRows = cont.rows ?? [];

  if (chunkRows.length === 0) {
    return hydrateOrdered(targetIds);
  }

  const chunkTargetIds = snapIds.slice(cursorStart, boundNext);
  const idsAligned =
    chunkTargetIds.length === chunkRows.length &&
    chunkTargetIds.every((id, i) => id === chunkRows[i]!.id);

  if (!idsAligned) {
    return hydrateOrdered(targetIds);
  }

  const prefixIds = snapIds.slice(0, cursorStart);
  const prefixHydrated = prefixIds.length > 0 ? await hydrateOrdered(prefixIds) : [];
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
    return hydrateOrdered(targetIds);
  }

  return merged;
}
