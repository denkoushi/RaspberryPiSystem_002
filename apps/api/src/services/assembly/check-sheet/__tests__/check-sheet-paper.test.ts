import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import type { AssemblyCheckSheetPayload } from '@raspi-system/shared-types';
import { assemblyCheckSheetLayoutSchema } from '@raspi-system/shared-types';
import { buildCheckSheetLayout } from '../check-sheet-layout.js';
import { buildCheckSheetWrites } from '../check-sheet-paper-writes.js';
import { fillCheckSheetXlsx } from '../check-sheet-xlsx-filler.js';

async function workbookFixture() {
  const book = new ExcelJS.Workbook();
  book.addWorksheet('Other').getCell('A1').value = 'Untouched';
  const sheet = book.addWorksheet('検査 & 控え');
  sheet.getCell('B2').value = { formula: '1+2', result: 3 };
  sheet.getCell('B2').font = { size: 14, bold: true };
  sheet.getCell('D2').value = { formula: '2+3', result: 5 };
  sheet.getCell('C3').value = '見出し'; sheet.mergeCells('C3:E3');
  sheet.getCell('C3').alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  sheet.getCell('C3').border = { top: { style: 'medium' }, bottom: { style: 'thin' } };
  sheet.getCell('E8').value = 'last';
  sheet.pageSetup.printArea = 'B2:F8';
  sheet.getColumn(2).width = 20; sheet.getRow(2).height = 30;
  const zip = await JSZip.loadAsync(await book.xlsx.writeBuffer());
  zip.file('xl/embeddings/oleObject1.bin', Buffer.from([0, 1, 255, 32, 127]));
  zip.file('xl/calcChain.xml', '<calcChain/>');
  zip.file('[Content_Types].xml', (await zip.file('[Content_Types].xml')!.async('string')).replace('</Types>', '<Override PartName="/xl/calcChain.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.calcChain+xml"/></Types>'));
  zip.file('xl/_rels/workbook.xml.rels', (await zip.file('xl/_rels/workbook.xml.rels')!.async('string')).replace('</Relationships>', '<Relationship Id="rCalc" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/calcChain" Target="calcChain.xml"/></Relationships>'));
  return zip.generateAsync({ type: 'nodebuffer' });
}

