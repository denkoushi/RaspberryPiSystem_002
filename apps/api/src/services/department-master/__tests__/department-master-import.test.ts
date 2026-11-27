import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';

import {
  DEPARTMENT_MASTER_HEADERS,
  parseDepartmentMasterRows,
  readDepartmentMasterXlsx,
  serialToDate,
  serialToJstDateTime,
  summarizeDepartmentMasterRows
} from '../department-master-import.js';

const header = [...DEPARTMENT_MASTER_HEADERS];
// FBUSHOCD, KANA, NAME, TYP, FENTDT, FINVALYMD, FJOI, FSIREFLG, FUPDTEDT, FKOKYAKUFLG, FVALIDYMD
const row = (over: Partial<Record<number, string>> = {}): string[] => {
  const base = ['TEST01', 'ﾃｽﾄ', 'テスト部署', 'C', '45000.5', '45099', 'TEST00', '1', '45001.25', '0', '45000'];
  return base.map((v, i) => over[i] ?? v);
};

describe('serial conversion', () => {
  it('converts date serials from 1899-12-30', () => {
    expect(serialToDate(2).toISOString()).toBe('1900-01-01T00:00:00.000Z');
    expect(serialToDate(45000).toISOString()).toBe('2023-03-15T00:00:00.000Z');
  });
  it('treats fractional part as JST time and converts to UTC', () => {
    expect(serialToJstDateTime(45000.5).toISOString()).toBe('2023-03-15T03:00:00.000Z');
    expect(serialToJstDateTime(45000).toISOString()).toBe('2023-03-14T15:00:00.000Z');
  });
});

describe('parseDepartmentMasterRows', () => {
  it('converts rows, nulls empty cells and flags', () => {
    const [r] = parseDepartmentMasterRows([header, row({ 1: '', 6: '' })]);
    expect(r).toMatchObject({
      code: 'TEST01',
      kanaName: null,
      parentCode: null,
      isSupplier: true,
      isCustomer: false
    });
    expect(r?.validFrom.toISOString()).toBe('2023-03-15T00:00:00.000Z');
    expect(r?.validTo.toISOString()).toBe('2023-06-22T00:00:00.000Z');
  });
  it('rejects a mismatched header', () => {
    expect(() => parseDepartmentMasterRows([[...header.slice(0, 10), 'X'], row()])).toThrow('見出し');
    expect(() => parseDepartmentMasterRows([header.slice(0, 10), row()])).toThrow('見出し');
  });
  it('skips trailing empty and one-column rows but rejects others', () => {
    expect(parseDepartmentMasterRows([header, row(), [], ['note']])).toHaveLength(1);
    expect(() => parseDepartmentMasterRows([header, ['note'], row()])).toThrow('11');
    expect(() => parseDepartmentMasterRows([header, row(), ['a', 'b']])).toThrow('11');
  });
  it('rejects duplicate (code, validFrom)', () => {
    expect(() => parseDepartmentMasterRows([header, row(), row()])).toThrow('重複');
  });
  it('rejects overlapping periods of the same code', () => {
    expect(() => parseDepartmentMasterRows([header, row({ 10: '45000', 5: '45099' }), row({ 10: '45050', 5: '45200' })])).toThrow('重なっています');
    expect(parseDepartmentMasterRows([header, row({ 10: '45000', 5: '45049' }), row({ 10: '45050', 5: '45200' })])).toHaveLength(2);
  });
  it('rejects zero data rows and bad values', () => {
    expect(() => parseDepartmentMasterRows([header])).toThrow('0件');
    expect(() => parseDepartmentMasterRows([header, row({ 10: 'x' })])).toThrow('FVALIDYMD');
    expect(() => parseDepartmentMasterRows([header, row({ 7: '2' })])).toThrow('FSIREFLG');
    expect(() => parseDepartmentMasterRows([header, row({ 5: '44000' })])).toThrow('逆転');
  });
  it('summarizes counts', () => {
    const rows = parseDepartmentMasterRows([header, row(), row({ 10: '45100', 5: '45200' }), row({ 0: 'TEST02', 3: 'P' })]);
    expect(summarizeDepartmentMasterRows(rows)).toEqual({
      total: 3,
      byUnitType: { C: 2, P: 1 },
      duplicatedCodeCount: 1
    });
  });
});

describe('readDepartmentMasterXlsx', () => {
  const inline = (text: string): string => `<x:c t="inlineStr"><x:is><x:t>${text}</x:t></x:is></x:c>`;
  const num = (v: string): string => `<x:c><x:v>${v}</x:v></x:c>`;

  async function buildXlsx(rows: string[]): Promise<Buffer> {
    const zip = new JSZip();
    zip.file(
      'xl/worksheets/sheet1.xml',
      `<?xml version="1.0"?><x:worksheet xmlns:x="urn:test"><x:sheetData>${rows.join('')}</x:sheetData></x:worksheet>`
    );
    return zip.generateAsync({ type: 'nodebuffer' });
  }

  it('reads prefixed inline strings, numbers, empty cells and entities', async () => {
    const headRow = `<x:row>${header.map(inline).join('')}</x:row>`;
    const dataRow = `<x:row>${inline('TEST01')}<x:c/>${inline('A&amp;B')}${inline('C')}${num('45000.5')}${num('45099')}<x:c t="inlineStr"><x:is><x:t></x:t></x:is></x:c>${inline('0')}${num('45001.25')}${inline('1')}${num('45000')}</x:row>`;
    const footer = `<x:row>${inline('注記')}</x:row>`;
    const rows = await readDepartmentMasterXlsx(await buildXlsx([headRow, dataRow, footer]));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ code: 'TEST01', kanaName: null, name: 'A&B', parentCode: null, isCustomer: true });
  });

  it('fails when the sheet is missing', async () => {
    const zip = new JSZip();
    zip.file('other.xml', '<a/>');
    await expect(readDepartmentMasterXlsx(await zip.generateAsync({ type: 'nodebuffer' }))).rejects.toThrow('sheet1');
  });
});
