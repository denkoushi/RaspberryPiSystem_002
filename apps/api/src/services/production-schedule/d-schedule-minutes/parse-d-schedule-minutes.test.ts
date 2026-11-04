import { describe, expect, it } from 'vitest';

import { formulaWithoutResult } from './date-cell.js';
import { buildWorkbook } from './__fixtures__/workbook.js';
import { parseDScheduleMinutesXlsx } from './parse-d-schedule-minutes.js';

async function parse(fixture = buildWorkbook(), filename = '20260515 D社日程会議議事録.xlsx', receivedAt: Date | null = null) {
  return parseDScheduleMinutesXlsx({ buffer: Buffer.from(await fixture.workbook.xlsx.writeBuffer()), filename, receivedAt });
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
    if (label === '製番') fixture.sheet.getCell(5, 10).value = null;
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

  it.each(['20261220', '20260105'])('resolves month/day to the nearest year around %s', async (date) => {
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

  it('skips hidden/filter-excluded blocks and collapsed outline blocks', async () => {
    const fixture = buildWorkbook();
    fixture.sheet.autoFilter = 'A7:BC29';
    fixture.sheet.getRow(fixture.start + 4).hidden = true; // persisted filter exclusion
    fixture.sheet.properties.outlineLevelRow = 1;
    fixture.sheet.getRow(fixture.start + 8).outlineLevel = 1;
    fixture.sheet.getCell(fixture.start + 1, 23).value = '★LSLH処理出';
    const result = success(await parse(fixture));
    expect(result.blocks.map((block) => block.seiban)).toEqual(['AB1C2345', 'AB1C2348', 'AB1C2349']);
    expect(result.blocks[0].surfaceSendOutDates).toContainEqual({ date: '2026-05-02', label: '★LSLH処理出', note: null });
  });

  it('rejects a month boundary whose next month label is missing', async () => {
    const fixture = buildWorkbook('Oct');
    fixture.sheet.getCell(3, 53).value = null;
    expect(await parse(fixture)).toMatchObject({ ok: false, reason: 'UNDETERMINABLE_CALENDAR' });
  });

  it('ignores collapsed columns and hidden-row blocks but reads hidden calendar columns on visible rows', async () => {
    const fixture = buildWorkbook();
    fixture.sheet.properties.outlineLevelCol = 1;
    fixture.sheet.getColumn(fixture.parts - 1).outlineLevel = 1;
    fixture.sheet.getCell(fixture.start, fixture.parts - 1).value = 'bad collapsed date';
    fixture.sheet.getRow(fixture.start + 4).hidden = true;
    fixture.sheet.getCell(fixture.start + 4, 22).value = '★LSLH処理出';
    const result = success(await parse(fixture));
    expect(result.blocks[0].memo).toBe('架空メモ');
    expect(result.warnings.map((warning) => warning.code)).toEqual(['UNKNOWN_STAR']);
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

  it.each(['number', 'seiban', 'short', 'long'])('keeps only unambiguous first-row values for a malformed %s block', async (kind) => {
    const fixture = buildWorkbook();
    if (kind === 'number') fixture.sheet.getCell(fixture.start + 2, 1).value = 4;
    if (kind === 'seiban') fixture.sheet.getCell(fixture.start + 2, 2).value = 'ZZZZ9999';
    if (kind === 'short') fixture.sheet.spliceRows(fixture.start + 2, 1);
    if (kind === 'long') fixture.sheet.spliceRows(fixture.start + 2, 0, []);
    const result = success(await parse(fixture));
    expect(result.warnings).toContainEqual(expect.objectContaining({ code: 'BLOCK_SHAPE', seiban: 'AB1C2345' }));
    expect(result.blocks[0]).toMatchObject({ partsCompleteDate: '2026-04-30', surfaceSendOutDates: [], outsourceMarks: [], memo: '架空メモ' });
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

  it.each(['※要調整', '※架空担当', 'ＬＳＬＨ完', '※note', '☆LSLH処理出 戻', '※LSLH処理品 戻', '★未知'])('silently ignores calendar note %s', async (value) => {
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

  it('warns about ambiguous years while retaining the nearest date', async () => {
    const fixture = buildWorkbook();
    fixture.sheet.getCell(fixture.start, fixture.parts).value = '11/2';
    const result = success(await parse(fixture));
    expect(result.blocks[0].partsCompleteDate).toBe('2026-11-02');
    expect(result.warnings).toContainEqual(expect.objectContaining({ code: 'AMBIGUOUS_YEAR', cell: 'N10' }));
  });

  it('reads a star on a hidden interior row of a visible block', async () => {
    const fixture = buildWorkbook();
    fixture.sheet.getRow(fixture.start + 3).hidden = true;
    const result = success(await parse(fixture));
    expect(result.blocks[0].surfaceSendOutDates).toContainEqual({ date: '2026-05-31', label: '★LSLH最終処理出', note: null });
  });

  it('returns a fatal result for invalid xlsx bytes', async () => {
    expect(await parseDScheduleMinutesXlsx({ buffer: Buffer.from('invalid'), filename: '20260515.xlsx', receivedAt: null })).toMatchObject({ ok: false, reason: 'INVALID_XLSX' });
  });
});
