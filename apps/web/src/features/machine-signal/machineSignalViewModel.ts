import type {
  MachineSignalHint,
  MachineSignalLoss,
  MachineSignalMachineDay,
  MachineSignalThresholds,
  MachineSignalWorsening
} from '../../api/client';

export const SIGNAL_DAY_SECONDS = 86_400;

/** 共通6区分の色と名前（稼働／稼働中異常／停止／異常停止／待機／記録なし）。 */
export const SIGNAL_CATEGORY_COLORS = ['#35b37e', '#ff8f4d', '#e2cc52', '#ef5350', '#43556b', '#1a2533'] as const;
export const SIGNAL_CATEGORY_LABELS = ['稼働', '稼働中異常', '停止', '異常停止', '待機', '記録なし'] as const;

/** 一覧の並びと絞り込みに使う順。重い気づきが先。 */
export const SIGNAL_HINT_ORDER: readonly MachineSignalHint[] = [
  'ALARM',
  'SHORT_STOPS',
  'LONG_STOP',
  'BARELY_RAN',
  'NONE',
  'NO_RECORD',
  'GOOD'
];

export const SIGNAL_HINT_LABELS: Record<MachineSignalHint, string> = {
  ALARM: '異常 多',
  SHORT_STOPS: 'チョコ停 多',
  LONG_STOP: '長時間停止',
  BARELY_RAN: 'ほぼ停止',
  NONE: '',
  NO_RECORD: '記録なし',
  GOOD: '良好'
};

export const SIGNAL_HINT_CLASSES: Record<MachineSignalHint, string> = {
  ALARM: 'bg-[#4a1f22] text-[#ff9c99]',
  SHORT_STOPS: 'bg-[#4a3a14] text-[#f3d977]',
  LONG_STOP: 'bg-[#27374b] text-[#b9cce3]',
  BARELY_RAN: 'bg-[#2a2f38] text-[#a9b4c2]',
  NONE: 'bg-[#1b2634] text-[#8b9cb2]',
  NO_RECORD: 'bg-[#1c2633] text-[#5d6e84]',
  GOOD: 'bg-[#143a2b] text-[#74dcae]'
};

/** 絞り込みに出す気づき（NONE は「気づきなし」なので出さない）。 */
export const SIGNAL_FILTER_HINTS = SIGNAL_HINT_ORDER.filter((hint) => hint !== 'NONE');

export type SignalDuration = { value: string; unit: string };

export function splitSignalDuration(seconds: number): SignalDuration {
  if (seconds >= 3_600) return { value: (seconds / 3_600).toFixed(1), unit: '時間' };
  if (seconds >= 60) return { value: String(Math.round(seconds / 60)), unit: '分' };
  return { value: String(Math.round(seconds)), unit: '秒' };
}

export function formatSignalDuration(seconds: number): string {
  const { value, unit } = splitSignalDuration(seconds);
  return `${value}${unit}`;
}

/** 設定値（区切り）の表記。ちょうどの時間・分は小数を付けない。 */
export function formatSignalLimit(seconds: number): string {
  if (seconds >= 3_600 && seconds % 3_600 === 0) return `${seconds / 3_600}時間`;
  return formatSignalDuration(seconds);
}

export const formatSignalHours = (seconds: number) => (seconds / 3_600).toFixed(seconds >= 36_000 ? 0 : 1);

