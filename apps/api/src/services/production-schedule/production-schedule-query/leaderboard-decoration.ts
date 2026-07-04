import { prisma } from '../../../lib/prisma.js';
import { enrichProductionScheduleRowsWithResolvedMachineName } from '../production-schedule-machine-name-enrichment.service.js';
import { enrichProductionScheduleRowsWithCustomerName } from '../production-schedule-customer-name-enrichment.service.js';
import { buildLeaderboardFooterChipsByPartKeyForScheduleRows } from '../leaderboard/leaderboard-part-footer-processes.service.js';
import {
  SelfInspectionService,
} from '../../part-measurement/self-inspection.service.js';
import type { LeaderboardPartFooterProcessItem } from '../leaderboard/leaderboard-part-footer-processes.service.js';
import {
  fetchLeaderboardScheduleHydratedRowsOrderedByDisplayItemIds,
} from '../leaderboard/leaderboard-split-expansion.service.js';
import { normalizeLeaderboardDisplayRowIdScope } from '../leaderboard/leaderboard-display-row-scope.js';
import { resolveLeaderboardMaterializedBaseWhereWithGenerationCache } from '../leaderboard/leaderboard-materialized-winner-cache.js';
import {
  getResourceCategoryPolicy,
  resolvePartMeasurementProcessGroupForApi,
} from '../policies/resource-category-policy.service.js';
import type {
  ProductionScheduleListResult,
  ProductionScheduleRow,
  ProductionScheduleSelfInspectionStatus,
} from './types.js';

/** 既に hydrate 済みの shell 行へ kiosk 向け装飾のみ適用（compose continue で二重 hydrate を避ける） */
export async function decorateLeaderboardShellRowsForKioskFromHydratedRows(params: {
  hydratedRows: ProductionScheduleRow[];
  locationKey: string;
  siteKey?: string;
  /**
   * 装飾対象の表示スコープ rowId（省略時は hydrate 済み行の id から導出）。
   * shell/board のリクエスト境界とフッタ winner 選定を揃えるために渡す。
   */
  preferredDisplayRowIds?: readonly string[];
}): Promise<ProductionScheduleLeaderboardDecorationPayload> {
  const { hydratedRows, locationKey, siteKey, preferredDisplayRowIds } = params;

  const preferredFooterScope =
    preferredDisplayRowIds !== undefined
      ? normalizeLeaderboardDisplayRowIdScope(preferredDisplayRowIds)
      : normalizeLeaderboardDisplayRowIdScope(hydratedRows.map((r) => r.id));

  if (hydratedRows.length === 0) {
    return {
      rowDecorations: [],
      leaderboardFooterChipsByPartKey: {}
    };
  }

  const lightRows = hydratedRows.map((r) => ({
    ...r,
    actualPerPieceMinutes: null as number | null,
    customerName: null as string | null
  }));

  const rowsWithResolvedMachineName = await enrichProductionScheduleRowsWithResolvedMachineName(lightRows);
  const enrichedRows = await enrichProductionScheduleRowsWithCustomerName(rowsWithResolvedMachineName);
  const selfInspectionService = new SelfInspectionService();
  const selfInspectionDecorations = await selfInspectionService.buildLeaderboardDecorations(enrichedRows, {
    siteKey
  });
  const selfInspectionById = new Map(selfInspectionDecorations.map((row) => [row.id, row]));

  const leaderboardFooterChipsByPartKey = await buildLeaderboardFooterChipsByPartKeyForScheduleRows({
    rows: enrichedRows,
    locationKey,
    siteKey,
    preferredDisplayRowIds: preferredFooterScope
  });

  return {
    rowDecorations: enrichedRows.map((r) => ({
      id: r.id,
      resolvedMachineName: r.resolvedMachineName ?? null,
      customerName: r.customerName ?? null,
      hasSelfInspectionDrawing: selfInspectionById.get(r.id)?.hasSelfInspectionDrawing ?? false,
      selfInspectionTemplateId: selfInspectionById.get(r.id)?.selfInspectionTemplateId ?? null,
      selfInspectionStatus: selfInspectionById.get(r.id)?.selfInspectionStatus ?? null,
      selfInspectionEntryPath: selfInspectionById.get(r.id)?.selfInspectionEntryPath ?? null
    })),
    leaderboardFooterChipsByPartKey: leaderboardFooterChipsByPartKey ?? {}
  };
}

