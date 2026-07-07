import {
  allocateRowToSingleDay,
  distributeRowLoadEvenly,
  resolveDailyAvailableMinutes,
  resolveMonthlyAvailableMinutes,
  type DailyAllocation,
  type RowLoadInput
} from './load-distribution.js';
import {
  buildWorkCalendarModeMap,
  listLoadBalancingCapacityBaseResolved,
  listLoadBalancingMonthlyCapacityRangeResolved,
  listLoadBalancingWorkCalendarsResolved
} from './load-balancing-settings.service.js';
import type {
  StartDateLevelingAllocatedRow,
  StartDateLevelingCell,
  StartDateLevelingMoveInput,
  StartDateLevelingQueryRow,
  StartDateLevelingResourceSummary,
  StartDateLevelingResult,
  StartDateLevelingSimulatedMove,
  StartDateLevelingUnallocatedRow,
  StartDateLevelingUnallocatedReason
} from './start-date-leveling.types.js';
import {
  DEFAULT_WORK_CALENDAR_MODE,
  formatUtcDateKey,
  isActiveWorkDay,
  listActiveDaysInclusive,
  listActiveDayKeysInMonth,
  parseUtcDateKey
} from './work-calendar-policy.js';
import { formatYearMonthFromUtcDate, parseYearMonthRangeInclusive } from './year-month-range.js';

function resolveTotalMinutes(row: StartDateLevelingQueryRow): number | null {
  const requiredMinutes = Number(row.requiredMinutes ?? 0);
  if (!Number.isFinite(requiredMinutes) || requiredMinutes <= 0) {
    return null;
  }
  return requiredMinutes;
}

function toUnallocatedRow(
  row: StartDateLevelingQueryRow,
  reason: StartDateLevelingUnallocatedReason
): StartDateLevelingUnallocatedRow {
  return {
    rowId: row.rowId,
    fseiban: row.fseiban,
    productNo: row.productNo,
    fhincd: row.fhincd,
    fkojun: row.fkojun,
    resourceCd: row.resourceCd,
    reason,
    requiredMinutes: Number(row.requiredMinutes ?? 0)
  };
}

