import { parse } from 'csv-parse/sync';
import iconv from 'iconv-lite';

import {
  SIGNAL_DAY_SECONDS,
  type LampCode,
  type ParsedSignalDailyReport,
  type SignalSegmentTuple,
} from './signal-report.types.js';

export class SignalDailyReportParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SignalDailyReportParseError';
  }
}

const FILE_NAME_PATTERN = /Signal(\d+)_(\d{4})(\d{2})(\d{2})\.csv$/i;
const DATE_TIME_PATTERN = /^(\d{4})\/(\d{1,2})\/(\d{1,2}) (\d{1,2}):(\d{2}):(\d{2})$/;
const DATE_PATTERN = /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/;
const LAMP_TOTAL_LABEL = /^(?:[赤黄緑青白]点[灯滅]|ブザーO(?:N|FF))$/;
const HEADER_LABEL = '日報データ';
const UNNAMED_STATE = '(名称なし)';

/** `DailySummary_Signal8_20261001.csv` → センサー番号と日付。形式が違えば null。 */
export function parseSignalFileName(fileName: string): { signalNo: number; reportDate: string } | null {
  const match = FILE_NAME_PATTERN.exec(fileName);
  if (!match) return null;
  return { signalNo: Number(match[1]), reportDate: `${match[2]}-${match[3]}-${match[4]}` };
}

/** UTF-8 として読めなければ Shift_JIS とみなす（導入時期の古いセンサーの出力に備える）。 */
export function decodeSignalCsv(content: Buffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(content).replace(/^\uFEFF/, '');
  } catch {
    return iconv.decode(content, 'cp932');
  }
}

function toLampCode(value: string | undefined): LampCode {
  const code = Number((value ?? '').trim());
  return code === 1 || code === 2 || code === 4 ? code : 0;
}

function toEpochSeconds(match: RegExpExecArray): number {
  // 日報の時刻はタイムゾーンなしの現地時刻。差分だけ使うのでUTCとして数える。
  return (
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5]), Number(match[6])) /
    1000
  );
}

/** 状態定義の表記（`赤点灯:黄消灯:緑消灯::::異常停止`）から状態名を取り出す。 */
function stateNameOf(definition: string): string {
  const name = definition.slice(definition.lastIndexOf(':') + 1).trim();
  return name.length > 0 ? name : UNNAMED_STATE;
}

/**
 * 信号灯センサーの日報CSV（1ファイル=1センサー×1日）を解析する。
 * 行位置ではなく内容で各ブロックを見分けるので、センサーごとに行数が違っても読める。
 */
export function parseSignalDailyReport(content: Buffer): ParsedSignalDailyReport {
  const rows = parse(decodeSignalCsv(content), {
    relax_column_count: true,
    skip_empty_lines: false,
  }) as string[][];

  const header = rows[0];
  const dateMatch = header ? DATE_PATTERN.exec((header[1] ?? '').trim()) : null;
  if (!header || (header[0] ?? '').trim() !== HEADER_LABEL || !dateMatch) {
    throw new SignalDailyReportParseError('1行目が「日報データ,日付,機械名」の形式ではありません');
  }
  const reportDate = `${dateMatch[1]}-${dateMatch[2].padStart(2, '0')}-${dateMatch[3].padStart(2, '0')}`;
  const machineName = (header[2] ?? '').trim();

  const summary: Record<string, string> = {};
  let dayStartMinute: number | null = null;
  const stateNames: string[] = [];
  const stateIndex = new Map<string, number>();
  const raw: Array<{ start: number; end: number; lamps: [LampCode, LampCode, LampCode]; state: number }> = [];

  for (const row of rows.slice(1)) {
    const label = (row[0] ?? '').trim();
    if (label.length === 0) continue;

    const startMatch = DATE_TIME_PATTERN.exec(label);
    if (startMatch) {
      const endMatch = DATE_TIME_PATTERN.exec((row[1] ?? '').trim());
      if (!endMatch) continue;
      const definition = [...row].reverse().find((cell) => cell.includes(':') && !DATE_TIME_PATTERN.test(cell.trim()));
      const name = definition ? stateNameOf(definition) : UNNAMED_STATE;
      let index = stateIndex.get(name);
      if (index === undefined) {
        index = stateNames.push(name) - 1;
        stateIndex.set(name, index);
      }
      raw.push({
        start: toEpochSeconds(startMatch),
        end: toEpochSeconds(endMatch),
        lamps: [toLampCode(row[3]), toLampCode(row[4]), toLampCode(row[5])],
        state: index,
      });
      continue;
    }

    const countMatch = /^カウント (\d{1,2}):(\d{2})$/.exec(label);
    if (countMatch) {
      dayStartMinute ??= Number(countMatch[1]) * 60 + Number(countMatch[2]);
      continue;
    }
    // 状態別・ランプ別の合計はログから再計算できるので保存しない。
    if (label.includes(':') || LAMP_TOTAL_LABEL.test(label)) continue;
    const value = (row[1] ?? '').trim();
    if (value.length > 0 && !(label in summary)) summary[label] = value;
  }

  const startOfDay =
    Date.UTC(Number(dateMatch[1]), Number(dateMatch[2]) - 1, Number(dateMatch[3])) / 1000 + (dayStartMinute ?? 480) * 60;
  const segments: SignalSegmentTuple[] = [];
  let cursor = 0;
  for (const item of raw.sort((a, b) => a.start - b.start)) {
    const start = Math.max(cursor, item.start - startOfDay, 0);
    const end = Math.min(item.end - startOfDay, SIGNAL_DAY_SECONDS);
    if (end <= start) continue;
    segments.push([start, end - start, item.lamps[0], item.lamps[1], item.lamps[2], item.state]);
    cursor = end;
  }

  return { reportDate, machineName, dayStartMinute: dayStartMinute ?? 480, summary, stateNames, segments };
}
