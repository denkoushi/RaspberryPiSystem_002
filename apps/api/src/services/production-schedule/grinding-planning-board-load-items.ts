import type { GrindingPlanningBoardLoad } from '@raspi-system/shared-types';
import type { GrindingPlanningBoardLoadSummary, GrindingPlanningBoardLoadSummaryRow, ReadGrindingPlanningBoardLoadSummaryParams } from './grinding-planning-board-load-summary.js';
import { missingStandardHoursItemId, type MissingStandardHoursBoardRow } from './missing-standard-hours-process.js';

export function addMinutes(
  entry: GrindingPlanningBoardLoad,
  field: 'originalRequiredMinutes' | 'alternateRequiredMinutes',
  minutes: number | null
): void {
  if (minutes == null) return;
  entry[field] = (entry[field] ?? 0) + minutes;
}

/**
 * Aggregates the load view from lightweight logical item summaries.
 *
 * The caller supplies all rows for the board, including unselected seiban. The
 * summary intentionally does not perform winner selection, category filtering,
 * completion resolution; those stay in the existing source pipeline.
 */
export function buildGrindingPlanningBoardLoadSummary(
  inputRows: readonly GrindingPlanningBoardLoadSummaryRow[]
): GrindingPlanningBoardLoadSummary {
  const rows: GrindingPlanningBoardLoadSummaryRow[] = [];
  const seen = new Set<string>();
  for (const row of inputRows) {
    const itemId = row.itemId.trim();
    if (!itemId || seen.has(itemId)) continue;
    seen.add(itemId);
    rows.push(row);
  }

  const byResource = new Map<string, GrindingPlanningBoardLoad>();
  let unknownRequiredMinutesCount = 0;

  const ensure = (resourceCd: string): GrindingPlanningBoardLoad => {
    const existing = byResource.get(resourceCd);
    if (existing) return existing;
    const created: GrindingPlanningBoardLoad = {
      resourceCd,
      originalItemCount: 0,
      alternateItemCount: 0,
      originalRequiredMinutes: null,
      alternateRequiredMinutes: null,
      unfinishedItemCount: 0,
      requiredMinutes: null,
      unknownItemCount: 0,
      originalUnknownItemCount: 0,
      alternateUnknownItemCount: 0
    };
    byResource.set(resourceCd, created);
    return created;
  };

  rows.sort((left, right) => left.sourceRowId < right.sourceRowId ? -1 : left.sourceRowId > right.sourceRowId ? 1
    : left.itemId < right.itemId ? -1 : left.itemId > right.itemId ? 1 : 0);
  for (const row of rows) {
    if (row.isCompleted) continue;
    const originalResource = row.originalResourceCd?.trim() || null;
    const alternateResource = row.effectiveResourceCd?.trim() || null;
    if (originalResource == null && alternateResource == null) continue;

    const unknown = !row.requiredMinutesKnown || row.requiredMinutes == null;
    if (unknown) unknownRequiredMinutesCount += 1;

    if (originalResource != null) {
      const originalEntry = ensure(originalResource);
      originalEntry.originalItemCount += 1;
      addMinutes(originalEntry, 'originalRequiredMinutes', row.requiredMinutes);
      if (unknown) originalEntry.originalUnknownItemCount += 1;
    }

    if (alternateResource != null) {
      const alternateEntry = ensure(alternateResource);
      alternateEntry.alternateItemCount += 1;
      alternateEntry.unfinishedItemCount += 1;
      addMinutes(alternateEntry, 'alternateRequiredMinutes', row.requiredMinutes);
      if (unknown) {
        alternateEntry.alternateUnknownItemCount += 1;
        alternateEntry.unknownItemCount += 1;
      }
    }
  }

  for (const entry of byResource.values()) {
    if (entry.originalItemCount === 0 && entry.originalUnknownItemCount === 0) {
      entry.originalRequiredMinutes = 0;
    }
    if (entry.alternateItemCount === 0 && entry.alternateUnknownItemCount === 0) {
      entry.alternateRequiredMinutes = 0;
    }
    entry.requiredMinutes = entry.alternateRequiredMinutes;
  }

  return {
    load: [...byResource.values()].sort((left, right) => left.resourceCd.localeCompare(right.resourceCd)),
    unknownRequiredMinutesCount
  };
}


export function addMissingStandardHoursLoad(summary: GrindingPlanningBoardLoadSummary, rows: readonly MissingStandardHoursBoardRow[],
  params: Pick<ReadGrindingPlanningBoardLoadSummaryParams, 'category' | 'isResourceInCategory' | 'excludedFseibans'>): GrindingPlanningBoardLoadSummary {
  const excluded = new Set(params.excludedFseibans ?? []);
  const missing = buildGrindingPlanningBoardLoadSummary(rows.filter((row) =>
    !excluded.has(String((row.rowData as Record<string, unknown>).FSEIBAN ?? '')) && params.isResourceInCategory(row.fkoteicd, params.category)
  ).map((row) => ({ itemId: missingStandardHoursItemId(row), sourceRowId: missingStandardHoursItemId(row), kind: 'row',
    originalResourceCd: row.fkoteicd, effectiveResourceCd: row.fkoteicd, requiredMinutes: null, requiredMinutesKnown: false, isCompleted: false })));
  const byResource = new Map(summary.load.map((row) => [row.resourceCd, { ...row }]));
  for (const row of missing.load) {
    const current = byResource.get(row.resourceCd);
    if (!current) { byResource.set(row.resourceCd, row); continue; }
    for (const field of ['originalItemCount', 'alternateItemCount', 'unfinishedItemCount', 'unknownItemCount', 'originalUnknownItemCount', 'alternateUnknownItemCount'] as const) current[field] += row[field];
    // No duration is added, including when the resource uses its own time settings.
  }
  return { load: [...byResource.values()].sort((a, b) => a.resourceCd.localeCompare(b.resourceCd)),
    unknownRequiredMinutesCount: summary.unknownRequiredMinutesCount + missing.unknownRequiredMinutesCount };
}
