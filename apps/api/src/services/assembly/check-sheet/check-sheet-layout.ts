import ExcelJS from 'exceljs';
import type { AssemblyCheckSheetLayout } from '@raspi-system/shared-types';
import { ApiError } from '../../../lib/errors.js';

function parseRange(address: string) {
  const [start, end = start] = address.replace(/\$/g, '').split(':');
  const position = (cell: string) => {
    const match = /^([A-Z]+)(\d+)$/.exec(cell)!;
    return { row: Number(match[2]), col: [...match[1]].reduce((n, char) => n * 26 + char.charCodeAt(0) - 64, 0) };
  };
  const first = position(start); const last = position(end);
  return { top: first.row, left: first.col, bottom: last.row, right: last.col };
}

function cellText(cell: ExcelJS.Cell) {
  const raw = cell.value;
  const value = raw && typeof raw === 'object' && 'result' in raw ? raw.result : raw;
  if (!(value instanceof Date)) return cell.text;
  // ExcelJS returns Date.toString(); Excel's day 0 is an empty date result, not 1899-12-30.
  if (value.getTime() === Date.UTC(1899, 11, 30)) return '';
  return `${value.getUTCFullYear()}/${value.getUTCMonth() + 1}/${value.getUTCDate()}`;
}

/** Read-only projection; never serialize an original through ExcelJS. */
export async function buildCheckSheetLayout(source: Buffer, sheetName: string): Promise<AssemblyCheckSheetLayout> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(source as unknown as ExcelJS.Buffer);
  const sheet = workbook.getWorksheet(sheetName);
  if (!sheet) throw new ApiError(400, 'チェックシートが見つかりません');
  const areas = [...(sheet.pageSetup.printArea ?? '').matchAll(/\$?([A-Z]+)\$?(\d+)(?::\$?([A-Z]+)\$?(\d+))?/g)]
    .map((match) => parseRange(`${match[1]}${match[2]}:${match[3] ?? match[1]}${match[4] ?? match[2]}`));
  const used = sheet.dimensions;
  const range = areas.length ? {
    top: Math.min(...areas.map((area) => area.top)), left: Math.min(...areas.map((area) => area.left)),
    bottom: Math.max(...areas.map((area) => area.bottom)), right: Math.max(...areas.map((area) => area.right))
  } : { top: used.top || 1, left: used.left || 1, bottom: used.bottom || 1, right: used.right || 1 };
  const tooLarge = () => new ApiError(400, '紙の控えのレイアウトが大きすぎます。印刷範囲を確認してください');
  if ((range.bottom - range.top + 1) * (range.right - range.left + 1) > 30000) throw tooLarge();
  const layout: AssemblyCheckSheetLayout = { range, columnWidths: [], rowHeights: [], merges: [], cells: {} };
  for (let col = range.left; col <= range.right; col++) {
    const column = sheet.getColumn(col);
    layout.columnWidths.push(column.hidden ? 0 : Math.round((column.width ?? sheet.properties.defaultColWidth ?? 8.43) * 7 + 5));
  }
  for (let row = range.top; row <= range.bottom; row++) {
    const sourceRow = sheet.getRow(row);
    layout.rowHeights.push(sourceRow.hidden ? 0 : (sourceRow.height ?? sheet.properties.defaultRowHeight ?? 15) * 4 / 3);
    for (let col = range.left; col <= range.right; col++) {
      const cell = sheet.getCell(row, col);
      const value: AssemblyCheckSheetLayout['cells'][string] = {};
      const text = cell.master.address === cell.address ? cellText(cell) : '';
      if (text) value.text = text;
      if (cell.font?.size && cell.font.size !== 11) value.fontSize = cell.font.size;
      if (cell.font?.bold) value.bold = true;
      const align = cell.alignment;
      if (align?.horizontal === 'center' || align?.horizontal === 'centerContinuous') value.horizontal = 'center';
      else if (align?.horizontal === 'right' || align?.horizontal === 'justify') value.horizontal = align.horizontal;
      else if (!align?.horizontal && typeof cell.value === 'number') value.horizontal = 'right';
      if (align?.vertical === 'top' || align?.vertical === 'middle') value.vertical = align.vertical;
      if (align?.wrapText) value.wrap = true;
      for (const side of ['left', 'right', 'top', 'bottom'] as const) {
        const style = cell.border?.[side]?.style;
        if (style) (value.borders ??= {})[side] = /medium|thick|double/i.test(style) ? 'medium' : 'thin';
      }
      if (Object.keys(value).length) layout.cells[cell.address] = value;
    }
  }
  layout.merges = (sheet.model.merges ?? []).map((address) => {
    const merge = parseRange(address);
    return { top: merge.top, left: merge.left, bottom: merge.bottom, right: merge.right };
  }).filter((merge) => merge.bottom >= range.top && merge.top <= range.bottom && merge.right >= range.left && merge.left <= range.right);
  if (Buffer.byteLength(JSON.stringify(layout)) > 500_000) throw tooLarge();
  return layout;
}
