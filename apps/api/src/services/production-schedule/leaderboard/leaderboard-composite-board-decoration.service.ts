/**
 * 順位ボード composite board 応答の装飾合成（shell / continue）。
 * continue では増分行を中心に enrich し、prefix 行は hydrate+machine/customer のみ。フッタは merged light 行スコープ。
 */
import {
  decorateLeaderboardShellRowsForKiosk,
  decorateLeaderboardShellRowsForKioskFromHydratedRows,
  type LeaderboardShellPhasedReadResult
} from '../production-schedule-query.service.js';
import { enrichProductionScheduleRowsWithResolvedMachineName } from '../production-schedule-machine-name-enrichment.service.js';
import { enrichProductionScheduleRowsWithCustomerName } from '../production-schedule-customer-name-enrichment.service.js';
import { resolveLeaderboardMaterializedBaseWhere } from '../row-resolver/index.js';
import { prisma } from '../../../lib/prisma.js';
import { normalizeLeaderboardDisplayRowIdScope } from './leaderboard-display-row-scope.js';
import { fetchLeaderboardScheduleHydratedRowsOrderedByIds } from './leaderboard-shell-hydrate.service.js';
import { buildLeaderboardFooterChipsByPartKeyForScheduleRows } from './leaderboard-part-footer-processes.service.js';

type LightShellRow = LeaderboardShellPhasedReadResult['rows'][number];

type RowDecoration = {
  id: string;
  resolvedMachineName: string | null;
  customerName: string | null;
};

function applyRowDecorationsToLightRows(
  mergedLightRows: LightShellRow[],
  decoMap: Map<string, RowDecoration>
): LightShellRow[] {
  return mergedLightRows.map((r) => {
    const d = decoMap.get(r.id);
    return d
      ? {
          ...r,
          resolvedMachineName: d.resolvedMachineName ?? r.resolvedMachineName,
          customerName: d.customerName
        }
      : r;
  });
}

function rowDecorationsToMap(decorations: RowDecoration[]): Map<string, RowDecoration> {
  return new Map(decorations.map((d) => [d.id, d]));
}

/** 初回 shell GET 後の全行装飾（従来と同じ `decorateLeaderboardShellRowsForKiosk` 経路）。 */
export async function decorateLeaderboardCompositeBoardShell(params: {
  mergedLightRows: LightShellRow[];
  locationKey: string;
  siteKey?: string;
}): Promise<{
  rowsWithDeco: LightShellRow[];
  leaderboardFooterChipsByPartKey?: Record<string, unknown>;
}> {
  const deco = await decorateLeaderboardShellRowsForKiosk({
    orderedRowIds: params.mergedLightRows.map((r) => r.id),
    locationKey: params.locationKey,
    siteKey: params.siteKey
  });

  const decoMap = rowDecorationsToMap(deco.rowDecorations);
  return {
    rowsWithDeco: applyRowDecorationsToLightRows(params.mergedLightRows, decoMap),
    leaderboardFooterChipsByPartKey: deco.leaderboardFooterChipsByPartKey as Record<string, unknown>
  };
}

/** continue 後の装飾。delta 非付与時は累積全行を従来どおり一括装飾。 */
export async function decorateLeaderboardCompositeBoardContinue(params: {
  mergedLightRows: LightShellRow[];
  incrementalLightRows: LightShellRow[];
  canAttachDelta: boolean;
  deltaShellRowsFlattened: LightShellRow[];
  locationKey: string;
  siteKey?: string;
}): Promise<{
  rowsWithDeco: LightShellRow[];
  deltaRowsWithDeco?: LightShellRow[];
  leaderboardFooterChipsByPartKey?: Record<string, unknown>;
}> {
  const preferredDisplayRowIds = normalizeLeaderboardDisplayRowIdScope(
    params.mergedLightRows.map((r) => r.id)
  );

  if (!params.canAttachDelta) {
    const deco = await decorateLeaderboardShellRowsForKioskFromHydratedRows({
      hydratedRows: params.mergedLightRows,
      locationKey: params.locationKey,
      siteKey: params.siteKey,
      preferredDisplayRowIds
    });
    const decoMap = rowDecorationsToMap(deco.rowDecorations);
    const rowsWithDeco = applyRowDecorationsToLightRows(params.mergedLightRows, decoMap);
    return {
      rowsWithDeco,
      leaderboardFooterChipsByPartKey: deco.leaderboardFooterChipsByPartKey as Record<string, unknown>
    };
  }

  const incrementalIds = new Set(params.incrementalLightRows.map((r) => r.id));
  const prefixIds = params.mergedLightRows.map((r) => r.id).filter((id) => !incrementalIds.has(id));

  const incrementalDeco =
    params.incrementalLightRows.length > 0
      ? await decorateLeaderboardShellRowsForKioskFromHydratedRows({
          hydratedRows: params.incrementalLightRows,
          locationKey: params.locationKey,
          siteKey: params.siteKey,
          preferredDisplayRowIds
        })
      : { rowDecorations: [] as RowDecoration[] };

  const decoMap = rowDecorationsToMap(incrementalDeco.rowDecorations);

  if (prefixIds.length > 0) {
    const leaderboardMaterializedBaseWhere = await resolveLeaderboardMaterializedBaseWhere(prisma);
    const siteScoped =
      params.siteKey?.trim().length ? params.siteKey.trim() : params.locationKey;

    const prefixHydrated = await fetchLeaderboardScheduleHydratedRowsOrderedByIds({
      orderedRowIds: prefixIds,
      locationKey: params.locationKey,
      siteScopedGlobalRankLocation: siteScoped,
      leaderboardMaterializedBaseWhere
    });

    const lightPrefix = prefixHydrated.map((r) => ({
      ...r,
      actualPerPieceMinutes: null as number | null,
      customerName: null as string | null
    }));
    const withMachine = await enrichProductionScheduleRowsWithResolvedMachineName(lightPrefix);
    const withCustomer = await enrichProductionScheduleRowsWithCustomerName(withMachine);
    for (const r of withCustomer) {
      decoMap.set(r.id, {
        id: r.id,
        resolvedMachineName: r.resolvedMachineName ?? null,
        customerName: r.customerName ?? null
      });
    }
  }

  const leaderboardFooterChipsByPartKey = await buildLeaderboardFooterChipsByPartKeyForScheduleRows({
    rows: params.mergedLightRows,
    locationKey: params.locationKey,
    siteKey: params.siteKey,
    preferredDisplayRowIds
  });

  const rowsWithDeco = applyRowDecorationsToLightRows(params.mergedLightRows, decoMap);
  const decoRowById = new Map(rowsWithDeco.map((r) => [r.id, r]));
  const deltaRowsWithDeco =
    params.deltaShellRowsFlattened.length > 0
      ? params.deltaShellRowsFlattened.map((shell) => decoRowById.get(shell.id) ?? shell)
      : undefined;

  return {
    rowsWithDeco,
    ...(deltaRowsWithDeco !== undefined ? { deltaRowsWithDeco } : {}),
    leaderboardFooterChipsByPartKey: leaderboardFooterChipsByPartKey as Record<string, unknown>
  };
}
