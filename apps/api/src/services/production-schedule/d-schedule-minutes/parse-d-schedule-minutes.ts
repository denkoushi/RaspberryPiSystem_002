import ExcelJS from 'exceljs';

import { calendarDate, cellText, formulaWithoutResult, inferDate, normalize, readDate } from './date-cell.js';

export type DScheduleMinutesBlock = {
  seiban: string;
  aliasSeibans: string[];
  partsCompleteDate: string | null;
  outsourceMarks: string[];
  surfaceSendOutDates: { date: string; label: string; note: string | null }[];
  memo: string | null;
  sourceRow: number;
  rawPartsCompleteText: string | null;
};
export type DScheduleMinutesWarning = { code: string; seiban: string | null; cell: string | null; rawText: string | null };
export type DScheduleMinutesParseResult =
  | { ok: true; meetingDate: string; blocks: DScheduleMinutesBlock[]; warnings: DScheduleMinutesWarning[] }
  | { ok: false; reason: string; warnings: DScheduleMinutesWarning[] };

const dateHeaders = ['出図', '部品完成', '組立完', '出荷', '組立納期', '出荷日', '注文書納期', '最終部品完'];
const headers = new Set(['仕様', '製番', ...dateHeaders, '担当', 'MEMO', 'ANS']);
// AutoFilter exclusions are persisted as hidden rows. ExcelJS does not execute filter predicates.
// Real headers wrap lines (組立\n納期) and the MEMO header carries a legend after it.
const headerLabel = (text: string): string | null => {
  const compact = text.replace(/\s+/g, '');
  if (headers.has(compact)) return compact;
  return compact.startsWith('MEMO') ? 'MEMO' : null;
};
const hidden = (item: ExcelJS.Row | ExcelJS.Column): boolean => Boolean(item.hidden);

