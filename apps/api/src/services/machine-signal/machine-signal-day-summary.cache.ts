import { prisma } from '../../lib/prisma.js';
import { buildSignalDaySummary } from './machine-signal-insights.aggregate.js';
import type { MachineSignalSensorDto } from './machine-signal-settings.service.js';
import type { SignalDayMetrics, SignalHint, SignalStop, SignalThresholds } from './signal-metrics.js';
import type { SignalSegmentTuple } from './signal-report.types.js';

export type SignalDaySummary = {
  signalNo: number;
  reportDate: string;
  hasRecord: boolean;
  hint: SignalHint;
  runSeconds: number;
  runBlockCount: number;
  averageRunSeconds: number;
  longestRunSeconds: number;
  stopCount: number;
  shortStopCount: number;
  alarmCount: number;
  alarmSeconds: number;
  loss: SignalDayMetrics['loss'];
  longestStop: SignalStop | null;
  estimatedKwh: number | null;
};

const MAX_CACHE_ENTRIES = 80_000;
const REPORT_BATCH_SIZE = 500;
const cache = new Map<string, { stamp: string; summary: SignalDaySummary }>();

export function clearSignalDaySummaryCache(): void {
  cache.clear();
}

export async function loadSignalDaySummaries(params: {
  sensors: MachineSignalSensorDto[];
  thresholds: SignalThresholds;
  from: string;
  to: string;
}): Promise<SignalDaySummary[]> {
  const sensors = new Map(params.sensors.map((sensor) => [sensor.signalNo, sensor]));
  const settingsStamps = new Map(params.sensors.map((sensor) => [sensor.signalNo, JSON.stringify({
    categoryOverrides: sensor.categoryOverrides,
    plannedStartMinute: sensor.plannedStartMinute,
    plannedEndMinute: sensor.plannedEndMinute,
    runningKw: sensor.runningKw,
    idleKw: sensor.idleKw,
  })]));
  const thresholdsStamp = JSON.stringify(params.thresholds);
  const rows = await prisma.machineSignalDailyReport.findMany({
    where: {
      signalNo: { in: [...sensors.keys()] },
      reportDate: { gte: new Date(`${params.from}T00:00:00.000Z`), lte: new Date(`${params.to}T00:00:00.000Z`) },
    },
    select: { id: true, signalNo: true, reportDate: true, updatedAt: true },
  });
  const stamps = new Map(rows.map((row) => [row.id,
    `${row.updatedAt.getTime()}|${settingsStamps.get(row.signalNo)}|${thresholdsStamp}`,
  ]));
  const summaries = new Map<string, SignalDaySummary>();
  const missing: string[] = [];
  for (const row of rows) {
    const entry = cache.get(row.id);
    if (entry && entry.stamp === stamps.get(row.id)) summaries.set(row.id, entry.summary);
    else missing.push(row.id);
  }
  // 更新された日報だけログを読み、DBへ渡すIDは小さなまとまりにする。
  for (let index = 0; index < missing.length; index += REPORT_BATCH_SIZE) {
    const reports = await prisma.machineSignalDailyReport.findMany({
      where: { id: { in: missing.slice(index, index + REPORT_BATCH_SIZE) } },
      select: { id: true, signalNo: true, reportDate: true, dayStartMinute: true, stateNames: true, segments: true },
    });
    for (const report of reports) {
      const sensor = sensors.get(report.signalNo);
      const stamp = stamps.get(report.id);
      if (!sensor || stamp === undefined) continue;
      const summary = buildSignalDaySummary(sensor, {
        signalNo: report.signalNo,
        reportDate: report.reportDate.toISOString().slice(0, 10),
        dayStartMinute: report.dayStartMinute,
        stateNames: Array.isArray(report.stateNames) ? report.stateNames as string[] : [],
        segments: Array.isArray(report.segments) ? report.segments as SignalSegmentTuple[] : [],
      }, params.thresholds);
      summaries.set(report.id, summary);
      cache.delete(report.id);
      cache.set(report.id, { stamp, summary });
      if (cache.size > MAX_CACHE_ENTRIES) {
        const oldest = cache.keys().next().value;
        if (oldest !== undefined) cache.delete(oldest);
      }
    }
  }
  return [...summaries.values()].sort((a, b) => a.reportDate.localeCompare(b.reportDate) || a.signalNo - b.signalNo);
}
