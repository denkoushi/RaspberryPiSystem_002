import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';

import { parseInternalScheduleMinutesXlsx } from './parse-internal-schedule-minutes.js';

function fixture(name = '1106結果') {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(name);
  sheet.getCell('A1').value = '日程会議事前資料';
  sheet.getCell('B1').value = new Date('2026-11-06Z');
  sheet.addRow(['【架空区分】', null, null, null, '進捗']);
  sheet.addRow(['製番', '製品名', '客先名', '台数', '出図', '部品', '組立・制御', '備考']);
  sheet.addRow(['BA1SB203\n(BA1SB202)', '架空製品', '架空客先', 1, null, 46338, '12/31', '【架空備考】']);
  return { workbook, sheet };
}
async function parse(workbook: ExcelJS.Workbook, filename = '日程会議議事録_1106.xlsx', receivedAt: Date | null = new Date('2026-11-07Z')) {
  return parseInternalScheduleMinutesXlsx({ buffer: Buffer.from(await workbook.xlsx.writeBuffer()), filename, receivedAt });
}

describe('internal schedule minutes parser', () => {
  it('reads repeated sections by headers, aliases and unformatted serials, ignoring hidden rows and unused columns', async () => {
    const { workbook, sheet } = fixture(' １１０６ 結果 ');
    sheet.addRow(['【別区分】']);
    sheet.addRow(['製品名', ' 部 品 ', '客先名', '製番']);
    sheet.addRow(['架空製品2', new Date('2026-11-13Z'), '架空客先2', 'BA1SB204']);
    sheet.addRow(['架空製品3', 46340, '架空客先3', 'BA1SB205']).hidden = true;
    const result = await parse(workbook);
    expect(result).toMatchObject({ ok: true, assigneeColumnFound: false, meetingDate: '2026-11-06', blocks: [
      { seiban: 'BA1SB203', aliasSeibans: ['BA1SB202'], partsCompleteDate: '2026-11-12', sourceRow: 4, assignees: [], outsourceMarks: [], surfaceSendOutDates: [], memo: null, rawPartsCompleteText: '46338' },
      { seiban: 'BA1SB204', partsCompleteDate: '2026-11-13', sourceRow: 7 }
    ], warnings: [] });
  });

  it('selects only the latest normalized result sheet, even with a newer preliminary sheet', async () => {
    const { workbook } = fixture('1030結果');
    const latest = workbook.addWorksheet('１１０６ 結果');
    latest.getCell('B1').value = new Date('2026-11-06Z');
    latest.addRow(['製番', '部品']); latest.addRow(['BA1SB999', '11/14']);
    const preliminary = workbook.addWorksheet('1113事前');
    preliminary.addRow(['製番', '部品']); preliminary.addRow(['BA1SB888', '11/15']);
    expect(await parse(workbook)).toMatchObject({ ok: true, meetingDate: '2026-11-06', blocks: [{ seiban: 'BA1SB999', partsCompleteDate: '2026-11-14' }] });
  });

  it.each(['完', '-', '', '11/6？', '11/10？12？', '支給品以外完', '客先支給品以外完', 'ﾚﾝﾀﾙ費のみ\n12月その他完', '板金11/13', '最短で10/29', '11/13以降', '10/14目標', '2026/1/8停止中', '1月以降'])('preserves raw text without inventing a date for %j', async (text) => {
    const { workbook, sheet } = fixture(); sheet.getCell('F4').value = text;
    const result = await parse(workbook);
    expect(result).toMatchObject({ ok: true, blocks: [{ partsCompleteDate: null, rawPartsCompleteText: text || null }] });
    if (result.ok) expect(result.warnings.map((warning) => warning.code)).toEqual(text && text !== '-' && !text.endsWith('完') ? ['UNREADABLE_DATE'] : []);
  });

  it.each([
    { b1: new Date('2026-11-05Z'), filename: 'anything.xlsx', receivedAt: null, expected: '2026-11-05' },
    { b1: null, filename: '日程会議議事録_1105.xlsx', receivedAt: new Date('2026-11-07Z'), expected: '2026-11-05' },
    { b1: null, filename: 'anything.xlsx', receivedAt: new Date('2026-11-07Z'), expected: '2026-11-06' },
    { b1: null, filename: '日程会議議事録_1106.xlsx', receivedAt: new Date('2026-01-07Z'), expected: '2025-11-06' }
  ])('resolves the meeting date from B1, filename or sheet: %j', async ({ b1, filename, receivedAt, expected }) => {
    const { workbook, sheet } = fixture(); sheet.getCell('B1').value = b1;
    expect(await parse(workbook, filename, receivedAt)).toMatchObject({ ok: true, meetingDate: expected });
  });

  it('selects January after December across the year boundary', async () => {
    const { workbook, sheet } = fixture('1225結果'); sheet.getCell('B1').value = null;
    const older = workbook.addWorksheet('0102結果'); older.addRow(['製番', '部品']); older.addRow(['BA1SB888', '1/8']);
    expect(await parse(workbook, 'anything.xlsx', new Date('2027-01-01Z'))).toMatchObject({ ok: true, meetingDate: '2027-01-02', blocks: [{ seiban: 'BA1SB888' }] });
  });

  it('fails without any meeting date, and ignores workbooks without a result sheet or headers', async () => {
    const { workbook, sheet } = fixture(); sheet.getCell('B1').value = null;
    expect(await parse(workbook, 'anything.xlsx', null)).toMatchObject({ ok: false, reason: 'NO_BASE_DATE' });
    sheet.name = '1106事前';
    expect(await parse(workbook)).toMatchObject({ ok: false, reason: 'MISSING_HEADERS' });
    sheet.name = '1106結果'; sheet.getCell('F3').value = '他の列';
    expect(await parse(workbook)).toMatchObject({ ok: false, reason: 'MISSING_HEADERS' });
  });

  it('uses the existing year inference, plausibility check and formula warning', async () => {
    const { workbook, sheet } = fixture(); sheet.getCell('F4').value = '1/8';
    expect(await parse(workbook)).toMatchObject({ ok: true, blocks: [{ partsCompleteDate: '2027-01-08' }] });
    sheet.getCell('F4').value = new Date('1999-01-01Z');
    expect(await parse(workbook)).toMatchObject({ ok: true, blocks: [{ partsCompleteDate: null }], warnings: [{ code: 'UNREADABLE_DATE' }] });
    sheet.getCell('F4').value = { formula: 'TODAY()' };
    expect(await parse(workbook)).toMatchObject({ ok: true, blocks: [{ partsCompleteDate: null }], warnings: [{ code: 'FORMULA_NO_RESULT' }] });
  });

  it('rejects conflicting duplicate dates while retaining an independent alias', async () => {
    const { workbook, sheet } = fixture(); sheet.addRow(['BA1SB203', null, null, null, null, '11/15']);
    expect(await parse(workbook)).toMatchObject({ ok: true, blocks: [{ seiban: 'BA1SB202', partsCompleteDate: '2026-11-12' }], warnings: [{ code: 'DUPLICATE_SEIBAN' }, { code: 'DUPLICATE_SEIBAN' }] });
  });
});