export async function parseDScheduleMinutesXlsx(input: {
  buffer: Buffer; filename: string; receivedAt: Date | null;
}): Promise<DScheduleMinutesParseResult> {
  const warnings: DScheduleMinutesWarning[] = [];
  const fatal = (reason: string): DScheduleMinutesParseResult => ({ ok: false, reason, warnings });
  const filenameMatch = normalize(input.filename).match(/^(\d{4})(\d{2})(\d{2})/);
  const filenameDate = filenameMatch && calendarDate(Number(filenameMatch[1]), Number(filenameMatch[2]), Number(filenameMatch[3]));
  const meetingDate = filenameDate
    || (input.receivedAt && Number.isFinite(input.receivedAt.getTime()) ? input.receivedAt.toISOString().slice(0, 10) : null);
  if (!meetingDate) return fatal('NO_BASE_DATE');
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(input.buffer as unknown as ExcelJS.Buffer);
  } catch {
    return fatal('INVALID_XLSX');
  }
  if (filenameDate && input.receivedAt && Number.isFinite(input.receivedAt.getTime())
    && Math.abs(Date.parse(meetingDate) - input.receivedAt.getTime()) > 45 * 86400000) {
    warnings.push({ code: 'FILENAME_DATE_MISMATCH', seiban: null, cell: null, rawText: null });
  }
  const seibanText = (cell: ExcelJS.Cell) => normalize(cellText(cell)).toUpperCase();
  const seibanPattern = /^([A-Z0-9]{8})(?=$|[\s(/])(.*)$/s;
  const aliasPattern = /^\s*\(([A-Z0-9]{8})\)$/;
  const shapeValid = (sheet: ExcelJS.Worksheet, row: number, col: number) => {
    const key = seibanText(sheet.getCell(row, col));
    return seibanPattern.test(key) && [0, 1, 2, 3].every((offset) => {
      const number = sheet.getCell(row + offset, 1);
      const seiban = sheet.getCell(row + offset, col);
      return Number(number.master.row) >= row && Number(number.master.row) <= row + 3
        && Number(seiban.master.row) >= row && Number(seiban.master.row) <= row + 3
        && normalize(cellText(number)) === String(offset + 1) && seibanText(seiban) === key;
    });
  };
  const sheetName = (candidate: ExcelJS.Worksheet) => normalize(candidate.name).replace(/\s+/g, '');
  const visibleSheets = workbook.worksheets.filter((candidate) => candidate.state === 'visible');
  const exact = visibleSheets.filter((candidate) => sheetName(candidate) === '日程表');
  const candidates = exact.length ? exact : visibleSheets.filter((candidate) => sheetName(candidate).includes('日程表'));
  const validBlockCount = (candidate: ExcelJS.Worksheet) => {
    let col = 0;
    for (let row = 1; row <= Math.min(30, candidate.rowCount) && !col; row++) {
      candidate.getRow(row).eachCell((cell, column) => { if (!col && headerLabel(normalize(cellText(cell))) === '製番') col = column; });
    }
    let count = 0;
    if (col) for (let row = 1; row <= candidate.rowCount; row++) if (shapeValid(candidate, row, col)) count++;
    return count;
  };
  const sheet = [...candidates].sort((a, b) => validBlockCount(b) - validBlockCount(a))[0] ?? visibleSheets[0];
  if (candidates.length > 1) warnings.push({ code: 'MULTIPLE_SCHEDULE_SHEETS', seiban: null, cell: null, rawText: null });
  if (!sheet) return fatal('MISSING_HEADERS');
  const columns = new Map<string, number>();
  const headerRows = new Map<string, number>();
  const requiredHeaders = new Map<string, Set<string>>();
  const headerColumns = new Set<number>();
  let dayRow = 0;
  let bestCount = 0;
  for (let row = 1; row <= Math.min(30, sheet.rowCount); row++) {
    let count = 0;
    sheet.getRow(row).eachCell((cell, column) => {
      const text = normalize(cellText(cell));
      const label = headerLabel(text);
      if (label) headerColumns.add(Number(cell.master.col));
      // The 製番 key column (B) is hidden in the real sheets; only its value cells identify blocks.
      const visible = label === '製番' || (!hidden(sheet.getRow(row)) && !hidden(sheet.getColumn(column)));
      if (label && ['製番', '部品完成'].includes(label)) {
        const cells = requiredHeaders.get(label) ?? new Set<string>();
        cells.add(cell.master.address);
        requiredHeaders.set(label, cells);
      }
      if (label && visible && !columns.has(label)) { columns.set(label, column); headerRows.set(label, Number(cell.master.row)); }
      if (/^(?:[1-9]|[12]\d|3[01])$/.test(text)) count++;
    });
    if (count > bestCount) { bestCount = count; dayRow = row; }
  }
  for (const [label, cells] of requiredHeaders) {
    if (cells.size > 1) return fatal(`DUPLICATE_REQUIRED_HEADER: ${label} (${[...cells].join(', ')})`);
  }
  if (!columns.has('製番') || !columns.has('部品完成')) return fatal('MISSING_HEADERS');
  const warn = (code: string, seiban: string | null, cell: ExcelJS.Cell): void => {
    if (!warnings.some((warning) => warning.code === code && warning.seiban === seiban && warning.cell === cell.address)) {
      warnings.push({ code, seiban, cell: cell.address, rawText: cellText(cell) || null });
    }
  };
  const calendar = new Map<number, string | null>();
  let month: number | null = null;
  let previousDay = 0;
  let previousMonth: number | null = null;
  if (dayRow > 1) {
    for (let col = 1; col <= sheet.columnCount; col++) {
      // A weekday row sits between the month row and the day row in the real sheets.
      for (let row = dayRow - 1; row >= Math.max(1, dayRow - 3); row--) {
        const monthMatch = normalize(cellText(sheet.getCell(row, col))).match(/^(\d{1,2})月$/);
        if (monthMatch) { month = Number(monthMatch[1]); break; }
      }
      const day = normalize(cellText(sheet.getCell(dayRow, col)));
      if (!/^(?:[1-9]|[12]\d|3[01])$/.test(day)) continue;
      if (Number(day) < previousDay && month === previousMonth) return fatal('UNDETERMINABLE_CALENDAR');
      previousDay = Number(day);
      previousMonth = month;
      let ambiguous = false;
      const date = month === null ? null : inferDate(month, Number(day), meetingDate, () => {
        ambiguous = true;
        warn('AMBIGUOUS_YEAR', null, sheet.getCell(dayRow, col));
      });
      if (!date && !ambiguous) return fatal('UNDETERMINABLE_CALENDAR');
      calendar.set(col, date);
    }
  }
  if (!calendar.size) return fatal('UNDETERMINABLE_CALENDAR');
  const blocks: DScheduleMinutesBlock[] = [];
  const safeCell = (row: number, col: number, start: number, seiban: string | null): ExcelJS.Cell | null => {
    const cell = sheet.getCell(row, col);
    if (Number(cell.master.row) < start || Number(cell.master.row) > start + 3) {
      warn('MERGED_ACROSS_BLOCKS', seiban, cell);
      return null;
    }
    return cell;
  };
  const seibanColumn = columns.get('製番')!;
  const invalidShapes = new Set<number>();
  let firstValidBlock = sheet.rowCount + 1;
  for (let row = 1; row <= sheet.rowCount; row++) {
    if (shapeValid(sheet, row, seibanColumn)) { firstValidBlock = row; break; }
  }
  const coveredRows = new Set<number>();
  for (let row = 1; row <= sheet.rowCount; row++) {
    const seibanCell = sheet.getCell(row, seibanColumn);
    if (normalize(cellText(sheet.getCell(row, 1))) !== '1') {
      const match = seibanText(seibanCell).match(seibanPattern);
      if (match && !coveredRows.has(row) && !hidden(sheet.getRow(row))) {
        warn('BLOCK_SHAPE', match[1], seibanCell);
        for (let offset = 0; offset < 4; offset++) coveredRows.add(row + offset);
      }
      continue;
    }
    const containingBlock = blocks.find((block) => row > block.sourceRow && row < block.sourceRow + 4);
    for (let offset = 0; offset < 4; offset++) coveredRows.add(row + offset);
    if (!safeCell(row, 1, row, null)) continue;
    if (!safeCell(row, seibanColumn, row, null)) continue;
    if (row >= firstValidBlock && !hidden(sheet.getRow(row)) && formulaWithoutResult(seibanCell)) {
      warn('FORMULA_NO_RESULT', null, seibanCell);
      continue;
    }
    const match = seibanText(seibanCell).match(seibanPattern);
    if (!match) {
      const text = normalize(cellText(seibanCell));
      // Template rows above the data carry 0 in the 製番 column.
      if (!hidden(sheet.getRow(row)) && text && text !== '0') warn('INVALID_SEIBAN', null, seibanCell);
      continue;
    }
    if (!shapeValid(sheet, row, seibanColumn)) {
      invalidShapes.add(row);
      if (!hidden(sheet.getRow(row))) {
        warn('BLOCK_SHAPE', match[1], seibanCell);
        for (let offset = 0; offset < 4; offset++) {
          safeCell(row + offset, 1, row, match[1]);
          const cell = safeCell(row + offset, seibanColumn, row, match[1]);
          if (cell && row + offset >= firstValidBlock && formulaWithoutResult(cell)) warn('FORMULA_NO_RESULT', match[1], cell);
        }
      }
    }
    // A repeated row-1 inside a block is another due-date claim for the same key.
    // Compare it during deduplication, but never read its shifted four-row range.
    if (containingBlock && containingBlock.seiban === match[1]) {
      invalidShapes.add(row);
    } else if (![0, 1, 2, 3].every((offset) => seibanText(sheet.getCell(row + offset, seibanColumn)) === seibanText(seibanCell))) {
      continue;
    }
    const alias = match[2].match(aliasPattern);
    if (match[2] && !alias) warn('UNREADABLE_ALIAS', match[1], seibanCell);
    const partsCell = safeCell(row, columns.get('部品完成')!, row, match[1]);
    blocks.push({ seiban: match[1], aliasSeibans: alias ? [alias[1]] : [], partsCompleteDate: null,
      outsourceMarks: [], surfaceSendOutDates: [], memo: null, sourceRow: row,
      rawPartsCompleteText: hidden(sheet.getRow(row)) || hidden(sheet.getColumn(columns.get('部品完成')!)) || !partsCell ? null : cellText(partsCell) || null });
  }
  const visibleBlocks = blocks.filter((block) => !hidden(sheet.getRow(block.sourceRow)));
  if (!visibleBlocks.length) return fatal('ZERO_BLOCKS');
  const offsets = new Map<string, number>();
  for (const label of dateHeaders) {
    const col = columns.get(label);
    if (!col) continue;
    const stack = [...headerRows].filter(([other]) => columns.get(other) === col).map(([, row]) => row);
    if (new Set(stack).size > 1) {
      offsets.set(label, headerRows.get(label)! - Math.min(...stack));
      continue;
    }
    const scores = [0, 1, 2, 3].map((offset) => visibleBlocks.reduce((sum, block) => {
      const row = block.sourceRow + offset;
      if (invalidShapes.has(block.sourceRow)) return sum;
      const cell = sheet.getCell(row, col);
      if (Number(cell.master.row) < block.sourceRow || Number(cell.master.row) > block.sourceRow + 3) return sum;
      return sum + Number(!hidden(sheet.getRow(row)) && !hidden(sheet.getColumn(col)) && Boolean(readDate(sheet.getCell(row, col), meetingDate, workbook.properties.date1904).date));
    }, 0));
    offsets.set(label, label === '部品完成' ? 0 : scores.indexOf(Math.max(...scores)));
  }
  for (const block of visibleBlocks) {
    const memos: string[] = [];
    {
      for (const [label, offset] of offsets) {
        if (invalidShapes.has(block.sourceRow) && label !== '部品完成') continue;
        const col = columns.get(label)!;
        const row = block.sourceRow + offset;
        if (offset > 3) {
          warn('BLOCK_SHAPE', block.seiban, sheet.getCell(block.sourceRow, col));
          continue;
        }
        if (hidden(sheet.getRow(row)) || hidden(sheet.getColumn(col))) continue;
        const cell = safeCell(row, col, block.sourceRow, block.seiban);
        if (!cell) continue;
        if (label === '部品完成') {
          block.rawPartsCompleteText = cellText(cell) || null;
          if ([...headerColumns].some((column) => column !== col
            && sheet.getCell(row, column).master.address === cell.master.address)
            || [...offsets].some(([other, otherOffset]) => other !== label && columns.get(other) === col
              && sheet.getCell(block.sourceRow + otherOffset, col).master.address === cell.master.address)) {
            warn('MERGED_ACROSS_HEADERS', block.seiban, cell);
            continue;
          }
        }
        if (row >= firstValidBlock && formulaWithoutResult(cell)) {
          warn('FORMULA_NO_RESULT', block.seiban, cell);
          continue;
        }
        const parsed = readDate(cell, meetingDate, workbook.properties.date1904, () => warn('AMBIGUOUS_YEAR', block.seiban, cell), label === '部品完成');
        if (parsed.invalid) warn('UNREADABLE_DATE', block.seiban, cell);
        if (parsed.memo) memos.push(parsed.memo);
        block.outsourceMarks.push(...parsed.marks);
        if (label === '部品完成') block.partsCompleteDate = parsed.date;
      }
      const memoColumn = columns.get('MEMO');
      if (memoColumn && !hidden(sheet.getColumn(memoColumn))) {
        const cell = safeCell(block.sourceRow, memoColumn, block.sourceRow, block.seiban);
        const text = cell ? normalize(cellText(cell)) : '';
        if (text) memos.push(text);
      }
    }
    // Calendar columns may be hidden; hidden rows never contribute stars.
    for (let offset = 0; !invalidShapes.has(block.sourceRow) && offset < 4; offset++) {
      if (hidden(sheet.getRow(block.sourceRow + offset))) continue;
      for (const [col, date] of calendar) {
        const cell = safeCell(block.sourceRow + offset, col, block.sourceRow, block.seiban);
        if (!cell) continue;
        if (cell.isMerged && cell.master.address !== cell.address) continue;
        const text = normalize(cellText(cell));
        if (text.includes('戻')) continue;
        if (/^☆/.test(text) || (!text.startsWith('★') && /処理出|処理品/.test(text))) {
          warn('UNKNOWN_STAR', block.seiban, cell);
        }
        if (!text.startsWith('★')) continue;
        // 最終処理出 is the older spelling of 最終処理品 (May 2026 sheets).
        const star = text.match(/^(★ *L *S *L *H *(?:最 *終 *処 *理 *(?:品|出)|処 *理 *出))(.*)$/s);
        if (!star) warn('UNKNOWN_STAR', block.seiban, cell);
        if (star && date) block.surfaceSendOutDates.push({ date, label: star[1].replace(/ /g, ''), note: star[2].trim() || null });
      }
    }
    block.outsourceMarks = [...new Set(block.outsourceMarks)];
    block.memo = [...new Set(memos)].join('\n') || null;
  }
  if (visibleBlocks.filter((block) => block.partsCompleteDate).length / visibleBlocks.length < 0.8) return fatal('INSUFFICIENT_PARTS_COMPLETE_DATES');
  const claims = new Map<string, DScheduleMinutesBlock[]>();
  for (const block of visibleBlocks) {
    for (const seiban of new Set([block.seiban, ...block.aliasSeibans])) {
      const entries = claims.get(seiban) ?? [];
      entries.push(block);
      claims.set(seiban, entries);
    }
  }
  const accepted = new Set<string>();
  for (const [seiban, entries] of claims) {
    const dates = new Set(entries.map((block) => JSON.stringify([block.partsCompleteDate,
      [...new Set(block.surfaceSendOutDates.map((star) => star.date))].sort()])));
    if (dates.size > 1) {
      for (const block of entries) warn('DUPLICATE_SEIBAN', seiban, sheet.getCell(block.sourceRow, seibanColumn));
    } else accepted.add(seiban);
  }
  const uniqueBlocks: DScheduleMinutesBlock[] = [];
  for (const block of visibleBlocks) {
    const keys = [...new Set([block.seiban, ...block.aliasSeibans])].filter((seiban) => accepted.delete(seiban));
    if (!keys.length) continue;
    // A conflicting main key must not suppress an independently safe alias (or vice versa).
    uniqueBlocks.push({ ...block, seiban: keys[0], aliasSeibans: keys.slice(1) });
  }
  return { ok: true, meetingDate, blocks: uniqueBlocks, warnings };
}
