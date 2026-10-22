import { describe, expect, it } from 'vitest';

import { estimateChipStripWidth, layoutChipStrips } from './planningBoardChipStrips';

const chip = (resourceCd: string) => ({ rowId: resourceCd, resourceCd, isCompleted: false });

describe('layoutChipStrips', () => {
  it('keeps strips that do not touch on one line', () => {
    const result = layoutChipStrips([{ id: 'b', left: 200, width: 60 }, { id: 'a', left: 0, width: 60 }]);
    expect(result.lines).toBe(1);
    expect(result.strips.map((strip) => [strip.id, strip.line])).toEqual([['a', 0], ['b', 0]]);
  });

  it('moves a strip that would overlap the previous one to the next line', () => {
    const result = layoutChipStrips([{ id: 'a', left: 0, width: 80 }, { id: 'b', left: 40, width: 80 }, { id: 'c', left: 100, width: 40 }]);
    expect(result.strips.map((strip) => [strip.id, strip.line])).toEqual([['a', 0], ['b', 1], ['c', 0]]);
    expect(result.lines).toBe(2);
  });

  it('returns no lines when there are no strips', () => {
    expect(layoutChipStrips([])).toEqual({ strips: [], lines: 0 });
  });
});

describe('estimateChipStripWidth', () => {
  it('grows with the number and length of resource codes', () => {
    expect(estimateChipStripWidth([])).toBe(0);
    expect(estimateChipStripWidth([chip('589'), chip('10')])).toBeGreaterThan(estimateChipStripWidth([chip('589')]));
  });
});
