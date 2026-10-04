import { describe, expect, it } from 'vitest';

import {
  buildSignalFleetDay,
  buildSignalDaySummary,
  buildSignalRange,
  buildSignalMachineDay,
  detectSignalWorsening,
  toPlannedWindows,
  type SignalReportRow,
  type SignalTrendPoint,
} from '../machine-signal-insights.aggregate.js';
import type { SignalDaySummary } from '../machine-signal-day-summary.cache.js';
import type { MachineSignalSensorDto } from '../machine-signal-settings.service.js';
import { DEFAULT_SIGNAL_THRESHOLDS } from '../signal-metrics.js';

const HOUR = 3_600;

const sensor = (overrides: Partial<MachineSignalSensorDto> = {}): MachineSignalSensorDto => ({
  signalNo: 1,
  sourceMachineName: 'HCN4000',
  displayName: null,
  site: null,
  kind: 'MACHINE',
  hidden: false,
  plannedStartMinute: null,
  plannedEndMinute: null,
  runningKw: null,
  idleKw: null,
  categoryOverrides: {},
  ...overrides,
});

const report = (segments: SignalReportRow['segments'], signalNo = 1): SignalReportRow => ({
  signalNo,
  reportDate: '2026-10-01',
  dayStartMinute: 480,
  stateNames: ['設備稼働', '一時停止', '異常停止'],
  segments,
});

describe('toPlannedWindows', () => {
  it('returns no window when the plan is not set', () => {
    expect(toPlannedWindows(sensor(), 480)).toEqual([]);
  });

  it('converts clock times to seconds from the start of the day', () => {
    expect(toPlannedWindows(sensor({ plannedStartMinute: 8 * 60, plannedEndMinute: 17 * 60 }), 480)).toEqual([
      { startSecond: 0, endSecond: 9 * HOUR },
    ]);
  });

  it('splits a plan that crosses the start of the day into two windows', () => {
    expect(toPlannedWindows(sensor({ plannedStartMinute: 6 * 60, plannedEndMinute: 18 * 60 }), 480)).toEqual([
      { startSecond: 0, endSecond: 10 * HOUR },
      { startSecond: 22 * HOUR, endSecond: 24 * HOUR },
    ]);
  });
});

describe('buildSignalMachineDay', () => {
  it('uses the display name when one is set and keeps the sensor name', () => {
    const machine = buildSignalMachineDay(
      sensor({ displayName: '1号機', site: '第1工場' }),
      report([[0, 24 * HOUR, 1, 1, 2, 0]]),
      DEFAULT_SIGNAL_THRESHOLDS
    );
    expect(machine).toMatchObject({ name: '1号機', sourceMachineName: 'HCN4000', site: '第1工場', hint: 'GOOD' });
    expect(machine.timeline).toEqual([[0, 24 * HOUR, 0]]);
  });

  it('shows a sensor without a report for the day as no record', () => {
    const machine = buildSignalMachineDay(sensor(), undefined, DEFAULT_SIGNAL_THRESHOLDS);
    expect(machine).toMatchObject({ hasRecord: false, hint: 'NO_RECORD', runSeconds: 0 });
  });

  it('applies the lamp override of the sensor', () => {
    const lit = report([[0, 24 * HOUR, 1, 2, 2, 0]]);
    expect(buildSignalMachineDay(sensor(), lit, DEFAULT_SIGNAL_THRESHOLDS).runSeconds).toBe(24 * HOUR);
    expect(
      buildSignalMachineDay(sensor({ categoryOverrides: { '122': 'STOP' } }), lit, DEFAULT_SIGNAL_THRESHOLDS).runSeconds
    ).toBe(0);
  });
});

