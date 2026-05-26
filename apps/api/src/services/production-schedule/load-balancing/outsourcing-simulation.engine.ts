import type {
  ExternalizationCandidate,
  ExternalizationCandidateImpact,
  ExternalizationPlanResult,
  ExternalizationPlanStrategy,
  ExternalizationReplacementOption,
  ExternalizationReplacementResult,
  OutsourcingAppliedRow,
  OutsourcingCandidateItem,
  OutsourcingEngineInput,
  OutsourcingEngineResource,
  OutsourcingSimulateSummary,
  OutsourcingSkippedCandidate,
  OutsourcingSkippedRow
} from './outsourcing-simulation.types.js';
import type { LoadBalancingRowCandidate } from './types.js';

const PART_CANDIDATE_SEP = '\u001f';

export function buildPartCandidateId(fseiban: string, productNo: string, fhincd: string): string {
  return [fseiban.trim(), productNo.trim(), fhincd.trim()].join(PART_CANDIDATE_SEP);
}

function cloneResources(resources: OutsourcingEngineResource[]): OutsourcingEngineResource[] {
  return resources.map((resource) => ({ ...resource }));
}

function computeOverMinutes(requiredMinutes: number, availableMinutes: number | null): number {
  const effectiveAvailable = availableMinutes ?? 0;
  return Math.max(0, requiredMinutes - effectiveAvailable);
}

function refreshOverMinutes(resources: OutsourcingEngineResource[]): void {
  for (const resource of resources) {
    resource.overMinutes = computeOverMinutes(resource.requiredMinutes, resource.availableMinutes);
  }
}

function buildOverMap(resources: OutsourcingEngineResource[]): Map<string, number> {
  return new Map(resources.map((resource) => [resource.resourceCd, resource.overMinutes]));
}

function computeRemainingOverMinutes(
  resources: OutsourcingEngineResource[],
  targetOverResourceCds?: Set<string>
): number {
  if (!targetOverResourceCds || targetOverResourceCds.size === 0) {
    return resources.reduce((sum, resource) => sum + resource.overMinutes, 0);
  }
  return resources.reduce((sum, resource) => {
    if (!targetOverResourceCds.has(resource.resourceCd)) {
      return sum;
    }
    return sum + resource.overMinutes;
  }, 0);
}

function isRowInOverFilter(row: LoadBalancingRowCandidate, overResourceCds?: Set<string>): boolean {
  if (!overResourceCds || overResourceCds.size === 0) {
    return true;
  }
  return overResourceCds.has(row.resourceCd);
}

function hasCompletePartKey(row: LoadBalancingRowCandidate): boolean {
  return row.fseiban.trim().length > 0 && row.productNo.trim().length > 0 && row.fhincd.trim().length > 0;
}

function listOperationsWithCurrentOverImpact(
  operations: LoadBalancingRowCandidate[],
  overMap: Map<string, number>,
  overResourceCds?: Set<string>
): LoadBalancingRowCandidate[] {
  return operations.filter((row) => {
    if (!isRowInOverFilter(row, overResourceCds)) return false;
    return (overMap.get(row.resourceCd) ?? 0) > 0 && row.requiredMinutes > 0;
  });
}

function compareCandidates(a: OutsourcingCandidateItem, b: OutsourcingCandidateItem): number {
  if (b.overReductionMinutes !== a.overReductionMinutes) {
    return b.overReductionMinutes - a.overReductionMinutes;
  }
  if (b.rowMinutes !== a.rowMinutes) {
    return b.rowMinutes - a.rowMinutes;
  }
  const seiban = a.fseiban.localeCompare(b.fseiban);
  if (seiban !== 0) return seiban;
  return a.fhincd.localeCompare(b.fhincd);
}

function comparePartCandidates(a: ExternalizationCandidate, b: ExternalizationCandidate): number {
  if (b.totalOverReductionMinutes !== a.totalOverReductionMinutes) {
    return b.totalOverReductionMinutes - a.totalOverReductionMinutes;
  }
  if (a.operations.length !== b.operations.length) {
    return a.operations.length - b.operations.length;
  }
  if (a.totalReducedMinutes !== b.totalReducedMinutes) {
    return a.totalReducedMinutes - b.totalReducedMinutes;
  }
  return a.candidateId.localeCompare(b.candidateId);
}

