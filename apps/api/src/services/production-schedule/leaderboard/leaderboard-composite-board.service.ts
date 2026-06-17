/**
 * 順位ボード（複数資源スロット）向け集約取得。
 * 単一資源の shell / continue / COUNT / 装飾を既存サービスに委譲し、HTTP 層とクエリ実装の間に置くオーケストレーションのみを担当する。
 */
import {
  countProductionScheduleDashboardVisibleRowsFromListFilters,
  listLeaderboardShellContinuationProductionScheduleRows,
  listLeaderboardShellProductionScheduleRows,
  type LeaderboardShellPhasedReadResult,
  type ProductionScheduleListParams,
  type ProductionScheduleRow
} from '../production-schedule-query.service.js';
import type { Prisma } from '@prisma/client';
import { resolveLeaderboardMaterializedBaseWhere } from '../row-resolver/index.js';
import { prisma } from '../../../lib/prisma.js';
import {
  decorateLeaderboardCompositeBoardContinue,
  decorateLeaderboardCompositeBoardShell
} from './leaderboard-composite-board-decoration.service.js';
import { resolveFiniteLeaderboardBoardNextCursor } from './leaderboard-board-resource-cursor.js';
import {
  assembleContinueMergedRowsForResource,
  deriveStateFromSnapshot,
  type ContinueAssembledResourceSlice
} from './leaderboard-composite-board-continue-assembly.js';
import { seedLeaderboardBoardSnapshotResourceTotal } from './leaderboard-composite-board-snapshot-totals.js';
import { seedLeaderboardBoardPrefixRowCache } from './leaderboard-composite-board-prefix-row-cache.js';
import { resolveLeaderboardBoardResourceTotalsForContinue } from './resolve-leaderboard-board-resource-totals-for-continue.js';
import { resolveLeaderboardBoardShellResourceTotalFromShell } from './resolve-leaderboard-board-shell-resource-total.js';
import type { LeaderboardShellSnapshotStore } from './leaderboard-shell-snapshot.store.js';
import { fetchLeaderboardProcessChangeResidualSummary } from './leaderboard-process-change-residual.service.js';
import {
  materializeProcessChangeResidualStrongEvidence,
  type ProcessChangeResidualStrongEvidenceMaterialization
} from './leaderboard-process-change-residual.materialization.js';
import { readLeaderboardShellSnapshotGenerationTokenDetails } from './leaderboard-shell-snapshot-generation.js';
import type { ProcessChangeResidualEvidence } from './leaderboard-process-change-residual.types.js';
import { attachLeaderboardLaborMinutes, type LeaderboardLaborMinutesLookupContext } from './leaderboard-labor-minutes.service.js';

/** キオスク順位ボード通常表示: 強い工程変更残骸疑いを通常候補から除外する。 */
const KIOSK_LEADERBOARD_PROCESS_CHANGE_RESIDUAL_MODE = 'normal' as const;

async function resolveLeaderboardBoardProcessChangeResidualContext(): Promise<{
  generationToken: string;
  processChangeResidualMaterialization: ProcessChangeResidualStrongEvidenceMaterialization;
}> {
  const initialTokenDetails = await readLeaderboardShellSnapshotGenerationTokenDetails();
  const processChangeResidualMaterialization = await materializeProcessChangeResidualStrongEvidence(prisma, {
    fkojunstStatusMailRowsRevision: initialTokenDetails.fkojunstStatusMailRowsRevision
  });
  const tokenDetails =
    processChangeResidualMaterialization.rawMailRowsRevision === initialTokenDetails.fkojunstStatusMailRowsRevision
      ? initialTokenDetails
      : await readLeaderboardShellSnapshotGenerationTokenDetails({
          fkojunstStatusMailRowsRevision: processChangeResidualMaterialization.rawMailRowsRevision
        });
  return {
    generationToken: tokenDetails.generationToken,
    processChangeResidualMaterialization
  };
}

type LightShellRow = LeaderboardShellPhasedReadResult['rows'][number];

