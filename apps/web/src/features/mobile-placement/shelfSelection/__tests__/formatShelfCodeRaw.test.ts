import { describe, expect, it } from 'vitest';

import { formatShelfCodeRaw } from '../formatShelfCodeRaw';

describe('formatShelfCodeRaw', () => {
  it('西-北-02 形式の shelfCodeRaw を生成する', () => {
    expect(
      formatShelfCodeRaw({
        areaId: 'west',
        lineId: 'north',
        slot: 2
      })
    ).toBe('西-北-02');
  });

  it('slot が 1 桁でもゼロ埋めする', () => {
    expect(
      formatShelfCodeRaw({
        areaId: 'east',
        lineId: 'south',
        slot: 9
      })
    ).toBe('東-南-09');
  });

  it('存在しない areaId なら例外', () => {
    expect(() =>
      formatShelfCodeRaw({
        areaId: 'west',
        lineId: 'north',
        slot: 99
      })
    ).not.toThrow();
    expect(() =>
      formatShelfCodeRaw({
        areaId: 'bogus' as never,
        lineId: 'north',
        slot: 1
      })
    ).toThrow();
  });
});
