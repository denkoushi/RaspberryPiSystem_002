import { resolveSiteKeyForScopeKey } from '../../../lib/site-directory.js';
import { SEIBAN_MACHINE_NAME_UNREGISTERED_LABEL } from '../constants.js';
import { resolveSeibanMachineDisplayNamesBatched } from '../seiban-machine-display-names.service.js';
import {
  assembleLoadBalancingWorkspace,
  assembleLoadBalancingWorkspaceDay
} from './load-balancing-workspace.assembler.js';
import type {
  LoadBalancingWorkspaceDayResult,
  LoadBalancingWorkspaceResult
} from './load-balancing-workspace.types.js';
import {
  buildWorkCalendarModeMap,
  listLoadBalancingCapacityBaseResolved,
  listLoadBalancingClassesResolved,
  listLoadBalancingMonthlyCapacityRangeResolved,
  listLoadBalancingTransferRulesResolved,
  listLoadBalancingWorkCalendarsResolved
} from './load-balancing-settings.service.js';
import { fetchLoadBalancingWinnerRowIds } from './load-balancing-winner-row-ids.js';
import { resolveMonthlyAvailableMinutes } from './load-distribution.js';
import { listStartDateLevelingQueryRows } from './start-date-leveling-query.service.js';
import { DEFAULT_WORK_CALENDAR_MODE, parseUtcDateKey } from './work-calendar-policy.js';
import { parseYearMonthRangeInclusive } from './year-month-range.js';

const MAX_WORKSPACE_MONTHS = 12;

/** 工場の「今日」（JST 暦日）を UTC 0 時の Date で返す。行の日付と同じ表現。 */
export function resolveLoadBalancingToday(now: Date = new Date()): Date {
  const dateKey = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(now);
  return parseUtcDateKey(dateKey);
}

export async function getProductionScheduleLoadBalancingWorkspace(params: {
  siteKeyInput: string;
  deviceScopeKey: string;
  fromMonth: string;
  toMonth: string;
  now?: Date;
}): Promise<LoadBalancingWorkspaceResult> {
  const range = parseYearMonthRangeInclusive({
    fromMonth: params.fromMonth,
    toMonth: params.toMonth,
    maxMonths: MAX_WORKSPACE_MONTHS
  });
  const siteKey = resolveSiteKeyForScopeKey(params.siteKeyInput.trim());
  const today = resolveLoadBalancingToday(params.now);

  const winnerRowIds = await fetchLoadBalancingWinnerRowIds();
  const [queryRows, baseCap, monthlyCap, classes, calendars, rules] = await Promise.all([
    listStartDateLevelingQueryRows({
      siteKey,
      deviceScopeKey: params.deviceScopeKey,
      rangeStart: range.rangeStart,
      rangeEndExclusive: range.rangeEndExclusive,
      includeOverdueBefore: today,
      winnerRowIds
    }),
    listLoadBalancingCapacityBaseResolved(siteKey),
    listLoadBalancingMonthlyCapacityRangeResolved({
      siteKeyInput: siteKey,
      fromMonth: range.fromMonth,
      toMonth: range.toMonth
    }),
    listLoadBalancingClassesResolved(siteKey),
    listLoadBalancingWorkCalendarsResolved(siteKey),
    listLoadBalancingTransferRulesResolved(siteKey)
  ]);

  const fseibans = [...new Set(queryRows.map((row) => row.fseiban).filter((value) => value.length > 0))];
  const { machineNames } = await resolveSeibanMachineDisplayNamesBatched(fseibans);

  return assembleLoadBalancingWorkspace({
    siteKey: baseCap.siteKey,
    today,
    fromMonth: range.fromMonth,
    toMonth: range.toMonth,
    months: range.months,
    queryRows,
    machineNameByFseiban: (fseiban) => machineNames[fseiban] || SEIBAN_MACHINE_NAME_UNREGISTERED_LABEL,
    baseCapacity: new Map(baseCap.items.map((item) => [item.resourceCd, item.baseAvailableMinutes])),
    monthlyCapacityByMonth: new Map(
      range.months.map((yearMonth) => [
        yearMonth,
        new Map((monthlyCap.itemsByMonth[yearMonth] ?? []).map((item) => [item.resourceCd, item.availableMinutes]))
      ])
    ),
    classByResource: new Map(classes.items.map((item) => [item.resourceCd, item.classCode])),
    calendarByResource: buildWorkCalendarModeMap(calendars.items),
    transferRules: rules.items
      .filter((rule) => rule.enabled && rule.efficiencyRatio > 0)
      .map(({ fromClassCode, toClassCode, priority, efficiencyRatio }) => ({
        fromClassCode,
        toClassCode,
        priority,
        efficiencyRatio
      }))
  });
}

export async function getProductionScheduleLoadBalancingWorkspaceDay(params: {
  siteKeyInput: string;
  deviceScopeKey: string;
  month: string;
  resourceCd: string;
  now?: Date;
}): Promise<LoadBalancingWorkspaceDayResult> {
  const range = parseYearMonthRangeInclusive({ fromMonth: params.month, toMonth: params.month, maxMonths: 1 });
  const siteKey = resolveSiteKeyForScopeKey(params.siteKeyInput.trim());
  const resourceCd = params.resourceCd.trim().toUpperCase();
  const today = resolveLoadBalancingToday(params.now);

  const winnerRowIds = await fetchLoadBalancingWinnerRowIds();
  const [queryRows, baseCap, monthlyCap, calendars] = await Promise.all([
    listStartDateLevelingQueryRows({
      siteKey,
      deviceScopeKey: params.deviceScopeKey,
      rangeStart: range.rangeStart,
      rangeEndExclusive: range.rangeEndExclusive,
      resourceCdFilter: resourceCd,
      winnerRowIds
    }),
    listLoadBalancingCapacityBaseResolved(siteKey),
    listLoadBalancingMonthlyCapacityRangeResolved({
      siteKeyInput: siteKey,
      fromMonth: range.fromMonth,
      toMonth: range.toMonth
    }),
    listLoadBalancingWorkCalendarsResolved(siteKey)
  ]);

  return assembleLoadBalancingWorkspaceDay({
    siteKey: baseCap.siteKey,
    today,
    month: range.fromMonth,
    resourceCd,
    queryRows,
    workCalendarMode: buildWorkCalendarModeMap(calendars.items).get(resourceCd) ?? DEFAULT_WORK_CALENDAR_MODE,
    monthlyCapacityMinutes: resolveMonthlyAvailableMinutes({
      resourceCd,
      yearMonth: range.fromMonth,
      baseMap: new Map(baseCap.items.map((item) => [item.resourceCd, item.baseAvailableMinutes])),
      monthlyMap: new Map(
        (monthlyCap.itemsByMonth[range.fromMonth] ?? []).map((item) => [item.resourceCd, item.availableMinutes])
      )
    })
  });
}
