import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { assemblyCheckSheetProposalSchema } from '@raspi-system/shared-types';
import { parseCheckSheetXlsx } from '../check-sheet-xlsx-parser.js';
import { normalizeCheckSheet } from '../check-sheet-normalizer.js';
import { makeCheckSheetWorkbook } from './check-sheet.fixture.js';

describe('check-sheet parser and normalizer', () => {
  it('reads merged groups once, joins continuations, preserves blank fields and maps headers', async () => {
    const parsed = await parseCheckSheetXlsx(await makeCheckSheetWorkbook());
    const snapshot = JSON.stringify(parsed);
    const proposal = normalizeCheckSheet(parsed);
    expect(JSON.stringify(parsed)).toBe(snapshot);
    expect(proposal.groups).toHaveLength(3);
    expect(proposal.items).toHaveLength(9);
    expect(proposal.documentNo).toBe('産3-TEST-1');
    expect(proposal.headerCellMap).toEqual({ productName: 'D2', date: 'D3' });
    expect(proposal.items[0]).toMatchObject({
      itemKey: '1-1', inputKind: 'NUMBER', label: '締結トルク(    N・m)',
      inputSpec: { fields: [{ key: 'field1', unit: 'N·m' }] },
      valueTarget: { cell: 'F5', template: '・締結トルク({field1} N・m)' }
    });
    expect(proposal.items[2]).toMatchObject({ inputKind: 'TEXT', inputSpec: { fields: [{ key: 'field1' }, { key: 'field2' }] } });
    expect(proposal.items[3]).toMatchObject({ sourceRows: [8, 9], roleKeys: ['leader'] });
    expect(proposal.items[3].label).toContain('前後方向も確認');
    expect(proposal.items[4].inputSpec.fields?.[0].unit).toBe('N');
    expect(proposal.items[5].inputSpec.fields?.[0].unit).toBe('個');
    expect(proposal.items[6].inputSpec.fields?.map((field) => field.unit)).toEqual(['', 'N·m']);
    expect(proposal.items[7]).toMatchObject({ inputKind: 'CHOICE', roleKeys: ['制御設計担当'], conditionKey: null });
    expect(proposal.items[8]).toMatchObject({ roleKeys: ['section_chief'], valueTarget: { cell: 'C14' } });
    expect(assemblyCheckSheetProposalSchema.safeParse(proposal).success).toBe(true);
  });

  it('guesses a condition including its first item and resets at the next group', async () => {
    const proposal = normalizeCheckSheet(await parseCheckSheetXlsx(await makeCheckSheetWorkbook()));
    expect(proposal.items[0].conditionKey).toBeNull();
    expect(proposal.items.slice(1, 7).every((item) => item.conditionKey === '1-condition-1')).toBe(true);
    expect(proposal.items[1].label).toBe('治具を使用したか');
    expect(proposal.items[1].warnings).toContain('condition_guessed');
    expect(proposal.items[7].conditionKey).toBeNull();
  });

  it('handles vertical merges, notes and bullets inside the same printed stamp box', async () => {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await makeCheckSheetWorkbook() as unknown as ExcelJS.Buffer);
    const sheet = workbook.getWorksheet('合成チェックシート')!;
    sheet.unMergeCells('F8:R8');
    sheet.unMergeCells('F9:R9');
    sheet.mergeCells('F8:R9');
    sheet.getCell('F8').value = '・二行の項目';
    sheet.getCell('F10').value = '※メーカー推奨値を参照';
    sheet.getCell('F11').value = 'ねじロック 有・無';
    sheet.getCell('F12').value = '･塗布仕様（メーカー　　　　型式　　　　）';
    sheet.getCell('S11').border = { left: { style: 'thin' }, top: { style: 'thin' } };
    sheet.getCell('S12').border = { left: { style: 'thin' }, bottom: { style: 'thin' } };
    const proposal = normalizeCheckSheet(await parseCheckSheetXlsx(Buffer.from(await workbook.xlsx.writeBuffer())));
    expect(proposal.items[3]).toMatchObject({ sourceRows: [8, 9, 10], note: '※メーカー推奨値を参照' });
    expect(proposal.items[4]).toMatchObject({ inputKind: 'CHOICE', sourceRows: [11, 12] });
    expect(proposal.items[4].inputSpec.fields?.map((field) => field.label)).toEqual(['メーカー', '型式']);
    expect(proposal.items[4].warnings).toContain('multiple_value_cells_review');
  });

  it('allows an explicit sheet name, rejects an absent sheet and an invalid workbook', async () => {
    const buffer = await makeCheckSheetWorkbook();
    expect((await parseCheckSheetXlsx(buffer, '合成チェックシート')).sheetNames).toHaveLength(2);
    await expect(parseCheckSheetXlsx(buffer, '不存在')).rejects.toThrow('見つかりません');
    await expect(parseCheckSheetXlsx(buffer, '梱包ﾁｪｯｸｼｰﾄ')).rejects.toThrow('見出し');
    await expect(parseCheckSheetXlsx(Buffer.from('invalid'))).rejects.toThrow();
  });

  it('stops at the print area without requiring the footer', async () => {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await makeCheckSheetWorkbook() as unknown as ExcelJS.Buffer);
    workbook.getWorksheet('合成チェックシート')!.pageSetup.printArea = 'A1:S7';
    const proposal = normalizeCheckSheet(await parseCheckSheetXlsx(Buffer.from(await workbook.xlsx.writeBuffer())));
    expect(proposal.groups).toHaveLength(1);
    expect(proposal.items).toHaveLength(3);
  });

  it('rejects duplicate keys, missing groups and invalid input specifications', async () => {
    const proposal = normalizeCheckSheet(await parseCheckSheetXlsx(await makeCheckSheetWorkbook()));
    const duplicate = structuredClone(proposal);
    duplicate.items[1].itemKey = duplicate.items[0].itemKey;
    expect(assemblyCheckSheetProposalSchema.safeParse(duplicate).success).toBe(false);
    const orphan = structuredClone(proposal);
    orphan.items[0].groupNo = 999;
    expect(assemblyCheckSheetProposalSchema.safeParse(orphan).success).toBe(false);
    const noFields = structuredClone(proposal);
    noFields.items[0].inputSpec = {};
    expect(assemblyCheckSheetProposalSchema.safeParse(noFields).success).toBe(false);
  });

  it('keeps unknown units for review and recognizes a multi-axis continuation', async () => {
    const parsed = await parseCheckSheetXlsx(await makeCheckSheetWorkbook());
    parsed.items[0].fragments[0].text = '・圧力（   psi）'.normalize('NFKC');
    parsed.items[1].fragments = [{ cell: 'F6', text: '・ストロークの確認' }, { cell: 'F7', text: 'X軸     Y軸     Z軸     θ軸' }];
    const proposal = normalizeCheckSheet(parsed);
    expect(proposal.items[0]).toMatchObject({ inputKind: 'NUMBER', inputSpec: { fields: [{ unit: '' }] }, warnings: ['unit_unknown'] });
    expect(proposal.items[0].valueTarget).toMatchObject({ template: '・圧力({field1} psi)' });
    expect(proposal.items[1].inputSpec.fields?.map((field) => field.label)).toEqual(['X軸', 'Y軸', 'Z軸', 'θ軸']);
    expect(proposal.items[1].valueTarget).toMatchObject({ cell: 'F7' });
  });
});
