import {
  formatUtcDateKey,
  listActiveDaysInclusive,
  type WorkCalendarMode
} from './work-calendar-policy.js';
import { formatYearMonthFromUtcDate } from './year-month-range.js';

export type RowLoadInput = {
  rowId: string;
  resourceCd: string;
  totalMinutes: number;
  plannedStartDate: Date;
  effectiveDueDate: Date;
};

export type DailyAllocation = {
  dateKey: string;
  yearMonth: string;
  resourceCd: string;
  minutes: number;
};

export function distributeRowLoadEvenly(params: {
  row: RowLoadInput;
  workCalendarMode: WorkCalendarMode;
}): DailyAllocation[] {
  const { row, workCalendarMode } = params;
  const activeDays = listActiveDaysInclusive(row.plannedStartDate, row.effectiveDueDate, workCalendarMode);
  if (activeDays.length === 0 || row.totalMinutes <= 0) {
    return [];
  }

  const perDay = row.totalMinutes / activeDays.length;
  return activeDays.map((day) => ({
    dateKey: formatUtcDateKey(day),
    yearMonth: formatYearMonthFromUtcDate(day),
    resourceCd: row.resourceCd,
    minutes: perDay
  }));
}

export function allocateRowToSingleDay(params: {
  row: RowLoadInput;
  targetDate: Date;
}): DailyAllocation[] {
  if (params.row.totalMinutes <= 0) {
    return [];
  }
  return [
    {
      dateKey: formatUtcDateKey(params.targetDate),
      yearMonth: formatYearMonthFromUtcDate(params.targetDate),
      resourceCd: params.row.resourceCd,
      minutes: params.row.totalMinutes
    }
  ];
}

export function mergeDailyAllocations(allocations: DailyAllocation[]): Map<string, number> {
  const totals = new Map<string, number>();
  for (const allocation of allocations) {
    const key = `${allocation.dateKey}\t${allocation.resourceCd}`;
    totals.set(key, (totals.get(key) ?? 0) + allocation.minutes);
  }
  return totals;
}

export function sumAllocationsByResourceMonth(allocations: DailyAllocation[]): Map<string, number> {
  const totals = new Map<string, number>();
  for (const allocation of allocations) {
    const key = `${allocation.yearMonth}\t${allocation.resourceCd}`;
    totals.set(key, (totals.get(key) ?? 0) + allocation.minutes);
  }
  return totals;
}

export function resolveMonthlyAvailableMinutes(params: {
  resourceCd: string;
  yearMonth: string;
  baseMap: Map<string, number>;
  monthlyMap: Map<string, number>;
}): number | null {
  if (params.monthlyMap.has(params.resourceCd)) {
    return params.monthlyMap.get(params.resourceCd)!;
  }
  if (params.baseMap.has(params.resourceCd)) {
    return params.baseMap.get(params.resourceCd)!;
  }
  return null;
}

export function resolveDailyAvailableMinutes(params: {
  monthlyAvailableMinutes: number | null;
  yearMonth: string;
  workCalendarMode: WorkCalendarMode;
}): number | null {
  if (params.monthlyAvailableMinutes == null) {
    return null;
  }
  const activeDays = listActiveDaysInclusive(
    parseMonthStartUtc(params.yearMonth),
    parseMonthEndUtc(params.yearMonth),
    params.workCalendarMode
  ).length;
  if (activeDays <= 0) {
    return null;
  }
  return params.monthlyAvailableMinutes / activeDays;
}

function parseMonthStartUtc(yearMonth: string): Date {
  const match = /^(\d{4})-(\d{2})$/.exec(yearMonth.trim());
  if (!match) {
    throw new Error('yearMonth は YYYY-MM 形式で指定してください');
  }
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, 1));
}

function parseMonthEndUtc(yearMonth: string): Date {
  const match = /^(\d{4})-(\d{2})$/.exec(yearMonth.trim());
  if (!match) {
    throw new Error('yearMonth は YYYY-MM 形式で指定してください');
  }
  const y = Number(match[1]);
  const m = Number(match[2]);
  return new Date(Date.UTC(y, m, 0));
}
