import { resolveSiteKeyForScopeKey } from '../../../lib/site-directory.js';
import { SEIBAN_MACHINE_NAME_UNREGISTERED_LABEL } from '../constants.js';
import { createGrindingPlanningBoardPerformance } from '../grinding-planning-board-performance.js';
import { readGrindingPlanningBoardSnapshotGenerationToken } from '../leaderboard/leaderboard-shell-snapshot-generation.js';
import { resolveSeibanMachineDisplayNamesBatched } from '../seiban-machine-display-names.service.js';
import {
  buildLoadBalancingWorkspaceSourceKey,
  readLoadBalancingWorkspaceSourceWithCache,
  type LoadBalancingWorkspaceSource
} from './load-balancing-workspace-source-cache.js';
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
import { DEFAULT_WORK_CALENDAR_MODE, formatUtcDateKey, parseUtcDateKey } from './work-calendar-policy.js';
import { parseYearMonthRangeInclusive } from './year-month-range.js';

const MAX_WORKSPACE_MONTHS = 12;

type Performance = ReturnType<typeof createGrindingPlanningBoardPerformance>;

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

/**
 * 表示範囲の未完了工程行と機種名。順位ボード・製番ボードと同じ世代トークンが
 * 変わらない間は保存済みを返す（CSV 取込・進捗・完了・納期の更新で世代が変わる）。
 */
async function readWorkspaceSource(params: {
  siteKey: string;
  deviceScopeKey: string;
  range: ReturnType<typeof parseYearMonthRangeInclusive>;
  today: Date;
  perf: Performance;
}): Promise<{ source: LoadBalancingWorkspaceSource; cacheHit: boolean }> {
  const generationToken = await params.perf.measure('generation', () => readGrindingPlanningBoardSnapshotGenerationToken());
  return readLoadBalancingWorkspaceSourceWithCache({
    key: buildLoadBalancingWorkspaceSourceKey({
      siteKey: params.siteKey,
      deviceScopeKey: params.deviceScopeKey,
      fromMonth: params.range.fromMonth,
      toMonth: params.range.toMonth,
      today: formatUtcDateKey(params.today)
    }),
    generationToken,
    load: async () => {
      const winnerRowIds = await params.perf.measure('winnerRowIds', () => fetchLoadBalancingWinnerRowIds());
      const queryRows = await params.perf.measure('queryRows', () =>
        listStartDateLevelingQueryRows({
          siteKey: params.siteKey,
          deviceScopeKey: params.deviceScopeKey,
          rangeStart: params.range.rangeStart,
          rangeEndExclusive: params.range.rangeEndExclusive,
          includeOverdueBefore: params.today,
          winnerRowIds
        })
      );
      const fseibans = [...new Set(queryRows.map((row) => row.fseiban).filter((value) => value.length > 0))];
      const { machineNames } = await params.perf.measure('machineNames', () =>
        resolveSeibanMachineDisplayNamesBatched(fseibans)
      );
      return { queryRows, machineNames };
    }
  });
}

