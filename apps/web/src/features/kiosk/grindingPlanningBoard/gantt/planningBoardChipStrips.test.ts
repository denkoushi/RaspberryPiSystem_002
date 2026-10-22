import { describe, expect, it } from 'vitest';

import { CHIP_STRIP_FIT, chipCodes, layoutChipStrips } from './planningBoardChipStrips';

const chip = (resourceCd: string, isCompleted = false) => ({ rowId: `${resourceCd}-${isCompleted}`, resourceCd, isCompleted });
const route = [chip('011', true), chip('102', true), chip('305'), chip('581'), chip('701')];

describe('layoutChipStrips', () => {
  it('keeps every chip when strips do not touch', () => {
    const result = layoutChipStrips([{ id: 'a', left: 0, chips: route }, { id: 'b', left: 400, chips: route }], { maxLines: 1, collapseDone: false });
    expect(result.lines).toBe(1);
    expect(result.strips.map((strip) => [strip.id, strip.shown.length, strip.hidden.length])).toEqual([['a', 5, 0], ['b', 5, 0]]);
  });

  it('cuts the earlier strip back with +N instead of adding a line when only one line is allowed', () => {
    const result = layoutChipStrips([{ id: 'a', left: 0, chips: route }, { id: 'b', left: 80, chips: route }], { maxLines: 1, collapseDone: false });
    const [a, b] = result.strips;
    expect(result.lines).toBe(1);
    expect(a!.shown.length + a!.hidden.length).toBe(5);
    expect(a!.hidden.length).toBeGreaterThan(0);
    expect(a!.left + a!.width).toBeLessThanOrEqual(b!.left);
  });

  it('uses a second line before cutting when two lines are allowed', () => {
    const result = layoutChipStrips([{ id: 'a', left: 0, chips: route }, { id: 'b', left: 80, chips: route }], { maxLines: 2, collapseDone: false });
    expect(result.lines).toBe(2);
    expect(result.strips.map((strip) => strip.hidden.length)).toEqual([0, 0]);
  });

  it('folds completed chips into one done chip', () => {
    const [strip] = layoutChipStrips([{ id: 'a', left: 0, chips: route }], { maxLines: 1, collapseDone: true }).strips;
    expect(strip!.done.length).toBe(2);
    expect(strip!.shown.map((item) => item.resourceCd)).toEqual(['305', '581', '701']);
  });

  it('board fit: two lines, done folded, and the cut chips are kept for the +N tip', () => {
    const result = layoutChipStrips([0, 60, 120].map((left, index) => ({ id: String(index), left, chips: route })), CHIP_STRIP_FIT);
    const [first] = result.strips;
    expect(result.lines).toBe(2);
    expect(chipCodes(first!.done)).toBe('011 102');
    expect([...first!.shown, ...first!.hidden].map((item) => item.resourceCd)).toEqual(['305', '581', '701']);
    expect(first!.hidden.length).toBeGreaterThan(0);
    expect(first!.left + first!.width).toBeLessThanOrEqual(result.strips[2]!.left);
  });

  it('returns no lines when there are no strips', () => {
    expect(layoutChipStrips([], { maxLines: 1, collapseDone: false })).toEqual({ strips: [], lines: 0 });
  });
});
