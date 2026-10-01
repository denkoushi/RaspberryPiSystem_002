import { describe, expect, it } from 'vitest';

import {
  ALL_DAYS,
  autoAdjust,
  countConflictPairs,
  durationsFromHistory,
  findConflicts,
  findRoomiestTiming,
  formatCronTiming,
  formatTimingShort,
  moveMarker,
  parseCronTiming,
  shiftTiming,
  withInterval,
  type TimelineEntry
} from './scheduleTimeline';

function entry(id: string, cron: string, overrides: Partial<TimelineEntry> = {}): TimelineEntry {
  return {
    ...parseCronTiming(cron)!,
    id,
    name: id,
    enabled: true,
    gated: true,
    durationSec: 45,
    editable: true,
    ...overrides
  };
}

// 2026-10-01 時点の本番に近い並び
const production = () => [
  entry('rigging', '*/30 * * * *'),
  entry('measuring', '15,30,45 * * * 0,1,2,3,4,5,6'),
  entry('machine', '21,36,51 * * * 0,1,2,3,4,5,6'),
  entry('order', '24,39,54 * * * 0,1,2,3,4,5,6'),
  entry('inventory', '*/5 * * * *', { gated: false }),
  entry('fkobaino', '25 6 * * 1,2,3,4,5,6', { durationSec: 240 })
];

describe('parseCronTiming / formatCronTiming', () => {
  it('reads step, list and time-of-day crons', () => {
    expect(parseCronTiming('*/30 * * * *')).toEqual({ minutes: [0, 30], hours: null, days: ALL_DAYS });
    expect(parseCronTiming('21,36,51 * * * 0,1,2,3,4,5,6')).toEqual({ minutes: [21, 36, 51], hours: null, days: ALL_DAYS });
    expect(parseCronTiming('25 6 * * 1,2,3,4,5,6')).toEqual({ minutes: [25], hours: [6], days: [1, 2, 3, 4, 5, 6] });
  });

  it('rejects crons the board cannot draw', () => {
    expect(parseCronTiming('0 2 1 * *')).toBeNull();
    expect(parseCronTiming('abc')).toBeNull();
    expect(parseCronTiming(undefined)).toBeNull();
  });

  it('writes the shortest equivalent cron', () => {
    expect(formatCronTiming({ minutes: [0, 30], hours: null, days: ALL_DAYS })).toBe('*/30 * * * *');
    expect(formatCronTiming({ minutes: [12, 42], hours: null, days: ALL_DAYS })).toBe('12,42 * * * *');
    expect(formatCronTiming({ minutes: [12], hours: null, days: ALL_DAYS })).toBe('12 * * * *');
    expect(formatCronTiming({ minutes: [25], hours: [6], days: [1, 2, 3, 4, 5, 6] })).toBe('25 6 * * 1,2,3,4,5,6');
  });
});

describe('findConflicts', () => {
  it('flags imports that fire in the same minute and ignores ungated ones', () => {
    const conflicts = findConflicts(production(), 0);
    expect(countConflictPairs(conflicts)).toEqual({ hard: 1, soft: 0 });
    expect(conflicts.every((c) => c.same && c.at % 60 === 30)).toBe(true);
    expect(conflicts.some((c) => c.victimId === 'inventory' || c.causeId === 'inventory')).toBe(false);
  });

  it('flags a fire while a long import is running, and right after it', () => {
    const during = findConflicts([entry('long', '25 6 * * *', { durationSec: 240 }), entry('x', '27 6 * * *')], 1);
    expect(during).toEqual([{ victimId: 'x', causeId: 'long', at: 387, causeAt: 385, level: 'hard', same: false }]);
    const after = findConflicts([entry('long', '25 6 * * *', { durationSec: 240 }), entry('x', '30 6 * * *')], 1);
    expect(after.map((c) => c.level)).toEqual(['soft']);
  });

  it('does not warn right after a short import', () => {
    expect(findConflicts([entry('a', '21 * * * *'), entry('b', '22 * * * *')], 1)).toEqual([]);
  });

  it('skips disabled imports and other weekdays', () => {
    const list = [entry('a', '30 6 * * 1'), entry('b', '30 6 * * *', { enabled: false }), entry('c', '30 6 * * 2')];
    expect(findConflicts(list, 1)).toEqual([]);
  });
});

describe('editing', () => {
  it('moves every hourly fire together', () => {
    const moved = moveMarker(parseCronTiming('*/30 * * * *')!, 0, 12);
    expect(formatCronTiming(moved)).toBe('12,42 * * * *');
    expect(shiftTiming(parseCronTiming('*/30 * * * *')!, -1).minutes).toEqual([29, 59]);
  });

  it('carries a once-a-day import across the hour', () => {
    expect(shiftTiming(parseCronTiming('59 6 * * *')!, 1)).toMatchObject({ hours: [7], minutes: [0] });
  });

  it('changes the interval and keeps the first minute', () => {
    expect(withInterval(parseCronTiming('12,42 * * * *')!, 15).minutes).toEqual([12, 27, 42, 57]);
  });

  it('labels timings compactly', () => {
    expect(formatTimingShort(parseCronTiming('12,42 * * * *')!)).toBe(':12 :42');
    expect(formatTimingShort(parseCronTiming('*/5 * * * *')!)).toBe('5分ごと');
    expect(formatTimingShort(parseCronTiming('25 6 * * 1,2,3,4,5,6')!)).toBe('月–土 06:25');
  });
});

describe('findRoomiestTiming / autoAdjust', () => {
  it('finds a slot with no conflict on any weekday', () => {
    const list = production();
    const next = findRoomiestTiming(list, 'rigging')!;
    const after = list.map((e) => (e.id === 'rigging' ? next : e));
    expect(ALL_DAYS.flatMap((d) => findConflicts(after, d)).filter((c) => c.victimId === 'rigging' || c.causeId === 'rigging')).toEqual([]);
    // 余裕が最大（前後2分以上）の候補のうち、今の :00 に近いものを選ぶ
    expect(next.minutes).toEqual([3, 33]);
  });

  it('auto-adjust moves only hourly imports and clears the overlap', () => {
    const result = autoAdjust(production());
    // 吊具点検（同時発火）に加えて、FKOBAINO の直後に当たる計測機器も動かす
    expect(result.movedIds).toEqual(['rigging', 'measuring']);
    expect(result.entries.find((e) => e.id === 'fkobaino')).toMatchObject({ hours: [6], minutes: [25] });
    expect(result.remaining).toBe(0);
  });

  it('reports what it could not fix', () => {
    const result = autoAdjust([entry('a', '0 6 * * *'), entry('b', '0 6 * * *')]);
    expect(result.movedIds).toEqual([]);
    expect(result.remaining).toBeGreaterThan(0);
  });
});

describe('durationsFromHistory', () => {
  it('uses the longest of the recent completed runs', () => {
    const run = (seconds: number, status = 'COMPLETED') => ({
      scheduleId: 'a',
      status,
      startedAt: '2026-10-01T00:00:00.000Z',
      completedAt: new Date(Date.UTC(2026, 9, 1, 0, 0, seconds)).toISOString()
    });
    expect(durationsFromHistory([run(20), run(95), run(300, 'FAILED')]).get('a')).toBe(95);
    expect(durationsFromHistory([]).get('a')).toBeUndefined();
  });
});