/** 集計日の開始からの秒を、時計の時刻（HH:MM）へ直す。 */
export function formatSignalClock(secondFromDayStart: number, dayStartMinute: number): string {
  const minute = (Math.floor(secondFromDayStart / 60) + dayStartMinute) % 1_440;
  return `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
}

/** 時間軸の目盛り（4時間ごと）。位置は 0〜1。 */
export function buildSignalAxisTicks(dayStartMinute: number): Array<{ position: number; label: string }> {
  return Array.from({ length: 7 }, (_, index) => ({
    position: index / 6,
    label: formatSignalClock(index * 4 * 3_600, dayStartMinute).slice(0, 2)
  }));
}

export function formatSignalDate(dateKey: string): string {
  const date = new Date(`${dateKey}T00:00:00`);
  return `${date.getMonth() + 1}/${date.getDate()}（${'日月火水木金土'[date.getDay()]}）`;
}

/** 気づきの重い順、同じ気づきなら赤ランプが長い順、稼働が短い順。 */
export function sortSignalMachinesByAttention(machines: MachineSignalMachineDay[]): MachineSignalMachineDay[] {
  return [...machines].sort(
    (a, b) =>
      SIGNAL_HINT_ORDER.indexOf(a.hint) - SIGNAL_HINT_ORDER.indexOf(b.hint) ||
      b.alarmSeconds - a.alarmSeconds ||
      a.runSeconds - b.runSeconds ||
      a.signalNo - b.signalNo
  );
}

type StopThresholds = Pick<MachineSignalThresholds, 'shortStopMaxSeconds' | 'longStopMinSeconds'>;

export type SignalLossSlice = { key: keyof MachineSignalLoss; label: string; color: string; seconds: number; ratio: number };

const LOSS_SLICES: Array<{ key: keyof MachineSignalLoss; label: string; color: string; optional?: boolean }> = [
  { key: 'normalRunSeconds', label: '正常に稼働', color: '#35b37e' },
  { key: 'runAlarmSeconds', label: '稼働中に赤ランプ', color: '#ff8f4d' },
  { key: 'shortStopSeconds', label: '短い停止', color: '#f3e7a0' },
  { key: 'midStopSeconds', label: '中間の停止', color: '#e2cc52' },
  { key: 'longStopSeconds', label: '長い停止', color: '#a58c2a' },
  { key: 'notStartedSeconds', label: '動かさなかった', color: '#43556b' },
  { key: 'outsidePlanSeconds', label: '予定外', color: '#2a3a4d', optional: true },
  { key: 'noRecordSeconds', label: '記録なし', color: '#1a2533' }
];

/** 全機械×24時間の行き先。稼働予定を誰も設定していなければ「予定外」は出さない。 */
export function buildSignalLossSlices(loss: MachineSignalLoss, thresholds: StopThresholds): SignalLossSlice[] {
  const total = Object.values(loss).reduce((sum, seconds) => sum + seconds, 0);
  const short = formatSignalLimit(thresholds.shortStopMaxSeconds);
  const long = formatSignalLimit(thresholds.longStopMinSeconds);
  const stopLabels: Partial<Record<keyof MachineSignalLoss, string>> = {
    shortStopSeconds: `${short}以下の停止`,
    midStopSeconds: `${short}〜${long}の停止`,
    longStopSeconds: `${long}超の停止`
  };
  return LOSS_SLICES.filter((slice) => !slice.optional || loss[slice.key] > 0).map((slice) => ({
    key: slice.key,
    label: stopLabels[slice.key] ?? slice.label,
    color: slice.color,
    seconds: loss[slice.key],
    ratio: total > 0 ? loss[slice.key] / total : 0
  }));
}

/** 停止の長さ別の見出し（短い／30分まで／長い停止の手前まで／長い停止）。区切りは設定値に合わせる。 */
export function buildSignalStopBucketLabels(thresholds: StopThresholds): string[] {
  const short = formatSignalLimit(thresholds.shortStopMaxSeconds);
  const long = formatSignalLimit(thresholds.longStopMinSeconds);
  return [`${short}以下`, `${short}〜30分`, `30分〜${long}`, `${long}超`];
}

export function describeSignalWorsening(worsening: MachineSignalWorsening): { title: string; detail: string } {
  if (worsening.kind === 'RUN_SHORTER') {
    return {
      title: '連続稼働が短く',
      detail: `${formatSignalDuration(worsening.baseline)} → ${formatSignalDuration(worsening.recent)}`
    };
  }
  const title = worsening.kind === 'ALARM_MORE' ? '赤ランプが増加' : '短い停止が増加';
  return { title, detail: `${worsening.baseline.toFixed(1)}回 → ${worsening.recent.toFixed(1)}回／日` };
}
