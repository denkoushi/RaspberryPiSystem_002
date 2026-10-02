import { prisma } from '../../lib/prisma.js';
import {
  buildSignalFleetDay,
  buildSignalMachineDay,
  buildSignalTrendPoint,
  detectSignalWorsening,
  SIGNAL_TREND_BASELINE_DAYS,
  SIGNAL_TREND_RECENT_DAYS,
  type SignalFleetDay,
  type SignalMachineDay,
  type SignalReportRow,
  type SignalTrendPoint,
  type SignalWorsening,
} from './machine-signal-insights.aggregate.js';
import {
  getMachineSignalSettings,
  listMachineSignalSensors,
  type MachineSignalSensorDto,
} from './machine-signal-settings.service.js';
import { classifySignalLamps, lampPatternKey, type SignalThresholds } from './signal-metrics.js';
import type { SignalCategory, SignalSegmentTuple } from './signal-report.types.js';

const DAY_MS = 86_400_000;
const toDateKey = (date: Date) => date.toISOString().slice(0, 10);
const toDate = (dateKey: string) => new Date(`${dateKey}T00:00:00.000Z`);

export type MachineSignalDayDto = {
  /** 表示している集計日。まだ1件も取り込んでいなければ null */
  reportDate: string | null;
  previousDate: string | null;
  nextDate: string | null;
  dayStartMinute: number;
  nightStartMinute: number;
  /** 停止の長さの区切りを画面に出すため、しきい値も返す */
  thresholds: SignalThresholds;
  sites: string[];
  fleet: SignalFleetDay | null;
  machines: SignalMachineDay[];
};

type ReportRecord = {
  signalNo: number;
  reportDate: Date;
  dayStartMinute: number;
  stateNames: unknown;
  segments: unknown;
};

const toReportRow = (row: ReportRecord): SignalReportRow => ({
  signalNo: row.signalNo,
  reportDate: toDateKey(row.reportDate),
  dayStartMinute: row.dayStartMinute,
  stateNames: Array.isArray(row.stateNames) ? (row.stateNames as string[]) : [],
  segments: Array.isArray(row.segments) ? (row.segments as SignalSegmentTuple[]) : [],
});

const REPORT_SELECT = { signalNo: true, reportDate: true, dayStartMinute: true, stateNames: true, segments: true } as const;

/** 1日分の全体と機械別。date を省くと最後に取り込んだ集計日。site を渡すとその工場だけで集計する。 */
export async function getMachineSignalDay(input: { date?: string; site?: string }): Promise<MachineSignalDayDto> {
  const [settings, allSensors] = await Promise.all([getMachineSignalSettings(), listMachineSignalSensors()]);
  const visible = allSensors.filter((sensor) => !sensor.hidden);
  const sites = [...new Set(visible.map((sensor) => sensor.site).filter((site): site is string => !!site))].sort();
  const sensors = input.site ? visible.filter((sensor) => sensor.site === input.site) : visible;

  const latest = await prisma.machineSignalDailyReport.findFirst({
    orderBy: { reportDate: 'desc' },
    select: { reportDate: true },
  });
  const empty: MachineSignalDayDto = {
    reportDate: null,
    previousDate: null,
    nextDate: null,
    dayStartMinute: 480,
    nightStartMinute: settings.nightStartMinute,
    thresholds: settings.thresholds,
    sites,
    fleet: null,
    machines: [],
  };
  if (!latest) return empty;

  const reportDate = input.date ?? toDateKey(latest.reportDate);
  const day = toDate(reportDate);
  const windowStart = new Date(day.getTime() - (SIGNAL_TREND_RECENT_DAYS + SIGNAL_TREND_BASELINE_DAYS - 1) * DAY_MS);
  const [previous, next, rows] = await Promise.all([
    prisma.machineSignalDailyReport.findFirst({
      where: { reportDate: { lt: day } },
      orderBy: { reportDate: 'desc' },
      select: { reportDate: true },
    }),
    prisma.machineSignalDailyReport.findFirst({
      where: { reportDate: { gt: day } },
      orderBy: { reportDate: 'asc' },
      select: { reportDate: true },
    }),
    prisma.machineSignalDailyReport.findMany({
      where: { reportDate: { gte: windowStart, lte: day }, signalNo: { in: sensors.map((sensor) => sensor.signalNo) } },
      orderBy: { reportDate: 'asc' },
      select: REPORT_SELECT,
    }),
  ]);

  const bySensor = new Map<number, SignalReportRow[]>();
  for (const row of rows.map(toReportRow)) {
    const list = bySensor.get(row.signalNo) ?? [];
    list.push(row);
    bySensor.set(row.signalNo, list);
  }
  const recentDates = new Set(
    Array.from({ length: SIGNAL_TREND_RECENT_DAYS }, (_, index) => toDateKey(new Date(day.getTime() - index * DAY_MS)))
  );

  const machines: SignalMachineDay[] = [];
  const worsening: SignalWorsening[] = [];
  let dayStartMinute = 480;
  for (const sensor of sensors) {
    const reports = bySensor.get(sensor.signalNo) ?? [];
    const today = reports.find((report) => report.reportDate === reportDate);
    if (today) dayStartMinute = today.dayStartMinute;
    machines.push(buildSignalMachineDay(sensor, today, settings.thresholds));
    const found = detectSignalWorsening(
      sensor.signalNo,
      reports.map((report) => buildSignalTrendPoint(sensor, report, settings.thresholds)),
      recentDates,
      settings.thresholds
    );
    if (found) worsening.push(found);
  }

  return {
    reportDate,
    previousDate: previous ? toDateKey(previous.reportDate) : null,
    nextDate: next ? toDateKey(next.reportDate) : null,
    dayStartMinute,
    nightStartMinute: settings.nightStartMinute,
    thresholds: settings.thresholds,
    sites,
    fleet: buildSignalFleetDay(machines, {
      dayStartMinute,
      nightStartMinute: settings.nightStartMinute,
      worsening,
      thresholds: settings.thresholds,
    }),
    machines,
  };
}

