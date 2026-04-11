import { describe, expect, it } from 'vitest';

import { isMobilePlacementShelfRegisterRouteState } from '../navigationState';

describe('isMobilePlacementShelfRegisterRouteState', () => {
  it('配膳ページの必要入力を持つ object を true', () => {
    expect(
      isMobilePlacementShelfRegisterRouteState({
        transferOrder: 'A',
        transferFhinmei: 'B',
        actualOrder: 'C',
        actualFhinmei: 'D',
        slipResult: 'ok',
        shelfCode: '西-北-02',
        orderBarcode: '123'
      })
    ).toBe(true);
  });

  it('必要項目が欠けると false', () => {
    expect(isMobilePlacementShelfRegisterRouteState({ shelfCode: '西-北-02' })).toBe(false);
  });

  it('null/undefined は false', () => {
    expect(isMobilePlacementShelfRegisterRouteState(null)).toBe(false);
    expect(isMobilePlacementShelfRegisterRouteState(undefined)).toBe(false);
  });
});
