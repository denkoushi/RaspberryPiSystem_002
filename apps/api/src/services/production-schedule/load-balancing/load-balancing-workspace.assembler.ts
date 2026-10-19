import { distributeRowLoadEvenly, resolveMonthlyAvailableMinutes, type DailyAllocation } from './load-distribution.js';
import {
  LOAD_BALANCING_LATE_BUCKET,
  type LoadBalancingWorkspaceDayResult,
  type LoadBalancingWorkspaceResource,
  type LoadBalancingWorkspaceResult,
  type LoadBalancingWorkspaceRow,
  type LoadBalancingWorkspaceTransferRule
} from './load-balancing-workspace.types.js';
import type {
  StartDateLevelingQueryRow,
  StartDateLevelingUnallocatedReason,
  StartDateLevelingUnallocatedRow
} from './start-date-leveling.types.js';
import {
  DEFAULT_WORK_CALENDAR_MODE,
  formatUtcDateKey,
  listActiveDayKeysInMonth,
  type WorkCalendarMode
} from './work-calendar-policy.js';

/**
 * 未完了行の「残り」負荷の置き方。
 * - 有効納期が今日より前 → 納期遅れ（日割りしない）
 * - それ以外 → max(着手日, 今日)〜有効納期 の稼働日に均等日割り（過去日には置かない）
 */
export type RemainingRowLoad =
  | { kind: 'late'; minutes: number }
  | { kind: 'allocated'; daily: DailyAllocation[] }
  | { kind: 'unallocated'; reason: StartDateLevelingUnallocatedReason };

