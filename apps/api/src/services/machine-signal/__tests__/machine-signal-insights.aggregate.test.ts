import { describe, expect, it } from 'vitest';

import {
  buildSignalFleetDay,
  buildSignalMachineDay,
  detectSignalWorsening,
  toPlannedWindows,
  type SignalReportRow,
  type SignalTrendPoint,
} from '../machine-signal-insights.aggregate.js';
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
    worsening: [],
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
