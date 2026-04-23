import { describe, expect, it } from 'vitest';

import { pushPalletTenkeyDigit } from '../pushPalletTenkeyDigit';

describe('pushPalletTenkeyDigit', () => {
  it('空から1桁追加', () => {
    expect(pushPalletTenkeyDigit([], 3)).toEqual([3]);
  });

  it('1桁から2桁へ', () => {
    expect(pushPalletTenkeyDigit([3], 5)).toEqual([3, 5]);
  });

  it('2桁済みで3キー目はバッファを置換', () => {
    expect(pushPalletTenkeyDigit([3, 5], 7)).toEqual([7]);
  });

  it('置換後は再び2桁まで積める', () => {
    expect(pushPalletTenkeyDigit([7], 1)).toEqual([7, 1]);
  });
});
