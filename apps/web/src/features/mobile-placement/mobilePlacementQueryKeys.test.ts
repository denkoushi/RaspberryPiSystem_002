import { describe, expect, it } from 'vitest';

import { mobilePlacementQueryKeys } from './mobilePlacementQueryKeys';

describe('mobilePlacementQueryKeys', () => {
  it('preserves every static key and invalidation prefix', () => {
    expect(mobilePlacementQueryKeys.all).toEqual(['mobile-placement']);
    expect(mobilePlacementQueryKeys.registeredShelves).toEqual(['mobile-placement', 'registered-shelves']);
    expect(mobilePlacementQueryKeys.haizenTargetDevices).toEqual(['mobile-placement', 'haizen-target-devices']);
    expect(mobilePlacementQueryKeys.orderPlacementBranchesAll).toEqual(['mobile-placement', 'order-placement-branches']);
    expect(mobilePlacementQueryKeys.clientCapabilities).toEqual(['mobile-placement', 'client-capabilities']);
    expect(mobilePlacementQueryKeys.shelfLayout).toEqual(['mobile-placement', 'shelf-layout']);
    expect(mobilePlacementQueryKeys.machineMasters).toEqual(['mobile-placement', 'machine-masters']);
  });

  it('preserves parameter values, null elements, and the empty shelf fallback', () => {
    for (const key of ['order-123', '', ' order-123 ']) {
      expect(mobilePlacementQueryKeys.orderPlacementBranches(key)).toEqual(['mobile-placement', 'order-placement-branches', key]);
    }
    for (const macroZoneId of ['zone-1', '', null]) {
      expect(mobilePlacementQueryKeys.shelfLayoutZone(macroZoneId)).toEqual(['mobile-placement', 'shelf-layout', 'zone', macroZoneId]);
    }
    expect(mobilePlacementQueryKeys.haizenCurrent('shelf-1')).toEqual(['mobile-placement', 'haizen-current', 'shelf-1']);
    expect(mobilePlacementQueryKeys.haizenCurrent('')).toEqual(['mobile-placement', 'haizen-current', '__all__']);
    expect(mobilePlacementQueryKeys.haizenCurrent(' ')).toEqual(['mobile-placement', 'haizen-current', ' ']);
  });
});