export async function assembleStartDateLevelingResult(params: {
  siteKeyInput: string;
  deviceScopeKey: string;
  fromMonth: string;
  toMonth: string;
  bucket: 'month' | 'day';
  focusMonth?: string | null;
  resourceCdFilter?: string | null;
  queryRows: StartDateLevelingQueryRow[];
  moves?: StartDateLevelingMoveInput[];
}): Promise<StartDateLevelingResult> {
  const range = parseYearMonthRangeInclusive({
    fromMonth: params.fromMonth,
    toMonth: params.toMonth,
    maxMonths: 12
  });
  const focusMonth =
    params.bucket === 'day' ? (params.focusMonth?.trim() || range.fromMonth) : null;

  const [baseCap, monthlyCapRange, calendarSettings] = await Promise.all([
    listLoadBalancingCapacityBaseResolved(params.siteKeyInput),
    listLoadBalancingMonthlyCapacityRangeResolved({
      siteKeyInput: params.siteKeyInput,
      fromMonth: params.fromMonth,
      toMonth: params.toMonth
    }),
    listLoadBalancingWorkCalendarsResolved(params.siteKeyInput)
  ]);

  const siteKey = baseCap.siteKey;
  const baseMap = new Map(baseCap.items.map((item) => [item.resourceCd, item.baseAvailableMinutes]));
  const monthlyMaps = new Map(
    range.months.map((yearMonth) => [
      yearMonth,
      new Map(
        (monthlyCapRange.itemsByMonth[yearMonth] ?? []).map((item) => [item.resourceCd, item.availableMinutes])
      )
    ])
  );
  const calendarMap = buildWorkCalendarModeMap(calendarSettings.items);

  const allocatedRows: StartDateLevelingAllocatedRow[] = [];
  const unallocatedRows: StartDateLevelingUnallocatedRow[] = [];
  const rowLoads = new Map<string, RowLoadInput>();

  for (const row of params.queryRows) {
    if (!row.plannedStartDate) {
      unallocatedRows.push(toUnallocatedRow(row, 'missing_planned_start_date'));
      continue;
    }
    if (!row.effectiveDueDate) {
      unallocatedRows.push(toUnallocatedRow(row, 'missing_effective_due_date'));
      continue;
    }
    const totalMinutes = resolveTotalMinutes(row);
    if (totalMinutes == null) {
      unallocatedRows.push(toUnallocatedRow(row, 'zero_required_minutes'));
      continue;
    }

    const workCalendarMode = calendarMap.get(row.resourceCd) ?? DEFAULT_WORK_CALENDAR_MODE;
    const activeDays = listActiveDaysInclusive(
      row.plannedStartDate,
      row.effectiveDueDate,
      workCalendarMode
    );
    if (activeDays.length === 0) {
      unallocatedRows.push(toUnallocatedRow(row, 'no_active_days'));
      continue;
    }
    const loadInput: RowLoadInput = {
      rowId: row.rowId,
      resourceCd: row.resourceCd,
      totalMinutes,
      plannedStartDate: row.plannedStartDate,
      effectiveDueDate: row.effectiveDueDate
    };
    rowLoads.set(row.rowId, loadInput);
    allocatedRows.push({
      rowId: row.rowId,
      fseiban: row.fseiban,
      productNo: row.productNo,
      fhincd: row.fhincd,
      fkojun: row.fkojun,
      resourceCd: row.resourceCd,
      totalMinutes,
      plannedStartDate: formatUtcDateKey(row.plannedStartDate),
      effectiveDueDate: formatUtcDateKey(row.effectiveDueDate),
      workCalendarMode
    });
  }

  const moveMap = new Map<string, string>();
  for (const move of params.moves ?? []) {
    moveMap.set(move.rowId.trim(), move.targetDate.trim());
  }

  const dailyAllocations: DailyAllocation[] = [];
  const simulatedMoves: StartDateLevelingSimulatedMove[] = [];

  for (const allocated of allocatedRows) {
    const load = rowLoads.get(allocated.rowId);
    if (!load) continue;
    const workCalendarMode = calendarMap.get(load.resourceCd) ?? DEFAULT_WORK_CALENDAR_MODE;
    const targetDateKey = moveMap.get(allocated.rowId);
    if (targetDateKey) {
      const targetDate = parseUtcDateKey(targetDateKey);
      if (!isActiveWorkDay(targetDate, workCalendarMode)) {
        throw new Error(`移動先 ${targetDateKey} は資源 ${load.resourceCd} の稼働日ではありません`);
      }
      const baseDistribution = distributeRowLoadEvenly({ row: load, workCalendarMode });
      dailyAllocations.push(...allocateRowToSingleDay({ row: load, targetDate }));
      simulatedMoves.push({
        rowId: load.rowId,
        targetDate: targetDateKey,
        resourceCd: load.resourceCd,
        movedMinutes: load.totalMinutes,
        fromDateKeys: [...new Set(baseDistribution.map((item) => item.dateKey))].sort()
      });
      continue;
    }
    dailyAllocations.push(...distributeRowLoadEvenly({ row: load, workCalendarMode }));
  }

  const dailyTotalsByDateResource = new Map<string, number>();
  for (const allocation of dailyAllocations) {
    const key = `${allocation.dateKey}\t${allocation.resourceCd}`;
    dailyTotalsByDateResource.set(key, (dailyTotalsByDateResource.get(key) ?? 0) + allocation.minutes);
  }

  const resourceSet = new Set<string>();
  for (const allocation of dailyAllocations) {
    resourceSet.add(allocation.resourceCd);
  }
  for (const row of allocatedRows) {
    resourceSet.add(row.resourceCd);
  }

  const cells: StartDateLevelingCell[] = [];
  const requiredByResource = new Map<string, number>();

  if (params.bucket === 'month') {
    for (const yearMonth of range.months) {
      const monthlyMap = monthlyMaps.get(yearMonth) ?? new Map<string, number>();
      const resourceTotals = new Map<string, number>();
      for (const allocation of dailyAllocations) {
        if (allocation.yearMonth !== yearMonth) continue;
        resourceTotals.set(
          allocation.resourceCd,
          (resourceTotals.get(allocation.resourceCd) ?? 0) + allocation.minutes
        );
      }
      for (const resourceCd of resourceSet) {
        const requiredMinutes = resourceTotals.get(resourceCd) ?? 0;
        const availableMinutes = resolveMonthlyAvailableMinutes({
          resourceCd,
          yearMonth,
          baseMap,
          monthlyMap
        });
        const effectiveAvailable = availableMinutes ?? 0;
        const overMinutes = Math.max(0, requiredMinutes - effectiveAvailable);
        cells.push({
          resourceCd,
          bucketKey: yearMonth,
          requiredMinutes,
          availableMinutes,
          overMinutes
        });
        requiredByResource.set(resourceCd, (requiredByResource.get(resourceCd) ?? 0) + requiredMinutes);
      }
    }
  } else if (focusMonth) {
    const allDayKeys = new Set<string>();
    const activeDayKeysByResource = new Map<string, Set<string>>();
    for (const resourceCd of resourceSet) {
      const mode = calendarMap.get(resourceCd) ?? DEFAULT_WORK_CALENDAR_MODE;
      const activeDayKeys = new Set(listActiveDayKeysInMonth(focusMonth, mode));
      activeDayKeysByResource.set(resourceCd, activeDayKeys);
      for (const dayKey of activeDayKeys) {
        allDayKeys.add(dayKey);
      }
    }
    const sortedDays = [...allDayKeys].sort((a, b) => a.localeCompare(b));
    const monthlyMap = monthlyMaps.get(focusMonth) ?? new Map<string, number>();

    for (const dateKey of sortedDays) {
      const yearMonth = formatYearMonthFromUtcDate(parseUtcDateKey(dateKey));
      if (yearMonth !== focusMonth) continue;
      for (const resourceCd of resourceSet) {
        const workCalendarMode = calendarMap.get(resourceCd) ?? DEFAULT_WORK_CALENDAR_MODE;
        if (!activeDayKeysByResource.get(resourceCd)?.has(dateKey)) {
          continue;
        }
        const requiredMinutes = dailyTotalsByDateResource.get(`${dateKey}\t${resourceCd}`) ?? 0;
        const monthlyAvailable = resolveMonthlyAvailableMinutes({
          resourceCd,
          yearMonth: focusMonth,
          baseMap,
          monthlyMap
        });
        const availableMinutes = resolveDailyAvailableMinutes({
          monthlyAvailableMinutes: monthlyAvailable,
          yearMonth: focusMonth,
          workCalendarMode
        });
        const effectiveAvailable = availableMinutes ?? 0;
        const overMinutes = Math.max(0, requiredMinutes - effectiveAvailable);
        cells.push({
          resourceCd,
          bucketKey: dateKey,
          requiredMinutes,
          availableMinutes,
          overMinutes
        });
        requiredByResource.set(resourceCd, (requiredByResource.get(resourceCd) ?? 0) + requiredMinutes);
      }
    }
  }

  const resources: StartDateLevelingResourceSummary[] = [...resourceSet]
    .sort((a, b) => a.localeCompare(b))
    .map((resourceCd) => {
      const requiredMinutes = requiredByResource.get(resourceCd) ?? 0;
      let availableMinutes: number | null = null;
      if (params.bucket === 'month') {
        let totalAvail = 0;
        let hasAny = false;
        for (const yearMonth of range.months) {
          const monthlyMap = monthlyMaps.get(yearMonth) ?? new Map<string, number>();
          const avail = resolveMonthlyAvailableMinutes({
            resourceCd,
            yearMonth,
            baseMap,
            monthlyMap
          });
          if (avail != null) {
            hasAny = true;
            totalAvail += avail;
          }
        }
        availableMinutes = hasAny ? totalAvail : null;
      } else if (focusMonth) {
        const monthlyMap = monthlyMaps.get(focusMonth) ?? new Map<string, number>();
        availableMinutes = resolveMonthlyAvailableMinutes({
          resourceCd,
          yearMonth: focusMonth,
          baseMap,
          monthlyMap
        });
      }
      const effectiveAvailable = availableMinutes ?? 0;
      return {
        resourceCd,
        workCalendarMode: calendarMap.get(resourceCd) ?? DEFAULT_WORK_CALENDAR_MODE,
        requiredMinutes,
        availableMinutes,
        overMinutes: Math.max(0, requiredMinutes - effectiveAvailable)
      };
    });

  const days =
    params.bucket === 'day' && focusMonth
      ? [
          ...new Set(
            cells
              .map((cell) => cell.bucketKey)
              .filter((key) => /^\d{4}-\d{2}-\d{2}$/.test(key))
          )
        ].sort()
      : [];

  return {
    siteKey,
    fromMonth: range.fromMonth,
    toMonth: range.toMonth,
    bucket: params.bucket,
    focusMonth,
    months: range.months,
    days,
    resources,
    cells: cells.sort((a, b) => {
      const bucket = a.bucketKey.localeCompare(b.bucketKey);
      if (bucket !== 0) return bucket;
      return a.resourceCd.localeCompare(b.resourceCd);
    }),
    allocatedRows,
    unallocatedRows,
    calendarSettings: calendarSettings.items,
    simulatedMoves
  };
}
