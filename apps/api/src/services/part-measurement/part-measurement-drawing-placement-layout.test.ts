import { describe, expect, it } from 'vitest';
import { transferItemsByLayout } from './part-measurement-drawing-placement-layout.js';
import type { DimensionMap, PlacementSourceItem } from './part-measurement-drawing-placement-transfer.js';

const item: PlacementSourceItem = {
  id: 'item', sortOrder: 1, measurementLabel: '長さ', nominalValue: 10, lowerLimit: 9.5, upperLimit: 10.5,
  depthMode: 'MEASURED', valueKind: 'NUMERIC', markerXRatio: 0.3, markerYRatio: 0.3,
  calloutTipXRatio: null, calloutTipYRatio: null
};
const dim = (text: string, xRatio: number, yRatio: number): DimensionMap['dimensions'][number] => ({
  text, xRatio, yRatio, nominal: 999, kind: 'other', depth: null, lowerTolerance: null, upperTolerance: null, tileId: 'tile'
});
const map = (dimensions: DimensionMap['dimensions'], width = 1000, height = 1000): DimensionMap => ({
  dimensions, image: { width, height }
});
const input = () => ({
  sourceMap: map([dim('10', 0.3, 0.3), dim('R20', 0.35, 0.3)]),
  targetMap: map([dim('10', 0.2, 0.2), dim('10', 0.6, 0.6), dim('R20', 0.65, 0.6)]),
  sourceItems: [item], existingItems: []
});

describe('transferItemsByLayout', () => {
  it('chooses the duplicate value with matching neighbors and preserves source values', () => {
    const [result] = transferItemsByLayout(input());
    expect(result).toMatchObject({ status: 'PROPOSED', nominalValue: 10, lowerLimit: 9.5, upperLimit: 10.5,
      dimension: { text: '10', xRatio: 0.6, yRatio: 0.6, kind: 'other' }, markerXRatio: 0.6, markerYRatio: 0.6 });
    expect(result.candidates.map((candidate) => candidate.score)).toEqual([3, 2]);
    expect(result.candidates[0].distance).toBeCloseTo(Math.hypot(0.3, 0.3));
  });

  it('rejects tied duplicate values without layout support', () => {
    const [result] = transferItemsByLayout({ ...input(), sourceMap: map([dim('10', 0.3, 0.3)]) });
    expect(result.status).toBe('UNPLACED');
    expect(result.candidates).toHaveLength(2);
    expect(result.candidates.every((candidate) => candidate.rejectionReason === 'ambiguous')).toBe(true);
  });

  it('leaves values missing from the target unplaced', () => {
    expect(transferItemsByLayout({ ...input(), targetMap: map([dim('11', 0.3, 0.3)]) })[0])
      .toMatchObject({ status: 'UNPLACED', dimension: null, markerXRatio: null, markerYRatio: null, candidates: [] });
  });

  it('requires four points for a single-character value', () => {
    const [result] = transferItemsByLayout({ ...input(), sourceItems: [{ ...item, nominalValue: 2 }],
      sourceMap: map([dim('2', 0.3, 0.3), dim('R20', 0.35, 0.3)]),
      targetMap: map([dim('（2）', 0.6, 0.6), dim('R20', 0.65, 0.6)]) });
    expect(result).toMatchObject({ status: 'UNPLACED', candidates: [{ score: 3, rejectionReason: 'ambiguous' }] });
  });

  it('accepts a single-character value with four points', () => {
    const sourceMap = map([dim('2', 0.3, 0.3), dim('R20', 0.35, 0.3), dim('R30', 0.3, 0.35)]);
    expect(transferItemsByLayout({ ...input(), sourceMap, targetMap: sourceMap,
      sourceItems: [{ ...item, nominalValue: 2 }] })[0]).toMatchObject({ status: 'PROPOSED', candidates: [{ score: 4 }] });
  });

  it('is deterministic and does not mutate the input', () => {
    const data = input();
    const before = structuredClone(data);
    expect(transferItemsByLayout(data)).toEqual(transferItemsByLayout(data));
    expect(data).toEqual(before);
  });

  it('recovers scale and translation from eight anchors mixed with two outliers', () => {
    const anchors = [[0.1, 0.1], [0.4, 0.1], [0.7, 0.1], [0.1, 0.4], [0.7, 0.4], [0.1, 0.7], [0.4, 0.7], [0.7, 0.7],
      [0.4, 0.4], [0.8, 0.8]];
    const sourceMap = map([...anchors.map(([x, y], i) => dim(`A${100 + i}`, x, y)), dim('10', 0.3, 0.3)]);
    // Target has a different image aspect; coordinates still represent drawing-width units.
    const targetMap = map([...anchors.map(([x, y], i) => i < 8
      ? dim(`A${100 + i}`, x * 0.8 + 0.12, (y * 0.8 + 0.08) / 0.5)
      : dim(`A${100 + i}`, 0.95, 0.95)), dim('10', 0.8, 0.8), dim('10', 0.36, 0.64)], 2000, 1000);
    const data = { ...input(), sourceMap, targetMap };
    const [result] = transferItemsByLayout(data);
    expect(result).toMatchObject({ status: 'PROPOSED', dimension: { xRatio: 0.36, yRatio: 0.64 } });
    expect(result.candidates[0].score).toBe(5);
    expect(result.candidates[0].distance).toBeCloseTo(0, 10);
    expect(transferItemsByLayout(data)).toEqual([result]);
  });

  it.each([null, map([]), map([dim('10', 0.9, 0.9)])])('rejects missing or distant source dimensions: %j', (sourceMap) => {
    const [result] = transferItemsByLayout({ ...input(), sourceMap });
    expect(result.status).toBe('UNPLACED');
    expect(result.candidates.every((candidate) => candidate.rejectionReason === 'source-missing')).toBe(true);
  });

  it('skips existing items by label and nominal value', () => {
    expect(transferItemsByLayout({ ...input(), existingItems: [{ measurementLabel: item.measurementLabel, nominalValue: 10 }] })).toEqual([]);
  });

  it('matches any textual number with decimal commas and normalization, irrespective of kind or nominal', () => {
    const sourceMap = map([dim('※（M6 深10,5）＊', 0.3, 0.3)]);
    expect(transferItemsByLayout({ ...input(), sourceMap, targetMap: sourceMap,
      sourceItems: [{ ...item, nominalValue: 10.50009 }] })[0].status).toBe('PROPOSED');
    expect(transferItemsByLayout({ ...input(), sourceMap, targetMap: sourceMap,
      sourceItems: [{ ...item, nominalValue: 10.50011 }] })[0].status).toBe('UNPLACED');
  });

  it('clamps markers to 0.01–0.99 while retaining dimension coordinates', () => {
    const sourceMap = map([dim('10', 0, 1)]);
    expect(transferItemsByLayout({ ...input(), sourceMap, targetMap: sourceMap,
      sourceItems: [{ ...item, markerXRatio: 0, markerYRatio: 1 }] })[0])
      .toMatchObject({ markerXRatio: 0.01, markerYRatio: 0.99, dimension: { xRatio: 0, yRatio: 1 } });
  });

  it('does not match a tapped-hole note to a bare length with the same number', () => {
    const [result] = transferItemsByLayout({ ...input(),
      sourceMap: map([dim('M5深10', 0.3, 0.3), dim('R20', 0.35, 0.3)]),
      targetMap: map([dim('10', 0.6, 0.6), dim('R20', 0.65, 0.6)]) });
    expect(result).toMatchObject({ status: 'UNPLACED', candidates: [] });
  });
});
