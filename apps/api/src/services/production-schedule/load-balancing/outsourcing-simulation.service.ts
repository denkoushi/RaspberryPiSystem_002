import { ApiError } from '../../../lib/errors.js';
import { normalizeProductionScheduleResourceCd } from '../policies/resource-category-policy.service.js';
import { getProductionScheduleLoadBalancingOverview } from './load-balancing-overview.service.js';
import { listMonthlyLoadRowCandidates } from './monthly-load-query.service.js';
import {
  buildExternalizationCandidates,
  computeExternalizationPlan,
  computeReplacementOptions,
  listOutsourcingCandidates,
  simulateExternalizationSelection,
  simulateOutsourcingSelection
} from './outsourcing-simulation.engine.js';
import type {
  ExternalizationPlanResult,
  ExternalizationPlanStrategy,
  ExternalizationReplacementResult,
  OutsourcingCandidatesResult,
  OutsourcingSimulateResult
} from './outsourcing-simulation.types.js';

type LoadBalancingScopeParams = {
  siteKey: string;
  deviceScopeKey: string;
  yearMonth: string;
};

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

async function loadOverviewAndRows(params: LoadBalancingScopeParams & { overResourceCds?: string[] }) {
  const [overview, rows] = await Promise.all([
    getProductionScheduleLoadBalancingOverview(params),
    listMonthlyLoadRowCandidates(params)
  ]);
  const overFilter = normalizeOverResourceCds(params.overResourceCds);
  return { overview, rows, overFilter };
}

export async function getProductionScheduleOutsourcingCandidates(params: {
  siteKey: string;
  deviceScopeKey: string;
  yearMonth: string;
  overResourceCds?: string[];
  maxCandidates?: number;
}): Promise<OutsourcingCandidatesResult> {
  const { overview, rows, overFilter } = await loadOverviewAndRows(params);

  const candidates = listOutsourcingCandidates({
    resources: overview.resources,
    rows,
    overResourceCds: overFilter,
    maxCandidates: params.maxCandidates ?? 100
  });

  const externalizationCandidates = buildExternalizationCandidates({
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
    candidates,
    externalizationCandidates
  };
}

export async function getProductionScheduleOutsourcingPlan(params: {
  siteKey: string;
  deviceScopeKey: string;
  yearMonth: string;
  overResourceCds?: string[];
  strategy?: ExternalizationPlanStrategy;
}): Promise<ExternalizationPlanResult & { siteKey: string; yearMonth: string; mode: 'outsourcing' }> {
  const strategy = params.strategy ?? 'max_over_reduction';
  if (strategy !== 'max_over_reduction') {
    throw new ApiError(400, `未対応の strategy です: ${strategy}`);
  }

  const { overview, rows, overFilter } = await loadOverviewAndRows(params);
  const plan = computeExternalizationPlan({
    resources: overview.resources,
    rows,
    overResourceCds: overFilter,
    strategy
  });

  return {
    siteKey: overview.siteKey,
    yearMonth: overview.yearMonth,
    mode: 'outsourcing',
    ...plan
  };
}

export async function getProductionScheduleOutsourcingReplacements(params: {
  siteKey: string;
  deviceScopeKey: string;
  yearMonth: string;
  overResourceCds?: string[];
  currentSelectedCandidateIds: string[];
  removeCandidateId: string;
  maxOptions?: number;
}): Promise<ExternalizationReplacementResult & { siteKey: string; yearMonth: string; mode: 'outsourcing' }> {
  const { overview, rows, overFilter } = await loadOverviewAndRows(params);
  const replacements = computeReplacementOptions({
    resources: overview.resources,
    rows,
    overResourceCds: overFilter,
    currentSelectedCandidateIds: params.currentSelectedCandidateIds,
    removeCandidateId: params.removeCandidateId,
    maxOptions: params.maxOptions ?? 5
  });

  return {
    siteKey: overview.siteKey,
    yearMonth: overview.yearMonth,
    mode: 'outsourcing',
    ...replacements
  };
}

export async function simulateProductionScheduleOutsourcing(params: {
  siteKey: string;
  deviceScopeKey: string;
  yearMonth: string;
  overResourceCds?: string[];
  selectedRowIds?: string[];
  selectedCandidateIds?: string[];
}): Promise<OutsourcingSimulateResult> {
  const rowIds = params.selectedRowIds ?? [];
  const candidateIds = params.selectedCandidateIds ?? [];
  const hasRows = rowIds.length > 0;
  const hasCandidates = candidateIds.length > 0;

  if (hasRows && hasCandidates) {
    throw new ApiError(400, 'selectedRowIds と selectedCandidateIds は同時に指定できません');
  }
  if (!hasRows && !hasCandidates) {
    throw new ApiError(400, 'selectedRowIds または selectedCandidateIds を指定してください');
  }

  const { overview, rows, overFilter } = await loadOverviewAndRows(params);

  if (hasCandidates) {
    const partCandidates = buildExternalizationCandidates({
      resources: overview.resources,
      rows,
      overResourceCds: overFilter,
      maxCandidates: 500
    });

    const simulation = simulateExternalizationSelection({
      resources: overview.resources,
      rows,
      partCandidates,
      selectedCandidateIds: candidateIds,
      overResourceCds: overFilter
    });

    return {
      siteKey: overview.siteKey,
      yearMonth: overview.yearMonth,
      mode: 'outsourcing',
      beforeResources: simulation.beforeResources,
      afterResources: simulation.afterResources,
      appliedRows: simulation.appliedRows,
      skippedRows: simulation.skippedRows,
      skippedCandidates: simulation.skippedCandidates,
      summary: simulation.summary
    };
  }

  const allowedRowIds =
    overFilter == null
      ? undefined
      : new Set(rows.filter((row) => overFilter.has(row.resourceCd)).map((row) => row.rowId));

  const selectedRowIdsFiltered: string[] = [];
  const preSkipped: OutsourcingSimulateResult['skippedRows'] = [];
  for (const rawRowId of rowIds) {
    const rowId = rawRowId.trim();
    if (rowId.length === 0) continue;
    if (allowedRowIds != null && !allowedRowIds.has(rowId)) {
      preSkipped.push({ rowId, reason: 'outside_over_resource_filter' });
      continue;
    }
    selectedRowIdsFiltered.push(rowId);
  }

  const simulation = simulateOutsourcingSelection({
    resources: overview.resources,
    rows,
    selectedRowIds: selectedRowIdsFiltered
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
      selectedCount: rowIds.length,
      skippedCount: preSkipped.length + simulation.skippedRows.length
    }
  };
}