export function allocateRemainingRowLoad(params: {
  row: StartDateLevelingQueryRow;
  today: Date;
  workCalendarMode: WorkCalendarMode;
}): RemainingRowLoad {
  const { row, today } = params;
  if (!row.plannedStartDate) return { kind: 'unallocated', reason: 'missing_planned_start_date' };
  if (!row.effectiveDueDate) return { kind: 'unallocated', reason: 'missing_effective_due_date' };
  const totalMinutes = Number(row.requiredMinutes ?? 0);
  if (!Number.isFinite(totalMinutes) || totalMinutes <= 0) {
    return { kind: 'unallocated', reason: 'zero_required_minutes' };
  }
  if (row.effectiveDueDate.getTime() < today.getTime()) {
    return { kind: 'late', minutes: totalMinutes };
  }
  const start = row.plannedStartDate.getTime() < today.getTime() ? today : row.plannedStartDate;
  const daily = distributeRowLoadEvenly({
    row: {
      rowId: row.rowId,
      resourceCd: row.resourceCd,
      totalMinutes,
      plannedStartDate: start,
      effectiveDueDate: row.effectiveDueDate
    },
    workCalendarMode: params.workCalendarMode
  });
  if (daily.length === 0) return { kind: 'unallocated', reason: 'no_active_days' };
  return { kind: 'allocated', daily };
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

export function assembleLoadBalancingWorkspace(params: {
  siteKey: string;
  today: Date;
  fromMonth: string;
  toMonth: string;
  months: string[];
  queryRows: StartDateLevelingQueryRow[];
  machineNameByFseiban: (fseiban: string) => string;
  baseCapacity: Map<string, number>;
  monthlyCapacityByMonth: Map<string, Map<string, number>>;
  classByResource: Map<string, string>;
  calendarByResource: Map<string, WorkCalendarMode>;
  transferRules: LoadBalancingWorkspaceTransferRule[];
}): LoadBalancingWorkspaceResult {
  const monthSet = new Set(params.months);
  const rows: LoadBalancingWorkspaceRow[] = [];
  const unallocatedRows: StartDateLevelingUnallocatedRow[] = [];
  const resourceSet = new Set<string>();

  for (const queryRow of params.queryRows) {
    const workCalendarMode = params.calendarByResource.get(queryRow.resourceCd) ?? DEFAULT_WORK_CALENDAR_MODE;
    const load = allocateRemainingRowLoad({ row: queryRow, today: params.today, workCalendarMode });
    if (load.kind === 'unallocated') {
      unallocatedRows.push(toUnallocatedRow(queryRow, load.reason));
      continue;
    }

    const allocations =
      load.kind === 'late'
        ? [{ bucket: LOAD_BALANCING_LATE_BUCKET, minutes: load.minutes }]
        : [...sumByMonth(load.daily).entries()]
            .filter(([yearMonth]) => monthSet.has(yearMonth))
            .map(([bucket, minutes]) => ({ bucket, minutes }));
    if (allocations.length === 0) continue;

    resourceSet.add(queryRow.resourceCd);
    rows.push({
      rowId: queryRow.rowId,
      fseiban: queryRow.fseiban,
      productNo: queryRow.productNo,
      fhincd: queryRow.fhincd,
      fhinmei: queryRow.fhinmei ?? '',
      machineName: params.machineNameByFseiban(queryRow.fseiban),
      resourceCd: queryRow.resourceCd,
      totalMinutes: Number(queryRow.requiredMinutes),
      plannedStartDate: formatUtcDateKey(queryRow.plannedStartDate!),
      effectiveDueDate: formatUtcDateKey(queryRow.effectiveDueDate!),
      late: load.kind === 'late',
      allocations
    });
  }

  // 負荷がなくても能力・分類がある資源は移管先・能力編集の対象として出す
  params.baseCapacity.forEach((_value, resourceCd) => resourceSet.add(resourceCd));
  params.classByResource.forEach((_value, resourceCd) => resourceSet.add(resourceCd));
  params.monthlyCapacityByMonth.forEach((map) => map.forEach((_value, resourceCd) => resourceSet.add(resourceCd)));

  const resources: LoadBalancingWorkspaceResource[] = [...resourceSet]
    .sort((a, b) => a.localeCompare(b))
    .map((resourceCd) => ({
      resourceCd,
      classCode: params.classByResource.get(resourceCd) ?? null,
      workCalendarMode: params.calendarByResource.get(resourceCd) ?? DEFAULT_WORK_CALENDAR_MODE,
      baseCapacityMinutes: params.baseCapacity.get(resourceCd) ?? null,
      capacityByMonth: Object.fromEntries(
        params.months.map((yearMonth) => [
          yearMonth,
          resolveMonthlyAvailableMinutes({
            resourceCd,
            yearMonth,
            baseMap: params.baseCapacity,
            monthlyMap: params.monthlyCapacityByMonth.get(yearMonth) ?? new Map()
          })
        ])
      )
    }));

  return {
    siteKey: params.siteKey,
    today: formatUtcDateKey(params.today),
    fromMonth: params.fromMonth,
    toMonth: params.toMonth,
    months: params.months,
    resources,
    rows,
    unallocatedRows,
    transferRules: params.transferRules
  };
}

function sumByMonth(daily: DailyAllocation[]): Map<string, number> {
  const totals = new Map<string, number>();
  for (const allocation of daily) {
    totals.set(allocation.yearMonth, (totals.get(allocation.yearMonth) ?? 0) + allocation.minutes);
  }
  return totals;
}

/** 1 資源・1 か月の日別負荷（明細パネルの日別グラフ用） */
export function assembleLoadBalancingWorkspaceDay(params: {
  siteKey: string;
  today: Date;
  month: string;
  resourceCd: string;
  queryRows: StartDateLevelingQueryRow[];
  workCalendarMode: WorkCalendarMode;
  monthlyCapacityMinutes: number | null;
}): LoadBalancingWorkspaceDayResult {
  const activeDays = listActiveDayKeysInMonth(params.month, params.workCalendarMode);
  const totals = new Map(activeDays.map((date) => [date, 0]));
  const rowDays: LoadBalancingWorkspaceDayResult['rowDays'] = [];

  for (const queryRow of params.queryRows) {
    if (queryRow.resourceCd !== params.resourceCd) continue;
    const load = allocateRemainingRowLoad({
      row: queryRow,
      today: params.today,
      workCalendarMode: params.workCalendarMode
    });
    if (load.kind !== 'allocated') continue;
    for (const allocation of load.daily) {
      if (!totals.has(allocation.dateKey)) continue;
      totals.set(allocation.dateKey, (totals.get(allocation.dateKey) ?? 0) + allocation.minutes);
      rowDays.push({ rowId: queryRow.rowId, date: allocation.dateKey, minutes: allocation.minutes });
    }
  }

  return {
    siteKey: params.siteKey,
    month: params.month,
    resourceCd: params.resourceCd,
    capacityMinutesPerDay:
      params.monthlyCapacityMinutes == null || activeDays.length === 0
        ? null
        : params.monthlyCapacityMinutes / activeDays.length,
    days: activeDays.map((date) => ({ date, requiredMinutes: totals.get(date) ?? 0 })),
    rowDays
  };
}
