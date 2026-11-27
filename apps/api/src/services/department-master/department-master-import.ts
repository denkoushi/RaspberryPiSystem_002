import JSZip from 'jszip';
import { JST_OFFSET_MS } from '../../lib/jst-date.js';

export const DEPARTMENT_MASTER_HEADERS = [
  'FBUSHOCD',
  'FBUSHOKANAMEI',
  'FBUSHORMEI',
  'FBUSHOTYP',
  'FENTDT',
  'FINVALYMD',
  'FJOIBUSHOCD',
  'FSIREFLG',
  'FUPDTEDT',
  'FKOKYAKUFLG',
  'FVALIDYMD'
] as const;

export type DepartmentMasterImportRow = {
  code: string;
  kanaName: string | null;
  name: string;
  unitType: string;
  parentCode: string | null;
  isSupplier: boolean;
  isCustomer: boolean;
  validFrom: Date;
  validTo: Date;
  sourceEnteredAt: Date | null;
  sourceUpdatedAt: Date | null;
};

const DAY_MS = 86_400_000;
const SERIAL_EPOCH_MS = Date.UTC(1899, 11, 30);

/** Excel のシリアル値(整数)を、UTC 0時の日付にする(2 → 1900-01-01)。 */
export function serialToDate(serial: number): Date {
  return new Date(SERIAL_EPOCH_MS + Math.floor(serial) * DAY_MS);
}

/** Excel のシリアル値(小数つき)を、日本時間の時刻として UTC の日時にする。 */
export function serialToJstDateTime(serial: number): Date {
  return new Date(SERIAL_EPOCH_MS + Math.round(serial * DAY_MS) - JST_OFFSET_MS);
}

function decodeXmlText(text: string): string {
  return text
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

const ROW_PATTERN = /<(?:[\w-]+:)?row\b[^>]*?(?:\/>|>([\s\S]*?)<\/(?:[\w-]+:)?row>)/g;
const CELL_PATTERN = /<(?:[\w-]+:)?c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:[\w-]+:)?c>)/g;
const TEXT_PATTERN = /<(?:[\w-]+:)?t\b[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?t>/g;
const VALUE_PATTERN = /<(?:[\w-]+:)?v\b[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?v>/;

/** sheet XML を、セルの並び順だけで文字列の表にする(セル参照は使わない)。 */
export function parseSheetXmlToRows(xml: string): string[][] {
  const rows: string[][] = [];
  for (const rowMatch of xml.matchAll(ROW_PATTERN)) {
    const cells: string[] = [];
    for (const cellMatch of (rowMatch[1] ?? '').matchAll(CELL_PATTERN)) {
      const attrs = cellMatch[1] ?? '';
      const body = cellMatch[2] ?? '';
      const type = /\bt="([^"]*)"/.exec(attrs)?.[1];
      if (type === 's') {
        throw new Error('共有文字列のセルには対応していません');
      }
      if (type === 'inlineStr') {
        const parts = [...body.matchAll(TEXT_PATTERN)].map((m) => decodeXmlText(m[1] ?? ''));
        cells.push(parts.join(''));
      } else {
        const value = VALUE_PATTERN.exec(body)?.[1];
        cells.push(value === undefined ? '' : decodeXmlText(value));
      }
    }
    rows.push(cells);
  }
  return rows;
}

export async function readXlsxFirstSheetRows(buffer: Buffer): Promise<string[][]> {
  const zip = await JSZip.loadAsync(buffer);
  const sheet = zip.file('xl/worksheets/sheet1.xml');
  if (!sheet) {
    throw new Error('xl/worksheets/sheet1.xml が見つかりません');
  }
  return parseSheetXmlToRows(await sheet.async('string'));
}

function parseSerial(raw: string, rowNumber: number, column: string): number {
  const value = Number(raw.trim());
  if (raw.trim() === '' || !Number.isFinite(value)) {
    throw new Error(`${rowNumber} 行目の ${column} が数値ではありません`);
  }
  return value;
}

function parseOptionalSerial(raw: string, rowNumber: number, column: string): number | null {
  return raw.trim() === '' ? null : parseSerial(raw, rowNumber, column);
}

function parseFlag(raw: string, rowNumber: number, column: string): boolean {
  const value = raw.trim();
  if (value !== '0' && value !== '1') {
    throw new Error(`${rowNumber} 行目の ${column} が 0 / 1 ではありません`);
  }
  return value === '1';
}

