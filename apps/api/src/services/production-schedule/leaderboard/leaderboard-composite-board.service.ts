/**
 * 順位ボード（複数資源スロット）向け集約取得。
 * 単一資源の shell / continue / COUNT / 装飾を既存サービスに委譲し、HTTP 層とクエリ実装の間に置くオーケストレーションのみを担当する。
 */
import {
  countProductionScheduleDashboardVisibleRowsFromListFilters,
  decorateLeaderboardShellRowsForKiosk,
  decorateLeaderboardShellRowsForKioskFromHydratedRows,
  listLeaderboardShellContinuationProductionScheduleRows,
  listLeaderboardShellProductionScheduleRows,
  type LeaderboardShellPhasedReadResult,
  type ProductionScheduleListParams
} from '../production-schedule-query.service.js';
import { resolveLeaderboardMaterializedBaseWhere } from '../row-resolver/index.js';
import { prisma } from '../../../lib/prisma.js';
import { normalizeLeaderboardDisplayRowIdScope } from './leaderboard-display-row-scope.js';
import { resolveFiniteLeaderboardBoardNextCursor } from './leaderboard-board-resource-cursor.js';
import {
  assembleContinueMergedRowsForResource,
  deriveStateFromSnapshot
} from './leaderboard-composite-board-continue-assembly.js';
import type { LeaderboardShellSnapshotStore } from './leaderboard-shell-snapshot.store.js';

type LightShellRow = LeaderboardShellPhasedReadResult['rows'][number];

export type LeaderboardBoardResourceState = {
  resourceCd: string;
  snapshotId?: string;
  nextCursor?: number;
  hasMore: boolean;
  total: number;
  pageSize: number;
};

export type LeaderboardBoardReadResult = {
  page: number;
  pageSize: number;
  total: number;
  rows: LightShellRow[];
  resources: LeaderboardBoardResourceState[];
  snapshotExpired?: boolean;
  leaderboardFooterChipsByPartKey?: Record<string, unknown>;
};

type ListParamsBase = Omit<ProductionScheduleListParams, 'page' | 'pageSize' | 'responseProfile' | 'resourceCds'>;

export async function fetchLeaderboardCompositeBoardShell(
  params: {
    listParamsBase: ListParamsBase;
    boardResourceCds: readonly string[];
    page: number;
    pageSize: number;
  },
  deps: { snapshotStore: LeaderboardShellSnapshotStore }
): Promise<LeaderboardBoardReadResult> {
  const cappedPageSize = Math.min(Math.max(1, Math.floor(params.pageSize)), 160);

  const [shells, totals] = await Promise.all([
    Promise.all(
      params.boardResourceCds.map((resourceCd) =>
        listLeaderboardShellProductionScheduleRows(
          {
            ...params.listParamsBase,
            page: params.page,
            pageSize: cappedPageSize,
            resourceCds: [resourceCd]
          },
          deps
        )
      )
    ),
    Promise.all(
      params.boardResourceCds.map((resourceCd) =>
        countProductionScheduleDashboardVisibleRowsFromListFilters({
          queryText: params.listParamsBase.queryText,
          productNos: params.listParamsBase.productNos,
          machineName: params.listParamsBase.machineName,
          resourceCds: [resourceCd],
          assignedOnlyCds: params.listParamsBase.assignedOnlyCds,
          resourceCategory: params.listParamsBase.resourceCategory,
          hasNoteOnly: params.listParamsBase.hasNoteOnly,
          hasDueDateOnly: params.listParamsBase.hasDueDateOnly,
          allowResourceOnly: params.listParamsBase.allowResourceOnly,
          locationKey: params.listParamsBase.locationKey,
          siteKey: params.listParamsBase.siteKey
        })
      )
    )
  ]);

  const mergedRows = shells.flatMap((s) => s.rows);
  const totalSum = totals.reduce((acc, n) => acc + n, 0);

  const resources: LeaderboardBoardResourceState[] = params.boardResourceCds.map((resourceCd, i) => ({
    resourceCd,
    snapshotId: shells[i]?.snapshotId,
    nextCursor: resolveFiniteLeaderboardBoardNextCursor(shells[i]?.nextCursor, [shells[i]?.rows.length]),
    hasMore: shells[i]?.hasMore ?? false,
    total: totals[i] ?? 0,
    pageSize: shells[i]?.pageSize ?? cappedPageSize
  }));

  const deco = await decorateLeaderboardShellRowsForKiosk({
    orderedRowIds: mergedRows.map((r) => r.id),
    locationKey: params.listParamsBase.locationKey,
    siteKey: params.listParamsBase.siteKey
  });

  const decoMap = new Map(deco.rowDecorations.map((d) => [d.id, d]));
  const rowsWithDeco = mergedRows.map((r) => {
    const d = decoMap.get(r.id);
    return d
      ? {
          ...r,
          resolvedMachineName: d.resolvedMachineName ?? r.resolvedMachineName,
          customerName: d.customerName
        }
      : r;
  });

  const maxPageSize = shells.length > 0 ? Math.max(...shells.map((s) => s.pageSize)) : cappedPageSize;

  return {
    page: params.page,
    pageSize: maxPageSize,
    total: totalSum,
    rows: rowsWithDeco,
    resources,
    leaderboardFooterChipsByPartKey: deco.leaderboardFooterChipsByPartKey as Record<string, unknown>
  };
}

