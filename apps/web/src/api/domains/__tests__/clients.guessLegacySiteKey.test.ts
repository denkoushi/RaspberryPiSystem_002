import { describe, expect, it } from 'vitest';

import { guessLegacySiteKey } from '../clients';

/** apps/api/src/lib/location-scope-resolver.ts の推測と同じ結果になること */
describe('guessLegacySiteKey', () => {
  it('uses the text before the delimiter of the location', () => {
    expect(guessLegacySiteKey({ location: ' 第2工場 - Sessaku-01 ', name: 'raspi4' })).toBe('第2工場');
  });

  it('uses the whole location or the name when there is no delimiter', () => {
    expect(guessLegacySiteKey({ location: 'factory', name: 'AQUOS' })).toBe('factory');
    expect(guessLegacySiteKey({ location: null, name: 'Mac' })).toBe('Mac');
    expect(guessLegacySiteKey({ location: '  ', name: ' raspi5_serber ' })).toBe('raspi5_serber');
    expect(guessLegacySiteKey({ location: null, name: ' ' })).toBe('default');
  });
});