describe('check-sheet raw XML filler', () => {
  it('patches only intended parts, preserves OLE/merges/styles and creates ordered rows/cells', async () => {
    const source = await workbookFixture();
    const original = await JSZip.loadAsync(source);
    // Resolve a nonstandard worksheet part through relationships, including absolute targets.
    const sheetXml = await original.file('xl/worksheets/sheet2.xml')!.async('string');
    original.remove('xl/worksheets/sheet2.xml');
    original.file('xl/worksheets/custom.xml', sheetXml);
    original.file('xl/_rels/workbook.xml.rels', (await original.file('xl/_rels/workbook.xml.rels')!.async('string')).replace('worksheets/sheet2.xml', '/xl/worksheets/custom.xml'));
    original.file('[Content_Types].xml', (await original.file('[Content_Types].xml')!.async('string')).replace('/xl/worksheets/sheet2.xml', '/xl/worksheets/custom.xml'));
    const text = ' 山田 & < > " \'\n$& ';
    const output = await fillCheckSheetXlsx(await original.generateAsync({ type: 'nodebuffer' }), '検査 & 控え', [
      { cell: 'B2', text }, { cell: 'C2', text: 'new' }, { cell: 'E5', text: 'last' },
      { cell: 'B5', text: 'first' }, { cell: 'A1', text: 'header' }, { cell: 'Z9', text: 'end' }
    ]);
    const filled = await JSZip.loadAsync(output);
    const changed = new Set(['xl/worksheets/custom.xml', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels', '[Content_Types].xml', 'xl/calcChain.xml']);
    for (const entry of Object.values(original.files)) {
      if (!entry.dir && !changed.has(entry.name)) expect(await filled.file(entry.name)!.async('nodebuffer'), entry.name).toEqual(await entry.async('nodebuffer'));
    }
    expect(filled.file('xl/calcChain.xml')).toBeNull();
    expect(await filled.file('[Content_Types].xml')!.async('string')).not.toContain('calcChain');
    expect(await filled.file('xl/_rels/workbook.xml.rels')!.async('string')).not.toContain('calcChain');
    expect(await filled.file('xl/workbook.xml')!.async('string')).toContain('fullCalcOnLoad="1"');
    const xml = await filled.file('xl/worksheets/custom.xml')!.async('string');
    expect([...xml.matchAll(/<row r="(\d+)"/g)].map((m) => Number(m[1]))).toEqual([1, 2, 3, 5, 8, 9]);
    expect([...xml.match(/<row r="5"[\s\S]*?<\/row>/)![0].matchAll(/<c r="([^"]+)"/g)].map((m) => m[1])).toEqual(['B5', 'E5']);
    expect(xml).toContain('xml:space="preserve"');
    // ExcelJS only reads canonical sheetN paths; restore the alias for this reader check.
    filled.file('xl/worksheets/sheet2.xml', xml);
    filled.file('xl/_rels/workbook.xml.rels', (await filled.file('xl/_rels/workbook.xml.rels')!.async('string')).replace('/xl/worksheets/custom.xml', 'worksheets/sheet2.xml'));
    const book = new ExcelJS.Workbook(); await book.xlsx.load(await filled.generateAsync({ type: 'nodebuffer' }) as unknown as ExcelJS.Buffer);
    const sheet = book.getWorksheet('検査 & 控え')!;
    expect(sheet.getCell('B2').value).toBe(text);
    expect(sheet.getCell('B2').formula).toBeUndefined();
    expect(sheet.getCell('B2').font).toMatchObject({ size: 14, bold: true });
    expect(sheet.getCell('D2').formula).toBe('2+3');
    expect(sheet.getCell('E3').master.address).toBe('C3');
    expect(sheet.getCell('B5').text).toBe('first');
  });
  it('fills a normal package readable by ExcelJS and rejects missing worksheets', async () => {
    const source = await workbookFixture();
    const output = await fillCheckSheetXlsx(source, '検査 & 控え', [{ cell: 'C3', text: 'merged' }]);
    const book = new ExcelJS.Workbook(); await book.xlsx.load(output as unknown as ExcelJS.Buffer);
    expect(book.getWorksheet('検査 & 控え')!.getCell('E3').text).toBe('merged');
    await expect(fillCheckSheetXlsx(source, 'missing', [])).rejects.toThrow('Worksheet not found');
  });
});

describe('check-sheet raw XML filler edge cases', () => {
  async function pack(sheetData: string) {
    const zip = new JSZip();
    zip.file('[Content_Types].xml', '<Types/>');
    zip.file('xl/workbook.xml', '<workbook><sheets><sheet name="s" r:id="rId1"/></sheets><calcPr calcId="1"/></workbook>');
    zip.file('xl/_rels/workbook.xml.rels', '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>');
    zip.file('xl/worksheets/sheet1.xml', `<worksheet><sheetData>${sheetData}</sheetData></worksheet>`);
    return zip.generateAsync({ type: 'nodebuffer' });
  }
  const sheetXml = async (buffer: Buffer) => (await JSZip.loadAsync(buffer)).file('xl/worksheets/sheet1.xml')!.async('string');
  it('keeps neighbours of self-closing cells and rows', async () => {
    const source = await pack('<row r="7" customHeight="1"/><row r="8"><c r="A8" s="1"/><c r="B8" t="s"><v>0</v></c><c r="C8" s="1"/></row>');
    const xml = await sheetXml(await fillCheckSheetXlsx(source, 's', [{ cell: 'A8', text: 'a' }, { cell: 'C8', text: 'c\u0001' }, { cell: 'B7', text: 'b' }]));
    expect(xml).toContain('<c r="B8" t="s"><v>0</v></c>');
    expect(xml.match(/<c r="C8"/g)).toHaveLength(1);
    expect(xml.match(/<row r="8"/g)).toHaveLength(1);
    expect(xml).toContain('<row r="7" customHeight="1"><c r="B7" t="inlineStr">');
    expect(xml).toContain('>c</t>');
  });
  it('refuses to overwrite a shared formula master', async () => {
    const source = await pack('<row r="1"><c r="A1"><f t="shared" ref="A1:A2" si="0">B1</f><v>1</v></c></row>');
    await expect(fillCheckSheetXlsx(source, 's', [{ cell: 'A1', text: 'x' }])).rejects.toThrow('shared formula master');
  });
});

describe('check-sheet layout snapshot', () => {
  it('captures the print area, merged cells, sizes and formatting within the byte budget', async () => {
    const layout = await buildCheckSheetLayout(await workbookFixture(), '検査 & 控え');
    expect(assemblyCheckSheetLayoutSchema.safeParse(layout).success).toBe(true);
    expect(layout.range).toEqual({ top: 2, left: 2, bottom: 8, right: 6 });
    expect(layout.columnWidths[0]).toBe(145); expect(layout.rowHeights[0]).toBe(40);
    expect(layout.merges).toEqual([{ top: 3, left: 3, bottom: 3, right: 5 }]);
    expect(layout.cells.C3).toMatchObject({ text: '見出し', horizontal: 'center', vertical: 'middle', wrap: true, borders: { top: 'medium', bottom: 'thin' } });
    expect(layout.cells.B2).toMatchObject({ fontSize: 14, bold: true });
    expect(layout.cells.D3?.text).toBeUndefined();
    expect(Buffer.byteLength(JSON.stringify(layout))).toBeLessThan(500000);
  });
  it('falls back to used range and rejects oversized print areas', async () => {
    const book = new ExcelJS.Workbook(); const sheet = book.addWorksheet('test'); sheet.getCell('C4').value = 'value';
    const source = () => book.xlsx.writeBuffer().then((bytes) => Buffer.from(bytes));
    expect((await buildCheckSheetLayout(await source(), 'test')).range).toEqual({ top: 4, left: 3, bottom: 4, right: 3 });
    sheet.pageSetup.printArea = 'A1:ZZ10000';
    await expect(buildCheckSheetLayout(await source(), 'test')).rejects.toMatchObject({ statusCode: 400 });
  });
  it('shows dates as Excel-style dates and empty date formulas as blank', async () => {
    const book = new ExcelJS.Workbook(); const sheet = book.addWorksheet('test');
    sheet.getCell('A1').value = new Date(Date.UTC(2026, 5, 23));
    sheet.getCell('B1').value = { formula: 'A2', result: new Date(Date.UTC(1899, 11, 30)) };
    const layout = await buildCheckSheetLayout(Buffer.from(await book.xlsx.writeBuffer()), 'test');
    expect(layout.cells.A1?.text).toBe('2026/6/23');
    expect(layout.cells.B1?.text).toBeUndefined();
  });
});

describe('check-sheet paper writes', () => {
  it('formats Tokyo OK/NA/flagged NG stamps, headers, numeric units, zero and inline placeholders', () => {
    const items = [
      { id: 'ok', stampCell: 'S1', inputKind: 'NUMBER', inputSpec: { fields: [{ key: 'n', unit: 'V' }] }, valueTarget: { mode: 'cell', cell: 'F1' } },
      { id: 'na', stampCell: 'S2', inputSpec: {}, valueTarget: { mode: 'cell', cell: 'F2' } },
      { id: 'ng', stampCell: 'S3', inputSpec: {}, valueTarget: { mode: 'inline', cell: 'F3', template: 'M{size}（{torque} N·m）{missing}' } },
      { id: 'todo', stampCell: 'S4', inputSpec: {}, valueTarget: { mode: 'cell', cell: 'F4' } }
    ];
    const sheet = { revision: { items, headerCellMap: { seiban: 'Q4', customer: 'K6' } }, headerValues: { seiban: '製番1' }, stamps: [
      { itemId: 'ok', result: 'OK', values: { n: 0 }, employeeNameSnapshot: '山田　一郎', stampedAt: '2026-10-28T15:12:00Z' },
      { itemId: 'na', result: 'NA', values: {}, employeeNameSnapshot: '佐藤 次郎', stampedAt: '2026-10-29T00:12:00Z' },
      { itemId: 'ng', result: 'NG', flagged: true, values: { size: 5, torque: 12 }, employeeNameSnapshot: '鈴木', stampedAt: '2026-10-29T00:12:00Z' }
    ] } as unknown as AssemblyCheckSheetPayload;
    expect(buildCheckSheetWrites(sheet)).toEqual([
      { cell: 'Q4', text: '製番1' }, { cell: 'F1', text: '0 V' }, { cell: 'S1', text: '山田 10/29 00:12' },
      { cell: 'S2', text: '該当なし 佐藤' }, { cell: 'F3', text: 'M5（12 N·m）' }, { cell: 'S3', text: 'NG 鈴木' }
    ]);
  });
});