export async function continueLeaderboardCompositeBoard(
  params: {
    listParamsBase: ListParamsBase;
    boardResourceCds: readonly string[];
    resourceSlices: ReadonlyArray<{
      resourceCd: string;
      snapshotId?: string;
      cursor?: number;
      excludeRowIds?: readonly string[];
      hasMore: boolean;
    }>;
    chunkSize: number;
  },
  deps: { snapshotStore: LeaderboardShellSnapshotStore }
): Promise<LeaderboardBoardReadResult> {
  const chunkSize = Math.min(160, Math.max(1, Math.floor(params.chunkSize)));

  const [totals, contOutputs] = await Promise.all([
    Promise.all(
      params.boardResourceCds.map((resourceCd) =>
        countProductionScheduleDashboardVisibleRowsFromListFilters({
          queryText: params.listParamsBase.queryText,
          productNos: params.listParamsBase.productNos,
          machineName: params.listParamsBase.machineName,
          resourceCds: [resourceCd],
          assignedOnlyCds: params.listParamsBase.assignedOnlyCds,
          resourceCategory: params.listParamsBase.resourceCategory,
          hasNoteOnly: params.listParamsBase.hasNoteOnly,
          hasDueDateOnly: params.listParamsBase.hasDueDateOnly,
          allowResourceOnly: params.listParamsBase.allowResourceOnly,
          locationKey: params.listParamsBase.locationKey,
          siteKey: params.listParamsBase.siteKey
        })
      )
    ),
    Promise.all(
      params.boardResourceCds.map(async (_resourceCd, i) => {
        const slice = params.resourceSlices[i]!;
        if (!slice.hasMore) {
          return null;
        }
        return listLeaderboardShellContinuationProductionScheduleRows(
          {
            queryText: params.listParamsBase.queryText,
            productNos: params.listParamsBase.productNos,
            machineName: params.listParamsBase.machineName,
            resourceCds: [slice.resourceCd],
            assignedOnlyCds: params.listParamsBase.assignedOnlyCds,
            resourceCategory: params.listParamsBase.resourceCategory,
            hasNoteOnly: params.listParamsBase.hasNoteOnly,
            hasDueDateOnly: params.listParamsBase.hasDueDateOnly,
            allowResourceOnly: params.listParamsBase.allowResourceOnly,
            locationKey: params.listParamsBase.locationKey,
            siteKey: params.listParamsBase.siteKey,
            excludeRowIds: slice.excludeRowIds ?? [],
            cursor: slice.cursor,
            chunkSize,
            snapshotId: slice.snapshotId,
            page: 1
          },
          deps
        );
      })
    )
  ]);

  if (contOutputs.some((o) => o?.snapshotExpired === true)) {
    return {
      page: 1,
      pageSize: chunkSize,
      total: totals.reduce((a, b) => a + b, 0),
      rows: [],
      resources: [],
      snapshotExpired: true
    };
  }

  /** 資源ごとの assemble が同一値を参照（リクエストあたり 1 回の winner materialization） */
  const leaderboardMaterializedBaseWhere = await resolveLeaderboardMaterializedBaseWhere(prisma);

  const perResourceRows: LightShellRow[][] = [];
  for (let i = 0; i < params.boardResourceCds.length; i += 1) {
    const slice = params.resourceSlices[i]!;
    const cont = contOutputs[i];
    const mergedForResource = await assembleContinueMergedRowsForResource({
      slice,
      cont,
      deps,
      locationKey: params.listParamsBase.locationKey,
      siteKey: params.listParamsBase.siteKey,
      leaderboardMaterializedBaseWhere
    });
    perResourceRows.push(mergedForResource);
  }

  const mergedRows = perResourceRows.flat();
  const preferredDisplayRowIds = normalizeLeaderboardDisplayRowIdScope(mergedRows.map((r) => r.id));

  const resources: LeaderboardBoardResourceState[] = params.boardResourceCds.map((resourceCd, i) => {
    const slice = params.resourceSlices[i]!;
    const cont = contOutputs[i];
    const snap = slice.snapshotId?.trim()
      ? deps.snapshotStore.get(slice.snapshotId.trim())
      : undefined;
    const totalI = totals[i] ?? 0;

    if (cont != null) {
      return {
        resourceCd,
        snapshotId: slice.snapshotId,
        nextCursor: resolveFiniteLeaderboardBoardNextCursor(cont.nextCursor, [
          slice.cursor,
          snap?.orderedRowIds.length
        ]),
        hasMore: cont.hasMore ?? false,
        total: totalI,
        pageSize: chunkSize
      };
    }

    const derived = deriveStateFromSnapshot(snap, totalI);
    return {
      resourceCd,
      snapshotId: slice.snapshotId,
      nextCursor: resolveFiniteLeaderboardBoardNextCursor(derived.nextCursor, []),
      hasMore: false,
      total: totalI,
      pageSize: chunkSize
    };
  });

  const deco = await decorateLeaderboardShellRowsForKioskFromHydratedRows({
    hydratedRows: mergedRows,
    locationKey: params.listParamsBase.locationKey,
    siteKey: params.listParamsBase.siteKey,
    preferredDisplayRowIds
  });

  const decoMap = new Map(deco.rowDecorations.map((d) => [d.id, d]));
  const rowsWithDeco = mergedRows.map((r) => {
    const d = decoMap.get(r.id);
    return d
      ? {
          ...r,
          resolvedMachineName: d.resolvedMachineName ?? r.resolvedMachineName,
          customerName: d.customerName
        }
      : r;
  });

  const totalSum = totals.reduce((a, b) => a + b, 0);

  return {
    page: 1,
    pageSize: chunkSize,
    total: totalSum,
    rows: rowsWithDeco,
    resources,
    leaderboardFooterChipsByPartKey: deco.leaderboardFooterChipsByPartKey as Record<string, unknown>
  };
}
