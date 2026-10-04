import { formatSignalClock, formatSignalDuration, SIGNAL_DAY_SECONDS } from './machineSignalViewModel';
import { formatSignalShortDate } from './signalDatePickerModel';

import type { MachineSignalRangeMachine } from '../../api/client';

export function signalRunRatio(runSeconds: number | null): number {
  return Math.max(0, Math.min(1, (runSeconds ?? 0) / SIGNAL_DAY_SECONDS));
}

export function signalRangeHeatColor(ratio: number | null): string {
  if (ratio === null || ratio <= 0) return '#1a2533';
  return `rgba(53,179,126,${(0.18 + Math.min(1, ratio) * 0.82).toFixed(2)})`;
}

export function formatSignalAverageRun(seconds: number): string {
  return `${(seconds / 3_600).toFixed(1)}h`;
}

export function sortSignalPinnedMachines<T extends { signalNo: number }>(machines: readonly T[], pins: ReadonlySet<number>): T[] {
  // 両グループ内の既存順を保つ。
  return [...machines.filter((machine) => pins.has(machine.signalNo)), ...machines.filter((machine) => !pins.has(machine.signalNo))];
}

export function buildSignalRangeAxis(dates: string[]): Array<{ position: number; label: string }> {
  return [...new Set([0, Math.floor((dates.length - 1) / 2), dates.length - 1])]
    .filter((index) => index >= 0 && dates[index])
    .map((index) => ({ position: dates.length > 1 ? index / (dates.length - 1) : 0, label: formatSignalShortDate(dates[index]) }));
}

export function formatSignalRangeStopStart(stop: NonNullable<MachineSignalRangeMachine['longestStop']>): string {
  return `${formatSignalShortDate(stop.reportDate)} ${formatSignalClock(stop.startSecond, 480)}`;
}

export function buildSignalRangePick(machine: MachineSignalRangeMachine, kind: 'alarm' | 'short' | 'long') {
  if (kind === 'alarm') return { machine, amount: machine.alarmSeconds, value: formatSignalDuration(machine.alarmSeconds), detail: `${machine.alarmCount}回` };
  if (kind === 'short') return { machine, amount: machine.shortStopCount, value: `${machine.shortStopCount}回`, detail: '' };
  const stop = machine.longestStop;
  return {
    machine,
    amount: stop?.durationSeconds ?? 0,
    value: stop ? formatSignalDuration(stop.durationSeconds) : 'なし',
    detail: stop ? `${formatSignalRangeStopStart(stop)} から ・ ${stop.stateName}` : ''
  };
}