async function attachLaborToBoardPayload(params: {
  rows: LightShellRow[];
  deltaRows?: LightShellRow[];
  laborLookupContext: LeaderboardLaborMinutesLookupContext;
}): Promise<{ rows: LightShellRow[]; deltaRows?: LightShellRow[] }> {
  const { laborLookupContext } = params;
  const deltaRows = params.deltaRows ?? [];
  const combined: ProductionScheduleRow[] = [];
  const seenIds = new Set<string>();
  for (const row of [...params.rows, ...deltaRows]) {
    if (seenIds.has(row.id)) continue;
    seenIds.add(row.id);
    combined.push(row);
  }
  const attachedCombined = await attachLeaderboardLaborMinutes(combined, laborLookupContext);
  const byId = new Map(attachedCombined.map((row) => [row.id, row]));
  return {
    rows: params.rows.map((row) => byId.get(row.id) ?? row),
    ...(params.deltaRows !== undefined
      ? { deltaRows: deltaRows.map((row) => byId.get(row.id) ?? row) }
      : {})
  };
}

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
  /** 初回 shell で一部スロットの exact total を後続 continue に回した場合のみ true。 */
  totalsDeferred?: boolean;
  rows: LightShellRow[];
  /**
   * 集約 `leaderboard-board/continue` のみ。軽量差分チャンク（スロット順に連結）。
   * 付与しない場合は古いクライアントのみを想定するか、このラウンドは累積 `rows` が正本。
   */
  deltaRows?: LightShellRow[];
  resources: LeaderboardBoardResourceState[];
  snapshotExpired?: boolean;
  leaderboardFooterChipsByPartKey?: Record<string, unknown>;
  processChangeResidualTotal?: number;
  processChangeResidualRows?: Array<
    LightShellRow & {
      processChangeResidualSuspected: true;
      processChangeResidualEvidence: ProcessChangeResidualEvidence;
    }
  >;
  processChangeResidualRepresentativeLimit?: number;
};

type ListParamsBase = Omit<ProductionScheduleListParams, 'page' | 'pageSize' | 'responseProfile' | 'resourceCds'>;

function countLeaderboardBoardShellResourceTotal(
  listParamsBase: ListParamsBase,
  params: {
    resourceCd: string;
    processChangeResidualStrongEvidenceKeys: ReadonlySet<string>;
    leaderboardMaterializedBaseWhere: Prisma.Sql;
  }
): Promise<number> {
  return countProductionScheduleDashboardVisibleRowsFromListFilters(
    {
      queryText: listParamsBase.queryText,
      productNos: listParamsBase.productNos,
      machineName: listParamsBase.machineName,
      resourceCds: [params.resourceCd],
      assignedOnlyCds: listParamsBase.assignedOnlyCds,
      resourceCategory: listParamsBase.resourceCategory,
      hasNoteOnly: listParamsBase.hasNoteOnly,
      hasDueDateOnly: listParamsBase.hasDueDateOnly,
      allowResourceOnly: listParamsBase.allowResourceOnly,
      locationKey: listParamsBase.locationKey,
      siteKey: listParamsBase.siteKey,
      processChangeResidualMode: KIOSK_LEADERBOARD_PROCESS_CHANGE_RESIDUAL_MODE,
      processChangeResidualStrongEvidenceKeys: params.processChangeResidualStrongEvidenceKeys
    },
    {
      leaderboardMaterializedBaseWhere: params.leaderboardMaterializedBaseWhere
    }
  );
}

function settleUnusedLeaderboardBoardShellCount(promise: Promise<number>): void {
  void promise.catch(() => {
    // hasMore=false スロットでは shell.rows.length を total 正本として返すため、
    // 並行起動済み COUNT の失敗は未処理 reject にしない。
  });
}

