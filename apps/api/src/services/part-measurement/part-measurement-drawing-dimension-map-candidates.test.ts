import { describe, expect, it } from 'vitest';

import {
  rankPartMeasurementDrawingDimensionMapCandidates,
  resolveWantedDimensionKind,
  suggestTolerances
} from './part-measurement-drawing-dimension-map-candidates.js';
import type { PartMeasurementDrawingDimension } from './part-measurement-drawing-dimension-map-payload.js';

function dim(partial: Partial<PartMeasurementDrawingDimension> & Pick<PartMeasurementDrawingDimension, 'text' | 'nominal' | 'xRatio' | 'yRatio'>): PartMeasurementDrawingDimension {
  return {
    upperTolerance: null,
    lowerTolerance: null,
    kind: 'len',
    depth: null,
    tileId: 'r0c0',
    ...partial
  };
}

const image = { width: 2000, height: 1000 };

describe('resolveWantedDimensionKind', () => {
  it('maps labels to the dimension kind to prefer', () => {
    expect(resolveWantedDimensionKind('深さ', 'measured')).toBe('depth');
    expect(resolveWantedDimensionKind('ネジ穴深さ', 'measured')).toBe('depth');
    expect(resolveWantedDimensionKind('深さ', 'through')).toBe('len');
    expect(resolveWantedDimensionKind('穴径', null)).toBe('hole');
    expect(resolveWantedDimensionKind('内径', null)).toBe('hole');
    expect(resolveWantedDimensionKind('平行度', null)).toBe('gdt');
    expect(resolveWantedDimensionKind('外径', null)).toBe('len');
    expect(resolveWantedDimensionKind('', null)).toBe('len');
  });
});

describe('rankPartMeasurementDrawingDimensionMapCandidates', () => {
  it('orders by distance with the vertical axis scaled by the image aspect', () => {
    // 縦横比 2: y の差 0.1 は x の差 0.05 と同じ距離
    const dimensions = [
      dim({ text: '30', nominal: 30, xRatio: 0.5, yRatio: 0.6 }), // dx 0, dy 0.1 → 0.05
      dim({ text: '40', nominal: 40, xRatio: 0.54, yRatio: 0.5 }) // dx 0.04 → 0.04
    ];
    const result = rankPartMeasurementDrawingDimensionMapCandidates({ image, dimensions }, { xRatio: 0.5, yRatio: 0.5 });
    expect(result.map((c) => c.valueText)).toEqual(['40', '30']);
    expect(result[0].distanceRatio).toBeCloseTo(0.04, 6);
  });

  it('prefers dimensions matching the measurement label and pads with the rest', () => {
    const dimensions = [
      dim({ text: 'φ20', nominal: 20, kind: 'hole', xRatio: 0.6, yRatio: 0.5 }),
      dim({ text: '55', nominal: 55, xRatio: 0.51, yRatio: 0.5 }),
      dim({ text: 'R5', nominal: 5, kind: 'radius', xRatio: 0.52, yRatio: 0.5 })
    ];
    const hole = rankPartMeasurementDrawingDimensionMapCandidates(
      { image, dimensions },
      { xRatio: 0.5, yRatio: 0.5, measurementLabel: '穴径', limit: 3 }
    );
    expect(hole.map((c) => c.valueText)).toEqual(['20', '55', '5']);
    const len = rankPartMeasurementDrawingDimensionMapCandidates(
      { image, dimensions },
      { xRatio: 0.5, yRatio: 0.5, measurementLabel: '外径', limit: 1 }
    );
    expect(len.map((c) => c.valueText)).toEqual(['55']);
  });

  it('uses the depth value for depth labels and skips dimensions without depth', () => {
    const dimensions = [
      dim({ text: 'φ10', nominal: 10, kind: 'hole', xRatio: 0.5, yRatio: 0.5 }),
      dim({ text: 'M6深12', nominal: 6, kind: 'thread', depth: 12, xRatio: 0.55, yRatio: 0.5 })
    ];
    const result = rankPartMeasurementDrawingDimensionMapCandidates(
      { image, dimensions },
      { xRatio: 0.5, yRatio: 0.5, measurementLabel: 'ネジ穴深さ', depthMode: 'measured', limit: 1 }
    );
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ valueText: '12', dimensionText: 'M6深12', suggestedLowerTolerance: '0', suggestedUpperTolerance: null });
  });

  it('keeps one candidate per value', () => {
    const dimensions = [
      dim({ text: '30', nominal: 30, xRatio: 0.5, yRatio: 0.5 }),
      dim({ text: '30', nominal: 30, xRatio: 0.9, yRatio: 0.9 }),
      dim({ text: '45', nominal: 45, xRatio: 0.95, yRatio: 0.95 })
    ];
    const result = rankPartMeasurementDrawingDimensionMapCandidates({ image, dimensions }, { xRatio: 0.5, yRatio: 0.5, limit: 3 });
    expect(result.map((c) => c.valueText)).toEqual(['30', '45']);
  });

  it('also measures from the callout tip when given', () => {
    const dimensions = [
      dim({ text: '30', nominal: 30, xRatio: 0.5, yRatio: 0.5 }),
      dim({ text: '80', nominal: 80, xRatio: 0.2, yRatio: 0.2 })
    ];
    const withoutTip = rankPartMeasurementDrawingDimensionMapCandidates({ image, dimensions }, { xRatio: 0.45, yRatio: 0.5 });
    const withTip = rankPartMeasurementDrawingDimensionMapCandidates(
      { image, dimensions },
      { xRatio: 0.45, yRatio: 0.5, calloutTipXRatio: 0.2, calloutTipYRatio: 0.21 }
    );
    expect(withoutTip[0].valueText).toBe('30');
    expect(withTip[0].valueText).toBe('80');
  });

  it('formats decimals without float noise', () => {
    const dimensions = [dim({ text: '12.5', nominal: 12.5, xRatio: 0.5, yRatio: 0.5 })];
    const result = rankPartMeasurementDrawingDimensionMapCandidates({ image, dimensions }, { xRatio: 0.5, yRatio: 0.5 });
    expect(result[0].valueText).toBe('12.5');
  });
});

describe('suggestTolerances', () => {
  it('uses explicit tolerances from the drawing first', () => {
    const d = dim({ text: 'φ10.1+0.1/0', nominal: 10.1, kind: 'hole', upperTolerance: 0.1, lowerTolerance: 0, xRatio: 0, yRatio: 0 });
    expect(suggestTolerances(d, 'hole', 10.1)).toEqual({ upper: '+0.1', lower: '0' });
  });

  it('falls back to the general tolerance table', () => {
    const d = dim({ text: '55', nominal: 55, xRatio: 0, yRatio: 0 });
    expect(suggestTolerances(d, 'len', 55)).toEqual({ upper: '+0.3', lower: '-0.3' });
    expect(suggestTolerances(dim({ text: '5000', nominal: 5000, xRatio: 0, yRatio: 0 }), 'len', 5000)).toEqual({ upper: null, lower: null });
  });

  it('gives 0 to -value for geometric tolerances', () => {
    const d = dim({ text: '// 0.02 A', nominal: 0.02, kind: 'gdt', xRatio: 0, yRatio: 0 });
    expect(suggestTolerances(d, 'gdt', 0.02)).toEqual({ upper: '0', lower: '-0.02' });
  });
});
