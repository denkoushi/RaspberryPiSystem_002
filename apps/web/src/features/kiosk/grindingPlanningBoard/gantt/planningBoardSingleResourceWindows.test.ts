import { describe, expect, it } from 'vitest';

import { buildForwardPlanningBoardGanttLayout, dateToDay, workingPeriods } from './planningBoardGanttLayout';
import { buildSingleResourceWindows, foldSingleResourceRow, singleResourceWindowTime } from './planningBoardSingleResourceWindows';

import type { GrindingPlanningBoardItem } from '@raspi-system/shared-types';

const day = dateToDay('2026-11-09');
const workingMinutes = (periods: { start: number; end: number }[]) => periods.reduce((sum, period) => sum + (period.end - period.start) * 1440, 0);
describe('single resource windows', () => {
  it.each([8, 10, 24])('chunks %iH working periods into at most 360 minutes and skips nights', (hours) => {
    const windows = buildSingleResourceWindows(day, day + 3, 1, hours);
    const firstDay = windows.filter((window) => window.day === day);
    expect(firstDay).toHaveLength(hours === 24 ? 4 : 2);
    expect(workingMinutes(firstDay[0]!.periods)).toBeCloseTo(360);
    expect(workingMinutes(firstDay.flatMap((window) => window.periods))).toBeCloseTo(hours * 60);
    expect(new Set(windows.map((window) => window.key)).size).toBe(windows.length);
    for (const window of windows) {
      expect(workingMinutes(window.periods)).toBeLessThanOrEqual(360.00001);
      expect(singleResourceWindowTime(window, window.end) - window.start).toBeCloseTo(workingMinutes(window.periods) / 1440);
      for (const period of window.periods) expect(workingPeriods(hours).some((working) =>
        period.start >= window.day + working.start - 1e-9 && period.end <= window.day + working.end + 1e-9)).toBe(true);
    }
    const tomorrow = windows.find((window) => window.day === day + 1)!;
    expect(tomorrow.start).toBeCloseTo(day + 1 + (hours === 24 ? 0 : 8 / 24));
  });
  it('honors running through breaks while retaining the capacity shift end', () => {
    const withBreaks = buildSingleResourceWindows(day, day + 3, 1, 8, true);
    const throughBreaks = buildSingleResourceWindows(day, day + 3, 1, 8, false);
    expect(withBreaks[0]!.end).toBeCloseTo(day + (14 * 60 + 50) / 1440);
    expect(throughBreaks[0]!.end).toBeCloseTo(day + 14 / 24);
    expect(workingMinutes(throughBreaks.filter((window) => window.day === day).flatMap((window) => window.periods))).toBeCloseTo(540);
  });
  it.each([2, 4, 7, 14, 28, 56])('builds %i calendar-day windows including nights and weekends', (scale) => {
    const windows = buildSingleResourceWindows(day, day + 10, scale, 8);
    expect(windows.length).toBeGreaterThanOrEqual(3);
    windows.forEach((window, index) => {
      expect(window.start).toBe(day + index * scale);
      expect(window.end - window.start).toBe(scale);
      expect(window.working).toBe(false);
      expect(singleResourceWindowTime(window, window.start + 0.5)).toBe(window.start + 0.5);
    });
  });
  it('clips every segment once with original IDs/items and retains predecessors on other resources', () => {
    const predecessor = { itemId: 'pre', kind: 'row', fseiban: 'S', fhincd: 'P', productNo: '1', processOrder: '10', originalResourceCd: '306', requiredMinutes: 480, requiredMinutesKnown: true } as GrindingPlanningBoardItem;
    const successor = { ...predecessor, itemId: 'next', processOrder: '20', originalResourceCd: '305', requiredMinutes: 720 };
    const layout = buildForwardPlanningBoardGanttLayout({ items: [successor, predecessor], allocation: 'alternate', view: 'resource', resources: ['305', '306'], seibanOrder: [], dailyHoursByResource: {}, today: '2026-11-09', now: new Date('2026-11-08T23:00:00Z'), scale: 1 });
    const row = layout.groups.find((group) => group.resource === '305')!.rows[0]!;
    const original = row.bars[0]!;
    expect(original.start).toBeGreaterThanOrEqual(layout.groups.find((group) => group.resource === '306')!.rows[0]!.bars[0]!.end!);
    const windows = buildSingleResourceWindows(day, layout.end, 1, 10);
    const rows = windows.map((window) => foldSingleResourceRow(row, window, 2400));
    const bars = rows.flatMap((entry) => entry.bars);
    expect(bars.length).toBeGreaterThan(1);
    for (const bar of bars) { expect(bar.item).toBe(successor); expect(bar.item.itemId).toBe('next'); }
    expect(workingMinutes(bars.flatMap((bar) => bar.segments!))).toBeCloseTo(720);
    expect(original.item).toBe(successor);
    expect(new Set(rows.map((entry) => entry.key)).size).toBe(rows.length);
  });
});

it('clips and compresses setup and operation metadata across a six-hour window', () => {
  const item = { itemId: 'unit', kind: 'piece', parentItemId: 'parent', fseiban: 'S1', fhincd: 'H1', processOrder: '10',
    originalResourceCd: '305', unitRequiredMinutes: 420, requiredMinutes: 999, requiredMinutesKnown: true,
    ops: [{ opNo: 10, minutes: 1 }, { opNo: 20, minutes: 1 }], completedOpNos: [10] } as GrindingPlanningBoardItem;
  const layout = buildForwardPlanningBoardGanttLayout({ items: [item], allocation: 'alternate', view: 'resource',
    seibanOrder: ['S1'], resources: ['305'], dailyHoursByResource: {}, today: '2026-11-09', now: new Date('2026-11-09T08:00:00+09:00'), scale: 1,
    resourceMinutes: { ownSourceResourceCds: ['305'], values: [{ resourceCd: '305', fhincd: 'H1', perUnitMinutes: 420, setupMinutes: 15 }] } });
  const row = layout.groups[0]!.rows[0]!;
  const windows = buildSingleResourceWindows(day, day + 1, 1, 8).filter(window => window.day === day);
  const folded = windows.flatMap(window => foldSingleResourceRow(row, window, 1440).bars);
  expect(workingMinutes(folded.flatMap(bar => bar.setupSegments ?? []))).toBeCloseTo(15);
  expect(workingMinutes(folded.flatMap(bar => bar.opSegments ?? []))).toBeCloseTo(420);
  expect(folded[0]!.setupSegments![0]!.start).toBeCloseTo(folded[0]!.start!);
  expect(folded[1]!.setupSegments).toEqual([]);
  expect(folded.flatMap(bar => bar.opSegments ?? []).filter(op => op.opNo === 10).every(op => op.completed)).toBe(true);
  for (const bar of folded) for (const segment of [...bar.setupSegments!, ...bar.opSegments!]) {
    expect(segment.start).toBeGreaterThanOrEqual(bar.start! - 1e-9);
    expect(segment.end).toBeLessThanOrEqual(bar.end! + 1e-9);
  }
});