/** 1台の日ごとの推移（古い順）。endDate を含む days 日分。 */
export async function getMachineSignalTrend(input: {
  signalNo: number;
  endDate: string;
  days: number;
}): Promise<SignalTrendPoint[]> {
  const [settings, sensors] = await Promise.all([getMachineSignalSettings(), listMachineSignalSensors()]);
  const sensor = sensors.find((candidate) => candidate.signalNo === input.signalNo);
  if (!sensor) return [];
  const end = toDate(input.endDate);
  const rows = await prisma.machineSignalDailyReport.findMany({
    where: { signalNo: input.signalNo, reportDate: { gte: new Date(end.getTime() - (input.days - 1) * DAY_MS), lte: end } },
    orderBy: { reportDate: 'asc' },
    select: REPORT_SELECT,
  });
  return rows.map((row) => buildSignalTrendPoint(sensor, toReportRow(row), settings.thresholds));
}

export type MachineSignalLampPattern = {
  /** 赤黄緑のコード3桁（0=不問, 1=消灯, 2=点灯, 4=点滅） */
  pattern: string;
  stateNames: string[];
  autoCategory: SignalCategory;
};

export type MachineSignalSensorAdminDto = MachineSignalSensorDto & {
  latestReportDate: string | null;
  /** 最新の日報に出てきたランプの組み合わせ。読み替え設定の選択肢になる */
  lampPatterns: MachineSignalLampPattern[];
};

/** 管理画面用。センサーごとに、最新の日報で使われたランプの組み合わせを添える。 */
export async function listMachineSignalSensorsForAdmin(): Promise<MachineSignalSensorAdminDto[]> {
  const [sensors, latestRows] = await Promise.all([
    listMachineSignalSensors(),
    prisma.machineSignalDailyReport.findMany({
      distinct: ['signalNo'],
      orderBy: [{ signalNo: 'asc' }, { reportDate: 'desc' }],
      select: REPORT_SELECT,
    }),
  ]);
  const latest = new Map(latestRows.map((row) => [row.signalNo, toReportRow(row)]));
  return sensors.map((sensor) => {
    const report = latest.get(sensor.signalNo);
    const patterns = new Map<string, MachineSignalLampPattern>();
    for (const [, , red, yellow, green, stateIndex] of report?.segments ?? []) {
      const pattern = lampPatternKey(red, yellow, green);
      const entry = patterns.get(pattern) ?? {
        pattern,
        stateNames: [],
        autoCategory: classifySignalLamps(red, yellow, green),
      };
      const name = report?.stateNames[stateIndex];
      if (name && !entry.stateNames.includes(name)) entry.stateNames.push(name);
      patterns.set(pattern, entry);
    }
    return {
      ...sensor,
      latestReportDate: report?.reportDate ?? null,
      lampPatterns: [...patterns.values()].sort((a, b) => a.pattern.localeCompare(b.pattern)),
    };
  });
}
