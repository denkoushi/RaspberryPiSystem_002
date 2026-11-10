import { workingPeriods } from './planningBoardGanttLayout';

import type { GanttBar, GanttRow } from './planningBoardGanttLayout';

const EPSILON = 1e-9;
type Period = { start: number; end: number };
export type SingleResourceWindow = {
  key: string;
  day: number;
  start: number;
  end: number;
  periods: Period[];
  working: boolean;
};

/** One-day rows have 360 working minutes; calendar rows keep nights and weekends. */
export function buildSingleResourceWindows(today: number, end: number, scale: number, hours: number, pausesForBreaks = true): SingleResourceWindow[] {
  const windows: SingleResourceWindow[] = [];
  if (scale > 1) {
    const count = Math.max(3, Math.ceil((end - today) / scale));
    for (let index = 0; index < count; index++) {
      const start = today + index * scale;
      windows.push({ key: `${start}:${scale}`, day: start, start, end: start + scale, periods: [{ start, end: start + scale }], working: false });
    }
    return windows;
  }
  for (let day = today; day < Math.max(today + 3, end); day++) {
    let periods: Period[] = [];
    let remaining = 360 / 1440;
    const flush = () => {
      const start = periods[0]!.start;
      const end = periods[periods.length - 1]!.end;
      windows.push({ key: `${day}:${windows.length}`, day, start, end, periods, working: true });
      periods = [];
      remaining = 360 / 1440;
    };
    for (const period of workingPeriods(hours, pausesForBreaks)) {
      let cursor = day + period.start;
      const end = day + period.end;
      while (cursor < end - EPSILON) {
        const take = Math.min(remaining, end - cursor);
        periods.push({ start: cursor, end: cursor + take });
        cursor += take;
        remaining -= take;
        if (remaining < EPSILON) flush();
      }
    }
    if (periods.length) flush();
  }
  return windows;
}

/** Compress only non-working gaps in a six-working-hour row; scale remains pixels/hour. */
export function singleResourceWindowTime(window: SingleResourceWindow, time: number): number {
  if (!window.working) return time;
  let elapsed = 0;
  for (const period of window.periods) {
    elapsed += Math.max(0, Math.min(time, period.end) - period.start);
    if (time <= period.end) break;
  }
  return window.start + elapsed;
}

export function clipSingleResourceBar(bar: GanttBar, window: SingleResourceWindow, dayWidth: number): GanttBar | null {
  const clip = <T extends Period>(segments: T[]): T[] => segments.flatMap((segment) => window.periods.flatMap((period) => {
    const start = Math.max(period.start, segment.start);
    const end = Math.min(period.end, segment.end);
    return end > start + EPSILON ? [{ ...segment, start: singleResourceWindowTime(window, start), end: singleResourceWindowTime(window, end) }] : [];
  }));
  const segments = clip(bar.unknown && bar.start != null ? [{ start: bar.start, end: bar.start + 70 / dayWidth }] : bar.segments ?? []);
  if (!segments.length) return null;
  return { ...bar, start: segments[0]!.start, end: segments[segments.length - 1]!.end, segments,
    ...(bar.setupSegments ? { setupSegments: clip(bar.setupSegments) } : {}),
    ...(bar.opSegments ? { opSegments: clip(bar.opSegments) } : {}) };
}

export function foldSingleResourceRow(row: GanttRow, window: SingleResourceWindow, dayWidth: number): GanttRow {
  return { ...row, key: `${row.key}:single:${window.key}`,
    bars: row.bars.flatMap((bar) => clipSingleResourceBar(bar, window, dayWidth) ?? []),
    connectors: row.connectors.flatMap((link) => {
      const start = Math.max(window.start, link.start);
      const end = Math.min(window.end, link.end);
      return end > start ? [{ start: singleResourceWindowTime(window, start), end: singleResourceWindowTime(window, end) }] : [];
    }) };
}

export type ForwardDragLane = { resource: string; bars: GanttBar[]; rowKey?: string; start?: number; end?: number };
export type GanttBarLocation = { rowKey: string; bar: GanttBar; start: number };
export type GanttBarLocations = ReadonlyMap<string, { first: GanttBarLocation; last: GanttBarLocation }>;