function buildImpactByResource(
  operations: LoadBalancingRowCandidate[],
  overMap: Map<string, number>
): ExternalizationCandidateImpact[] {
  const reducedByResource = new Map<string, number>();
  for (const row of operations) {
    reducedByResource.set(
      row.resourceCd,
      (reducedByResource.get(row.resourceCd) ?? 0) + row.requiredMinutes
    );
  }

  const impacts: ExternalizationCandidateImpact[] = [];
  for (const [resourceCd, reducedMinutes] of reducedByResource) {
    const sourceOver = overMap.get(resourceCd) ?? 0;
    impacts.push({
      resourceCd,
      reducedMinutes,
      overReductionMinutes: Math.min(reducedMinutes, sourceOver)
    });
  }
  return impacts.sort((a, b) => a.resourceCd.localeCompare(b.resourceCd));
}

export function buildExternalizationCandidates(params: {
  resources: OutsourcingEngineResource[];
  rows: LoadBalancingRowCandidate[];
  overResourceCds?: Set<string>;
  maxCandidates?: number;
}): ExternalizationCandidate[] {
  const overMap = buildOverMap(params.resources);
  const grouped = new Map<string, LoadBalancingRowCandidate[]>();

  for (const row of params.rows) {
    if (!hasCompletePartKey(row) || row.requiredMinutes <= 0) continue;

    const candidateId = buildPartCandidateId(row.fseiban, row.productNo, row.fhincd);
    const list = grouped.get(candidateId) ?? [];
    list.push(row);
    grouped.set(candidateId, list);
  }

  const candidates: ExternalizationCandidate[] = [];
  for (const [candidateId, operations] of grouped) {
    const sortedOps = [...operations].sort((a, b) => a.rowId.localeCompare(b.rowId));
    const impactOps = listOperationsWithCurrentOverImpact(sortedOps, overMap, params.overResourceCds);
    if (impactOps.length === 0) continue;
    const first = sortedOps[0]!;
    const impactByResource = buildImpactByResource(impactOps, overMap);
    const totalReducedMinutes = sortedOps.reduce((sum, row) => sum + row.requiredMinutes, 0);
    const totalOverReductionMinutes = impactByResource.reduce(
      (sum, impact) => sum + impact.overReductionMinutes,
      0
    );
    const resolvesOverResourceCds = impactByResource
      .filter((impact) => impact.overReductionMinutes > 0)
      .map((impact) => impact.resourceCd);

    candidates.push({
      candidateId,
      fseiban: first.fseiban,
      productNo: first.productNo,
      fhincd: first.fhincd,
      fhinmei: sortedOps.find((row) => row.fhinmei.length > 0)?.fhinmei ?? '',
      operations: sortedOps,
      impactByResource,
      totalReducedMinutes,
      totalOverReductionMinutes,
      resolvesOverResourceCds
    });
  }

  const maxCandidates = params.maxCandidates ?? candidates.length;
  return candidates.sort(comparePartCandidates).slice(0, maxCandidates);
}

export function listOutsourcingCandidates(params: OutsourcingEngineInput): OutsourcingCandidateItem[] {
  const overMap = buildOverMap(params.resources);
  const maxCandidates = params.maxCandidates ?? 100;
  const candidates: OutsourcingCandidateItem[] = [];

  for (const row of params.rows) {
    if (!isRowInOverFilter(row, params.overResourceCds)) continue;
    const sourceOver = overMap.get(row.resourceCd) ?? 0;
    if (sourceOver <= 0 || row.requiredMinutes <= 0) continue;

    candidates.push({
      rowId: row.rowId,
      fseiban: row.fseiban,
      productNo: row.productNo,
      fhincd: row.fhincd,
      fkojun: row.fkojun,
      resourceCd: row.resourceCd,
      rowMinutes: row.requiredMinutes,
      overReductionMinutes: Math.min(row.requiredMinutes, sourceOver)
    });
  }

  return candidates.sort(compareCandidates).slice(0, maxCandidates);
}

