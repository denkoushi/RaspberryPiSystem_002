import { describe, expect, it, vi } from 'vitest';
import type { PartMeasurementDrawingDimension } from './part-measurement-drawing-dimension-map-payload.js';
import {
  chooseSourceSibling,
  drawingNameFamily,
  transferItems,
  type PlacementSibling,
  type PlacementSourceItem
} from './part-measurement-drawing-placement-transfer.js';

const item: PlacementSourceItem = {
  id: 'item', sortOrder: 2, measurementLabel: '長さ', nominalValue: 10, lowerLimit: 9.5, upperLimit: 10.5,
  depthMode: 'MEASURED', valueKind: 'NUMERIC', markerXRatio: 0.5, markerYRatio: 0.5,
  calloutTipXRatio: null, calloutTipYRatio: null
};
const dim = (overrides: Partial<PartMeasurementDrawingDimension> = {}): PartMeasurementDrawingDimension => ({
  text: '10', nominal: 10, kind: 'len', upperTolerance: null, lowerTolerance: null, depth: null,
  xRatio: 0.5, yRatio: 0.5, tileId: 'tile', ...overrides
});
const map = (dimensions = [dim()], width = 2000, height = 1000) => ({ dimensions, image: { width, height } });
const input = () => ({ targetMap: map(), sourceItems: [item], sourceMap: null, existingItems: [] });

describe('drawingNameFamily', () => {
  it.each([
    ['3351-MD12 ブラケット(左)', 'ブラケット'],
    ['3351-MD13 ブラケット(右)', 'ブラケット'],
    ['３３５１－ＭＤ１２　ブラケット（左）', 'ブラケット'],
    ['7161X軸MD123ホルダー(大)(左)', 'ホルダー'],
    ['7161Y軸ホルダー', 'ホルダー'],
    ['Z軸ホルダー', 'ホルダー'],
    ['本体ホルダー', 'ホルダー'],
    ['Yホルダー', 'ホルダー'],
    ['3351-MD12 (左)', ''],
    ['7161 X軸ホルダー', 'X軸ホルダー'],
    ['ブラケットmd12', 'ブラケットmd12']
  ])('%s → %s', (name, family) => expect(drawingNameFamily(name)).toBe(family));
});

