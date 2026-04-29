import { describe, expect, it } from 'vitest';

import { collectNextPrefixChars } from '../collectSeibanPrefixCharset';

describe('collectNextPrefixChars', () => {
  it('現在の接頭辞に続けられる次の文字だけをユニークに収集してソートする', () => {
    expect(collectNextPrefixChars(['AB1', 'AC2', 'BA'], 'A')).toEqual(['B', 'C']);
  });

  it('空入力では空配列', () => {
    expect(collectNextPrefixChars([], '')).toEqual([]);
  });

  it('完全一致の製番は次候補に含めない', () => {
    expect(collectNextPrefixChars(['AB', 'ABC'], 'AB')).toEqual(['C']);
  });
});