export function simulateOutsourcingSelection(params: {
  resources: OutsourcingEngineResource[];
  rows: LoadBalancingRowCandidate[];
  selectedRowIds: string[];
}): {
  beforeResources: OutsourcingEngineResource[];
  afterResources: Array<OutsourcingEngineResource & { reducedMinutes: number }>;
  appliedRows: OutsourcingAppliedRow[];
  skippedRows: OutsourcingSkippedRow[];
  summary: OutsourcingSimulateSummary;
} {
  const beforeResources = cloneResources(params.resources);
  const afterResources = cloneResources(params.resources);
  const rowMap = new Map(params.rows.map((row) => [row.rowId, row]));
  const resourceIndex = new Map(afterResources.map((resource, index) => [resource.resourceCd, index]));
  const appliedRows: OutsourcingAppliedRow[] = [];
  const skippedRows: OutsourcingSkippedRow[] = [];
  const seenRowIds = new Set<string>();

  for (const rawRowId of params.selectedRowIds) {
    const rowId = rawRowId.trim();
    if (rowId.length === 0) continue;

    if (seenRowIds.has(rowId)) {
      skippedRows.push({ rowId, reason: 'duplicate' });
      continue;
    }
    seenRowIds.add(rowId);

    const row = rowMap.get(rowId);
    if (!row) {
      skippedRows.push({ rowId, reason: 'not_found' });
      continue;
    }
    if (row.requiredMinutes <= 0) {
      skippedRows.push({ rowId, reason: 'zero_minutes' });
      continue;
    }

    const resourceIdx = resourceIndex.get(row.resourceCd);
    if (resourceIdx == null) {
      skippedRows.push({ rowId, reason: 'resource_not_in_overview' });
      continue;
    }

    const resource = afterResources[resourceIdx]!;
    resource.requiredMinutes = Math.max(0, resource.requiredMinutes - row.requiredMinutes);
    refreshOverMinutes(afterResources);

    appliedRows.push({
      rowId: row.rowId,
      fseiban: row.fseiban,
      productNo: row.productNo,
      fhincd: row.fhincd,
      fkojun: row.fkojun,
      resourceCd: row.resourceCd,
      rowMinutes: row.requiredMinutes,
      reducedMinutes: row.requiredMinutes
    });
  }

  const totalReducedMinutes = appliedRows.reduce((sum, row) => sum + row.rowMinutes, 0);
  const remainingOverMinutes = computeRemainingOverMinutes(afterResources);

  return {
    beforeResources,
    afterResources: afterResources.map((resource) => {
      const before = beforeResources.find((item) => item.resourceCd === resource.resourceCd);
      const reducedMinutes = Math.max(0, (before?.requiredMinutes ?? 0) - resource.requiredMinutes);
      return { ...resource, reducedMinutes };
    }),
    appliedRows,
    skippedRows,
    summary: {
      selectedCount: params.selectedRowIds.length,
      appliedCount: appliedRows.length,
      skippedCount: skippedRows.length,
      totalReducedMinutes,
      remainingOverMinutes
    }
  };
}

export function buildCandidateIdToRowIdsMap(
  partCandidates: ExternalizationCandidate[]
): Map<string, string[]> {
  return new Map(
    partCandidates.map((candidate) => [
      candidate.candidateId,
      candidate.operations.map((operation) => operation.rowId)
    ])
  );
}

