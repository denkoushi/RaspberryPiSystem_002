import { describe, expect, it } from 'vitest';

import { palletVisualizationQueryKeys } from './palletVisualization';

describe('palletVisualizationQueryKeys', () => {
  it('preserves the board key and invalidation prefix length', () => {
    expect(palletVisualizationQueryKeys.boardAll).toEqual(['tools-pallet-viz-board']);
  });
});
