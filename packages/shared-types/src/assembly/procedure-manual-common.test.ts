import { describe, expect, it } from 'vitest';

import { deriveProcedureManualKanaRow, normalizeProcedureManualCommonSubject } from './procedure-manual-common.js';

describe('common manual subject normalization', () => {
  it('uses NFKC, trim, collapsed whitespace and uppercase Latin', () => {
    expect(normalizeProcedureManualCommonSubject(' ｔｏｏｌ　 \t ① ')).toBe('TOOL 1');
    expect(normalizeProcedureManualCommonSubject('トルクレンチ')).toBe('トルクレンチ');
    expect(normalizeProcedureManualCommonSubject('café')).toBe('CAFÉ');
  });
  it.each([['ヴァルブ', 'あ'], ['がいど', 'か'], ['ジグ', 'さ'], ['ッール', 'た'], ['ノギス', 'な'], ['パイプ', 'は'], ['マイクロ', 'ま'], ['ゅう', 'や'], ['リール', 'ら'], ['ヲ', 'わ'], ['ヵ', 'か'], ['ㇰ', 'か'], ['ぴ', 'は'], ['ョ', 'や'], [' ﾊﾟｲﾌﾟ', 'は'], ['研削盤', null], ['A', null], ['', null]])('derives %s as %s', (name, row) => {
    expect(deriveProcedureManualKanaRow(name)).toBe(row);
  });
});
