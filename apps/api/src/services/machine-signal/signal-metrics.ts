import {
  SIGNAL_DAY_SECONDS,
  type LampCode,
  type SignalCategory,
  type SignalSegmentTuple,
} from './signal-report.types.js';

/** 気づき（一覧で機械に付ける短い判定）。重い順。 */
export const SIGNAL_HINTS = ['ALARM', 'SHORT_STOPS', 'LONG_STOP', 'BARELY_RAN', 'NONE', 'NO_RECORD', 'GOOD'] as const;
export type SignalHint = (typeof SIGNAL_HINTS)[number];

export type SignalThresholds = {
  /** これ以下の停止を「短い停止（チョコ停）」と数える秒数 */
  shortStopMaxSeconds: number;
  /** これを超える停止を「長い停止」と数える秒数 */
  longStopMinSeconds: number;
  /** 短い停止がこの回数以上で「細かく止まる」 */
  shortStopCountForHint: number;
  /** 赤ランプの合計がこの秒数以上で「異常 多」 */
  alarmSecondsForHint: number;
  /** 赤ランプがこの回数以上で「異常 多」 */
  alarmCountForHint: number;
  /** 稼働がこの秒数未満で「ほぼ停止」 */
  barelyRanMaxSeconds: number;
  /** 稼働がこの秒数以上で、他の気づきが無ければ「良好」 */
  goodRunMinSeconds: number;
  /** 直近7日が、その前の28日よりこの割合（%）以上悪ければ「悪化」 */
  worseningPercent: number;
};

export const DEFAULT_SIGNAL_THRESHOLDS: SignalThresholds = {
  shortStopMaxSeconds: 300,
  longStopMinSeconds: 10_800,
  shortStopCountForHint: 10,
  alarmSecondsForHint: 1_800,
  alarmCountForHint: 10,
  barelyRanMaxSeconds: 3_600,
  goodRunMinSeconds: 57_600,
  worseningPercent: 30,
};

/** 停止の長さの区切り（秒）。短い停止／中／長い停止の境界は設定値、中の内訳だけ固定。 */
const MID_STOP_SPLIT_SECONDS = 1_800;

export type SignalCategoryOverrides = Record<string, SignalCategory>;

export type SignalDayInput = {
  segments: SignalSegmentTuple[];
  stateNames: string[];
  /** ランプの組み合わせ（`赤黄緑` のコード3桁）→区分の上書き。センサーごとの設定 */
  categoryOverrides?: SignalCategoryOverrides;
  /** 稼働予定の時間帯（集計日の開始からの秒）。空または未設定なら終日。日をまたぐ予定は2つに分けて渡す */
  plannedWindows?: SignalPlannedWindow[];
  /** 稼働中・それ以外の消費電力（kW）。両方未設定なら電力は推定しない */
  power?: { runningKw: number | null; idleKw: number | null } | null;
};

export type SignalPlannedWindow = { startSecond: number; endSecond: number };

export type SignalTimelineSegment = { startSecond: number; durationSeconds: number; category: SignalCategory };

export type SignalStop = { startSecond: number; durationSeconds: number; stateName: string };

export type SignalDayMetrics = {
  timeline: SignalTimelineSegment[];
  categorySeconds: Record<SignalCategory, number>;
  /** 稼働＋稼働中異常 */
  runSeconds: number;
  runBlockCount: number;
  averageRunSeconds: number;
  longestRunSeconds: number;
  stopCount: number;
  shortStopCount: number;
  /** 停止の長さ別（短い／30分まで／長い停止の手前まで／長い停止） */
  stopBuckets: Array<{ count: number; seconds: number }>;
  longestStops: SignalStop[];
  alarmCount: number;
  alarmSeconds: number;
  /** 24時間の行き先。合計は常に86,400秒 */
  loss: {
    normalRunSeconds: number;
    runAlarmSeconds: number;
    shortStopSeconds: number;
    midStopSeconds: number;
    longStopSeconds: number;
    notStartedSeconds: number;
    outsidePlanSeconds: number;
    noRecordSeconds: number;
  };
  hasRecord: boolean;
  estimatedKwh: number | null;
};

const isLit = (code: LampCode) => code === 2 || code === 4;