export async function fetchLeaderboardCompositeBoardShell(
  params: {
    listParamsBase: ListParamsBase;
    boardResourceCds: readonly string[];
    page: number;
    pageSize: number;
    includeDecorations?: boolean;
    deferTotals?: boolean;
  },
  deps: { snapshotStore: LeaderboardShellSnapshotStore }
): Promise<LeaderboardBoardReadResult> {
  const includeDecorations = params.includeDecorations !== false;
  const deferTotals = params.deferTotals === true;
  const cappedPageSize = Math.min(Math.max(1, Math.floor(params.pageSize)), 160);

  /** continue と同型: 同一 board shell リクエスト内で winner / residual / generation token を 1 回だけ */
  const { generationToken, processChangeResidualMaterialization } =
    await resolveLeaderboardBoardProcessChangeResidualContext();
  const processChangeResidualStrongEvidenceKeys = processChangeResidualMaterialization.keys;
  const leaderboardMaterializedBaseWhere = await resolveLeaderboardMaterializedBaseWhere(prisma);

  const countPromises = deferTotals
    ? []
    : params.boardResourceCds.map((resourceCd) => {
        const promise = countLeaderboardBoardShellResourceTotal(
          params.listParamsBase,
          {
            resourceCd,
            processChangeResidualStrongEvidenceKeys,
            leaderboardMaterializedBaseWhere
          }
        );
        settleUnusedLeaderboardBoardShellCount(promise);
        return promise;
      });

  const [shells, processChangeResidualSummary] = await Promise.all([
    Promise.all(
      params.boardResourceCds.map((resourceCd) =>
        listLeaderboardShellProductionScheduleRows(
          {
            ...params.listParamsBase,
            page: params.page,
            pageSize: cappedPageSize,
            resourceCds: [resourceCd],
            processChangeResidualMode: KIOSK_LEADERBOARD_PROCESS_CHANGE_RESIDUAL_MODE,
            processChangeResidualStrongEvidenceKeys
          },
          { snapshotStore: deps.snapshotStore, leaderboardMaterializedBaseWhere, generationToken }
        )
      )
    ),
    fetchLeaderboardProcessChangeResidualSummary({
      ...params.listParamsBase,
      resourceCds: [...params.boardResourceCds],
      leaderboardMaterializedBaseWhere,
      processChangeResidualMaterialization
    })
  ]);

  const resourceTotals = await Promise.all(
    shells.map((shell, i) => {
      const totalFromShell = resolveLeaderboardBoardShellResourceTotalFromShell(shell);
      if (totalFromShell !== undefined) {
        return Promise.resolve({ total: totalFromShell, exact: true });
      }
      if (deferTotals) {
        return Promise.resolve({ total: shell.rows.length, exact: false });
      }
      return countPromises[i]!.then((total) => ({ total, exact: true }));
    })
  );
  const totals = resourceTotals.map((entry) => entry.total);
  const totalsDeferred = resourceTotals.some((entry) => !entry.exact);

  const mergedRowsRaw = shells.flatMap((s) => s.rows);
  const { rows: mergedRows } = await attachLaborToBoardPayload({
    rows: mergedRowsRaw,
    laborLookupContext: {
      leaderboardMaterializedBaseWhere,
      processChangeResidualMode: KIOSK_LEADERBOARD_PROCESS_CHANGE_RESIDUAL_MODE,
      processChangeResidualStrongEvidenceKeys
    }
  });
  const totalSum = totals.reduce((acc, n) => acc + n, 0);

  const resources: LeaderboardBoardResourceState[] = params.boardResourceCds.map((resourceCd, i) => ({
    resourceCd,
    snapshotId: shells[i]?.snapshotId,
    nextCursor: resolveFiniteLeaderboardBoardNextCursor(shells[i]?.nextCursor, [shells[i]?.rows.length]),
    hasMore: shells[i]?.hasMore ?? false,
    total: totals[i] ?? 0,
    pageSize: shells[i]?.pageSize ?? cappedPageSize
  }));

  for (let i = 0; i < shells.length; i += 1) {
    const snapshotId = shells[i]?.snapshotId?.trim();
    if (snapshotId && shells[i]!.rows.length > 0) {
      seedLeaderboardBoardPrefixRowCache(snapshotId, shells[i]!.rows);
    }
    if (snapshotId && resourceTotals[i]?.exact === true) {
      seedLeaderboardBoardSnapshotResourceTotal(snapshotId, totals[i] ?? 0);
    }
  }

  const maxPageSize = shells.length > 0 ? Math.max(...shells.map((s) => s.pageSize)) : cappedPageSize;

  const processChangeResidualPayload =
    processChangeResidualSummary.processChangeResidualTotal > 0
      ? {
          processChangeResidualTotal: processChangeResidualSummary.processChangeResidualTotal,
          processChangeResidualRows: processChangeResidualSummary.processChangeResidualRows,
          processChangeResidualRepresentativeLimit:
            processChangeResidualSummary.processChangeResidualRepresentativeLimit
        }
      : {
          processChangeResidualTotal: 0,
          processChangeResidualRows: [] as LeaderboardBoardReadResult['processChangeResidualRows'],
          processChangeResidualRepresentativeLimit:
            processChangeResidualSummary.processChangeResidualRepresentativeLimit
        };

  if (!includeDecorations) {
    return {
      page: params.page,
      pageSize: maxPageSize,
      total: totalSum,
      rows: mergedRows,
      resources,
      ...(totalsDeferred ? { totalsDeferred: true } : {}),
      ...processChangeResidualPayload
    };
  }

  const { rowsWithDeco, leaderboardFooterChipsByPartKey } = await decorateLeaderboardCompositeBoardShell({
    mergedLightRows: mergedRows,
    locationKey: params.listParamsBase.locationKey,
    siteKey: params.listParamsBase.siteKey
  });

  return {
    page: params.page,
    pageSize: maxPageSize,
    total: totalSum,
    rows: rowsWithDeco,
    resources,
    ...(totalsDeferred ? { totalsDeferred: true } : {}),
    leaderboardFooterChipsByPartKey,
    ...processChangeResidualPayload
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
    includeDecorations?: boolean;
  },
  deps: { snapshotStore: LeaderboardShellSnapshotStore }
): Promise<LeaderboardBoardReadResult> {
  const includeDecorations = params.includeDecorations !== false;
  const chunkSize = Math.min(160, Math.max(1, Math.floor(params.chunkSize)));

  const { generationToken, processChangeResidualMaterialization } =
    await resolveLeaderboardBoardProcessChangeResidualContext();
  const processChangeResidualStrongEvidenceKeys = processChangeResidualMaterialization.keys;
  const leaderboardMaterializedBaseWherePromise = resolveLeaderboardMaterializedBaseWhere(prisma);

  const [totals, contOutputs] = await Promise.all([
    resolveLeaderboardBoardResourceTotalsForContinue(
      params.listParamsBase,
      params.resourceSlices,
      processChangeResidualStrongEvidenceKeys,
      leaderboardMaterializedBaseWherePromise
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
            processChangeResidualMode: KIOSK_LEADERBOARD_PROCESS_CHANGE_RESIDUAL_MODE,
            processChangeResidualStrongEvidenceKeys,
            excludeRowIds: slice.excludeRowIds ?? [],
            cursor: slice.cursor,
            chunkSize,
            snapshotId: slice.snapshotId,
            page: 1
          },
          {
            snapshotStore: deps.snapshotStore,
            generationToken,
            leaderboardMaterializedBaseWhere: await leaderboardMaterializedBaseWherePromise
          }
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

  /** 資源ごとの continue / assemble が同一値を参照（リクエストあたり 1 回の winner materialization） */
  const leaderboardMaterializedBaseWhere = await leaderboardMaterializedBaseWherePromise;

  const perResourceAssembled: ContinueAssembledResourceSlice[] = [];
  for (let i = 0; i < params.boardResourceCds.length; i += 1) {
    const slice = params.resourceSlices[i]!;
    const cont = contOutputs[i];
    const assembled = await assembleContinueMergedRowsForResource({
      slice,
      cont,
      deps,
      locationKey: params.listParamsBase.locationKey,
      siteKey: params.listParamsBase.siteKey,
      leaderboardMaterializedBaseWhere
    });
    perResourceAssembled.push(assembled);
  }

  const mergedRowsRaw = perResourceAssembled.flatMap((a) => a.merged);
  const canAttachDelta = perResourceAssembled.every((a) => a.incrementalRows !== undefined);
  const incrementalLightRows = canAttachDelta
    ? perResourceAssembled.flatMap((a) => a.incrementalRows!)
    : [];
  const deltaShellRowsFlattened = incrementalLightRows;
  const { rows: mergedRows, deltaRows: mergedDeltaRows } = await attachLaborToBoardPayload({
    rows: mergedRowsRaw,
    ...(canAttachDelta ? { deltaRows: deltaShellRowsFlattened } : {}),
    laborLookupContext: {
      leaderboardMaterializedBaseWhere,
      processChangeResidualMode: KIOSK_LEADERBOARD_PROCESS_CHANGE_RESIDUAL_MODE,
      processChangeResidualStrongEvidenceKeys
    }
  });

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

  const totalSum = totals.reduce((a, b) => a + b, 0);

  if (!includeDecorations) {
    return {
      page: 1,
      pageSize: chunkSize,
      total: totalSum,
      rows: mergedRows,
      ...(canAttachDelta && mergedDeltaRows ? { deltaRows: mergedDeltaRows } : {}),
      resources
    };
  }

  const { rowsWithDeco, deltaRowsWithDeco, leaderboardFooterChipsByPartKey } =
    await decorateLeaderboardCompositeBoardContinue({
      mergedLightRows: mergedRows,
      incrementalLightRows: mergedDeltaRows ?? incrementalLightRows,
      canAttachDelta,
      deltaShellRowsFlattened: mergedDeltaRows ?? deltaShellRowsFlattened,
      locationKey: params.listParamsBase.locationKey,
      siteKey: params.listParamsBase.siteKey
    });

  return {
    page: 1,
    pageSize: chunkSize,
    total: totalSum,
    rows: rowsWithDeco,
    ...(deltaRowsWithDeco !== undefined ? { deltaRows: deltaRowsWithDeco } : {}),
    resources,
    leaderboardFooterChipsByPartKey
  };
}
