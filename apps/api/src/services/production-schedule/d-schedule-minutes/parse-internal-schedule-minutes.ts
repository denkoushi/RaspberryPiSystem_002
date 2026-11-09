import ExcelJS from 'exceljs';

import { calendarDate, cellText, formulaWithoutResult, normalize, readDate } from './date-cell.js';
import type { DScheduleMinutesBlock, DScheduleMinutesParseResult, DScheduleMinutesWarning } from './parse-d-schedule-minutes.js';

// Allow the same 45-day date discrepancy used by the D company parser before rolling back a year.
function dateFromMMDD(mmdd: string, receivedAt: Date): string | null {
  const month = Number(mmdd.slice(0, 2));
  const day = Number(mmdd.slice(2));
  const year = receivedAt.getUTCFullYear();
  const date = calendarDate(year, month, day);
  if (!date) return null;
  return Date.parse(date) - receivedAt.getTime() > 45 * 86400000 ? calendarDate(year - 1, month, day) : date;
}

export async function parseInternalScheduleMinutesXlsx(input: {
  buffer: Buffer; filename: string; receivedAt: Date | null; subject?: string;
}): Promise<DScheduleMinutesParseResult> {
  const warnings: DScheduleMinutesWarning[] = [];
  const fatal = (reason: string): DScheduleMinutesParseResult => ({ ok: false, reason, warnings });
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(input.buffer as unknown as ExcelJS.Buffer);
  } catch {
    return fatal('INVALID_XLSX');
  }
  const receivedAt = input.receivedAt && Number.isFinite(input.receivedAt.getTime()) ? input.receivedAt : null;
  const candidates = workbook.worksheets.flatMap((sheet) => {
    const match = normalize(sheet.name).replace(/\s+/g, '').match(/^(\d{4})結果$/);
    if (!match || !calendarDate(2000, Number(match[1].slice(0, 2)), Number(match[1].slice(2)))) return [];
    return [{ sheet, mmdd: match[1], date: receivedAt ? dateFromMMDD(match[1], receivedAt) : null }];
  });
  const selected = candidates.sort((a, b) => (b.date ?? b.mmdd).localeCompare(a.date ?? a.mmdd))[0];
  if (!selected) return fatal('MISSING_HEADERS');
  const { sheet } = selected;
  const compact = (cell: ExcelJS.Cell) => normalize(cellText(cell)).replace(/\s+/g, '');
  let columns: { seiban: number; parts: number } | undefined;
  const blocks: DScheduleMinutesBlock[] = [];
  const warn = (code: string, seiban: string | null, cell: ExcelJS.Cell) => {
    warnings.push({ code, seiban, cell: cell.address, rawText: cellText(cell) || null });
  };
  const b1 = sheet.getCell('B1').master.value;
  const filenameMMDD = normalize(input.filename).match(/_(\d{4})(?!\d)/)?.[1];
  const meetingDate = b1 instanceof Date && Number.isFinite(b1.getTime()) ? b1.toISOString().slice(0, 10)
    : receivedAt ? (filenameMMDD ? dateFromMMDD(filenameMMDD, receivedAt) : null) ?? selected.date : null;
  let headerFound = false;
  for (let row = 1; row <= sheet.rowCount; row++) {
    const current = sheet.getRow(row);
    if (current.hidden) continue;
    const headers = new Map<string, number>();
    current.eachCell((cell, column) => { headers.set(compact(cell), column); });
    if (headers.has('製番') && headers.has('部品')) {
      columns = { seiban: headers.get('製番')!, parts: headers.get('部品')! };
      headerFound = true;
      continue;
    }
    // Section rows reset the previous header, so data never inherits another section's columns.
    if (/^【.*】$/.test(compact(sheet.getCell(row, 1)))) { columns = undefined; continue; }
    if (!columns || !meetingDate) continue;
    const seibanCell = sheet.getCell(row, columns.seiban);
    const text = normalize(cellText(seibanCell)).toUpperCase();
    if (!text) continue;
    if (formulaWithoutResult(seibanCell)) { warn('FORMULA_NO_RESULT', null, seibanCell); continue; }
    const match = text.match(/^([A-Z0-9]{8})(?=$|[\s(])(.*)$/s);
    if (!match) { warn('INVALID_SEIBAN', null, seibanCell); continue; }
    const alias = match[2].match(/^\s*\(([A-Z0-9]{8})\)$/);
    if (match[2] && !alias) warn('UNREADABLE_ALIAS', match[1], seibanCell);
    const partsCell = sheet.getCell(row, columns.parts);
    const block: DScheduleMinutesBlock = {
      seiban: match[1], aliasSeibans: alias ? [alias[1]] : [], assignees: [], partsCompleteDate: null,
      outsourceMarks: [], surfaceSendOutDates: [], memo: null, sourceRow: row,
      rawPartsCompleteText: cellText(partsCell) || null
    };
    // The new sheet has neither outsource marks nor a processing calendar.
    if (Number(seibanCell.master.row) !== row || Number(partsCell.master.row) !== row) {
      warn('MERGED_ACROSS_BLOCKS', block.seiban, partsCell);
      continue;
    }
    if (partsCell.master.address === seibanCell.master.address) {
      warn('MERGED_ACROSS_HEADERS', block.seiban, partsCell);
    } else if (formulaWithoutResult(partsCell)) {
      warn('FORMULA_NO_RESULT', block.seiban, partsCell);
    } else {
      const parsed = readDate(partsCell, meetingDate, workbook.properties.date1904,
        () => warn('AMBIGUOUS_YEAR', block.seiban, partsCell), true);
      if (parsed.invalid) warn('UNREADABLE_DATE', block.seiban, partsCell);
      block.partsCompleteDate = parsed.date;
    }
    blocks.push(block);
  }
  if (!headerFound) return fatal('MISSING_HEADERS');
  if (!meetingDate) return fatal('NO_BASE_DATE');
  if (!blocks.length) return fatal('ZERO_BLOCKS');
  // As in the D company format, conflicting claims must not pick an arbitrary date.
  const claims = new Map<string, DScheduleMinutesBlock[]>();
  for (const block of blocks) for (const key of new Set([block.seiban, ...block.aliasSeibans])) {
    const entries = claims.get(key) ?? [];
    entries.push(block);
    claims.set(key, entries);
  }
  const accepted = new Set<string>();
  for (const [key, entries] of claims) {
    if (new Set(entries.map((block) => block.partsCompleteDate)).size > 1) {
      for (const block of entries) warnings.push({ code: 'DUPLICATE_SEIBAN', seiban: key, cell: null, rawText: block.rawPartsCompleteText });
    } else accepted.add(key);
  }
  const uniqueBlocks = blocks.flatMap((block) => {
    const keys = [...new Set([block.seiban, ...block.aliasSeibans])].filter((key) => accepted.delete(key));
    return keys.length ? [{ ...block, seiban: keys[0], aliasSeibans: keys.slice(1) }] : [];
  });
  return { ok: true, assigneeColumnFound: false, meetingDate, blocks: uniqueBlocks, warnings };
}