export function lampPatternKey(red: LampCode, yellow: LampCode, green: LampCode): string {
  return `${red}${yellow}${green}`;
}

/** ランプの組み合わせから共通区分を決める。緑が点いていれば稼働、赤が点いていれば異常。 */
export function classifySignalLamps(
  red: LampCode,
  yellow: LampCode,
  green: LampCode,
  overrides?: SignalCategoryOverrides
): SignalCategory {
  const override = overrides?.[lampPatternKey(red, yellow, green)];
  if (override) return override;
  if (isLit(green)) return isLit(red) ? 'RUN_ALARM' : 'RUN';
  if (isLit(red)) return 'ALARM_STOP';
  if (isLit(yellow)) return 'STOP';
  return 'IDLE';
}

const isRun = (category: SignalCategory) => category === 'RUN' || category === 'RUN_ALARM';
const isAlarm = (category: SignalCategory) => category === 'RUN_ALARM' || category === 'ALARM_STOP';

type Piece = { start: number; end: number; category: SignalCategory; stateName: string; planned: boolean };

function splitAtPlanBoundaries(pieces: Piece[], windows: SignalPlannedWindow[]): Piece[] {
  if (windows.length === 0) return pieces;
  const cuts = [...new Set(windows.flatMap((window) => [window.startSecond, window.endSecond]))].sort((a, b) => a - b);
  return pieces.flatMap((piece) => {
    const points = [piece.start, ...cuts.filter((cut) => cut > piece.start && cut < piece.end), piece.end];
    return points.slice(0, -1).map((start, index) => ({
      ...piece,
      start,
      end: points[index + 1],
      planned: windows.some((window) => start >= window.startSecond && start < window.endSecond),
    }));
  });
}

