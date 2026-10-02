import {
  computeSignalDayMetrics,
  countRunningByBin,
  decideSignalHint,
  SIGNAL_HINTS,
  type SignalDayMetrics,
  type SignalHint,
  type SignalPlannedWindow,
  type SignalThresholds,
} from './signal-metrics.js';
import type { MachineSignalSensorDto } from './machine-signal-settings.service.js';
import {
  SIGNAL_CATEGORIES,
  SIGNAL_DAY_SECONDS,
  type SignalSegmentTuple,
} from './signal-report.types.js';

const DAY_MINUTES = 1_440;
const TOP_LIST_SIZE = 4;
/** 悪化の比較に使う日数。直近 RECENT_DAYS 日と、その前の BASELINE_DAYS 日を比べる。 */
export const SIGNAL_TREND_RECENT_DAYS = 7;
export const SIGNAL_TREND_BASELINE_DAYS = 28;
const MIN_RECENT_RECORD_DAYS = 3;
const MIN_BASELINE_RECORD_DAYS = 7;
const MIN_BASELINE_RUN_SECONDS = 600;
const MIN_ALARM_INCREASE_PER_DAY = 3;
const MIN_SHORT_STOP_INCREASE_PER_DAY = 5;

export type SignalReportRow = {
  signalNo: number;
  reportDate: string;
  dayStartMinute: number;
  stateNames: string[];
  segments: SignalSegmentTuple[];
};

export type SignalMachineDay = {
  signalNo: number;
  name: string;
  sourceMachineName: string;
  site: string | null;
  kind: string;
  hint: SignalHint;
  hasRecord: boolean;
  /** [開始秒, 継続秒, 区分index（SIGNAL_CATEGORIES の順）] */
  timeline: Array<[number, number, number]>;
  categorySeconds: number[];
  runSeconds: number;
  runBlockCount: number;
  averageRunSeconds: number;
  longestRunSeconds: number;
  stopCount: number;
  shortStopCount: number;
  stopBuckets: SignalDayMetrics['stopBuckets'];
  longestStops: SignalDayMetrics['longestStops'];
  alarmCount: number;
  alarmSeconds: number;
  loss: SignalDayMetrics['loss'];
  estimatedKwh: number | null;
};

export type SignalWorseningKind = 'RUN_SHORTER' | 'ALARM_MORE' | 'SHORT_STOPS_MORE';

export type SignalWorsening = {
  signalNo: number;
  kind: SignalWorseningKind;
  /** 直近とその前の1日あたり平均（RUN_SHORTER は連続稼働の平均秒、他は回数） */
  recent: number;
  baseline: number;
};

export type SignalFleetDay = {
  machineCount: number;
  /** 全機械×24時間のうち稼働していた割合（0〜1） */
  runRatio: number;
  loss: SignalDayMetrics['loss'];
  /** 10分刻みの稼働台数 */
  runningBins: number[];
  dayAverage: number | null;
  nightAverage: number | null;
  hintCounts: Record<SignalHint, number>;
  estimatedKwh: number | null;
  topAlarm: number[];
  topShortStops: number[];
  topLongStop: number[];
  worsening: SignalWorsening[];
};

export type SignalTrendPoint = {
  reportDate: string;
  runSeconds: number;
  averageRunSeconds: number;
  stopCount: number;
  shortStopCount: number;
  alarmCount: number;
  alarmSeconds: number;
};

