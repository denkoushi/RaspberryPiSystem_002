import { describe, expect, it } from 'vitest';

import { parseCsvList, toLegacyLocationKeyFromDeviceScope } from '../shared.js';

describe('production-schedule route shared helpers', () => {
  it('deduplicates csv tokens while preserving explicit scope boundary conversion', () => {
    expect(parseCsvList(' 305,581,305 , ,582 ')).toEqual(['305', '581', '582']);
  });

  it('bridges deviceScopeKey to legacy locationKey at route boundary', () => {
    const deviceScopeKey = '第2工場 - kensakuMain';
    expect(toLegacyLocationKeyFromDeviceScope(deviceScopeKey)).toBe('第2工場 - kensakuMain');
  });
});