export async function getProductionScheduleLoadBalancingWorkspace(params: {
  siteKeyInput: string;
  deviceScopeKey: string;
  fromMonth: string;
  toMonth: string;
  now?: Date;
}): Promise<LoadBalancingWorkspaceResult> {
  const perf = createGrindingPlanningBoardPerformance('load-balancing-workspace');
  const range = parseYearMonthRangeInclusive({
    fromMonth: params.fromMonth,
    toMonth: params.toMonth,
    maxMonths: MAX_WORKSPACE_MONTHS
  });
  const siteKey = resolveSiteKeyForScopeKey(params.siteKeyInput.trim());
  const today = resolveLoadBalancingToday(params.now);

  const [{ source, cacheHit }, baseCap, monthlyCap, classes, calendars, rules] = await Promise.all([
    readWorkspaceSource({ siteKey, deviceScopeKey: params.deviceScopeKey, range, today, perf }),
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

  const result = await perf.measure('assemble', async () =>
    assembleLoadBalancingWorkspace({
      siteKey: baseCap.siteKey,
      today,
      fromMonth: range.fromMonth,
      toMonth: range.toMonth,
      months: range.months,
      queryRows: source.queryRows,
      machineNameByFseiban: (fseiban) => source.machineNames[fseiban] || SEIBAN_MACHINE_NAME_UNREGISTERED_LABEL,
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
    })
  );
  perf.flush({ cacheHit, queryRowCount: source.queryRows.length, rowCount: result.rows.length });
  return result;
}

export async function getProductionScheduleLoadBalancingWorkspaceDay(params: {
  siteKeyInput: string;
  deviceScopeKey: string;
  month: string;
  resourceCd: string;
  /** 画面の表示範囲。渡されて month を含むとき、ワークスペースと同じ保存済み元データを使う */
  fromMonth?: string;
  toMonth?: string;
  now?: Date;
}): Promise<LoadBalancingWorkspaceDayResult> {
  const perf = createGrindingPlanningBoardPerformance('load-balancing-workspace-day');
  const monthRange = parseYearMonthRangeInclusive({ fromMonth: params.month, toMonth: params.month, maxMonths: 1 });
  const siteKey = resolveSiteKeyForScopeKey(params.siteKeyInput.trim());
  const resourceCd = params.resourceCd.trim().toUpperCase();
  const today = resolveLoadBalancingToday(params.now);

  const viewRange =
    params.fromMonth && params.toMonth && params.fromMonth <= monthRange.fromMonth && monthRange.fromMonth <= params.toMonth
      ? parseYearMonthRangeInclusive({ fromMonth: params.fromMonth, toMonth: params.toMonth, maxMonths: MAX_WORKSPACE_MONTHS })
      : null;

  const readRows = async () => {
    if (viewRange) {
      const { source } = await readWorkspaceSource({ siteKey, deviceScopeKey: params.deviceScopeKey, range: viewRange, today, perf });
      return source.queryRows;
    }
    const winnerRowIds = await perf.measure('winnerRowIds', () => fetchLoadBalancingWinnerRowIds());
    return perf.measure('queryRows', () =>
      listStartDateLevelingQueryRows({
        siteKey,
        deviceScopeKey: params.deviceScopeKey,
        rangeStart: monthRange.rangeStart,
        rangeEndExclusive: monthRange.rangeEndExclusive,
        resourceCdFilter: resourceCd,
        winnerRowIds
      })
    );
  };

  const [queryRows, baseCap, monthlyCap, calendars] = await Promise.all([
    readRows(),
    listLoadBalancingCapacityBaseResolved(siteKey),
    listLoadBalancingMonthlyCapacityRangeResolved({
      siteKeyInput: siteKey,
      fromMonth: monthRange.fromMonth,
      toMonth: monthRange.toMonth
    }),
    listLoadBalancingWorkCalendarsResolved(siteKey)
  ]);

  const result = assembleLoadBalancingWorkspaceDay({
    siteKey: baseCap.siteKey,
    today,
    month: monthRange.fromMonth,
    resourceCd,
    queryRows,
    workCalendarMode: buildWorkCalendarModeMap(calendars.items).get(resourceCd) ?? DEFAULT_WORK_CALENDAR_MODE,
    monthlyCapacityMinutes: resolveMonthlyAvailableMinutes({
      resourceCd,
      yearMonth: monthRange.fromMonth,
      baseMap: new Map(baseCap.items.map((item) => [item.resourceCd, item.baseAvailableMinutes])),
      monthlyMap: new Map(
        (monthlyCap.itemsByMonth[monthRange.fromMonth] ?? []).map((item) => [item.resourceCd, item.availableMinutes])
      )
    })
  });
  perf.flush({ sharedSource: viewRange != null, dayRowCount: result.rowDays.length });
  return result;
}
