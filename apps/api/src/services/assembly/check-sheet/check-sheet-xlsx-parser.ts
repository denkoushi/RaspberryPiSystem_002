import ExcelJS from 'exceljs';

/** Keep blank runs: they are input slots, not cosmetic whitespace. */
export function normalizeCheckSheetText(text: string): string {
  return text.replace(/\u3000/g, ' ').normalize('NFKC').replace(/\r\n?/g, '\n').trim();
}

export type ParsedCheckSheetItem = {
  groupNo: number;
  sourceRows: number[];
  stampCell: string;
  fragments: { cell: string; text: string }[];
};

export type ParsedCheckSheet = {
  sheetNames: string[];
  sourceSheetName: string;
  documentNo: string;
  title: string;
  revisionLabel: string;
  headerCellMap: Record<string, string>;
  stampColumn: string;
  groups: { groupNo: number; label: string; sortOrder: number }[];
  items: ParsedCheckSheetItem[];
};

const compact = (text: string) => normalizeCheckSheetText(text).replace(/\s/g, '');
const isBullet = (text: string) => /^[・･]/.test(text);
const isAxisLine = (text: string) => /^(?:[XYZθ]軸\s*){2,}/.test(text);

/** Reads only. No filesystem, storage, database, or workbook serialization. */
export async function parseCheckSheetXlsx(buffer: Buffer, sheetName?: string): Promise<ParsedCheckSheet> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  const sheet = sheetName ? workbook.getWorksheet(sheetName) : workbook.worksheets.find((candidate) => {
    const name = normalizeCheckSheetText(candidate.name);
    return name.includes('チェックシート') && !name.includes('梱包');
  });
  if (!sheet) throw new Error('検査チェックシートが見つかりません');

  let headerRow = 0;
  let noColumn = 0;
  let groupColumn = 0;
  let itemColumn = 0;
  let stampColumn = 0;
  // Bound work to the print area when supplied, excluding input blocks outside it.
  const printRanges = [...(sheet.pageSetup.printArea ?? '').matchAll(/\$?([A-Z]+)\$?(\d+):\$?([A-Z]+)\$?(\d+)/g)];
  const lastRow = printRanges.length ? Math.max(...printRanges.map((range) => Number(range[4]))) : sheet.rowCount;
  for (let rowNo = 1; rowNo <= Math.min(lastRow, 100); rowNo++) {
    const columns: Record<string, number> = {};
    sheet.getRow(rowNo).eachCell((cell, column) => {
      if (cell.master.address !== cell.address) return;
      const text = compact(cell.text);
      if (/^no\.?$/i.test(text)) columns.no = column;
      if (/主.*項.*目/.test(text)) columns.group = column;
      if (/チ.*項.*目/.test(text)) columns.item = column;
      if (text === 'チェック') columns.stamp = column;
    });
    if (columns.no && columns.group && columns.item && columns.stamp) {
      headerRow = rowNo;
      ({ no: noColumn, group: groupColumn, item: itemColumn, stamp: stampColumn } = columns);
      break;
    }
  }
  if (!headerRow) throw new Error('No・主項目・チェック項目・チェックの見出しが見つかりません');

  const result: ParsedCheckSheet = {
    sheetNames: workbook.worksheets.map((candidate) => candidate.name),
    sourceSheetName: sheet.name, documentNo: '', title: sheet.name, revisionLabel: '',
    headerCellMap: {}, stampColumn: sheet.getColumn(stampColumn).letter, groups: [], items: []
  };
  const headerLabels: Record<string, string> = {
    日付: 'date', 出荷予定日: 'shipDate', 製品No: 'productNo', 製番: 'seiban', 製品名: 'productName', 客先名: 'customer'
  };
  for (let rowNo = 1; rowNo < headerRow; rowNo++) {
    sheet.getRow(rowNo).eachCell((cell, column) => {
      if (column > stampColumn || cell.master.address !== cell.address) return;
      const text = normalizeCheckSheetText(cell.text);
      if (text.includes('チェックシート')) result.title = text;
      const docNo = text.match(/産\d+-[A-Z0-9-]+/i);
      if (docNo) result.documentNo = docNo[0];
      if (/△\s*\d/.test(text)) result.revisionLabel = text;
      const key = headerLabels[compact(text).replace(/:$/, '')];
      if (key) {
        let next = column + 1;
        while (next <= stampColumn && sheet.getCell(rowNo, next).master.address === cell.address) next++;
        if (next <= stampColumn) result.headerCellMap[key] = sheet.getCell(rowNo, next).master.address;
      }
    });
  }

  let currentGroup: ParsedCheckSheet['groups'][number] | undefined;
  const seen = new Set<string>();
  for (let rowNo = headerRow + 1; rowNo <= lastRow; rowNo++) {
    if (/^制定/.test(compact(sheet.getCell(rowNo, 1).text))) break;
    const noCell = sheet.getCell(rowNo, noColumn);
    const groupCell = sheet.getCell(rowNo, groupColumn).master;
    const number = Number(compact(noCell.text));
    const newGroup = Number.isInteger(number) && number > 0 && number !== currentGroup?.groupNo;
    if (newGroup) {
      currentGroup = { groupNo: number, label: normalizeCheckSheetText(groupCell.text), sortOrder: result.groups.length };
      result.groups.push(currentGroup);
    }
    if (!currentGroup) continue;
    const cell = sheet.getCell(rowNo, itemColumn).master;
    const text = normalizeCheckSheetText(cell.text);
    const previous = result.items.at(-1);
    if (seen.has(cell.address)) {
      if (previous?.fragments.some((fragment) => fragment.cell === cell.address)) previous.sourceRows.push(rowNo);
      continue;
    }
    seen.add(cell.address);
    if (!text) continue;
    const stamp = sheet.getCell(rowNo, stampColumn);
    const previousStamp = sheet.getCell(rowNo - 1, stampColumn);
    const hasStampBorders = Boolean(stamp.border?.left || stamp.border?.right);
    const boundary = Boolean(stamp.border?.top?.style || previousStamp.border?.bottom?.style);
    // Borderless forms use bullets; printed forms may have a bullet inside a continued stamp box.
    const startsItem = newGroup || !previous || /場合.*以下.*確認/.test(text) ||
      (!/^※/.test(text) && !isAxisLine(text) && (hasStampBorders ? boundary : isBullet(text)));
    if (startsItem) {
      result.items.push({
        groupNo: currentGroup.groupNo, sourceRows: [rowNo], stampCell: stamp.master.address,
        fragments: [{ cell: cell.address, text }]
      });
    } else {
      previous.sourceRows.push(rowNo);
      previous.fragments.push({ cell: cell.address, text });
    }
  }
  if (!result.items.length) throw new Error('検査項目が見つかりません');
  return result;
}