const offsetSeconds = (clockMinute: number, dayStartMinute: number) =>
  (((clockMinute - dayStartMinute) % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES * 60;

/** 稼働予定（時計の時刻）を、集計日の開始からの秒の区間へ直す。日をまたぐ予定は2区間になる。 */
export function toPlannedWindows(
  sensor: Pick<MachineSignalSensorDto, 'plannedStartMinute' | 'plannedEndMinute'>,
  dayStartMinute: number
): SignalPlannedWindow[] {
  if (sensor.plannedStartMinute === null || sensor.plannedEndMinute === null) return [];
  const start = offsetSeconds(sensor.plannedStartMinute, dayStartMinute);
  const end = offsetSeconds(sensor.plannedEndMinute, dayStartMinute);
  if (start === end) return [];
  if (start < end) return [{ startSecond: start, endSecond: end }];
  return [
    { startSecond: 0, endSecond: end },
    { startSecond: start, endSecond: SIGNAL_DAY_SECONDS },
  ].filter((window) => window.endSecond > window.startSecond);
}

function metricsOf(
  sensor: MachineSignalSensorDto,
  report: SignalReportRow | undefined,
  thresholds: SignalThresholds
): SignalDayMetrics {
  return computeSignalDayMetrics(
    {
      segments: report?.segments ?? [],
      stateNames: report?.stateNames ?? [],
      categoryOverrides: sensor.categoryOverrides,
      plannedWindows: toPlannedWindows(sensor, report?.dayStartMinute ?? 480),
      power: { runningKw: sensor.runningKw, idleKw: sensor.idleKw },
    },
    thresholds
  );
}

export function buildSignalMachineDay(
  sensor: MachineSignalSensorDto,
  report: SignalReportRow | undefined,
  thresholds: SignalThresholds
): SignalMachineDay {
  const metrics = metricsOf(sensor, report, thresholds);
  return {
    signalNo: sensor.signalNo,
    name: sensor.displayName ?? sensor.sourceMachineName,
    sourceMachineName: sensor.sourceMachineName,
    site: sensor.site,
    kind: sensor.kind,
    hint: decideSignalHint(metrics, thresholds),
    hasRecord: metrics.hasRecord,
    timeline: metrics.timeline.map((segment) => [
      segment.startSecond,
      segment.durationSeconds,
      SIGNAL_CATEGORIES.indexOf(segment.category),
    ]),
    categorySeconds: SIGNAL_CATEGORIES.map((category) => metrics.categorySeconds[category]),
    runSeconds: metrics.runSeconds,
    runBlockCount: metrics.runBlockCount,
    averageRunSeconds: metrics.averageRunSeconds,
    longestRunSeconds: metrics.longestRunSeconds,
    stopCount: metrics.stopCount,
    shortStopCount: metrics.shortStopCount,
    stopBuckets: metrics.stopBuckets,
    longestStops: metrics.longestStops,
    alarmCount: metrics.alarmCount,
    alarmSeconds: metrics.alarmSeconds,
    loss: metrics.loss,
    estimatedKwh: metrics.estimatedKwh,
  };
}

export function buildSignalTrendPoint(
  sensor: MachineSignalSensorDto,
  report: SignalReportRow,
  thresholds: SignalThresholds
): SignalTrendPoint {
  const metrics = metricsOf(sensor, report, thresholds);
  return {
    reportDate: report.reportDate,
    runSeconds: metrics.runSeconds,
    averageRunSeconds: metrics.averageRunSeconds,
    stopCount: metrics.stopCount,
    shortStopCount: metrics.shortStopCount,
    alarmCount: metrics.alarmCount,
    alarmSeconds: metrics.alarmSeconds,
  };
}

const average = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;

/**
 * 直近の日々が、その前の期間より悪くなっているかを見る（予兆の手がかり）。
 * points は古い順。recentDates に入る日を直近、それ以外を比較元とする。
 */
export function detectSignalWorsening(
  signalNo: number,
  points: SignalTrendPoint[],
  recentDates: Set<string>,
  thresholds: SignalThresholds
): SignalWorsening | null {
  const recorded = points.filter((point) => point.runSeconds > 0);
  const recent = recorded.filter((point) => recentDates.has(point.reportDate));
  const baseline = recorded.filter((point) => !recentDates.has(point.reportDate));
  if (recent.length < MIN_RECENT_RECORD_DAYS || baseline.length < MIN_BASELINE_RECORD_DAYS) return null;
  const ratio = thresholds.worseningPercent / 100;

  const runRecent = average(recent.map((point) => point.averageRunSeconds));
  const runBaseline = average(baseline.map((point) => point.averageRunSeconds));
  if (runBaseline >= MIN_BASELINE_RUN_SECONDS && runRecent <= runBaseline * (1 - ratio)) {
    return { signalNo, kind: 'RUN_SHORTER', recent: runRecent, baseline: runBaseline };
  }
  const alarmRecent = average(recent.map((point) => point.alarmCount));
  const alarmBaseline = average(baseline.map((point) => point.alarmCount));
  if (alarmRecent >= alarmBaseline * (1 + ratio) && alarmRecent - alarmBaseline >= MIN_ALARM_INCREASE_PER_DAY) {
    return { signalNo, kind: 'ALARM_MORE', recent: alarmRecent, baseline: alarmBaseline };
  }
  const shortRecent = average(recent.map((point) => point.shortStopCount));
  const shortBaseline = average(baseline.map((point) => point.shortStopCount));
  if (shortRecent >= shortBaseline * (1 + ratio) && shortRecent - shortBaseline >= MIN_SHORT_STOP_INCREASE_PER_DAY) {
    return { signalNo, kind: 'SHORT_STOPS_MORE', recent: shortRecent, baseline: shortBaseline };
  }
  return null;
}

function topBy(machines: SignalMachineDay[], valueOf: (machine: SignalMachineDay) => number): number[] {
  return machines
    .map((machine) => ({ signalNo: machine.signalNo, value: valueOf(machine) }))
    .filter((entry) => entry.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, TOP_LIST_SIZE)
    .map((entry) => entry.signalNo);
}

/** 1日分の全機械から、全体ページに出す結論（時間の行き先、稼働台数、手を打つ機械）を作る。 */
export function buildSignalFleetDay(
  machines: SignalMachineDay[],
  options: { dayStartMinute: number; nightStartMinute: number; worsening: SignalWorsening[]; thresholds: SignalThresholds }
): SignalFleetDay {
  const loss: SignalDayMetrics['loss'] = {
    normalRunSeconds: 0,
    runAlarmSeconds: 0,
    shortStopSeconds: 0,
    midStopSeconds: 0,
    longStopSeconds: 0,
    notStartedSeconds: 0,
    outsidePlanSeconds: 0,
    noRecordSeconds: 0,
  };
  const hintCounts = Object.fromEntries(SIGNAL_HINTS.map((hint) => [hint, 0])) as Record<SignalHint, number>;
  let kwh: number | null = null;
  for (const machine of machines) {
    for (const key of Object.keys(loss) as Array<keyof typeof loss>) loss[key] += machine.loss[key];
    hintCounts[machine.hint] += 1;
    if (machine.estimatedKwh !== null) kwh = (kwh ?? 0) + machine.estimatedKwh;
  }

  const runningBins = countRunningByBin(
    machines.map((machine) =>
      machine.timeline.map(([startSecond, durationSeconds, category]) => ({
        startSecond,
        durationSeconds,
        category: SIGNAL_CATEGORIES[category],
      }))
    )
  );
  const nightBin = Math.round(offsetSeconds(options.nightStartMinute, options.dayStartMinute) / 600);
  const dayBins = runningBins.slice(0, nightBin);
  const nightBins = runningBins.slice(nightBin);
  const total = machines.length * SIGNAL_DAY_SECONDS;

  return {
    machineCount: machines.length,
    runRatio: total > 0 ? (loss.normalRunSeconds + loss.runAlarmSeconds) / total : 0,
    loss,
    runningBins,
    dayAverage: dayBins.length > 0 ? average(dayBins) : null,
    nightAverage: nightBins.length > 0 ? average(nightBins) : null,
    hintCounts,
    estimatedKwh: kwh,
    topAlarm: topBy(machines, (machine) => machine.alarmSeconds),
    topShortStops: topBy(machines, (machine) => machine.shortStopCount),
    // ほとんど動かなかった機械は「ほぼ停止」として別に出るので、長い停止の上位からは外す。
    topLongStop: topBy(machines, (machine) =>
      machine.runSeconds >= options.thresholds.barelyRanMaxSeconds ? (machine.longestStops[0]?.durationSeconds ?? 0) : 0
    ),
    worsening: options.worsening,
  };
}