/** rowIds 順で leaderboard 選定クエリと同形の行を hydrate し、装飾用ペイロードを返す */
export async function decorateLeaderboardShellRowsForKiosk(params: {
  orderedRowIds: string[];
  locationKey: string;
  siteKey?: string;
}): Promise<ProductionScheduleLeaderboardDecorationPayload> {
  const { orderedRowIds, locationKey, siteKey } = params;

  const preferredDisplayRowIds = normalizeLeaderboardDisplayRowIdScope(orderedRowIds);

  if (preferredDisplayRowIds.length === 0) {
    return {
      rowDecorations: [],
      leaderboardFooterChipsByPartKey: {}
    };
  }

  const leaderboardMaterializedBaseWhere =
    await resolveLeaderboardMaterializedBaseWhereWithGenerationCache(prisma);

  const rawRows = await fetchLeaderboardScheduleHydratedRowsOrderedByDisplayItemIds({
    orderedDisplayItemIds: preferredDisplayRowIds,
    locationKey,
    siteScopedGlobalRankLocation: siteKey?.trim().length ? siteKey.trim() : locationKey,
    leaderboardMaterializedBaseWhere
  });

  const lightRows = rawRows.map((r) => ({
    ...r,
    actualPerPieceMinutes: null as number | null,
    customerName: null as string | null
  }));

  return decorateLeaderboardShellRowsForKioskFromHydratedRows({
    hydratedRows: lightRows,
    locationKey,
    siteKey,
    preferredDisplayRowIds
  });
}

export type ProductionScheduleLeaderboardDecorationPayload = {
  rowDecorations: Array<{
    id: string;
    resolvedMachineName: string | null;
    customerName: string | null;
    hasSelfInspectionDrawing: boolean;
    selfInspectionTemplateId: string | null;
    selfInspectionStatus: ProductionScheduleSelfInspectionStatus | null;
    selfInspectionEntryPath: string | null;
  }>;
  leaderboardFooterChipsByPartKey: Record<string, LeaderboardPartFooterProcessItem[]>;
};

export async function enrichLeaderboardListRowsAndFooter(params: {
  page: number;
  pageSize: number;
  total: number;
  rows: ProductionScheduleRow[];
  locationKey: string;
  siteKey: string | undefined;
}): Promise<ProductionScheduleListResult> {
  const { page, pageSize, total, rows, locationKey, siteKey } = params;

  const lightRows = rows.map((row) => ({
    ...row,
    actualPerPieceMinutes: null as number | null
  }));

  const rowsWithResolvedMachineName = await enrichProductionScheduleRowsWithResolvedMachineName(lightRows);
  const enrichedRows = await enrichProductionScheduleRowsWithCustomerName(rowsWithResolvedMachineName);
  const resourcePolicy = await getResourceCategoryPolicy({ siteKey });
  const rowsWithProcessGroup = enrichedRows.map((row) => {
    const rowData = (row.rowData ?? {}) as Record<string, unknown>;
    const resourceCd = typeof rowData.FSIGENCD === 'string' ? rowData.FSIGENCD.trim() : '';
    return {
      ...row,
      partMeasurementProcessGroup: resourceCd
        ? resolvePartMeasurementProcessGroupForApi(resourceCd, resourcePolicy)
        : undefined
    };
  });

  const selfInspectionService = new SelfInspectionService();
  const selfInspectionByRowId = new Map(
    (
      await selfInspectionService.buildLeaderboardDecorations(
        rowsWithProcessGroup.map((row) => ({
          id: row.id,
          rowData: row.rowData,
          plannedQuantity: row.plannedQuantity
        })),
        { siteKey }
      )
    ).map((decoration) => [decoration.id, decoration])
  );
  const rowsWithSelfInspection = rowsWithProcessGroup.map((row) => {
    const decoration = selfInspectionByRowId.get(row.id);
    return {
      ...row,
      hasSelfInspectionDrawing: decoration?.hasSelfInspectionDrawing ?? false,
      selfInspectionTemplateId: decoration?.selfInspectionTemplateId ?? null,
      selfInspectionStatus: decoration?.selfInspectionStatus ?? null,
      selfInspectionEntryPath: decoration?.selfInspectionEntryPath ?? null
    };
  });

  const leaderboardFooterChipsByPartKey = await buildLeaderboardFooterChipsByPartKeyForScheduleRows({
    rows: rowsWithSelfInspection,
    locationKey,
    siteKey,
    preferredDisplayRowIds: normalizeLeaderboardDisplayRowIdScope(rowsWithSelfInspection.map((r) => r.id))
  });

  return {
    page,
    pageSize,
    total,
    rows: rowsWithSelfInspection,
    ...(leaderboardFooterChipsByPartKey ? { leaderboardFooterChipsByPartKey } : {})
  };
}