export function simulateExternalizationSelection(params: {
  resources: OutsourcingEngineResource[];
  rows: LoadBalancingRowCandidate[];
  partCandidates: ExternalizationCandidate[];
  selectedCandidateIds: string[];
  overResourceCds?: Set<string>;
}): {
  beforeResources: OutsourcingEngineResource[];
  afterResources: Array<OutsourcingEngineResource & { reducedMinutes: number }>;
  appliedRows: OutsourcingAppliedRow[];
  skippedRows: OutsourcingSkippedRow[];
  skippedCandidates: OutsourcingSkippedCandidate[];
  summary: OutsourcingSimulateSummary;
} {
  const candidateMap = new Map(params.partCandidates.map((c) => [c.candidateId, c]));
  const allowedRowIds =
    params.overResourceCds == null || params.overResourceCds.size === 0
      ? undefined
      : new Set(
          params.rows.filter((row) => params.overResourceCds!.has(row.resourceCd)).map((row) => row.rowId)
        );

  const selectedRowIds: string[] = [];
  const skippedCandidates: OutsourcingSkippedCandidate[] = [];
  const seenCandidateIds = new Set<string>();

  for (const rawCandidateId of params.selectedCandidateIds) {
    const candidateId = rawCandidateId.trim();
    if (candidateId.length === 0) continue;

    if (seenCandidateIds.has(candidateId)) {
      skippedCandidates.push({ candidateId, reason: 'duplicate' });
      continue;
    }
    seenCandidateIds.add(candidateId);

    const candidate = candidateMap.get(candidateId);
    if (!candidate) {
      skippedCandidates.push({ candidateId, reason: 'not_found' });
      continue;
    }
    if (candidate.operations.length === 0) {
      skippedCandidates.push({ candidateId, reason: 'no_operations' });
      continue;
    }

    const rowIds = candidate.operations.map((op) => op.rowId);
    if (allowedRowIds != null && !rowIds.some((rowId) => allowedRowIds.has(rowId))) {
      skippedCandidates.push({ candidateId, reason: 'outside_over_resource_filter' });
      continue;
    }

    selectedRowIds.push(...rowIds);
  }

  const simulation = simulateOutsourcingSelection({
    resources: params.resources,
    rows: params.rows,
    selectedRowIds
  });

  return {
    ...simulation,
    skippedCandidates,
    summary: {
      ...simulation.summary,
      selectedCount: params.selectedCandidateIds.length,
      skippedCount: skippedCandidates.length + simulation.skippedRows.length
    }
  };
}

function isTargetOverResolved(
  resources: OutsourcingEngineResource[],
  targetOverResourceCds?: Set<string>
): boolean {
  if (!targetOverResourceCds || targetOverResourceCds.size === 0) {
    return resources.every((resource) => resource.overMinutes <= 0);
  }
  return [...targetOverResourceCds].every((cd) => {
    const resource = resources.find((item) => item.resourceCd === cd);
    return (resource?.overMinutes ?? 0) <= 0;
  });
}

function computePartCandidateEffect(params: {
  resources: OutsourcingEngineResource[];
  candidate: ExternalizationCandidate;
  overResourceCds?: Set<string>;
}): ExternalizationCandidate {
  const overMap = buildOverMap(params.resources);
  const impactOperations = listOperationsWithCurrentOverImpact(
    params.candidate.operations,
    overMap,
    params.overResourceCds
  );
  const impactByResource = buildImpactByResource(impactOperations, overMap);
  const totalReducedMinutes = params.candidate.operations.reduce((sum, row) => sum + row.requiredMinutes, 0);
  const totalOverReductionMinutes = impactByResource.reduce(
    (sum, impact) => sum + impact.overReductionMinutes,
    0
  );
  return {
    ...params.candidate,
    impactByResource,
    totalReducedMinutes,
    totalOverReductionMinutes,
    resolvesOverResourceCds: impactByResource
      .filter((impact) => impact.overReductionMinutes > 0)
      .map((impact) => impact.resourceCd)
  };
}

