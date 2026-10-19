import { describe, expect, it } from 'vitest';

import {
  buildDimensionMapTilePrompt,
  mergeDuplicateDimensions,
  parseDimensionMapTileResponse,
  toDrawingDimensions
} from './part-measurement-drawing-dimension-map-parse.js';

const tile = { id: 'r0c1', box: { x0: 0.25, y0: 0, x1: 0.75, y1: 0.5 } };

describe('parseDimensionMapTileResponse', () => {
  it('reads the json_object wrapper with array rows', () => {
    const rows = parseDimensionMapTileResponse(
      '{"dimensions": [["540±0.3", 540, 0.3, -0.3, "len", null, 500, 100]]}'
    );
    expect(rows).toEqual([['540±0.3', 540, 0.3, -0.3, 'len', null, 500, 100]]);
  });

  it('reads dict rows keyed in Japanese', () => {
    const rows = parseDimensionMapTileResponse(
      '```json\n[{"表記": "4-M5深10", "基準値": 5, "上の許容差": null, "下の許容差": null, "種類": "thread", "深さ": 10, "x": 10, "y": 20}]\n```'
    );
    expect(rows).toEqual([['4-M5深10', 5, null, null, 'thread', 10, 10, 20]]);
  });

  it('falls back to the first array inside surrounding text', () => {
    const rows = parseDimensionMapTileResponse('結果: [["(25)", 25, null, null, "ref", null, 1, 2]] 以上');
    expect(rows).toHaveLength(1);
  });

  it('returns null when nothing is JSON', () => {
    expect(parseDimensionMapTileResponse('寸法は見つかりません')).toBeNull();
  });

  it('drops short rows', () => {
    expect(parseDimensionMapTileResponse('{"dimensions": [["10", 10, null]]}')).toEqual([]);
  });
});

describe('toDrawingDimensions', () => {
  it('maps tile-local 0..1000 coordinates onto the drawing', () => {
    const [dimension] = toDrawingDimensions([['φ10.1+0.1/0深15', '10.1', '0.1', 0, 'hole', '15', 500, 1000]], tile);
    expect(dimension).toMatchObject({
      text: 'φ10.1+0.1/0深15',
      nominal: 10.1,
      upperTolerance: 0.1,
      lowerTolerance: 0,
      kind: 'hole',
      depth: 15,
      tileId: 'r0c1'
    });
    expect(dimension?.xRatio).toBeCloseTo(0.5);
    expect(dimension?.yRatio).toBeCloseTo(0.5);
  });

  it('excludes surface roughness, chamfers and rows without a value or position', () => {
    const dimensions = toDrawingDimensions(
      [
        ['Ra1.6', 1.6, null, null, 'other', null, 1, 1],
        ['0.5C', 0.5, null, null, 'len', null, 1, 1],
        ['10', null, null, null, 'len', null, 1, 1],
        ['10', 10, null, null, 'len', null, '', 1],
        ['12', 12, null, null, 'unknown', null, 1, 1]
      ],
      tile
    );
    expect(dimensions).toHaveLength(1);
    expect(dimensions[0]).toMatchObject({ nominal: 12, kind: 'other' });
  });
});

describe('mergeDuplicateDimensions', () => {
  it('keeps the first of two same-value reads within 1% of the width', () => {
    const base = { text: '20', upperTolerance: null, lowerTolerance: null, kind: 'len' as const, depth: null, tileId: 'a' };
    const merged = mergeDuplicateDimensions(
      [
        { ...base, nominal: 20, xRatio: 0.5, yRatio: 0.5 },
        { ...base, nominal: 20, xRatio: 0.505, yRatio: 0.5, tileId: 'b' },
        { ...base, nominal: 20, xRatio: 0.53, yRatio: 0.5 },
        { ...base, nominal: 21, xRatio: 0.5, yRatio: 0.5 }
      ],
      { width: 4000, height: 2000 }
    );
    expect(merged.map((dimension) => [dimension.nominal, dimension.xRatio])).toEqual([
      [20, 0.5],
      [20, 0.53],
      [21, 0.5]
    ]);
  });
});

describe('buildDimensionMapTilePrompt', () => {
  it('states the tile count and the json_object wrapper', () => {
    const prompt = buildDimensionMapTilePrompt(8);
    expect(prompt).toContain('8 分割');
    expect(prompt).toContain('{"dimensions"');
  });
});
