import { describe, expect, it } from 'vitest';

import {
  classifySignalLamps,
  computeSignalDayMetrics,
  countRunningByBin,
  decideSignalHint,
  DEFAULT_SIGNAL_THRESHOLDS,
  type SignalDayInput,
} from '../signal-metrics.js';
import type { LampCode, SignalSegmentTuple } from '../signal-report.types.js';

const HOUR = 3_600;
const RUN: [LampCode, LampCode, LampCode] = [1, 1, 2];
const STOP: [LampCode, LampCode, LampCode] = [1, 2, 1];
const ALARM: [LampCode, LampCode, LampCode] = [2, 1, 1];
const IDLE: [LampCode, LampCode, LampCode] = [1, 1, 1];
const STATES = ['設備稼働', '一時停止', '異常停止', '設備待機'];

/** [継続秒, ランプ, 状態index] の並びを、開始秒つきのログへ直す。 */
function log(start: number, items: Array<[number, [LampCode, LampCode, LampCode], number]>): SignalSegmentTuple[] {
  let at = start;
  return items.map(([duration, lamps, state]) => {
    const segment: SignalSegmentTuple = [at, duration, lamps[0], lamps[1], lamps[2], state];
    at += duration;
    return segment;
  });
}

const input = (segments: SignalSegmentTuple[], extra: Partial<SignalDayInput> = {}): SignalDayInput => ({
  segments,
  stateNames: STATES,
  ...extra,
});

describe('classifySignalLamps', () => {
  it.each([
    [[1, 1, 2], 'RUN'],
    [[0, 0, 4], 'RUN'],
    [[2, 1, 2], 'RUN_ALARM'],
    [[4, 1, 1], 'ALARM_STOP'],
    [[0, 2, 0], 'STOP'],
    [[1, 1, 1], 'IDLE'],
  ] as Array<[[LampCode, LampCode, LampCode], string]>)('%j → %s', (lamps, expected) => {
    expect(classifySignalLamps(...lamps)).toBe(expected);
  });

  it('lets a sensor override one lamp combination', () => {
    expect(classifySignalLamps(1, 2, 2, { '122': 'STOP' })).toBe('STOP');
    expect(classifySignalLamps(1, 1, 2, { '122': 'STOP' })).toBe('RUN');
  });
});

