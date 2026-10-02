import type { MachineSignalThresholds } from '../../api/client';

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

/** 設定画面の入力項目。秒で保存する値は、分で入力する。 */
export const SIGNAL_THRESHOLD_FIELDS: Array<{
  key: keyof MachineSignalThresholds;
  label: string;
  unit: string;
  /** 入力値 × scale = 保存値 */
  scale: number;
}> = [
  { key: 'shortStopMaxSeconds', label: '短い停止の上限', unit: '分', scale: 60 },
  { key: 'longStopMinSeconds', label: '長い停止の下限', unit: '分', scale: 60 },
  { key: 'shortStopCountForHint', label: '「チョコ停 多」にする短い停止の回数', unit: '回', scale: 1 },
  { key: 'alarmSecondsForHint', label: '「異常 多」にする赤ランプの合計', unit: '分', scale: 60 },
  { key: 'alarmCountForHint', label: '「異常 多」にする赤ランプの回数', unit: '回', scale: 1 },
  { key: 'barelyRanMaxSeconds', label: '「ほぼ停止」にする稼働の上限', unit: '分', scale: 60 },
  { key: 'goodRunMinSeconds', label: '「良好」にする稼働の下限', unit: '分', scale: 60 },
  { key: 'worseningPercent', label: '「悪くなってきた」とする変化', unit: '%', scale: 1 }
];
