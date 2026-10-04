import { describe, expect, it } from 'vitest';

import {
  buildSignalRangeAxis, buildSignalRangePick, formatSignalAverageRun,
  formatSignalRangeStopStart, signalRangeHeatColor, signalRunRatio, sortSignalPinnedMachines
} from './machineSignalRangeViewModel';

import type { MachineSignalRangeMachine } from '../../api/client';

const machine: MachineSignalRangeMachine = {
  signalNo: 2, name: 'NHX5000', sourceMachineName: 'NHX5000', site: null, kind: 'MACHINE',
  recordDays: 1, runSeconds: 3_600, averageRunSecondsPerDay: 1_800,
  stopCount: 4, shortStopCount: 3, alarmCount: 2, alarmSeconds: 600,
  longestStop: { reportDate: '2026-10-01', startSecond: 28_800, durationSeconds: 3_600, stateName: '停止' },
  loss: { normalRunSeconds: 3_600, runAlarmSeconds: 0, shortStopSeconds: 0, midStopSeconds: 0, longStopSeconds: 0, notStartedSeconds: 0, outsidePlanSeconds: 0, noRecordSeconds: 0 },
  estimatedKwh: null, days: [{ runSeconds: 3_600, hint: 'NONE' }, null]
};

describe('machineSignalRangeViewModel', () => {
  it('uses a full day denominator and clamps the ratio', () => {
    expect(signalRunRatio(43_200)).toBe(0.5);
    expect(signalRunRatio(null)).toBe(0);
    expect(signalRunRatio(-1)).toBe(0);
    expect(signalRunRatio(172_800)).toBe(1);
  });
  it('uses the ground color for missing or zero days and stronger green for more running', () => {
    expect(signalRangeHeatColor(null)).toBe('#1a2533');
    expect(signalRangeHeatColor(0)).toBe('#1a2533');
    expect(signalRangeHeatColor(0.5)).toBe('rgba(53,179,126,0.59)');
    expect(signalRangeHeatColor(1)).toBe('rgba(53,179,126,1.00)');
    expect(signalRangeHeatColor(2)).toBe(signalRangeHeatColor(1));
  });
  it('puts pins first without changing the order inside each group or the input', () => {
    const machines = [4, 2, 3, 1].map((signalNo) => ({ signalNo }));
    expect(sortSignalPinnedMachines(machines, new Set([3, 4])).map((item) => item.signalNo)).toEqual([4, 3, 2, 1]);
    expect(machines.map((item) => item.signalNo)).toEqual([4, 2, 3, 1]);
  });
  it('formats average hours with one decimal place', () => {
    expect(formatSignalAverageRun(44_280)).toBe('12.3h');
    expect(formatSignalAverageRun(0)).toBe('0.0h');
  });
  it('builds unique start, middle and end ticks', () => {
    expect(buildSignalRangeAxis(['2026-09-29', '2026-09-30', '2026-10-01'])).toEqual([
      { position: 0, label: '9/29' }, { position: 0.5, label: '9/30' }, { position: 1, label: '10/1' }
    ]);
    expect(buildSignalRangeAxis([])).toEqual([]);
    expect(buildSignalRangeAxis(['2026-10-01'])).toEqual([{ position: 0, label: '10/1' }]);
  });
  it('formats dated stops with the existing 08:00 day start clock and duration', () => {
    expect(formatSignalRangeStopStart(machine.longestStop!)).toBe('10/1 16:00');
    expect(buildSignalRangePick(machine, 'long')).toMatchObject({ amount: 3_600, value: '1.0時間', detail: '10/1 16:00 から ・ 停止' });
    expect(buildSignalRangePick({ ...machine, longestStop: null }, 'long')).toMatchObject({ amount: 0, value: 'なし', detail: '' });
    expect(buildSignalRangePick(machine, 'alarm')).toMatchObject({ amount: 600, value: '10分', detail: '2回' });
    expect(buildSignalRangePick(machine, 'short')).toMatchObject({ amount: 3, value: '3回' });
  });
});
