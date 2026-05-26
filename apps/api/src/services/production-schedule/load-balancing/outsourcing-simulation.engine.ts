import type {
  OutsourcingAppliedRow,
  OutsourcingCandidateItem,
  OutsourcingEngineInput,
  OutsourcingEngineResource,
  OutsourcingSimulateSummary,
  OutsourcingSkippedRow
} from './outsourcing-simulation.types.js';
import type { LoadBalancingRowCandidate } from './types.js';

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

function isRowInOverFilter(row: LoadBalancingRowCandidate, overResourceCds?: Set<string>): boolean {
  if (!overResourceCds || overResourceCds.size === 0) {
    return true;
  }
  return overResourceCds.has(row.resourceCd);
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
  const remainingOverMinutes = afterResources.reduce((sum, resource) => sum + resource.overMinutes, 0);

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