describe('buildSignalFleetDay', () => {
  const machines = [
    buildSignalMachineDay(sensor({ signalNo: 1 }), report([[0, 24 * HOUR, 1, 1, 2, 0]]), DEFAULT_SIGNAL_THRESHOLDS),
    buildSignalMachineDay(
      sensor({ signalNo: 2 }),
      report(
        [
          [0, 6 * HOUR, 1, 1, 2, 0],
          [6 * HOUR, 2 * HOUR, 2, 1, 1, 2],
          [8 * HOUR, 16 * HOUR, 1, 2, 1, 1],
        ],
        2
      ),
      DEFAULT_SIGNAL_THRESHOLDS
    ),
    buildSignalMachineDay(sensor({ signalNo: 3 }), undefined, DEFAULT_SIGNAL_THRESHOLDS),
    // 10分だけ動いて止まった機械。長い停止の上位には出さない。
    buildSignalMachineDay(sensor({ signalNo: 4 }), report([[0, 600, 1, 1, 2, 0]], 4), DEFAULT_SIGNAL_THRESHOLDS),
  ];
  const fleet = buildSignalFleetDay(machines, {
    dayStartMinute: 480,
    nightStartMinute: 20 * 60,
    thresholds: DEFAULT_SIGNAL_THRESHOLDS,
  });

  it('accounts for every machine-hour exactly once', () => {
    expect(Object.values(fleet.loss).reduce((sum, seconds) => sum + seconds, 0)).toBe(4 * 24 * HOUR);
    expect(fleet.loss.noRecordSeconds).toBe(24 * HOUR);
    expect(fleet.loss.longStopSeconds).toBe(18 * HOUR + (24 * HOUR - 600));
    expect(fleet.runRatio).toBeCloseTo((30 * HOUR + 600) / (96 * HOUR));
  });

  it('averages the running machines for day and night around the configured boundary', () => {
    expect(fleet.runningBins).toHaveLength(144);
    expect(fleet.dayAverage).toBeCloseTo(1.5 + 1 / 72);
    expect(fleet.nightAverage).toBeCloseTo(1);
  });

  it('lists the machines to look at first and counts the hints', () => {
    // 開いたままの古い画面のために、空の配列だけ残している。
    expect(fleet.worsening).toEqual([]);
    expect(fleet.topAlarm).toEqual([2]);
    expect(fleet.topLongStop).toEqual([2]);
    expect(fleet.topShortStops).toEqual([]);
    expect(fleet.hintCounts).toMatchObject({ GOOD: 1, ALARM: 1, NO_RECORD: 1, BARELY_RAN: 1 });
  });
});

describe('detectSignalWorsening', () => {
  const point = (day: number, values: Partial<SignalTrendPoint>): SignalTrendPoint => ({
    reportDate: `2026-09-${String(day).padStart(2, '0')}`,
    runSeconds: 10 * HOUR,
    averageRunSeconds: HOUR,
    stopCount: 5,
    shortStopCount: 2,
    alarmCount: 1,
    alarmSeconds: 60,
    ...values,
  });
  const recentDates = new Set(['2026-09-28', '2026-09-29', '2026-09-30']);
  const baseline = Array.from({ length: 10 }, (_, index) => point(index + 1, {}));

  it('reports a machine whose continuous run got shorter', () => {
    const recent = [28, 29, 30].map((day) => point(day, { averageRunSeconds: 1_800 }));
    expect(detectSignalWorsening(7, [...baseline, ...recent], recentDates, DEFAULT_SIGNAL_THRESHOLDS)).toEqual({
      signalNo: 7,
      kind: 'RUN_SHORTER',
      recent: 1_800,
      baseline: HOUR,
    });
  });

  it('reports a machine whose red lamp count went up', () => {
    const recent = [28, 29, 30].map((day) => point(day, { alarmCount: 6 }));
    expect(detectSignalWorsening(7, [...baseline, ...recent], recentDates, DEFAULT_SIGNAL_THRESHOLDS)?.kind).toBe(
      'ALARM_MORE'
    );
  });

  it('stays quiet when the recent days look like the earlier ones', () => {
    const recent = [28, 29, 30].map((day) => point(day, {}));
    expect(detectSignalWorsening(7, [...baseline, ...recent], recentDates, DEFAULT_SIGNAL_THRESHOLDS)).toBeNull();
  });

  it('needs enough days on both sides before judging', () => {
    const recent = [28, 29, 30].map((day) => point(day, { averageRunSeconds: 600 }));
    expect(detectSignalWorsening(7, [...baseline.slice(0, 3), ...recent], recentDates, DEFAULT_SIGNAL_THRESHOLDS)).toBeNull();
  });
});