/** 見出し行つきの表を検証し、取り込み用の行に変換する。 */
export function parseDepartmentMasterRows(table: readonly (readonly string[])[]): DepartmentMasterImportRow[] {
  const header = table[0];
  if (
    !header ||
    header.length !== DEPARTMENT_MASTER_HEADERS.length ||
    header.some((cell, index) => cell.trim() !== DEPARTMENT_MASTER_HEADERS[index])
  ) {
    throw new Error('見出し行が想定の11列と一致しません');
  }

  const result: DepartmentMasterImportRow[] = [];
  const seen = new Set<string>();
  // 末尾に付く「0〜1列の行」(空行、フィルターなしの注記)だけは飛ばす。
  let lastDataIndex = 0;
  table.forEach((cells, index) => {
    if (cells.length === DEPARTMENT_MASTER_HEADERS.length) lastDataIndex = index;
  });

  for (let index = 1; index < table.length; index += 1) {
    const cells = table[index] ?? [];
    const rowNumber = index + 1;
    if (cells.length !== DEPARTMENT_MASTER_HEADERS.length) {
      if (index > lastDataIndex && cells.length <= 1) {
        continue;
      }
      throw new Error(`${rowNumber} 行目の列数が11ではありません`);
    }
    const [code, kana, name, unitType, enteredAt, validTo, parent, supplier, updatedAt, customer, validFrom] =
      cells.map((cell) => cell.trim()) as [string, string, string, string, string, string, string, string, string, string, string];

    if (code === '') throw new Error(`${rowNumber} 行目の FBUSHOCD が空です`);
    if (unitType === '') throw new Error(`${rowNumber} 行目の FBUSHOTYP が空です`);

    const from = serialToDate(parseSerial(validFrom, rowNumber, 'FVALIDYMD'));
    const to = serialToDate(parseSerial(validTo, rowNumber, 'FINVALYMD'));
    if (to.getTime() < from.getTime()) {
      throw new Error(`${rowNumber} 行目の有効期間が逆転しています`);
    }
    const key = `${code}\u0000${from.getTime()}`;
    if (seen.has(key)) {
      throw new Error(`${rowNumber} 行目が (コード, 有効開始日) の重複です`);
    }
    seen.add(key);

    const entered = parseOptionalSerial(enteredAt, rowNumber, 'FENTDT');
    const updated = parseOptionalSerial(updatedAt, rowNumber, 'FUPDTEDT');
    result.push({
      code,
      kanaName: kana === '' ? null : kana,
      name,
      unitType,
      parentCode: parent === '' ? null : parent,
      isSupplier: parseFlag(supplier, rowNumber, 'FSIREFLG'),
      isCustomer: parseFlag(customer, rowNumber, 'FKOKYAKUFLG'),
      validFrom: from,
      validTo: to,
      sourceEnteredAt: entered === null ? null : serialToJstDateTime(entered),
      sourceUpdatedAt: updated === null ? null : serialToJstDateTime(updated)
    });
  }

  if (result.length === 0) {
    throw new Error('データ行が0件です');
  }
  assertNoOverlappingPeriods(result);
  return result;
}

/** 同じコードの有効期間が重なると、ある日の名前が1つに決まらないので取り込まない。 */
function assertNoOverlappingPeriods(rows: readonly DepartmentMasterImportRow[]): void {
  const byCode = new Map<string, DepartmentMasterImportRow[]>();
  for (const row of rows) byCode.set(row.code, [...byCode.get(row.code) ?? [], row]);
  for (const [code, periods] of byCode) {
    const sorted = [...periods].sort((a, b) => a.validFrom.getTime() - b.validFrom.getTime());
    for (let index = 1; index < sorted.length; index += 1) {
      if (sorted[index]!.validFrom.getTime() <= sorted[index - 1]!.validTo.getTime()) {
        throw new Error(`コード ${code} の有効期間が重なっています`);
      }
    }
  }
}

export async function readDepartmentMasterXlsx(buffer: Buffer): Promise<DepartmentMasterImportRow[]> {
  return parseDepartmentMasterRows(await readXlsxFirstSheetRows(buffer));
}

export function summarizeDepartmentMasterRows(rows: readonly DepartmentMasterImportRow[]): {
  total: number;
  byUnitType: Record<string, number>;
  duplicatedCodeCount: number;
} {
  const byUnitType: Record<string, number> = {};
  const codeCounts = new Map<string, number>();
  for (const row of rows) {
    byUnitType[row.unitType] = (byUnitType[row.unitType] ?? 0) + 1;
    codeCounts.set(row.code, (codeCounts.get(row.code) ?? 0) + 1);
  }
  let duplicatedCodeCount = 0;
  for (const count of codeCounts.values()) {
    if (count > 1) duplicatedCodeCount += 1;
  }
  return { total: rows.length, byUnitType, duplicatedCodeCount };
}
