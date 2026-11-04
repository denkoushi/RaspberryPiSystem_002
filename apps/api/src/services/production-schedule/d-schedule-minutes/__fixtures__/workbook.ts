import ExcelJS from 'exceljs';

export function buildWorkbook(layout: 'May' | 'Oct' = 'May') {
  const workbook = new ExcelJS.Workbook();
  workbook.addWorksheet('画像のみ');
  const sheet = workbook.addWorksheet('架空 日程表');
  const start = layout === 'May' ? 10 : 12;
  const parts = layout === 'May' ? 14 : 15;
  const order = layout === 'May' ? 18 : 19;
  const memo = layout === 'May' ? 54 : 84;
  sheet.getCell(1, 55).value = new Date('1999-01-01T00:00:00Z'); // stale BC1
  sheet.getCell(3, 2).value = ' 製番 ';
  sheet.getColumn(2).hidden = true;
  sheet.getCell(3, parts + 2).value = '組立\n納期';
  sheet.getCell(3, parts - 2).value = '最終\n部品完';
  sheet.getCell(3, parts).value = '部品完成';
  sheet.getCell(5, order).value = '注文書納期';
  sheet.getCell(3, parts - 1).value = '出図';
  sheet.getCell(3, parts + 1).value = '出荷\n日';
  sheet.getColumn(parts + 1).hidden = true;
  ['担当', 'MEMO \n黒字：前回まで\n青字：新規', 'ANS'].forEach((text, index) => { sheet.getCell(3, memo - 1 + index).value = text; });
  const months = layout === 'May' ? [5] : [10, 11];
  let column = 22;
  for (const month of months) {
    const days = new Date(Date.UTC(2026, month, 0)).getUTCDate();
    sheet.mergeCells(3, column, 3, column + days - 1);
    sheet.getCell(3, column).value = `${month}月`;
    for (let day = 1; day <= days; day++, column++) {
      sheet.getCell(4, column).value = ['日', '月', '火', '水', '木', '金', '土'][new Date(Date.UTC(2026, month - 1, day)).getUTCDay()];
      sheet.getCell(5, column).value = day;
    }
  }
  const finalStarColumn = layout === 'May' ? 52 : 53; // May 31 / Nov 1
  sheet.getColumn(22).hidden = true;
  for (let offset = 0; offset < 4; offset++) {
    sheet.getCell(6 + offset, 1).value = offset + 1;
    sheet.getCell(6 + offset, 2).value = 0;
  }
  const dates = ['確定\n4/30', '2026/10/30(X)', '10/19(YZ)', '2026/07/14', '4/30'];
  for (let index = 0; index < 5; index++) {
    const row = start + index * 4;
    for (let offset = 0; offset < 4; offset++) {
      sheet.getCell(row + offset, 1).value = offset + 1;
      sheet.getCell(row + offset, 2).value = index === 0 ? ' ＡＢ１Ｃ２３４５（ＡＢ１Ｃ１１１１） ' : `AB1C234${5 + index}`;
    }
    sheet.getCell(row, parts).value = dates[index];
    sheet.getCell(row + 1, parts).value = '1/1'; // must never become latest
    sheet.getCell(row + 3, order).value = '2026/11/2(Z)';
    sheet.getCell(row, parts - 1).value = index === 0 ? '※材料:4/17発注' : '4/20';
    sheet.getCell(row, parts + 1).value = 'bad hidden date';
    sheet.getCell(row, memo).value = '架空メモ';
  }
  sheet.getCell(start, 22).value = '★LSLH処理出（ＣＴ以外）';
  sheet.getCell(start + 1, 23).value = '★LSLH処理出 戻';
  sheet.getCell(start + 2, 24).value = '☆未知';
  sheet.getCell(start + 3, finalStarColumn).value = layout === 'May' ? '★LSLH最終処理出' : '★LSLH最終処理品';
  return { workbook, sheet, start, parts, order, memo };
}