/** 1センサー×1日の状態遷移ログから、停止・連続稼働・異常の指標を出す。 */
export function computeSignalDayMetrics(input: SignalDayInput, thresholds: SignalThresholds): SignalDayMetrics {
  const filled: Piece[] = [];
  let cursor = 0;
  for (const [start, duration, red, yellow, green, stateIndex] of input.segments) {
    if (start > cursor) {
      filled.push({ start: cursor, end: start, category: 'NO_RECORD', stateName: '記録なし', planned: true });
    }
    filled.push({
      start,
      end: start + duration,
      category: classifySignalLamps(red, yellow, green, input.categoryOverrides),
      stateName: input.stateNames[stateIndex] ?? '',
      planned: true,
    });
    cursor = start + duration;
  }
  if (cursor < SIGNAL_DAY_SECONDS) {
    filled.push({ start: cursor, end: SIGNAL_DAY_SECONDS, category: 'NO_RECORD', stateName: '記録なし', planned: true });
  }
  const pieces = splitAtPlanBoundaries(filled, input.plannedWindows ?? []);
  const hasRecord = input.segments.length > 0;

  const categorySeconds: Record<SignalCategory, number> = {
    RUN: 0,
    RUN_ALARM: 0,
    STOP: 0,
    ALARM_STOP: 0,
    IDLE: 0,
    NO_RECORD: 0,
  };
  const timeline: SignalTimelineSegment[] = [];
  const runBlocks: number[] = [];
  const stops: SignalStop[] = [];
  let alarmCount = 0;
  let alarmSeconds = 0;
  let notStartedSeconds = 0;
  let outsidePlanSeconds = 0;
  let previous: 'run' | 'stop' | 'other' = 'other';
  let started = false;

  for (const piece of pieces) {
    const seconds = piece.end - piece.start;
    categorySeconds[piece.category] += seconds;
    const last = timeline[timeline.length - 1];
    if (last && last.category === piece.category && last.startSecond + last.durationSeconds === piece.start) {
      last.durationSeconds += seconds;
    } else {
      timeline.push({ startSecond: piece.start, durationSeconds: seconds, category: piece.category });
      if (isAlarm(piece.category)) alarmCount += 1;
    }
    if (isAlarm(piece.category)) alarmSeconds += seconds;

    if (isRun(piece.category)) {
      if (previous === 'run') runBlocks[runBlocks.length - 1] += seconds;
      else runBlocks.push(seconds);
      previous = 'run';
      started = true;
    } else if (!piece.planned) {
      outsidePlanSeconds += seconds;
      previous = 'other';
    } else if (!started) {
      notStartedSeconds += seconds;
      previous = 'other';
    } else {
      if (previous === 'stop') stops[stops.length - 1].durationSeconds += seconds;
      else stops.push({ startSecond: piece.start, durationSeconds: seconds, stateName: piece.stateName });
      previous = 'stop';
    }
  }

  const stopBuckets = [0, 1, 2, 3].map(() => ({ count: 0, seconds: 0 }));
  for (const stop of stops) {
    const bucket =
      stop.durationSeconds <= thresholds.shortStopMaxSeconds
        ? 0
        : stop.durationSeconds > thresholds.longStopMinSeconds
          ? 3
          : stop.durationSeconds <= MID_STOP_SPLIT_SECONDS
            ? 1
            : 2;
    stopBuckets[bucket].count += 1;
    stopBuckets[bucket].seconds += stop.durationSeconds;
  }

  const runSeconds = categorySeconds.RUN + categorySeconds.RUN_ALARM;
  const noRecordSeconds = hasRecord ? 0 : SIGNAL_DAY_SECONDS;
  const power = input.power;
  const estimatedKwh =
    hasRecord && power && (power.runningKw !== null || power.idleKw !== null)
      ? (runSeconds * (power.runningKw ?? 0) +
          (SIGNAL_DAY_SECONDS - runSeconds - categorySeconds.NO_RECORD) * (power.idleKw ?? 0)) /
        3_600
      : null;

  return {
    timeline,
    categorySeconds,
    runSeconds,
    runBlockCount: runBlocks.length,
    averageRunSeconds: runBlocks.length > 0 ? Math.round(runSeconds / runBlocks.length) : 0,
    longestRunSeconds: runBlocks.reduce((max, seconds) => Math.max(max, seconds), 0),
    stopCount: stops.length,
    shortStopCount: stopBuckets[0].count,
    stopBuckets,
    longestStops: [...stops].sort((a, b) => b.durationSeconds - a.durationSeconds).slice(0, 5),
    alarmCount,
    alarmSeconds,
    loss: {
      normalRunSeconds: categorySeconds.RUN,
      runAlarmSeconds: categorySeconds.RUN_ALARM,
      shortStopSeconds: stopBuckets[0].seconds,
      midStopSeconds: stopBuckets[1].seconds + stopBuckets[2].seconds,
      longStopSeconds: stopBuckets[3].seconds,
      notStartedSeconds: hasRecord ? notStartedSeconds : 0,
      outsidePlanSeconds: hasRecord ? outsidePlanSeconds : 0,
      noRecordSeconds,
    },
    hasRecord,
    estimatedKwh,
  };
}

export function decideSignalHint(metrics: SignalDayMetrics, thresholds: SignalThresholds): SignalHint {
  if (!metrics.hasRecord) return 'NO_RECORD';
  if (metrics.alarmSeconds >= thresholds.alarmSecondsForHint || metrics.alarmCount >= thresholds.alarmCountForHint) {
    return 'ALARM';
  }
  if (metrics.shortStopCount >= thresholds.shortStopCountForHint) return 'SHORT_STOPS';
  if (metrics.runSeconds < thresholds.barelyRanMaxSeconds) return 'BARELY_RAN';
  if (metrics.stopBuckets[3].count > 0) return 'LONG_STOP';
  if (metrics.runSeconds >= thresholds.goodRunMinSeconds) return 'GOOD';
  return 'NONE';
}

/** 10分刻みで、稼働していた台数（その10分のうち稼働した割合の合計）を数える。 */
export function countRunningByBin(timelines: SignalTimelineSegment[][], binSeconds = 600): number[] {
  const bins = new Array<number>(Math.ceil(SIGNAL_DAY_SECONDS / binSeconds)).fill(0);
  for (const timeline of timelines) {
    for (const segment of timeline) {
      if (!isRun(segment.category)) continue;
      let at = segment.startSecond;
      const end = segment.startSecond + segment.durationSeconds;
      while (at < end) {
        const index = Math.floor(at / binSeconds);
        const next = Math.min(end, (index + 1) * binSeconds);
        bins[index] += (next - at) / binSeconds;
        at = next;
      }
    }
  }
  return bins;
}
