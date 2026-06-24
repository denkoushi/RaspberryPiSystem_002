import { describe, expect, it } from 'vitest';

import {
  buildUnifiedOrderSlotScopeWhere,
  resolveUnifiedOrderSlotLockScopeKeys,
  sortUnifiedOrderSlots
} from '../production-schedule-unified-order-slot.service.js';

describe('sortUnifiedOrderSlots', () => {
  it('deduplicates and sorts slots by location, resourceCd, orderNumber', () => {
    const sorted = sortUnifiedOrderSlots([
      { locationKey: 'site-a', resourceCd: 'R02', orderNumber: 2 },
      { locationKey: 'site-a', resourceCd: 'R01', orderNumber: 2 },
      { locationKey: 'site-a', resourceCd: 'R01', orderNumber: 1 },
      { locationKey: 'site-a', resourceCd: 'R01', orderNumber: 1 }
    ]);

    expect(sorted).toEqual([
      { locationKey: 'site-a', resourceCd: 'R01', orderNumber: 1 },
      { locationKey: 'site-a', resourceCd: 'R01', orderNumber: 2 },
      { locationKey: 'site-a', resourceCd: 'R02', orderNumber: 2 }
    ]);
  });
});

describe('buildUnifiedOrderSlotScopeWhere', () => {
  it('matches usage aggregation scope (location or siteKey)', () => {
    expect(buildUnifiedOrderSlotScopeWhere('第2工場')).toEqual([
      { location: '第2工場' },
      { siteKey: '第2工場' }
    ]);
  });
});

describe('resolveUnifiedOrderSlotLockScopeKeys', () => {
  it('returns site key only for canonical location', () => {
    expect(resolveUnifiedOrderSlotLockScopeKeys('第2工場')).toEqual(['第2工場']);
  });

  it('includes site key for device-specific location', () => {
    expect(resolveUnifiedOrderSlotLockScopeKeys('第2工場 - kioskA')).toEqual([
      '第2工場',
      '第2工場 - kioskA'
    ]);
  });
});
