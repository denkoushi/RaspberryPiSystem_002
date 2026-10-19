import iconv from 'iconv-lite';
import { describe, expect, it } from 'vitest';

import { parseSignalDailyReport, parseSignalFileName, SignalDailyReportParseError } from '../signal-daily-report.parser.js';

const pad = (cells: string[]) => [...cells, ...new Array(10 - cells.length).fill('')].join(',');

function buildReport(events: string[], options: { machineName?: string; countStart?: string } = {}): string {
  return [
    pad(['日報データ', '2026/10/01', ` ${options.machineName ?? 'HCN4000'}`]),
    pad(['稼働時間', '06:12:19']),
    pad(['稼働率', '56.4']),
    pad(['目標生産数', '---']),
    pad([]),
    pad([`カウント ${options.countStart ?? '08:00'}`]),
    pad(['カウント 09:00']),
    pad(['::緑点灯::::設備稼働', '06:12:19', '16', '00:23:16', '56.38']),
    pad(['::::::']),
    pad(['赤点灯', '00:27:04', '10', '00:02:42']),
    pad(['ブザーOFF', '12:38:00', '1', '12:38:00']),
    pad([]),
    ...events,
    '',
  ].join('\r\n');
}

const EVENTS = [
  '2026/10/01 19:22:00,2026/10/01 19:24:11,131,1,1,1,,,,赤消灯:黄消灯:緑消灯::::設備待機',
  '2026/10/01 19:24:11,2026/10/01 19:24:25,14,,,2,,,,::緑点灯::::設備稼働',
  '2026/10/02 07:56:19,2026/10/02 08:00:00,221,2,1,1,,,,赤点灯:黄消灯:緑消灯::::異常停止',
];

describe('parseSignalFileName', () => {
  it('reads the sensor number and date from the attachment name', () => {
    expect(parseSignalFileName('DailySummary_Signal8_20261001.csv')).toEqual({ signalNo: 8, reportDate: '2026-10-01' });
  });

  it('returns null for other files', () => {
    expect(parseSignalFileName('summary.csv')).toBeNull();
  });
});

describe('parseSignalDailyReport', () => {
  it('reads the header, the vendor summary and the state log relative to the day start', () => {
    const report = parseSignalDailyReport(Buffer.from(buildReport(EVENTS), 'utf-8'));

    expect(report.reportDate).toBe('2026-10-01');
    expect(report.machineName).toBe('HCN4000');
    expect(report.dayStartMinute).toBe(480);
    expect(report.summary).toEqual({ 稼働時間: '06:12:19', 稼働率: '56.4', 目標生産数: '---' });
    expect(report.stateNames).toEqual(['設備待機', '設備稼働', '異常停止']);
    expect(report.segments).toEqual([
      [40_920, 131, 1, 1, 1, 0],
      [41_051, 14, 0, 0, 2, 1],
      [86_179, 221, 2, 1, 1, 2],
    ]);
  });

  it('keeps a report that has no state log', () => {
    const report = parseSignalDailyReport(Buffer.from(buildReport([]), 'utf-8'));
    expect(report.segments).toEqual([]);
    expect(report.stateNames).toEqual([]);
  });

  it('names a state whose definition has no label', () => {
    const report = parseSignalDailyReport(
      Buffer.from(buildReport(['2026/10/01 08:00:00,2026/10/01 09:00:00,3600,,,2,,,,::緑点灯::::']), 'utf-8')
    );
    expect(report.stateNames).toEqual(['(名称なし)']);
  });

  it('uses the first count row as the start of the day and clips the log to 24 hours', () => {
    const report = parseSignalDailyReport(
      Buffer.from(
        buildReport(['2026/10/01 05:00:00,2026/10/02 07:00:00,93600,1,1,2,,,,赤消灯:黄消灯:緑点灯::::設備稼働'], {
          countStart: '06:00',
        }),
        'utf-8'
      )
    );
    expect(report.dayStartMinute).toBe(360);
    expect(report.segments).toEqual([[0, 86_400, 1, 1, 2, 0]]);
  });

  it('reads Shift_JIS files from older sensors', () => {
    const report = parseSignalDailyReport(iconv.encode(buildReport(EVENTS, { machineName: '圧延ライン-5' }), 'cp932'));
    expect(report.machineName).toBe('圧延ライン-5');
    expect(report.stateNames).toContain('異常停止');
  });

  it('rejects a file that is not a daily report', () => {
    expect(() => parseSignalDailyReport(Buffer.from('a,b,c\r\n1,2,3\r\n', 'utf-8'))).toThrow(SignalDailyReportParseError);
  });
});