describe('computeSignalDayMetrics', () => {
  it('splits the day into run blocks, stops by length and time before the first run', () => {
    const segments = log(0, [
      [HOUR, IDLE, 3],
      [2 * HOUR, RUN, 0],
      [120, STOP, 1],
      [HOUR, RUN, 0],
      [600, ALARM, 2],
      [1_200, STOP, 1],
      [HOUR, RUN, 0],
      [5 * HOUR, STOP, 1],
    ]);
    const metrics = computeSignalDayMetrics(input(segments), DEFAULT_SIGNAL_THRESHOLDS);

    expect(metrics.runSeconds).toBe(4 * HOUR);
    expect(metrics.runBlockCount).toBe(3);
    expect(metrics.averageRunSeconds).toBe((4 * HOUR) / 3);
    expect(metrics.longestRunSeconds).toBe(2 * HOUR);
    // 異常停止と一時停止は続いているので1回の停止。最後の5時間停止は記録なしの終端まで伸びる。
    expect(metrics.stopCount).toBe(3);
    expect(metrics.shortStopCount).toBe(1);
    expect(metrics.stopBuckets.map((bucket) => bucket.count)).toEqual([1, 1, 0, 1]);
    expect(metrics.longestStops[0]).toEqual({
      startSecond: 5 * HOUR + 120 + 1_800,
      durationSeconds: 86_400 - (5 * HOUR + 120 + 1_800),
      stateName: '一時停止',
    });
    expect(metrics.alarmCount).toBe(1);
    expect(metrics.alarmSeconds).toBe(600);
    expect(metrics.loss.notStartedSeconds).toBe(HOUR);
    expect(Object.values(metrics.loss).reduce((sum, seconds) => sum + seconds, 0)).toBe(86_400);
  });

  it('treats a day with no log as no record, not as a stop', () => {
    const metrics = computeSignalDayMetrics(input([]), DEFAULT_SIGNAL_THRESHOLDS);
    expect(metrics.hasRecord).toBe(false);
    expect(metrics.stopCount).toBe(0);
    expect(metrics.loss.noRecordSeconds).toBe(86_400);
    expect(decideSignalHint(metrics, DEFAULT_SIGNAL_THRESHOLDS)).toBe('NO_RECORD');
  });

  it('does not count time outside the planned window as a stop', () => {
    const segments = log(0, [
      [8 * HOUR, RUN, 0],
      [16 * HOUR, IDLE, 3],
    ]);
    const all = computeSignalDayMetrics(input(segments), DEFAULT_SIGNAL_THRESHOLDS);
    const planned = computeSignalDayMetrics(
      input(segments, { plannedWindows: [{ startSecond: 0, endSecond: 9 * HOUR }] }),
      DEFAULT_SIGNAL_THRESHOLDS
    );

    expect(all.loss.longStopSeconds).toBe(16 * HOUR);
    expect(planned.loss.longStopSeconds).toBe(0);
    expect(planned.loss.midStopSeconds).toBe(HOUR);
    expect(planned.loss.outsidePlanSeconds).toBe(15 * HOUR);
    expect(Object.values(planned.loss).reduce((sum, seconds) => sum + seconds, 0)).toBe(86_400);
  });

  it('estimates energy only when a power rating is set', () => {
    const segments = log(0, [
      [10 * HOUR, RUN, 0],
      [14 * HOUR, IDLE, 3],
    ]);
    expect(computeSignalDayMetrics(input(segments), DEFAULT_SIGNAL_THRESHOLDS).estimatedKwh).toBeNull();
    expect(
      computeSignalDayMetrics(input(segments, { power: { runningKw: 15, idleKw: 2 } }), DEFAULT_SIGNAL_THRESHOLDS)
        .estimatedKwh
    ).toBe(10 * 15 + 14 * 2);
  });
});

describe('decideSignalHint', () => {
  const hintOf = (segments: SignalSegmentTuple[]) =>
    decideSignalHint(computeSignalDayMetrics(input(segments), DEFAULT_SIGNAL_THRESHOLDS), DEFAULT_SIGNAL_THRESHOLDS);

  it('flags many short stops', () => {
    const cycle: Array<[number, [LampCode, LampCode, LampCode], number]> = [
      [HOUR, RUN, 0],
      [60, STOP, 1],
    ];
    expect(hintOf(log(0, new Array(12).fill(cycle).flat()))).toBe('SHORT_STOPS');
  });

  it('puts a long red lamp ahead of other hints', () => {
    expect(
      hintOf(
        log(0, [
          [2 * HOUR, RUN, 0],
          [HOUR, ALARM, 2],
          [21 * HOUR, RUN, 0],
        ])
      )
    ).toBe('ALARM');
  });

  it('marks a full day of running as good', () => {
    expect(hintOf(log(0, [[24 * HOUR, RUN, 0]]))).toBe('GOOD');
  });

  it('marks a machine that hardly ran', () => {
    expect(
      hintOf(
        log(0, [
          [600, RUN, 0],
          [23 * HOUR, IDLE, 3],
        ])
      )
    ).toBe('BARELY_RAN');
  });
});

describe('countRunningByBin', () => {
  it('adds up the share of each 10 minutes that machines were running', () => {
    const one = computeSignalDayMetrics(input(log(0, [[900, RUN, 0]])), DEFAULT_SIGNAL_THRESHOLDS).timeline;
    const bins = countRunningByBin([one, one]);
    expect(bins).toHaveLength(144);
    expect(bins.slice(0, 3)).toEqual([2, 1, 0]);
  });
});
