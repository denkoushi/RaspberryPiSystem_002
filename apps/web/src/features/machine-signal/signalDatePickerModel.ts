export type SignalDateSelection = { mode: 'latest' } | { mode: 'day'; date: string } | { mode: 'range'; from: string; to: string };
export type SignalDateRange = { from: string; to: string };
export type SignalDatePreset = '7' | '30' | 'month' | 'last';
export const SIGNAL_RANGE_MAX_DAYS = 92;
const DAY_MS = 86_400_000;

// UTC の暦だけを使い、端末のタイムゾーンや夏時間の影響を避ける。
const dateOf = (date: string) => new Date(`${date}T00:00:00.000Z`);
const keyOf = (date: Date) => date.toISOString().slice(0, 10);

export function addSignalDays(date: string, count: number): string {
  return keyOf(new Date(dateOf(date).getTime() + count * DAY_MS));
}

export function signalRangeDayCount(from: string, to: string): number {
  return Math.abs(dateOf(to).getTime() - dateOf(from).getTime()) / DAY_MS + 1;
}

export function isSignalRangeAllowed(from: string, to: string): boolean {
  return signalRangeDayCount(from, to) <= SIGNAL_RANGE_MAX_DAYS;
}

export function normalizeSignalRange(a: string, b: string): SignalDateRange {
  return a <= b ? { from: a, to: b } : { from: b, to: a };
}

export function signalRangeSelection(range: SignalDateRange): SignalDateSelection {
  return range.from === range.to ? { mode: 'day', date: range.from } : { mode: 'range', ...range };
}

export function moveSignalMonth(month: string, count: number): string {
  const date = dateOf(`${month.slice(0, 7)}-01`);
  date.setUTCMonth(date.getUTCMonth() + count);
  return keyOf(date);
}

export function buildSignalMonthCells(month: string): Array<string | null> {
  const first = `${month.slice(0, 7)}-01`;
  const last = addSignalDays(moveSignalMonth(first, 1), -1);
  const leading = dateOf(first).getUTCDay();
  const count = Number(last.slice(8));
  return Array.from({ length: Math.ceil((leading + count) / 7) * 7 }, (_, index) =>
    index < leading || index >= leading + count ? null : addSignalDays(first, index - leading));
}

export function buildSignalPresetRange(latest: string, preset: SignalDatePreset): SignalDateRange {
  const first = `${latest.slice(0, 7)}-01`;
  if (preset === 'last') return { from: moveSignalMonth(first, -1), to: addSignalDays(first, -1) };
  return { from: preset === 'month' ? first : addSignalDays(latest, -(Number(preset) - 1)), to: latest };
}

export function formatSignalShortDate(date: string): string {
  return `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;
}

export function formatSignalPickerDay(date: string): string {
  return `${Number(date.slice(5, 7))}/${date.slice(8, 10)}（${'日月火水木金土'[dateOf(date).getUTCDay()]}）`;
}

export function formatSignalPickerRange(from: string, to: string): string {
  return `${formatSignalShortDate(from)}〜${formatSignalShortDate(to)}（${signalRangeDayCount(from, to)}日）`;
}
