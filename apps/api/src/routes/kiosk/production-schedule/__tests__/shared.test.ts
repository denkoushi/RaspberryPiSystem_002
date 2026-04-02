import { describe, expect, it } from 'vitest';

import {
  parseCsvList,
  productionScheduleSeibanMachineNamesBodySchema,
  toLegacyLocationKeyFromDeviceScope
} from '../shared.js';

describe('production-schedule route shared helpers', () => {
  it('deduplicates csv tokens while preserving explicit scope boundary conversion', () => {
    expect(parseCsvList(' 305,581,305 , ,582 ')).toEqual(['305', '581', '582']);
  });

  it('bridges deviceScopeKey to legacy locationKey at route boundary', () => {
    const deviceScopeKey = '第2工場 - kensakuMain';
    expect(toLegacyLocationKeyFromDeviceScope(deviceScopeKey)).toBe('第2工場 - kensakuMain');
  });

  it('productionScheduleSeibanMachineNamesBodySchema は重複除去と正規化する', () => {
    const parsed = productionScheduleSeibanMachineNamesBodySchema.parse({
      fseibans: ['  a ', 'a', 'b']
    });
    expect(parsed.fseibans).toEqual(['a', 'b']);
  });

  it('productionScheduleSeibanMachineNamesBodySchema は 100 件までは保持する', () => {
    const inputs = Array.from({ length: 60 }, (_, i) => `S-${i + 1}`);
    const parsed = productionScheduleSeibanMachineNamesBodySchema.parse({
      fseibans: inputs
    });
    expect(parsed.fseibans).toEqual(inputs);
  });
});