describe('transferItems', () => {
  it('places a single candidate with the fallback offset, preserving absolute limits and fields', async () => {
    const [result] = await transferItems(input());
    expect(result).toMatchObject({
      status: 'PROPOSED', markerXRatio: 0.52, markerYRatio: 0.48,
      dimension: { text: '10', xRatio: 0.5, yRatio: 0.5, kind: 'len' },
      item: { sortOrder: 2, nominalValue: 10, lowerLimit: 9.5, upperLimit: 10.5, depthMode: 'MEASURED', valueKind: 'NUMERIC' }
    });
    expect(item.markerXRatio).toBe(0.5);
  });

  it('sorts candidates by aspect-corrected position and keeps distant equal values', async () => {
    const [result] = await transferItems({
      ...input(), targetMap: map([dim({ text: 'horizontal', xRatio: 0.56 }), dim({ text: 'vertical', yRatio: 0.6 })])
    });
    expect(result.candidates.map((c) => c.text)).toEqual(['vertical', 'horizontal']);
    expect(result.candidates[0].distance).toBeCloseTo(0.05);
  });

  it('uses the nearer callout tip only when both coordinates exist', async () => {
    const targetMap = map([dim(), dim({ text: 'tip', xRatio: 0.8 })]);
    const [result] = await transferItems({
      ...input(), targetMap, sourceItems: [{ ...item, markerXRatio: 0.4, calloutTipXRatio: 0.8, calloutTipYRatio: 0.5 }]
    });
    expect(result.dimension?.text).toBe('tip');
    const [partialTip] = await transferItems({
      ...input(), targetMap, sourceItems: [{ ...item, calloutTipXRatio: 0.8 }]
    });
    expect(partialTip.dimension?.text).toBe('10');
  });

  it('deduplicates equal values within 0.01 with aspect correction before ranking', async () => {
    const [result] = await transferItems({
      ...input(), targetMap: map([
        dim({ text: 'first' }), dim({ text: 'duplicate', yRatio: 0.515 }),
        dim({ text: 'separate', yRatio: 0.53 }), dim({ text: 'different-value', nominal: 10.0000005 })
      ])
    });
    expect(result.candidates.map((c) => c.text)).toEqual(['first', 'different-value', 'separate']);
  });

  it('uses a nearby value-matched source dimension offset, even when its kind differs', async () => {
    const [result] = await transferItems({
      ...input(), targetMap: map([dim({ xRatio: 0.8, yRatio: 0.7 })]),
      sourceMap: map([dim({ xRatio: 0.47, yRatio: 0.54, kind: 'other' })])
    });
    expect(result.markerXRatio).toBeCloseTo(0.83);
    expect(result.markerYRatio).toBeCloseTo(0.66);
  });

  it('finds the source dimension from the tip and uses the source image aspect', async () => {
    const [result] = await transferItems({
      ...input(), sourceItems: [{ ...item, calloutTipXRatio: 0.2, calloutTipYRatio: 0.2 }],
      sourceMap: map([dim({ xRatio: 0.2, yRatio: 0.3 })], 4000, 1000)
    });
    expect(result.markerXRatio).toBeCloseTo(0.8);
    expect(result.markerYRatio).toBeCloseTo(0.7);
  });

  it.each([{ dimensions: [] }, { dimensions: [dim({ xRatio: 0.8 })] }, { dimensions: [dim({ nominal: 99 })] }])('falls back when source map has no nearby matching value: %j', async ({ dimensions }) => {
    const [result] = await transferItems({ ...input(), sourceMap: map(dimensions) });
    expect([result.markerXRatio, result.markerYRatio]).toEqual([0.52, 0.48]);
  });

  it('clamps both upper and lower marker bounds', async () => {
    const [result] = await transferItems({ ...input(), targetMap: map([dim({ xRatio: 0.99, yRatio: 0 })]) });
    expect([result.markerXRatio, result.markerYRatio]).toEqual([0.99, 0.01]);
    const [other] = await transferItems({
      ...input(), targetMap: map([dim({ xRatio: 0, yRatio: 1 })]),
      sourceMap: map([dim({ xRatio: 0.53, yRatio: 0.47 })])
    });
    expect([other.markerXRatio, other.markerYRatio]).toEqual([0.01, 0.99]);
  });

  it('skips only matching existing label + nominal pairs', async () => {
    expect(await transferItems({ ...input(), existingItems: [{ measurementLabel: '長さ', nominalValue: 10 }] })).toEqual([]);
    expect(await transferItems({ ...input(), existingItems: [
      { measurementLabel: '幅', nominalValue: 10 }, { measurementLabel: '長さ', nominalValue: null }
    ] })).toHaveLength(1);
  });

  it('produces UNPLACED with null coordinates when kind or value does not match', async () => {
    const [result] = await transferItems({
      ...input(), targetMap: map([dim({ kind: 'hole' }), dim({ nominal: 11 })])
    });
    expect(result).toMatchObject({
      status: 'UNPLACED', dimension: null, markerXRatio: null, markerYRatio: null, candidates: []
    });
  });

  it.each([
    ['穴径', 'MEASURED', dim({ kind: 'hole' })],
    ['内径', 'MEASURED', dim({ kind: 'other', text: 'φ10' })],
    ['ネジ穴深さ', 'MEASURED', dim({ kind: 'thread', nominal: 6, depth: 10 })],
    ['平行度', 'MEASURED', dim({ kind: 'gdt' })],
    ['深さ', 'THROUGH', dim({ kind: 'basic', depth: 20 })]
  ] as const)('reuses kind/value rules for %s / %s', async (measurementLabel, depthMode, dimension) => {
    const [result] = await transferItems({
      ...input(), targetMap: map([dimension]), sourceItems: [{ ...item, measurementLabel, depthMode }]
    });
    expect(result.status).toBe('PROPOSED');
  });

  it('lets an async reorder choose a candidate and retains its score', async () => {
    const reorder = vi.fn(async (_item, candidates) => [...candidates].reverse().map((c) => ({ ...c, score: 0.9 })));
    const [result] = await transferItems({
      ...input(), targetMap: map([dim(), dim({ text: 'second', xRatio: 0.8 })]), reorder
    });
    expect(reorder).toHaveBeenCalledWith(item, expect.any(Array));
    expect(result.dimension?.text).toBe('second');
    expect(result.candidates[0].score).toBe(0.9);
    expect(result.markerXRatio).toBeCloseTo(0.82);
  });
});

const sibling = (id: string, items: PlacementSourceItem[], updatedAt = new Date(0)): PlacementSibling => ({
  id, name: '3351-MD13 ブラケット(右)', isActive: true,
  templates: [{ id: `${id}-template`, isActive: true, items, updatedAt }]
});
const target = { id: 'target', name: '3351-MD12 ブラケット(左)' };

describe('chooseSourceSibling', () => {
  it('maximizes matched items, then chooses the most recently updated active template', () => {
    const older = sibling('older', [item, { ...item, id: 'second' }]);
    const newer = sibling('newer', [item, { ...item, id: 'second' }], new Date(100));
    const less = sibling('less', [item, { ...item, id: 'missing', nominalValue: 999 }], new Date(200));
    expect(chooseSourceSibling({ target, targetMap: map(), siblings: [older, less, newer] })?.sibling.id).toBe('newer');
  });

  it('excludes self, inactive drawings/templates, other families and empty templates', () => {
    const inactiveTemplate = sibling('inactive-template', [item]);
    inactiveTemplate.templates[0].isActive = false;
    expect(chooseSourceSibling({
      target, targetMap: map(), siblings: [
        sibling('target', [item]), { ...sibling('inactive', [item]), isActive: false },
        { ...sibling('different', [item]), name: '足' }, sibling('empty', []), inactiveTemplate
      ]
    })).toBeNull();
  });

  it('never matches an empty family', () => {
    expect(chooseSourceSibling({
      target: { id: 'target', name: '3351-MD12(左)' }, targetMap: map(),
      siblings: [{ ...sibling('source', [item]), name: '3351-MD13(右)' }]
    })).toBeNull();
  });

  it('retains a valid sibling with zero matches so its items can be UNPLACED', () => {
    expect(chooseSourceSibling({ target, targetMap: map([]), siblings: [sibling('source', [item])] })?.sibling.id).toBe('source');
  });
});
