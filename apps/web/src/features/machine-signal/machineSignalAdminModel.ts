import type { MachineSignalCategory, MachineSignalSensor, MachineSignalThresholds } from '../../api/client';

/** 1回のアップロードで送るファイル数。サーバー側の上限（200）より小さくして、1回を短く保つ。 */
export const SIGNAL_UPLOAD_BATCH_SIZE = 50;
const REPORT_FILE_PATTERN = /Signal\d+_\d{8}\.csv$/i;

export function minuteToTimeText(minute: number | null): string {
  if (minute === null) return '';
  return `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
}

export function timeTextToMinute(text: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(text.trim());
  if (!match) return null;
  const minute = Number(match[1]) * 60 + Number(match[2]);
  return minute >= 0 && minute < 1_440 ? minute : null;
}

export function numberOrNull(text: string): number | null {
  if (text.trim() === '') return null;
  const value = Number(text);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

/** 選んだフォルダの中から日報CSVだけを残し、送信単位に分ける。 */
export function planSignalUpload<T extends { name: string }>(files: T[]): { batches: T[][]; ignored: number } {
  const reports = files.filter((file) => REPORT_FILE_PATTERN.test(file.name));
  const batches: T[][] = [];
  for (let index = 0; index < reports.length; index += SIGNAL_UPLOAD_BATCH_SIZE) {
    batches.push(reports.slice(index, index + SIGNAL_UPLOAD_BATCH_SIZE));
  }
  return { batches, ignored: files.length - reports.length };
}

/** 共通区分の index（RUN, RUN_ALARM, STOP, ALARM_STOP, IDLE, NO_RECORD の順）。 */
const CATEGORY_INDEX: Record<MachineSignalCategory, number> = {
  RUN: 0,
  RUN_ALARM: 1,
  STOP: 2,
  ALARM_STOP: 3,
  IDLE: 4,
  NO_RECORD: 5
};
const NO_RECORD_INDEX = 5;
const DAY_SECONDS = 86_400;

type SensorSegments = Pick<MachineSignalSensor, 'latestSegments' | 'lampPatterns'>;

/** 最新の日報を、読み替え（上書き）を反映した [開始秒, 継続秒, 区分index] の帯にする。 */
export function buildSensorTimeline(
  sensor: SensorSegments,
  overrides: Record<string, MachineSignalCategory>
): Array<[number, number, number]> {
  return sensor.latestSegments.map(([start, duration, patternIndex]) => {
    const pattern = sensor.lampPatterns[patternIndex];
    const category = pattern ? (overrides[pattern.pattern] ?? pattern.autoCategory) : 'NO_RECORD';
    return [start, duration, CATEGORY_INDEX[category]];
  });
}

export type SensorDayBase = {
  hasRecord: boolean;
  runSeconds: number;
  alarmSeconds: number;
  alarmCount: number;
  /** 最初の稼働より後の、停止1回ごとの長さ（秒） */
  stopSeconds: number[];
};

/** しきい値に依らない1日分の材料（稼働、赤ランプ、停止の長さ）。しきい値を変えるたびの数え直しに使う。 */
export function computeSensorDayBase(timeline: Array<[number, number, number]>): SensorDayBase {
  let cursor = 0;
  let runSeconds = 0;
  let alarmSeconds = 0;
  let alarmCount = 0;
  let previous = -1;
  let started = false;
  let stop = 0;
  const stopSeconds: number[] = [];
  const push = (seconds: number, category: number) => {
    const isRun = category === 0 || category === 1;
    if (category === 1 || category === 3) {
      alarmSeconds += seconds;
      if (category !== previous) alarmCount += 1;
    }
    if (isRun) {
      runSeconds += seconds;
      started = true;
      if (stop > 0) stopSeconds.push(stop);
      stop = 0;
    } else if (started) {
      stop += seconds;
    }
    previous = category;
  };
  for (const [start, duration, category] of timeline) {
    if (start > cursor) push(start - cursor, NO_RECORD_INDEX);
    push(duration, category);
    cursor = start + duration;
  }
  if (cursor < DAY_SECONDS) push(DAY_SECONDS - cursor, NO_RECORD_INDEX);
  if (stop > 0) stopSeconds.push(stop);
  return { hasRecord: timeline.length > 0, runSeconds, alarmSeconds, alarmCount, stopSeconds };
}

export type SensorHintKey = 'ALARM' | 'SHORT_STOPS' | 'LONG_STOP' | 'BARELY_RAN' | 'GOOD';

/** その条件で、何台がどの気づきになるか。判定の順はキオスクと同じ。 */
export function countSensorHints(bases: SensorDayBase[], thresholds: MachineSignalThresholds): Record<SensorHintKey, number> {
  const counts: Record<SensorHintKey, number> = { ALARM: 0, SHORT_STOPS: 0, LONG_STOP: 0, BARELY_RAN: 0, GOOD: 0 };
  for (const base of bases) {
    if (!base.hasRecord) continue;
    const shortStops = base.stopSeconds.filter((seconds) => seconds <= thresholds.shortStopMaxSeconds).length;
    if (base.alarmSeconds >= thresholds.alarmSecondsForHint || base.alarmCount >= thresholds.alarmCountForHint) counts.ALARM += 1;
    else if (shortStops >= thresholds.shortStopCountForHint) counts.SHORT_STOPS += 1;
    else if (base.runSeconds < thresholds.barelyRanMaxSeconds) counts.BARELY_RAN += 1;
    else if (base.stopSeconds.some((seconds) => seconds > thresholds.longStopMinSeconds)) counts.LONG_STOP += 1;
    else if (base.runSeconds >= thresholds.goodRunMinSeconds) counts.GOOD += 1;
  }
  return counts;
}

/** 「47 * * * *」のような毎時の設定を「毎時 :47 / 次は 15:47」と読める形にする。それ以外は設定の文字列をそのまま返す。 */
export function describeGmailSchedule(schedule: string | null, now: Date): { label: string; next: string | null } {
  if (!schedule) return { label: '未設定', next: null };
  const match = /^(\d{1,2}) \* \* \* \*$/.exec(schedule.trim());
  if (!match) return { label: schedule, next: null };
  const minute = Number(match[1]);
  const next = new Date(now);
  next.setSeconds(0, 0);
  next.setMinutes(minute);
  if (next.getTime() <= now.getTime()) next.setHours(next.getHours() + 1);
  const text = `${String(next.getHours()).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  return { label: `毎時 :${String(minute).padStart(2, '0')}`, next: text };
}

export type Box = { left: number; right: number; top: number; bottom: number };

/**
 * 編集パネルを、選んだ行のすぐ隣に置く位置を決める。
 * 右に入らなければ左へ。mode が below なら、押したボタンの真下に右端をそろえて出す。
 */
export function placeBeside(
  anchor: Box,
  size: { width: number; height: number },
  viewport: { width: number; height: number },
  mode: 'beside' | 'below' = 'beside'
): { left: number; top: number } {
  const margin = 8;
  const gap = 10;
  let left: number;
  let top: number;
  if (mode === 'below') {
    left = anchor.right - size.width;
    top = anchor.bottom + margin;
  } else {
    left = anchor.right + gap + size.width <= viewport.width - margin ? anchor.right + gap : anchor.left - size.width - gap;
    top = anchor.top - 52;
  }
  return {
    left: Math.max(margin, left),
    top: Math.min(Math.max(margin, top), Math.max(margin, viewport.height - size.height - margin))
  };
}
