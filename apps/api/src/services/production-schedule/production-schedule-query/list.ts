import { prisma } from '../../../lib/prisma.js';
import { loadActualHoursReadContext } from '../actual-hours/actual-hours-read-context.service.js';
import { enrichProductionScheduleRowsWithResolvedMachineName } from '../production-schedule-machine-name-enrichment.service.js';
import { enrichProductionScheduleRowsWithCustomerName } from '../production-schedule-customer-name-enrichment.service.js';
import {
  fetchLeaderboardScheduleRowsWithSeibanAwarePriority,
} from '../leaderboard/leaderboard-row-selection.service.js';
import {
  expandLeaderboardParentRowsForResponse,
} from '../leaderboard/leaderboard-split-expansion.service.js';
import { resolveLeaderboardMaterializedBaseWhere } from '../row-resolver/index.js';
import {
  countProductionScheduleDashboardVisibleLeaderboardUnits,
  countProductionScheduleDashboardVisibleRows
} from '../production-schedule-list-count.service.js';
import { prepareProductionScheduleDashboardFilters } from './filters.js';
import { enrichLeaderboardListRowsAndFooter } from './leaderboard-decoration.js';
import {
  shouldExpandLeaderboardSeibanAcrossResources,
} from './leaderboard-shell.js';
import { fetchProductionScheduleDashboardRowsRawPage } from './raw-page.js';
import {
  listSelfInspectionEligibleProductionScheduleRows,
  toSelfInspectionEligibleListParams,
} from './self-inspection-eligible.js';
import type {
  ProductionScheduleListParams,
  ProductionScheduleListResult,
  ProductionScheduleRow,
} from './types.js';

export type { ProductionScheduleListResult } from './types.js';

export async function listProductionScheduleRows(params: ProductionScheduleListParams): Promise<ProductionScheduleListResult> {
  if (params.selfInspectionEligibleOnly) {
    return listSelfInspectionEligibleProductionScheduleRows(toSelfInspectionEligibleListParams(params));
  }

  const {
    page,
    pageSize,
    queryText,
    productNos,
    machineName,
    resourceCds,
    assignedOnlyCds,
    resourceCategory,
    hasNoteOnly,
    hasDueDateOnly,
    allowResourceOnly = false,
    locationKey,
    siteKey,
    responseProfile = 'full'
  } = params;
  const isLeaderboardProfile = responseProfile === 'leaderboard';

  const filters = await prepareProductionScheduleDashboardFilters({
    queryText,
    productNos,
    machineName,
    resourceCds,
    assignedOnlyCds,
    resourceCategory,
    hasNoteOnly,
    hasDueDateOnly,
    allowResourceOnly,
    locationKey,
    siteKey
  });

  if (filters.kind === 'blocked_empty_search') {
    return {
      page,
      pageSize,
      total: 0,
      rows: []
    };
  }

  const { baseWhere, queryWhere, leaderboardExpansionWhere, siteScopedGlobalRankLocation } = filters;

  const offset = (page - 1) * pageSize;

  const leaderboardMaterializedBaseWhere = isLeaderboardProfile
    ? await resolveLeaderboardMaterializedBaseWhere(prisma)
    : null;

  const leaderboardCountParams = {
    baseWhere: leaderboardMaterializedBaseWhere ?? baseWhere,
    queryWhere,
    hasDueDateOnly,
    completionFilter: params.completionFilter,
    processChangeResidualMode: params.processChangeResidualMode,
    processChangeResidualStrongEvidenceKeys: params.processChangeResidualStrongEvidenceKeys
  };

  const totalPromise = isLeaderboardProfile
    ? countProductionScheduleDashboardVisibleLeaderboardUnits(leaderboardCountParams)
    : countProductionScheduleDashboardVisibleRows({
        baseWhere,
        queryWhere,
        processChangeResidualMode: params.processChangeResidualMode,
        processChangeResidualStrongEvidenceKeys: params.processChangeResidualStrongEvidenceKeys
      });

  if (isLeaderboardProfile) {
    const leaderboardRowsPromise = fetchLeaderboardScheduleRowsWithSeibanAwarePriority({
      leaderboardMaterializedBaseWhere: leaderboardMaterializedBaseWhere!,
      queryWhere,
      expansionWhere: leaderboardExpansionWhere,
      locationKey,
      siteScopedGlobalRankLocation,
      pageSize,
      seibanExpansion: shouldExpandLeaderboardSeibanAcrossResources(resourceCds),
      completionFilter: params.completionFilter,
      processChangeResidualMode: params.processChangeResidualMode,
      processChangeResidualStrongEvidenceKeys: params.processChangeResidualStrongEvidenceKeys
    }).then(async (rawRows) =>
      expandLeaderboardParentRowsForResponse({
        rows: rawRows.map(
          (r): ProductionScheduleRow => ({
            ...r,
            actualPerPieceMinutes: null,
            customerName: null
          })
        ),
        locationKey,
        hasDueDateOnly
      })
    );

    const [totalBig, leaderboardRows] = await Promise.all([totalPromise, leaderboardRowsPromise]);

    return enrichLeaderboardListRowsAndFooter({
      page,
      pageSize,
      total: Number(totalBig),
      rows: leaderboardRows,
      locationKey,
      siteKey
    });
  }

  const rowsPromiseFull = fetchProductionScheduleDashboardRowsRawPage({
    baseWhere,
    queryWhere,
    locationKey,
    siteScopedGlobalRankLocation,
    offset,
    limit: pageSize
  });

  const [totalBig, fullRows] = await Promise.all([totalPromise, rowsPromiseFull]);
  const total = Number(totalBig);

  const rowResourceCds = fullRows
    .map((row) => {
      const rowData = (row.rowData ?? {}) as Record<string, unknown>;
      return typeof rowData.FSIGENCD === 'string' ? rowData.FSIGENCD.trim() : '';
    })
    .filter((resourceCd) => resourceCd.length > 0);
  const actualHoursReadContext = await loadActualHoursReadContext({
    locationKey,
    resourceCds: rowResourceCds
  });

  const rowsWithActualHours = fullRows.map((row) => {
    const rowData = (row.rowData ?? {}) as Record<string, unknown>;
    const fhincd = typeof rowData.FHINCD === 'string' ? rowData.FHINCD.trim() : '';
    const resourceCd = typeof rowData.FSIGENCD === 'string' ? rowData.FSIGENCD.trim() : '';
    const perPieceMinutes = actualHoursReadContext.resolver.resolve({ fhincd, resourceCd }).perPieceMinutes;
    return {
      ...row,
      actualPerPieceMinutes: perPieceMinutes
    };
  });
  const rowsWithResolvedMachineName = await enrichProductionScheduleRowsWithResolvedMachineName(rowsWithActualHours);
  const enrichedRows = await enrichProductionScheduleRowsWithCustomerName(rowsWithResolvedMachineName);

  return {
    page,
    pageSize,
    total,
    rows: enrichedRows
  };
}
