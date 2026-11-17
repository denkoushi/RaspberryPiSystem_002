import { describe, expect, it } from 'vitest';

import { templateItemSchema } from '../shared.js';

const item = { sortOrder: 0, datumSurface: 'A', measurementPoint: '幅', measurementLabel: '幅' };
const x = { dir: 'x', baseXRatio: 0.1, baseYRatio: 0.2, offsetRatio: 0.05 };

describe('template item dimensions', () => {
  it('accepts X/Y and clamps the offset', () => {
    expect(templateItemSchema.parse({ ...item, calloutDims: [x, { ...x, dir: 'y', offsetRatio: 2 }] }).calloutDims)
      .toEqual([x, { ...x, dir: 'y', offsetRatio: 1 }]);
  });
  it('rejects duplicate directions, more than two lines and invalid coordinates', () => {
    for (const calloutDims of [[x, x], [x, { ...x, dir: 'y' }, x], [{ ...x, baseXRatio: -0.1 }], [{ ...x, dir: 'z' }]]) {
      expect(templateItemSchema.safeParse({ ...item, calloutDims }).success).toBe(false);
    }
  });
});
