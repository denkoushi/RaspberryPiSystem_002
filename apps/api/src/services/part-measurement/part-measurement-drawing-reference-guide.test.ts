import { describe, expect, it } from 'vitest';

import type { PartMeasurementDrawingDimension } from './part-measurement-drawing-dimension-map-payload.js';
import { deterministicReferenceLabel, generalTolerance, geometricToleranceLabel, referenceLimits } from './part-measurement-drawing-reference-guide.js';

const dimension: PartMeasurementDrawingDimension = {
  text: '64', nominal: 64, kind: 'len', depth: null, lowerTolerance: null, upperTolerance: null,
  xRatio: 0.2, yRatio: 0.3, tileId: 'tile'
};

describe('reference guide rules', () => {
  it.each([['// 0.005 A', '平行度'], ['∥ 0.01', '平行度'], ['⊥ 0.02', '直角度'], ['□ 0.01', '平面度'],
    ['⏥ 0.01', '平面度'], ['⌖ 0.1', '位置度'], ['◎ 0.01', '同心度'], ['— 0.01', '真直度'],
    ['- 0.01', '真直度'], ['φ0.02 A', '位置度'], ['φ47', null]])('maps %s to %s', (text, label) => {
    expect(geometricToleranceLabel(text)).toBe(label);
  });
  it.each([[0, 0.1], [6, 0.1], [6.01, 0.2], [30, 0.2], [30.01, 0.3], [120, 0.3], [120.01, 0.5],
    [400, 0.5], [400.01, 0.8], [1000, 0.8], [1000.01, 1.2], [2000, 1.2], [2001, 2], [-64, 0.3]])('tolerance for %s', (value, tolerance) => {
    expect(generalTolerance(value)).toBe(tolerance);
  });
  it('uses explicit tolerances, gdt zero, and fixed depth limits', () => {
    expect(referenceLimits(dimension, 'nominal')).toEqual({ nominalValue: 64, lowerLimit: 63.7, upperLimit: 64.3 });
    expect(referenceLimits({ ...dimension, nominal: 47, lowerTolerance: -0.1, upperTolerance: -0.05 }, 'nominal'))
      .toEqual({ nominalValue: 47, lowerLimit: 46.9, upperLimit: 46.95 });
    expect(referenceLimits({ ...dimension, kind: 'gdt', nominal: 0.005 }, 'nominal')).toEqual({ nominalValue: 0.005, lowerLimit: 0, upperLimit: 0.005 });
    expect(referenceLimits({ ...dimension, depth: 10 }, 'depth')).toEqual({ nominalValue: 10, lowerLimit: 10, upperLimit: 10 });
    expect(referenceLimits({ ...dimension, upperTolerance: 0.1 }, 'nominal')).toEqual({ nominalValue: 64, lowerLimit: 64, upperLimit: 64.1 });
  });
  it('only fixes geometric labels and tapped-hole depth', () => {
    expect(deterministicReferenceLabel({ ...dimension, kind: 'gdt', text: '// 0.005 A' }, 'nominal')).toBe('平行度');
    expect(deterministicReferenceLabel({ ...dimension, text: '４-Ｍ５深１０' }, 'depth')).toBe('ネジ穴深さ');
    expect(deterministicReferenceLabel({ ...dimension, kind: 'thread' }, 'depth')).toBe('ネジ穴深さ');
    expect(deterministicReferenceLabel({ ...dimension, kind: 'thread' }, 'nominal')).toBeNull();
    expect(deterministicReferenceLabel(dimension, 'nominal')).toBeNull();
  });
});