export function computeExternalizationPlan(params: {
  resources: OutsourcingEngineResource[];
  rows: LoadBalancingRowCandidate[];
  overResourceCds?: Set<string>;
  strategy?: ExternalizationPlanStrategy;
  maxIterations?: number;
}): ExternalizationPlanResult {
  const strategy = params.strategy ?? 'max_over_reduction';
  if (strategy !== 'max_over_reduction') {
    throw new Error(`未対応の strategy です: ${strategy}`);
  }

  const beforeResources = cloneResources(params.resources);
  let currentResources = cloneResources(params.resources);
  const allPartCandidates = buildExternalizationCandidates({
    resources: beforeResources,
    rows: params.rows,
    overResourceCds: params.overResourceCds,
    maxCandidates: 500
  });

  const selectedCandidateIds: string[] = [];
  const appliedRowIds = new Set<string>();
  const maxIterations = params.maxIterations ?? allPartCandidates.length;

  for (let iteration = 0; iteration < maxIterations; iteration += 1) {
    if (isTargetOverResolved(currentResources, params.overResourceCds)) {
      break;
    }

    const remainingCandidates = allPartCandidates
      .filter((candidate) => candidate.operations.some((op) => !appliedRowIds.has(op.rowId)))
      .map((candidate) =>
        computePartCandidateEffect({
          resources: currentResources,
          candidate,
          overResourceCds: params.overResourceCds
        })
      )
      .filter((candidate) => candidate.totalOverReductionMinutes > 0);

    if (remainingCandidates.length === 0) {
      break;
    }

    remainingCandidates.sort(comparePartCandidates);
    const pick = remainingCandidates[0]!;
    selectedCandidateIds.push(pick.candidateId);
    for (const op of pick.operations) {
      appliedRowIds.add(op.rowId);
    }

    const step = simulateOutsourcingSelection({
      resources: currentResources,
      rows: params.rows,
      selectedRowIds: pick.operations.map((op) => op.rowId)
    });
    currentResources = step.afterResources.map(
      ({ resourceCd, requiredMinutes, availableMinutes, overMinutes, classCode }) => ({
        resourceCd,
        requiredMinutes,
        availableMinutes,
        overMinutes,
        classCode
      })
    );
  }

  const finalSimulation = simulateOutsourcingSelection({
    resources: beforeResources,
    rows: params.rows,
    selectedRowIds: [...appliedRowIds]
  });

  const beforeOverTotal = computeRemainingOverMinutes(beforeResources, params.overResourceCds);
  const afterOverTotal = computeRemainingOverMinutes(finalSimulation.afterResources, params.overResourceCds);

  return {
    strategy,
    selectedCandidateIds,
    beforeResources,
    afterResources: finalSimulation.afterResources,
    resolved: isTargetOverResolved(finalSimulation.afterResources, params.overResourceCds),
    remainingOverMinutes: computeRemainingOverMinutes(finalSimulation.afterResources, params.overResourceCds),
    totalReducedMinutes: finalSimulation.summary.totalReducedMinutes,
    totalOverReductionMinutes: Math.max(0, beforeOverTotal - afterOverTotal)
  };
}

export function computeReplacementOptions(params: {
  resources: OutsourcingEngineResource[];
  rows: LoadBalancingRowCandidate[];
  overResourceCds?: Set<string>;
  currentSelectedCandidateIds: string[];
  removeCandidateId: string;
  maxOptions?: number;
}): ExternalizationReplacementResult {
  const removeId = params.removeCandidateId.trim();
  const baseSelectedCandidateIds = params.currentSelectedCandidateIds
    .map((id) => id.trim())
    .filter((id) => id.length > 0 && id !== removeId);

  const allPartCandidates = buildExternalizationCandidates({
    resources: params.resources,
    rows: params.rows,
    overResourceCds: params.overResourceCds,
    maxCandidates: 500
  });

  const selectedSet = new Set(baseSelectedCandidateIds);
  const options: ExternalizationReplacementOption[] = [];

  for (const candidate of allPartCandidates) {
    if (selectedSet.has(candidate.candidateId) || candidate.candidateId === removeId) {
      continue;
    }

    const trialIds = [...baseSelectedCandidateIds, candidate.candidateId];
    const trial = simulateExternalizationSelection({
      resources: params.resources,
      rows: params.rows,
      partCandidates: allPartCandidates,
      selectedCandidateIds: trialIds,
      overResourceCds: params.overResourceCds
    });

    options.push({
      candidateId: candidate.candidateId,
      fseiban: candidate.fseiban,
      productNo: candidate.productNo,
      fhincd: candidate.fhincd,
      fhinmei: candidate.fhinmei,
      afterResources: trial.afterResources,
      resolved: isTargetOverResolved(trial.afterResources, params.overResourceCds),
      remainingOverMinutes: computeRemainingOverMinutes(trial.afterResources, params.overResourceCds)
    });
  }

  options.sort((a, b) => {
    if (a.resolved !== b.resolved) return a.resolved ? -1 : 1;
    if (a.remainingOverMinutes !== b.remainingOverMinutes) {
      return a.remainingOverMinutes - b.remainingOverMinutes;
    }
    return a.candidateId.localeCompare(b.candidateId);
  });

  const maxOptions = params.maxOptions ?? 5;
  return {
    removeCandidateId: removeId,
    baseSelectedCandidateIds,
    replacementOptions: options.slice(0, maxOptions)
  };
}
