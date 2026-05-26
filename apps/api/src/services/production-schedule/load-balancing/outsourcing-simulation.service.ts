import { normalizeProductionScheduleResourceCd } from '../policies/resource-category-policy.service.js';
import { getProductionScheduleLoadBalancingOverview } from './load-balancing-overview.service.js';
import { listMonthlyLoadRowCandidates } from './monthly-load-query.service.js';
import {
  listOutsourcingCandidates,
  simulateOutsourcingSelection
} from './outsourcing-simulation.engine.js';
import type {
  OutsourcingCandidatesResult,
  OutsourcingSimulateResult
} from './outsourcing-simulation.types.js';

function normalizeOverResourceCds(overResourceCds?: string[]): Set<string> | undefined {
  if (!overResourceCds || overResourceCds.length === 0) {
    return undefined;
  }
  const normalized = new Set(
    overResourceCds
      .map((cd) => normalizeProductionScheduleResourceCd(cd))
      .filter((cd) => cd.length > 0)
  );
  return normalized.size > 0 ? normalized : undefined;
}

export async function getProductionScheduleOutsourcingCandidates(params: {
  siteKey: string;
  deviceScopeKey: string;
  yearMonth: string;
  overResourceCds?: string[];
  maxCandidates?: number;
}): Promise<OutsourcingCandidatesResult> {
  const [overview, rows] = await Promise.all([
    getProductionScheduleLoadBalancingOverview(params),
    listMonthlyLoadRowCandidates(params)
  ]);

  const overFilter = normalizeOverResourceCds(params.overResourceCds);
  const candidates = listOutsourcingCandidates({
    resources: overview.resources,
    rows,
    overResourceCds: overFilter,
    maxCandidates: params.maxCandidates ?? 100
  });

  return {
    siteKey: overview.siteKey,
    yearMonth: overview.yearMonth,
    mode: 'outsourcing',
    resources: overview.resources,
    candidates
  };
}

export async function simulateProductionScheduleOutsourcing(params: {
  siteKey: string;
  deviceScopeKey: string;
  yearMonth: string;
  overResourceCds?: string[];
  selectedRowIds: string[];
}): Promise<OutsourcingSimulateResult> {
  const [overview, rows] = await Promise.all([
    getProductionScheduleLoadBalancingOverview(params),
    listMonthlyLoadRowCandidates(params)
  ]);

  const overFilter = normalizeOverResourceCds(params.overResourceCds);
  const allowedRowIds =
    overFilter == null
      ? undefined
      : new Set(rows.filter((row) => overFilter.has(row.resourceCd)).map((row) => row.rowId));

  const selectedRowIds: string[] = [];
  const preSkipped: OutsourcingSimulateResult['skippedRows'] = [];
  for (const rawRowId of params.selectedRowIds) {
    const rowId = rawRowId.trim();
    if (rowId.length === 0) continue;
    if (allowedRowIds != null && !allowedRowIds.has(rowId)) {
      preSkipped.push({ rowId, reason: 'outside_over_resource_filter' });
      continue;
    }
    selectedRowIds.push(rowId);
  }

  const simulation = simulateOutsourcingSelection({
    resources: overview.resources,
    rows,
    selectedRowIds
  });

  return {
    siteKey: overview.siteKey,
    yearMonth: overview.yearMonth,
    mode: 'outsourcing',
    beforeResources: simulation.beforeResources,
    afterResources: simulation.afterResources,
    appliedRows: simulation.appliedRows,
    skippedRows: [...preSkipped, ...simulation.skippedRows],
    summary: {
      ...simulation.summary,
      selectedCount: params.selectedRowIds.length,
      skippedCount: preSkipped.length + simulation.skippedRows.length
    }
  };
}
