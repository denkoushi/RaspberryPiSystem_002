import ExcelJS from 'exceljs';

export async function makeCheckSheetWorkbook(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.addWorksheet('梱包ﾁｪｯｸｼｰﾄ');
  const sheet = workbook.addWorksheet('合成チェックシート');
  sheet.pageSetup.printArea = 'A1:S20';
  sheet.getCell('E1').value = '合成チェックシート';
  sheet.getCell('P1').value = '産3-TEST-1';
  sheet.getCell('B2').value = '製品名';
  sheet.mergeCells('B2:C2');
  sheet.mergeCells('D2:M2');
  sheet.getCell('D2').value = { formula: 'U1', result: '合成品' };
  sheet.mergeCells('B3:C3');
  sheet.getCell('B3').value = '日 付：';
  sheet.mergeCells('D3:E3');
  for (const [cell, text] of Object.entries({ A4: 'Ｎｏ', C4: '主　項　目', F4: 'チ ェ ッ ク 項 目', S4: 'ﾁｪｯｸ' })) {
    sheet.getCell(cell).value = text;
  }
  for (const [start, end, groupNo, label] of [[5, 12, 1, '機構'], [13, 13, 2, 'IO（制御設計担当）'], [14, 14, 3, '最終確認（係長）']] as const) {
    sheet.mergeCells(`A${start}:B${end}`);
    sheet.mergeCells(`C${start}:${groupNo === 3 ? 'R' : 'E'}${end}`);
    sheet.getCell(`A${start}`).value = groupNo;
    sheet.getCell(`C${start}`).value = label;
  }
  const rows: Record<number, string> = {
    5: '・締結トルク（　　  N･m）',
    6: 'モータが一体でない場合は以下の確認を実施すること。\n・治具を使用したか',
    7: '・使用ボルト（　　　）区分（　　）',
    8: '・抵抗なく動くか（班長）',
    9: '前後方向も確認すること',
    10: '・テンション（　　　）Ｎ',
    11: '・センサー（　　　個）',
    12: '・サイズ（M　　）締結トルク（　 N･m）',
    13: '・確認（　OK　・　NG　・　該当無し　）'
  };
  for (const [rowNo, label] of Object.entries(rows)) {
    sheet.mergeCells(`F${rowNo}:R${rowNo}`);
    sheet.getCell(`F${rowNo}`).value = { richText: [{ text: label }] };
  }
  sheet.getCell('A15').value = '制　定　年　月　日';
  sheet.getCell('F16').value = '・履歴は項目に含めない';
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
