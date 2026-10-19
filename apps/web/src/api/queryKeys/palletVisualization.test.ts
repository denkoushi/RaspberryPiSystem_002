import { describe, expect, it } from 'vitest';

import { palletVisualizationQueryKeys } from './palletVisualization';

describe('palletVisualizationQueryKeys', () => {
  it('preserves the board key and invalidation prefix length', () => {
    expect(palletVisualizationQueryKeys.boardAll).toEqual(['tools-pallet-viz-board']);
  });

  it('preserves the kiosk board key for each client', () => {
    expect(palletVisualizationQueryKeys.kioskBoard('client-1')).toEqual(['kiosk-pallet-viz-board', 'client-1']);
  });
});
