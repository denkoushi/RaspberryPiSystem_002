import { buildPartSearchIndex } from '@raspi-system/part-search-core';
import { describe, expect, it } from 'vitest';

import { pickSpeechSearchText } from '../pickSpeechSearchText';

const index = buildPartSearchIndex([
  { id: '1', shelfCodeRaw: null, fseiban: 'BE01', fhincd: 'P-01', fhinmei: 'テーブル', machineName: 'DAD3350', productNo: '1' },
  { id: '2', shelfCodeRaw: null, fseiban: 'BE02', fhincd: 'P-02', fhinmei: 'パルプ', machineName: 'DFD6362', productNo: '2' }
]);

describe('pickSpeechSearchText', () => {
  it('normalizes full-width input and uses the indexed half-width machine form ignoring spaces', () => {
    expect(pickSpeechSearchText([' ｄａｄ ３３５０ '], index, [])).toBe('DAD3350');
    expect(pickSpeechSearchText([' ＢＥ０１ '], index, [])).toBe('BE01');
    expect(pickSpeechSearchText([' Ｐ－０１ '], index, [])).toBe('P-01');
  });

  it('selects the first hit under current filters in all fields', () => {
    expect(pickSpeechSearchText(['パルプ', 'ＢＥ０１', 'テーブル'], index, [{ field: 'machine', value: 'DAD3350' }])).toBe('BE01');
    expect(pickSpeechSearchText(['パルプ', 'テーブル'], index, [])).toBe('パルプ');
  });

  it('uses the existing core kana fold without rewriting the spoken display text', () => {
    expect(pickSpeechSearchText(['存在しない', 'てぶる', 'テーブル'], index, [])).toBe('てぶる');
    expect(pickSpeechSearchText(['存在しない', 'ばるぶ'], index, [])).toBe('ばるぶ');
  });

  it('falls back to the first normalized candidate when none match', () => {
    expect(pickSpeechSearchText(['  ＸＹＺ　 ９９  ', 'unknown'], index, [])).toBe('XYZ 99');
    expect(pickSpeechSearchText(['パルプ', 'missing'], index, [{ field: 'machine', value: 'DAD3350' }])).toBe('パルプ');
  });

  it('handles missing or blank candidates', () => {
    expect(pickSpeechSearchText([], index, [])).toBe('');
    expect(pickSpeechSearchText([' ', ' Ｐ－０１ '], index, [])).toBe('P-01');
  });
});