describe('buildSignalDaySummary', () => {
  it('keeps the daily metrics and longest stop without a timeline', () => {
    const summary = buildSignalDaySummary(sensor({ runningKw: 2, idleKw: 1 }), report([
      [0, HOUR, 1, 1, 2, 0],
      [HOUR, 120, 1, 2, 1, 1],
      [HOUR + 120, HOUR, 2, 1, 2, 0],
      [2 * HOUR + 120, 24 * HOUR - 2 * HOUR - 120, 1, 2, 1, 1],
    ]), DEFAULT_SIGNAL_THRESHOLDS);

    expect(summary).toMatchObject({
      signalNo: 1, reportDate: '2026-10-01', hasRecord: true, hint: 'ALARM',
      runSeconds: 2 * HOUR, runBlockCount: 2, averageRunSeconds: HOUR, longestRunSeconds: HOUR,
      stopCount: 2, shortStopCount: 1, alarmCount: 1, alarmSeconds: HOUR,
      longestStop: { startSecond: 2 * HOUR + 120, durationSeconds: 22 * HOUR - 120, stateName: '一時停止' },
      estimatedKwh: 26,
    });
    expect(summary.loss).toEqual({
      normalRunSeconds: HOUR, runAlarmSeconds: HOUR, shortStopSeconds: 120,
      midStopSeconds: 0, longStopSeconds: 22 * HOUR - 120,
      notStartedSeconds: 0, outsidePlanSeconds: 0, noRecordSeconds: 0,
    });
    expect(summary).not.toHaveProperty('timeline');
  });

  it('uses overrides, planned windows and thresholds for the summary', () => {
    const configured = sensor({
      categoryOverrides: { '122': 'STOP' }, plannedStartMinute: 480, plannedEndMinute: 600,
    });
    const summary = buildSignalDaySummary(configured, report([
      [0, HOUR, 1, 1, 2, 0],
      [HOUR, 120, 1, 2, 2, 1],
      [HOUR + 120, HOUR - 120, 1, 1, 2, 0],
      [2 * HOUR, 22 * HOUR, 1, 2, 1, 1],
    ]), { ...DEFAULT_SIGNAL_THRESHOLDS, shortStopMaxSeconds: 60, goodRunMinSeconds: 6_000 });
    expect(summary).toMatchObject({
      runSeconds: 2 * HOUR - 120, stopCount: 1, shortStopCount: 0, hint: 'GOOD', estimatedKwh: null,
      loss: { midStopSeconds: 120, outsidePlanSeconds: 22 * HOUR },
    });
  });

  it('returns no record, no stop and no power estimate for an empty report', () => {
    expect(buildSignalDaySummary(sensor({ runningKw: 2 }), report([]), DEFAULT_SIGNAL_THRESHOLDS)).toMatchObject({
      hasRecord: false, hint: 'NO_RECORD', runSeconds: 0, longestStop: null,
      loss: { noRecordSeconds: 24 * HOUR }, estimatedKwh: null,
    });
  });
});

