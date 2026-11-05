import { describe, expect, it } from 'vitest';

import { formulaWithoutResult, inferDate } from './date-cell.js';
import { buildWorkbook } from './__fixtures__/workbook.js';
import { parseDScheduleMinutesXlsx } from './parse-d-schedule-minutes.js';

async function parse(fixture = buildWorkbook(), filename = '20260515 D社日程会議議事録.xlsx', receivedAt: Date | null = null, subject?: string) {
  return parseDScheduleMinutesXlsx({ buffer: Buffer.from(await fixture.workbook.xlsx.writeBuffer()), filename, receivedAt, subject });
}

function success(result: Awaited<ReturnType<typeof parse>>) {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.reason);
  return result;
}

describe('parseDScheduleMinutesXlsx', () => {
  it('reads shifted May and Oct layouts identically, preserving aliases, marks, notes and hidden calendar stars', async () => {
    const may = success(await parse(buildWorkbook('May')));
    const oct = success(await parse(buildWorkbook('Oct')));
    const values = (result: typeof may) => result.blocks.map(({ sourceRow: _sourceRow, surfaceSendOutDates: _surfaceSendOutDates, ...block }) => block);
    expect(values(may)).toEqual(values(oct));
    expect(may.blocks.map((block) => block.seiban)).toEqual(['AB1C2345', 'AB1C2346', 'AB1C2347', 'AB1C2348', 'AB1C2349']);
    expect(may.blocks.map((block) => block.partsCompleteDate)).toEqual(['2026-04-30', '2026-10-30', '2026-10-19', '2026-07-14', '2026-04-30']);
    expect(may.blocks[0]).toMatchObject({ aliasSeibans: ['AB1C1111'], sourceRow: 10, rawPartsCompleteText: '確定\n4/30', memo: '※材料:4/17発注\n架空メモ' });
    expect(may.blocks[1].outsourceMarks).toEqual(['X', 'Z']);
    expect(may.blocks[2].outsourceMarks).toEqual(['Y', 'Z']);
    expect(may.blocks[0].surfaceSendOutDates).toEqual([
      { date: '2026-05-01', label: '★LSLH処理出', note: '(CT以外)' },
      { date: '2026-05-31', label: '★LSLH最終処理出', note: null }
    ]);
    expect(oct.blocks[0].surfaceSendOutDates).toEqual([
      { date: '2026-10-01', label: '★LSLH処理出', note: '(CT以外)' },
      { date: '2026-11-01', label: '★LSLH最終処理品', note: null }
    ]);
    for (const result of [may, oct]) {
      expect(result.warnings.some((warning) => warning.code === 'INVALID_SEIBAN')).toBe(false);
      expect(result.blocks[0].memo).toContain('架空メモ');
    }
    expect(may.warnings).toEqual([{ code: 'UNKNOWN_STAR', seiban: 'AB1C2345', cell: 'X12', rawText: '☆未知' }]);
  });

  it.each(['製番', '部品完成'])('fails when required header %s is missing', async (label) => {
    const fixture = buildWorkbook();
    fixture.sheet.getCell(3, label === '製番' ? 2 : fixture.parts).value = null;
    expect(await parse(fixture)).toMatchObject({ ok: false, reason: 'MISSING_HEADERS' });
  });

  it.each([-2, 1, 2])('reads the wrapped date header at parts offset %s', async (offset) => {
    const fixture = buildWorkbook();
    const column = fixture.parts + offset;
    fixture.sheet.getColumn(column).hidden = false;
    for (let index = 0; index < 5; index++) fixture.sheet.getCell(fixture.start + index * 4, column).value = null;
    fixture.sheet.getCell(fixture.start, column).value = '4/30(Q)';
    expect(success(await parse(fixture)).blocks[0].outsourceMarks).toContain('Q');
  });

  it('warns only for the unreadable cell and accepts exactly 80% readable parts dates', async () => {
    const fixture = buildWorkbook();
    fixture.sheet.getCell(fixture.start + 2, 24).value = null;
    fixture.sheet.getCell(fixture.start, fixture.parts).value = '4月末';
    const result = success(await parse(fixture));
    expect(result.blocks).toHaveLength(5);
    expect(result.blocks[0].partsCompleteDate).toBeNull();
    expect(result.blocks[1].partsCompleteDate).toBe('2026-10-30');
    expect(result.warnings).toEqual([{ code: 'UNREADABLE_DATE', seiban: 'AB1C2345', cell: 'N10', rawText: '4月末' }]);
  });

  it('fails below the 80% parts date threshold', async () => {
    const fixture = buildWorkbook();
    fixture.sheet.getCell(fixture.start, fixture.parts).value = '4月末';
    fixture.sheet.getCell(fixture.start + 4, fixture.parts).value = '-';
    expect(await parse(fixture)).toMatchObject({ ok: false, reason: 'INSUFFICIENT_PARTS_COMPLETE_DATES' });
  });

  it.each(['20261220', '20260105'])('resolves month/day within the reference window around %s', async (date) => {
    const fixture = buildWorkbook();
    fixture.sheet.getCell(fixture.start, fixture.parts).value = date === '20261220' ? '1/10' : '12/25';
    const result = success(await parse(fixture, `${date} D社日程会議議事録.xlsx`));
    expect(result.blocks[0].partsCompleteDate).toBe(date === '20261220' ? '2027-01-10' : '2025-12-25');
  });

  it('falls back to receivedAt, ignores BC1, and fails without any base date', async () => {
    expect(success(await parse(buildWorkbook(), 'minutes.xlsx', new Date('2026-05-15T00:00:00Z'))).meetingDate).toBe('2026-05-15');
    expect(success(await parse(buildWorkbook(), '20260230 minutes.xlsx', new Date('2026-05-15T00:00:00Z'))).meetingDate).toBe('2026-05-15');
    expect(await parse(buildWorkbook(), 'minutes.xlsx')).toMatchObject({ ok: false, reason: 'NO_BASE_DATE' });
  });

  it.each(['議事録_20261030_確定.xlsx', '20260230_議事録_20261030.xlsx'])('uses a valid YYYYMMDD anywhere in %s before subject/receipt', async (filename) => {
    const result = success(await parse(buildWorkbook('Oct'), filename, new Date('2026-11-01Z'), '日程会議議事録 11/1'));
    expect(result.meetingDate).toBe('2026-10-30');
  });

  it.each(['日程会議議事録 10/30', '日程会議議事録　１０／３０'])('uses the normalized subject date: %s', async (subject) => {
    expect(success(await parse(buildWorkbook('Oct'), '議事録.xlsx', new Date('2026-11-01Z'), subject)).meetingDate).toBe('2026-10-30');
  });

  it.each([
    ['2027-01-03Z', '12/27', '2026-12-27'],
    ['2026-12-30Z', '1/3', '2027-01-03'],
    ['2026-10-30Z', '2/30', '2026-10-30']
  ])('resolves subject %s / %s to the nearest valid date or receipt', async (receivedAt, subject, expected) => {
    expect(success(await parse(buildWorkbook('Oct'), '議事録.xlsx', new Date(receivedAt), subject)).meetingDate).toBe(expected);
  });

  it.each([45, 46])('warns for subject/receipt differences only over 45 days (%s)', async (days) => {
    const receivedAt = new Date(Date.parse('2026-05-15Z') + days * 86400000);
    const result = success(await parse(buildWorkbook(), '議事録.xlsx', receivedAt, '議事録 5/15'));
    expect(result.meetingDate).toBe('2026-05-15');
    expect(result.warnings.some((warning) => warning.code === 'FILENAME_DATE_MISMATCH')).toBe(days > 45);
  });

  it.each(['missing', 'invalid'])('fails on %s calendar month labels', async (kind) => {
    const fixture = buildWorkbook();
    fixture.sheet.getCell(3, 22).value = kind === 'missing' ? null : '13月';
    expect(await parse(fixture)).toMatchObject({ ok: false, reason: 'UNDETERMINABLE_CALENDAR' });
  });

  it('warns for malformed seibans and fails if no valid blocks remain', async () => {
    const fixture = buildWorkbook();
    fixture.sheet.getCell(fixture.start, 2).value = 'bad job';
    expect(success(await parse(fixture)).warnings).toContainEqual({ code: 'INVALID_SEIBAN', seiban: null, cell: 'B10', rawText: 'bad job' });
    for (let index = 1; index < 5; index++) fixture.sheet.getCell(fixture.start + index * 4, 2).value = null;
    expect(await parse(fixture)).toMatchObject({ ok: false, reason: 'ZERO_BLOCKS' });
  });

  it.each([false, true])('accepts native dates, numeric serials and cached formulas (date1904=%s)', async (date1904) => {
    const fixture = buildWorkbook();
    fixture.workbook.properties.date1904 = date1904;
    fixture.sheet.getCell(fixture.start, fixture.parts).value = new Date('2026-04-30T00:00:00Z');
    const serial = (Date.parse('2026-04-30') - Date.parse(date1904 ? '1904-01-01' : '1899-12-30')) / 86400000;
    fixture.sheet.getCell(fixture.start + 4, fixture.parts).value = serial;
    fixture.sheet.getCell(fixture.start + 8, fixture.parts).value = { formula: '1+1', result: serial };
    expect(success(await parse(fixture)).blocks.slice(0, 3).map((block) => block.partsCompleteDate)).toEqual(Array(3).fill('2026-04-30'));
  });

  it('ignores blank/no-value dates and does not treat memo dates as dates', async () => {
    const fixture = buildWorkbook();
    for (let index = 0; index < 5; index++) fixture.sheet.getCell(fixture.start + index * 4, fixture.parts - 1).value = ['', '無し', '-', '発注 4/30', '※4/30'][index];
    const result = success(await parse(fixture));
    expect(result.warnings).toHaveLength(1); // unknown star only
    expect(result.blocks[3].memo).toBe('発注 4/30\n架空メモ');
  });

  it('skips hidden/filter-excluded blocks and reads visible grouped rows', async () => {
    const fixture = buildWorkbook();
    fixture.sheet.autoFilter = 'A7:BC29';
    fixture.sheet.getRow(fixture.start + 4).hidden = true; // persisted filter exclusion
    fixture.sheet.properties.outlineLevelRow = 1;
    fixture.sheet.getRow(fixture.start + 8).outlineLevel = 1;
    fixture.sheet.getCell(fixture.start + 1, 23).value = '★LSLH処理出';
    const result = success(await parse(fixture));
    expect(result.blocks.map((block) => block.seiban)).toEqual(['AB1C2345', 'AB1C2347', 'AB1C2348', 'AB1C2349']);
    expect(result.blocks[0].surfaceSendOutDates).toContainEqual({ date: '2026-05-02', label: '★LSLH処理出', note: null });
  });

  it('rejects a month boundary whose next month label is missing', async () => {
    const fixture = buildWorkbook('Oct');
    fixture.sheet.getCell(3, 53).value = null;
    expect(await parse(fixture)).toMatchObject({ ok: false, reason: 'UNDETERMINABLE_CALENDAR' });
  });

  it('reads visible grouped columns and hidden calendar columns but skips hidden rows', async () => {
    const fixture = buildWorkbook();
    fixture.sheet.properties.outlineLevelCol = 1;
    fixture.sheet.getColumn(fixture.parts - 1).outlineLevel = 1;
    fixture.sheet.getCell(fixture.start, fixture.parts - 1).value = 'bad collapsed date';
    fixture.sheet.getRow(fixture.start + 4).hidden = true;
    fixture.sheet.getCell(fixture.start + 4, 22).value = '★LSLH処理出';
    const result = success(await parse(fixture));
    expect(result.blocks[0].memo).toBe('架空メモ');
    expect(result.warnings.map((warning) => warning.code)).toEqual(['UNREADABLE_DATE', 'UNKNOWN_STAR']);
    expect(result.blocks.map((block) => block.seiban)).toEqual(['AB1C2345', 'AB1C2347', 'AB1C2348', 'AB1C2349']);
    expect(result.blocks[0].surfaceSendOutDates).toContainEqual({ date: '2026-05-01', label: '★LSLH処理出', note: '(CT以外)' });
  });

  it('uses the first sheet when there is no 日程表 sheet', async () => {
    const fixture = buildWorkbook();
    fixture.workbook.removeWorksheet(fixture.workbook.worksheets[0].id);
    fixture.sheet.name = '議事録';
    expect(success(await parse(fixture)).blocks).toHaveLength(5);
  });

  it.each([1030, 10.3, 19999, 60000, new Date('2016-10-30Z'), new Date('2030-01-01Z'), '2023/05/14', '2029/05/16'])('rejects implausible date %s', async (value) => {
    const fixture = buildWorkbook();
    fixture.sheet.getCell(fixture.start, fixture.parts).value = value;
    const result = success(await parse(fixture));
    expect(result.blocks[0].partsCompleteDate).toBeNull();
    expect(result.warnings).toContainEqual(expect.objectContaining({ code: 'UNREADABLE_DATE', cell: 'N10' }));
  });

  it.each(['2023/05/15', '2029/05/15', '2025/02/07'])('accepts the inclusive plausibility boundary %s', async (value) => {
    const fixture = buildWorkbook();
    fixture.sheet.getCell(fixture.start, fixture.parts).value = value;
    expect(success(await parse(fixture)).blocks[0].partsCompleteDate).toBe(value.replaceAll('/', '-'));
  });

  it('applies date plausibility to other date columns too', async () => {
    const fixture = buildWorkbook();
    fixture.sheet.getCell(fixture.start, fixture.parts - 1).value = 1030;
    expect(success(await parse(fixture)).warnings).toContainEqual(expect.objectContaining({ code: 'UNREADABLE_DATE', cell: 'M10' }));
  });

  it.each(['parts', 'memo', 'calendar', 'seiban', 'otherDate'])('rejects merge masters outside the block in %s', async (kind) => {
    const fixture = buildWorkbook();
    const col = { parts: fixture.parts, memo: fixture.memo, calendar: 22, seiban: 2, otherDate: fixture.parts - 1 }[kind]!;
    fixture.sheet.mergeCells(fixture.start, col, fixture.start + 4, col);
    const result = success(await parse(fixture));
    expect(result.warnings).toContainEqual(expect.objectContaining({ code: 'MERGED_ACROSS_BLOCKS', cell: fixture.sheet.getCell(fixture.start + 4, col).address }));
    if (kind === 'parts') expect(result.blocks[1].partsCompleteDate).toBeNull();
    if (kind === 'memo') expect(result.blocks[1].memo).toBeNull();
    if (kind === 'calendar') expect(result.blocks[1].surfaceSendOutDates).toEqual([]);
    if (kind === 'seiban') expect(result.blocks.some((block) => block.sourceRow === fixture.start + 4)).toBe(false);
  });

  it('accepts a merged date inside one block', async () => {
    const fixture = buildWorkbook();
    fixture.sheet.mergeCells(fixture.start, fixture.parts, fixture.start + 3, fixture.parts);
    const result = success(await parse(fixture));
    expect(result.blocks[0].partsCompleteDate).toBe('2026-04-30');
    expect(result.warnings.some((warning) => warning.code === 'MERGED_ACROSS_BLOCKS')).toBe(false);
  });

  it.each(['number', 'seiban', 'short', 'long'])('skips inconsistent seibans and keeps only unambiguous values for a malformed %s block', async (kind) => {
    const fixture = buildWorkbook();
    if (kind === 'number') fixture.sheet.getCell(fixture.start + 2, 1).value = 4;
    if (kind === 'seiban') fixture.sheet.getCell(fixture.start + 2, 2).value = 'ZZZZ9999';
    if (kind === 'short') fixture.sheet.spliceRows(fixture.start + 2, 1);
    if (kind === 'long') fixture.sheet.spliceRows(fixture.start + 2, 0, []);
    const result = success(await parse(fixture));
    expect(result.warnings).toContainEqual(expect.objectContaining({ code: 'BLOCK_SHAPE', seiban: 'AB1C2345' }));
    if (kind === 'number') expect(result.blocks[0]).toMatchObject({ partsCompleteDate: '2026-04-30', surfaceSendOutDates: [], outsourceMarks: [], memo: '架空メモ' });
    else expect(result.blocks.some((block) => block.sourceRow === fixture.start)).toBe(false);
  });

  it('does not keep a row-1 date when its identifying row is invalid', async () => {
    const fixture = buildWorkbook();
    fixture.sheet.getCell(fixture.start, 1).value = 2;
    expect(success(await parse(fixture)).blocks.some((block) => block.sourceRow === fixture.start)).toBe(false);
  });

  it.each(['seiban', 'parts'])('warns for uncached %s formulas only after the first valid block', async (kind) => {
    const fixture = buildWorkbook();
    fixture.sheet.getCell(6, 2).value = { formula: 'J1' };
    fixture.sheet.getCell(6, fixture.parts).value = { formula: 'N1' };
    const col = kind === 'seiban' ? 2 : fixture.parts;
    fixture.sheet.getCell(fixture.start + 4, col).value = { formula: 'J1' };
    const result = success(await parse(fixture));
    expect(result.warnings.filter((warning) => warning.code === 'FORMULA_NO_RESULT').map((warning) => warning.cell)).toEqual([fixture.sheet.getCell(fixture.start + 4, col).address]);
    if (kind === 'parts') expect(result.blocks[1].partsCompleteDate).toBeNull();
  });

  it.each([0, ''])('treats cached formula result %j as present', (result) => {
    const fixture = buildWorkbook();
    const cell = fixture.sheet.getCell(fixture.start + 4, 2);
    cell.value = { formula: 'J1', result };
    expect(cell.result).toBe(result);
    expect(formulaWithoutResult(cell)).toBe(false);
  });

  it('silently skips a cached-zero formula template after a valid block', async () => {
    const fixture = buildWorkbook();
    for (let offset = 0; offset < 4; offset++) {
      fixture.sheet.getCell(fixture.start + 4 + offset, 2).value = { formula: 'J1', result: 0 };
    }
    const result = success(await parse(fixture));
    expect(result.blocks).toHaveLength(4);
    expect(result.warnings.filter((warning) => warning.code !== 'UNKNOWN_STAR')).toEqual([]);
  });

  it('reads each stacked date header at its own physical row offset without duplicate warnings', async () => {
    const fixture = buildWorkbook();
    fixture.sheet.getCell(5, fixture.order).value = null;
    fixture.sheet.getCell(5, fixture.parts - 1).value = '注文書納期';
    fixture.sheet.getCell(3, fixture.parts - 2).value = null;
    fixture.sheet.getCell(5, fixture.parts).value = '最終部品完';
    for (let index = 0; index < 5; index++) {
      fixture.sheet.getCell(fixture.start + index * 4 + 2, fixture.parts - 1).value = '2026/11/2(Q)';
      fixture.sheet.getCell(fixture.start + index * 4 + 2, fixture.parts).value = '2026/11/3(R)';
    }
    fixture.sheet.getCell(fixture.start, fixture.parts - 1).value = 'bad date';
    const result = success(await parse(fixture));
    expect(result.blocks[0].partsCompleteDate).toBe('2026-04-30');
    expect(result.blocks[0].outsourceMarks).toEqual(['Q', 'R']);
    expect(result.warnings.filter((warning) => warning.code === 'UNREADABLE_DATE')).toEqual([
      expect.objectContaining({ cell: 'M10' })
    ]);
  });

  it.each([45, 46])('warns for filename/receipt differences only over 45 days (%s)', async (days) => {
    const receivedAt = new Date(Date.parse('2026-05-15') + days * 86400000);
    const result = success(await parse(buildWorkbook(), '20260515.xlsx', receivedAt));
    expect(result.meetingDate).toBe('2026-05-15');
    expect(result.warnings.some((warning) => warning.code === 'FILENAME_DATE_MISMATCH')).toBe(days > 45);
  });

  it('prefers the normalized exact sheet name over a containing name', async () => {
    const fixture = buildWorkbook();
    const decoy = fixture.workbook.worksheets[0];
    decoy.name = '旧日程表';
    fixture.sheet.name = ' 日 程 表 ';
    expect(success(await parse(fixture)).blocks).toHaveLength(5);
  });

  it('picks the containing sheet with the most valid blocks and warns about multiple candidates', async () => {
    const fixture = buildWorkbook();
    const decoy = fixture.workbook.worksheets[0];
    decoy.name = '旧日程表';
    decoy.getCell(1, 2).value = '製番';
    for (let offset = 0; offset < 4; offset++) {
      decoy.getCell(3 + offset, 1).value = offset + 1;
      decoy.getCell(3 + offset, 2).value = 'ZZZZ9999';
    }
    const result = success(await parse(fixture));
    expect(result.blocks).toHaveLength(5);
    expect(result.warnings.filter((warning) => warning.code === 'MULTIPLE_SCHEDULE_SHEETS')).toHaveLength(1);
  });

  it.each(['☆LSLH処理出', '※LSLH処理出', 'LSLH処理出', '☆unknown', '処理品'])('warns about star look-alike %s', async (value) => {
    const fixture = buildWorkbook();
    fixture.sheet.getCell(fixture.start, 22).value = value;
    const result = success(await parse(fixture));
    expect(result.warnings).toContainEqual(expect.objectContaining({ code: 'UNKNOWN_STAR', cell: 'V10' }));
    expect(result.blocks[0].surfaceSendOutDates).toHaveLength(1);
  });

  it.each(['※要調整', '※架空担当', 'ＬＳＬＨ完', '※note', '☆LSLH処理出 戻', '※LSLH処理品 戻'])('silently ignores calendar note %s', async (value) => {
    const fixture = buildWorkbook();
    fixture.sheet.getCell(fixture.start, 22).value = value;
    const result = success(await parse(fixture));
    expect(result.warnings.some((warning) => warning.cell === 'V10')).toBe(false);
    expect(result.blocks[0].surfaceSendOutDates).toHaveLength(1);
  });

  it('uppercases NFKC-normalized seibans and aliases', async () => {
    const fixture = buildWorkbook();
    for (let offset = 0; offset < 4; offset++) fixture.sheet.getCell(fixture.start + offset, 2).value = 'ａｂ１ｃ２３４５（ab1c1111）';
    expect(success(await parse(fixture)).blocks[0]).toMatchObject({ seiban: 'AB1C2345', aliasSeibans: ['AB1C1111'] });
  });

  it.each(['hidden', 'veryHidden'] as const)('excludes %s schedule sheets even with an exact name and more valid blocks', async (state) => {
    const fixture = buildWorkbook();
    const decoy = fixture.workbook.addWorksheet('日程表', { state });
    fixture.sheet.eachRow((row, r) => row.eachCell((cell, c) => { decoy.getCell(r, c).value = cell.value; }));
    for (let offset = 0; offset < 4; offset++) {
      decoy.getCell(30 + offset, 1).value = offset + 1;
      decoy.getCell(30 + offset, 2).value = 'ZZZZ9999';
    }
    const result = success(await parse(fixture));
    expect(result.blocks).toHaveLength(5);
    expect(result.blocks[0].partsCompleteDate).toBe('2026-04-30');
    expect(result.warnings.some((warning) => warning.code === 'MULTIPLE_SCHEDULE_SHEETS')).toBe(false);
    fixture.sheet.state = state;
    expect(await parse(fixture)).toMatchObject({ ok: false, reason: 'MISSING_HEADERS' });
  });

  it.each(['製番', '部品完成'])('fails clearly on duplicate required header %s', async (label) => {
    const fixture = buildWorkbook();
    fixture.sheet.getCell(3, 20).value = label;
    expect(await parse(fixture)).toMatchObject({ ok: false, reason: expect.stringContaining(`DUPLICATE_REQUIRED_HEADER: ${label}`) });
  });

  it.each([-1, 1])('rejects a parts date merged horizontally across header offset %s', async (offset) => {
    const fixture = buildWorkbook();
    const left = Math.min(fixture.parts, fixture.parts + offset);
    const right = Math.max(fixture.parts, fixture.parts + offset);
    fixture.sheet.getCell(fixture.start, left).value = '4/30';
    fixture.sheet.mergeCells(fixture.start, left, fixture.start, right);
    const result = success(await parse(fixture));
    expect(result.blocks[0].partsCompleteDate).toBeNull();
    expect(result.warnings).toContainEqual(expect.objectContaining({ code: 'MERGED_ACROSS_HEADERS', seiban: 'AB1C2345' }));
  });

  it.each(['取消 4/30', '※4/30', '4/30 発注済', '4/30(木)', '4/30→5/10', '要確認4/30'])('warns and skips decorated due date %s', async (value) => {
    const fixture = buildWorkbook();
    fixture.sheet.getCell(fixture.start, fixture.parts).value = value;
    const result = success(await parse(fixture));
    expect(result.blocks[0].partsCompleteDate).toBeNull();
    expect(result.warnings).toContainEqual(expect.objectContaining({ code: 'UNREADABLE_DATE', cell: 'N10', rawText: value }));
  });

  it.each([0, 1, 2, 3])('skips the whole block when seiban differs on row offset %s', async (offset) => {
    const fixture = buildWorkbook();
    fixture.sheet.getCell(fixture.start + offset, 2).value = 'ZZZZ9999';
    const result = success(await parse(fixture));
    expect(result.blocks).toHaveLength(4);
    expect(result.blocks.some((block) => block.seiban === 'ZZZZ9999' || block.seiban === 'AB1C2345')).toBe(false);
    expect(result.warnings).toContainEqual(expect.objectContaining({ code: 'BLOCK_SHAPE', cell: 'B10' }));
  });

  it.each(['blank', 'missing-first'])('warns and skips a block with %s A sequence', async (kind) => {
    const fixture = buildWorkbook();
    for (let offset = 0; offset < (kind === 'blank' ? 4 : 1); offset++) fixture.sheet.getCell(fixture.start + offset, 1).value = null;
    const result = success(await parse(fixture));
    expect(result.blocks).toHaveLength(4);
    expect(result.warnings).toContainEqual(expect.objectContaining({ code: 'BLOCK_SHAPE', seiban: 'AB1C2345' }));
  });

  it.each(['main', 'alias', 'history'])('rejects conflicting dates for a duplicate %s seiban', async (kind) => {
    const fixture = buildWorkbook();
    if (kind === 'history') {
      fixture.sheet.getCell(fixture.start + 1, 1).value = 1;
      fixture.sheet.getCell(fixture.start + 2, 1).value = 2;
      fixture.sheet.getCell(fixture.start + 3, 1).value = 3;
      fixture.sheet.getCell(fixture.start + 1, fixture.parts).value = '2/2';
    } else {
      for (let offset = 0; offset < 4; offset++) fixture.sheet.getCell(fixture.start + offset, 2).value = kind === 'main' ? 'AB1C2346' : 'AB1C2345(AB1C2346)';
    }
    const result = success(await parse(fixture));
    const conflict = kind === 'history' ? 'AB1C2345' : 'AB1C2346';
    expect(result.blocks.flatMap((block) => [block.seiban, ...block.aliasSeibans])).not.toContain(conflict);
    expect(result.warnings).toContainEqual(expect.objectContaining({ code: 'DUPLICATE_SEIBAN', seiban: conflict }));
    if (kind === 'alias') expect(result.blocks[0].seiban).toBe('AB1C2345');
  });

  it.each(['main', 'alias', 'history'])('writes identical dates once for a duplicate %s seiban', async (kind) => {
    const fixture = buildWorkbook();
    if (kind === 'history') {
      fixture.sheet.getCell(fixture.start + 1, 1).value = 1;
      fixture.sheet.getCell(fixture.start + 2, 1).value = 2;
      fixture.sheet.getCell(fixture.start + 3, 1).value = 3;
      fixture.sheet.getCell(fixture.start + 1, fixture.parts).value = '4/30';
    } else {
      for (let offset = 0; offset < 4; offset++) fixture.sheet.getCell(fixture.start + 4 + offset, 2).value = kind === 'main' ? 'AB1C2345' : 'AB1C1111';
      fixture.sheet.getCell(fixture.start + 4, fixture.parts).value = '4/30';
      fixture.sheet.getCell(fixture.start + 4, 22).value = '★LSLH処理出';
      fixture.sheet.getCell(fixture.start + 7, 52).value = '★LSLH最終処理出';
    }
    const result = success(await parse(fixture));
    const duplicate = kind === 'alias' ? 'AB1C1111' : 'AB1C2345';
    expect(result.blocks.flatMap((block) => [block.seiban, ...block.aliasSeibans]).filter((seiban) => seiban === duplicate)).toHaveLength(1);
    expect(result.warnings.some((warning) => warning.code === 'DUPLICATE_SEIBAN')).toBe(false);
  });

  it.each(['★ LSLH処理出', '★LSLH 処理出', '★　ＬＳＬＨ　処理出'])('normalizes label spaces in %s while preserving note spaces', async (label) => {
    const fixture = buildWorkbook();
    fixture.sheet.getCell(fixture.start, 22).value = `${label} (CT 以外)`;
    const result = success(await parse(fixture));
    expect(result.blocks[0].surfaceSendOutDates[0]).toEqual({ date: '2026-05-01', label: '★LSLH処理出', note: '(CT 以外)' });
  });

  it.each(['★未知', '★LSLH最終処理', '★', '★別処理'])('warns on unknown star %s', async (value) => {
    const fixture = buildWorkbook();
    fixture.sheet.getCell(fixture.start, 22).value = value;
    const result = success(await parse(fixture));
    expect(result.warnings).toContainEqual(expect.objectContaining({ code: 'UNKNOWN_STAR', cell: 'V10' }));
  });

  it('does not read stars or warn about unknown stars on hidden rows', async () => {
    const fixture = buildWorkbook();
    fixture.sheet.getRow(fixture.start + 3).hidden = true;
    fixture.sheet.getRow(fixture.start + 2).hidden = true;
    const result = success(await parse(fixture));
    expect(result.blocks[0].surfaceSendOutDates).toEqual([{ date: '2026-05-01', label: '★LSLH処理出', note: '(CT以外)' }]);
    expect(result.warnings.some((warning) => warning.code === 'UNKNOWN_STAR')).toBe(false);
  });

  it.each([
    ['20260515', '12/10', '2026-12-10'],
    ['20261220', '7/15', '2027-07-15'],
    ['20261220', '11/30', '2026-11-30'],
    ['20261220', '1/10', '2027-01-10']
  ])('infers due year using the reference window for %s and %s', async (reference, value, expected) => {
    const fixture = buildWorkbook();
    fixture.sheet.getCell(fixture.start, fixture.parts).value = value;
    expect(success(await parse(fixture, `${reference}.xlsx`)).blocks[0].partsCompleteDate).toBe(expected);
    expect(success(await parse(fixture, 'minutes.xlsx', new Date(`${reference.slice(0, 4)}-${reference.slice(4, 6)}-${reference.slice(6, 8)}T00:00:00Z`))).blocks[0].partsCompleteDate).toBe(expected);
  });

  it.each(['1/15', '1/30', '12/31', '1/14'])('warns and drops inferred due date %s within 15 days of either window edge', async (value) => {
    const fixture = buildWorkbook();
    fixture.sheet.getCell(fixture.start, fixture.parts).value = value;
    const result = success(await parse(fixture));
    expect(result.blocks[0].partsCompleteDate).toBeNull();
    expect(result.warnings).toContainEqual(expect.objectContaining({ code: 'AMBIGUOUS_YEAR', cell: 'N10' }));
  });

  it.each(['1/31', '12/30'])('accepts inferred due date %s outside the 15-day edge margin', async (value) => {
    const fixture = buildWorkbook();
    fixture.sheet.getCell(fixture.start, fixture.parts).value = value;
    const result = success(await parse(fixture));
    expect(result.blocks[0].partsCompleteDate).not.toBeNull();
    expect(result.warnings.some((warning) => warning.code === 'AMBIGUOUS_YEAR' && warning.cell === 'N10')).toBe(false);
  });

  it('warns and skips star dates near a year-window edge without failing the calendar', async () => {
    const fixture = buildWorkbook();
    fixture.sheet.getCell(fixture.start, fixture.parts).value = '2026/4/30';
    fixture.sheet.getCell(fixture.start + 16, fixture.parts).value = '2026/4/30';
    const result = success(await parse(fixture, '20260915.xlsx'));
    expect(result.blocks[0].surfaceSendOutDates).toEqual([{ date: '2026-05-31', label: '★LSLH最終処理出', note: null }]);
    expect(result.warnings).toContainEqual(expect.objectContaining({ code: 'AMBIGUOUS_YEAR', cell: 'V5' }));
  });

  it('infers star years across December to January', async () => {
    const fixture = buildWorkbook('Oct');
    fixture.sheet.getCell(3, 22).value = '12月';
    fixture.sheet.getCell(3, 53).value = '1月';
    const result = success(await parse(fixture, '20261220.xlsx'));
    expect(result.blocks[0].surfaceSendOutDates.map((star) => star.date)).toEqual(['2026-12-01', '2027-01-01']);
  });

  it('reads parts completion under a stacked header using its physical row offset', async () => {
    const fixture = buildWorkbook();
    fixture.sheet.getCell(3, fixture.parts - 1).value = null;
    fixture.sheet.getCell(3, fixture.parts).value = '出図';
    fixture.sheet.getCell(5, fixture.parts).value = '部品完成';
    for (let index = 0; index < 5; index++) {
      fixture.sheet.getCell(fixture.start + index * 4, fixture.parts).value = '3/1';
      fixture.sheet.getCell(fixture.start + index * 4 + 2, fixture.parts).value = '6/1';
    }
    const result = success(await parse(fixture));
    expect(result.blocks.map((block) => block.partsCompleteDate)).toEqual(Array(5).fill('2026-06-01'));
    expect(result.blocks[0].rawPartsCompleteText).toBe('6/1');
  });

  it('rejects a parts cell vertically merged with the upper stacked header value', async () => {
    const fixture = buildWorkbook();
    fixture.sheet.getCell(3, fixture.parts - 1).value = null;
    fixture.sheet.getCell(3, fixture.parts).value = '出図';
    fixture.sheet.getCell(5, fixture.parts).value = '部品完成';
    for (let index = 0; index < 5; index++) fixture.sheet.getCell(fixture.start + index * 4 + 2, fixture.parts).value = '6/1';
    fixture.sheet.mergeCells(fixture.start, fixture.parts, fixture.start + 2, fixture.parts);
    const result = success(await parse(fixture));
    expect(result.blocks[0].partsCompleteDate).toBeNull();
    expect(result.warnings).toContainEqual(expect.objectContaining({ code: 'MERGED_ACROSS_HEADERS', cell: 'N12' }));
  });

  it('warns without reading the upper value when a stacked parts offset exceeds the block', async () => {
    const fixture = buildWorkbook();
    fixture.sheet.getCell(3, fixture.parts - 1).value = null;
    fixture.sheet.getCell(3, fixture.parts).value = '出図';
    fixture.sheet.getCell(7, fixture.parts).value = '部品完成';
    const result = await parse(fixture);
    expect(result).toMatchObject({ ok: false, reason: 'INSUFFICIENT_PARTS_COMPLETE_DATES' });
    expect(result.warnings).toContainEqual(expect.objectContaining({ code: 'BLOCK_SHAPE', cell: 'N10' }));
  });

  it('rejects duplicate seibans with identical due dates but conflicting star dates', async () => {
    const fixture = buildWorkbook();
    for (let offset = 0; offset < 4; offset++) fixture.sheet.getCell(fixture.start + 4 + offset, 2).value = 'AB1C2345';
    fixture.sheet.getCell(fixture.start + 4, fixture.parts).value = '4/30';
    fixture.sheet.getCell(fixture.start + 4, 23).value = '★LSLH処理出';
    const result = success(await parse(fixture));
    expect(result.blocks.flatMap((block) => [block.seiban, ...block.aliasSeibans])).not.toContain('AB1C2345');
    expect(result.warnings).toContainEqual(expect.objectContaining({ code: 'DUPLICATE_SEIBAN', seiban: 'AB1C2345' }));
  });

  it('clamps month-end window edges before applying the 15-day margin', () => {
    const ambiguous = () => { throw new Error('Unexpected ambiguous date'); };
    expect(inferDate(3, 16, '2026-06-30', ambiguous)).toBe('2026-03-16');
    const warn = { count: 0 };
    expect(inferDate(3, 15, '2026-06-30', () => warn.count++)).toBeNull();
    expect(warn.count).toBe(1);
  });

  it.each(['BA1S9340（BA1S7332 改）', 'BA1S9340(旧BA1S7332)', 'BA1S9340/BA1S7332', 'BA1S9340(BA1S733)'])('imports the main key and warns on unreadable alias %s', async (value) => {
    const fixture = buildWorkbook();
    for (let offset = 0; offset < 4; offset++) fixture.sheet.getCell(fixture.start + offset, 2).value = value;
    const result = success(await parse(fixture));
    expect(result.blocks[0]).toMatchObject({ seiban: 'BA1S9340', aliasSeibans: [], partsCompleteDate: '2026-04-30' });
    expect(result.warnings).toContainEqual(expect.objectContaining({ code: 'UNREADABLE_ALIAS', seiban: 'BA1S9340', cell: 'B10' }));
  });

  it('returns a fatal result for invalid xlsx bytes', async () => {
    expect(await parseDScheduleMinutesXlsx({ buffer: Buffer.from('invalid'), filename: '20260515.xlsx', receivedAt: null })).toMatchObject({ ok: false, reason: 'INVALID_XLSX' });
  });
});
