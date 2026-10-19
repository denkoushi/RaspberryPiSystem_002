import { describe, expect, it } from 'vitest';

import {
  buildSignalAxisTicks,
  buildSignalLossSlices,
  buildSignalStopBucketLabels,
  describeSignalWorsening,
  formatSignalClock,
  formatSignalDuration,
  sortSignalMachinesByAttention
} from './machineSignalViewModel';

import type { MachineSignalLoss, MachineSignalMachineDay } from '../../api/client';

const machine = (overrides: Partial<MachineSignalMachineDay>): MachineSignalMachineDay =>
  ({ signalNo: 1, hint: 'NONE', alarmSeconds: 0, runSeconds: 0, ...overrides }) as MachineSignalMachineDay;

const loss = (overrides: Partial<MachineSignalLoss>): MachineSignalLoss => ({
  normalRunSeconds: 0,
  runAlarmSeconds: 0,
  shortStopSeconds: 0,
  midStopSeconds: 0,
  longStopSeconds: 0,
  notStartedSeconds: 0,
  outsidePlanSeconds: 0,
  noRecordSeconds: 0,
  ...overrides
});

const STOPS = { shortStopMaxSeconds: 300, longStopMinSeconds: 10_800 };

describe('machineSignalViewModel', () => {
  it('formats a duration in the largest unit that reads naturally', () => {
    expect(formatSignalDuration(45)).toBe('45秒');
    expect(formatSignalDuration(1_140)).toBe('19分');
    expect(formatSignalDuration(48_000)).toBe('13.3時間');
  });

  it('turns seconds from the start of the day into a clock time across midnight', () => {
    expect(formatSignalClock(0, 480)).toBe('08:00');
    expect(formatSignalClock(73_860, 480)).toBe('04:31');
  });

  it('labels the axis every four hours from the start of the day', () => {
    expect(buildSignalAxisTicks(480).map((tick) => tick.label)).toEqual(['08', '12', '16', '20', '00', '04', '08']);
  });

  it('puts the heaviest hint first, then the longer red lamp, then the shorter run', () => {
    const sorted = sortSignalMachinesByAttention([
      machine({ signalNo: 1, hint: 'GOOD', runSeconds: 80_000 }),
      machine({ signalNo: 2, hint: 'ALARM', alarmSeconds: 600 }),
      machine({ signalNo: 3, hint: 'LONG_STOP', runSeconds: 9_000 }),
      machine({ signalNo: 4, hint: 'ALARM', alarmSeconds: 7_200 }),
      machine({ signalNo: 5, hint: 'LONG_STOP', runSeconds: 4_000 })
    ]);
    expect(sorted.map((item) => item.signalNo)).toEqual([4, 2, 5, 3, 1]);
  });

  it('shows where the machine-hours went and hides the off-plan slice until a plan is set', () => {
    const withoutPlan = buildSignalLossSlices(loss({ normalRunSeconds: 3_600, longStopSeconds: 10_800 }), STOPS);
    expect(withoutPlan.map((slice) => slice.key)).not.toContain('outsidePlanSeconds');
    expect(withoutPlan.find((slice) => slice.key === 'longStopSeconds')?.ratio).toBeCloseTo(0.75);

    const withPlan = buildSignalLossSlices(loss({ normalRunSeconds: 3_600, outsidePlanSeconds: 3_600 }), STOPS);
    expect(withPlan.map((slice) => slice.key)).toContain('outsidePlanSeconds');
  });

  it('names the stop lengths after the configured limits', () => {
    expect(buildSignalStopBucketLabels(STOPS)).toEqual(['5分以下', '5分〜30分', '30分〜3時間', '3時間超']);
    expect(buildSignalLossSlices(loss({ longStopSeconds: 1 }), STOPS).find((slice) => slice.key === 'longStopSeconds')?.label).toBe(
      '3時間超の停止'
    );
  });

  it('describes a worsening machine with the before and after values', () => {
    expect(describeSignalWorsening({ signalNo: 1, kind: 'RUN_SHORTER', baseline: 3_600, recent: 1_800 })).toEqual({
      title: '連続稼働が短く',
      detail: '1.0時間 → 30分'
    });
    expect(describeSignalWorsening({ signalNo: 1, kind: 'ALARM_MORE', baseline: 1, recent: 6 }).detail).toBe(
      '1.0回 → 6.0回／日'
    );
  });
});