describe('buildSignalRange', () => {
  const build = (sensors: MachineSignalSensorDto[], summaries: SignalDaySummary[], from = '2026-10-01', to = '2026-10-03') =>
    buildSignalRange({ from, to, sensors, summaries, thresholds: DEFAULT_SIGNAL_THRESHOLDS, sites: ['第1工場'] });

  it('sums days and includes missing dates and empty reports in the denominator', () => {
    const first = sensor({ displayName: '1号機', site: '第1工場', runningKw: 2, idleKw: 1 });
    const second = sensor({ signalNo: 2 });
    const summaries = [
      buildSignalDaySummary(first, report([[0, HOUR, 1, 1, 2, 0], [HOUR, 23 * HOUR, 1, 2, 1, 1]]), DEFAULT_SIGNAL_THRESHOLDS),
      buildSignalDaySummary(first, { ...report([[0, 24 * HOUR, 1, 1, 2, 0]]), reportDate: '2026-10-03' }, DEFAULT_SIGNAL_THRESHOLDS),
      buildSignalDaySummary(second, report([], 2), DEFAULT_SIGNAL_THRESHOLDS),
    ];
    const result = build([second, first], summaries);
    expect(result.dates).toEqual(['2026-10-01', '2026-10-02', '2026-10-03']);
    expect(result.machines.map((machine) => machine.signalNo)).toEqual([1, 2]);
    expect(result.machines[0]).toMatchObject({
      name: '1号機', sourceMachineName: 'HCN4000', site: '第1工場', kind: 'MACHINE',
      recordDays: 2, runSeconds: 25 * HOUR, averageRunSecondsPerDay: 30_000,
      stopCount: 1, shortStopCount: 0, alarmCount: 0, alarmSeconds: 0,
      longestStop: { startSecond: HOUR, durationSeconds: 23 * HOUR, stateName: '一時停止', reportDate: '2026-10-01' },
      loss: { normalRunSeconds: 25 * HOUR, longStopSeconds: 23 * HOUR, noRecordSeconds: 24 * HOUR },
      estimatedKwh: 73,
      days: [{ runSeconds: HOUR, hint: 'LONG_STOP' }, null, { runSeconds: 24 * HOUR, hint: 'GOOD' }],
    });
    expect(result.machines[1]).toMatchObject({
      name: 'HCN4000', recordDays: 0, estimatedKwh: null, longestStop: null,
      loss: { noRecordSeconds: 72 * HOUR }, days: [{ runSeconds: 0, hint: 'NO_RECORD' }, null, null],
    });
    expect(result.fleet).toMatchObject({
      machineCount: 2, dayCount: 3, hintDayCounts: { NO_RECORD: 4, LONG_STOP: 1, GOOD: 1 }, estimatedKwh: 73,
      loss: { normalRunSeconds: 25 * HOUR, longStopSeconds: 23 * HOUR, noRecordSeconds: 96 * HOUR },
    });
    expect(result.fleet.runRatio).toBeCloseTo(25 / 144);
    expect(result.fleet.dailyRunRatio).toEqual([1 / 48, 0, 1 / 2]);
    expect(Object.values(result.fleet.loss).reduce((sum, seconds) => sum + seconds, 0)).toBe(144 * HOUR);
  });

  it('orders and caps top lists, excludes zero values and barely running machines', () => {
    const sensors = Array.from({ length: 7 }, (_, index) => sensor({ signalNo: index + 1 }));
    const summaries = sensors.map((entry, index) => ({
      ...buildSignalDaySummary(entry, report([[0, 24 * HOUR, 1, 1, 2, 0]], entry.signalNo), DEFAULT_SIGNAL_THRESHOLDS),
      runSeconds: index === 6 ? 2 * HOUR - 1 : 2 * HOUR,
      alarmSeconds: index === 0 ? 0 : index * 60,
      shortStopCount: index === 0 ? 0 : 7 - index,
      longestStop: index === 0 ? null : { startSecond: 100, durationSeconds: index * HOUR, stateName: '停止' },
    }));
    const result = build(sensors, summaries, '2026-10-01', '2026-10-02');
    expect(result.fleet.topAlarm).toEqual([7, 6, 5, 4]);
    expect(result.fleet.topShortStops).toEqual([2, 3, 4, 5]);
    expect(result.fleet.topLongStop).toEqual([6, 5, 4, 3]);
    expect(result.machines[0].averageRunSecondsPerDay).toBe(HOUR);
    expect(result.fleet.estimatedKwh).toBeNull();
  });

  it('sums counters and power including a zero estimate and selects the longest stop across days', () => {
    const base = buildSignalDaySummary(sensor(), report([]), DEFAULT_SIGNAL_THRESHOLDS);
    const result = build([sensor()], [
      { ...base, hasRecord: true, stopCount: 3, shortStopCount: 2, alarmCount: 1, alarmSeconds: 60,
        estimatedKwh: 0, longestStop: { startSecond: 10, durationSeconds: 120, stateName: '停止' } },
      { ...base, reportDate: '2026-10-03', hasRecord: true, stopCount: 4, shortStopCount: 3,
        alarmCount: 2, alarmSeconds: 120, longestStop: { startSecond: 20, durationSeconds: 180, stateName: '異常停止' } },
    ]);
    expect(result.machines[0]).toMatchObject({
      recordDays: 2, stopCount: 7, shortStopCount: 5, alarmCount: 3, alarmSeconds: 180, estimatedKwh: 0,
      longestStop: { reportDate: '2026-10-03', startSecond: 20, durationSeconds: 180, stateName: '異常停止' },
    });
    expect(result.fleet.estimatedKwh).toBe(0);
  });

  it('returns null estimates and zero ratios for an empty fleet', () => {
    const result = build([], []);
    expect(result.fleet).toMatchObject({ machineCount: 0, dayCount: 3, runRatio: 0,
      dailyRunRatio: [0, 0, 0], estimatedKwh: null, topAlarm: [], topShortStops: [], topLongStop: [] });
    expect(result.fleet.hintDayCounts.NO_RECORD).toBe(0);
  });
});
