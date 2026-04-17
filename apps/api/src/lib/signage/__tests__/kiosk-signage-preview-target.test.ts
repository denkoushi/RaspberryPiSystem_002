import { describe, expect, it } from 'vitest';

import { resolveEffectiveKioskSignagePreviewApiKey } from '../kiosk-signage-preview-target.js';

describe('resolveEffectiveKioskSignagePreviewApiKey', () => {
  it('uses stored target when it is in the valid signage set', () => {
    expect(
      resolveEffectiveKioskSignagePreviewApiKey({
        kioskApiKey: 'kiosk-key',
        storedTarget: 'sig-key',
        validSignageApiKeys: new Set(['sig-key']),
      })
    ).toBe('sig-key');
  });

  it('falls back to kiosk key when stored is absent', () => {
    expect(
      resolveEffectiveKioskSignagePreviewApiKey({
        kioskApiKey: 'kiosk-key',
        storedTarget: null,
        validSignageApiKeys: new Set(['sig-key']),
      })
    ).toBe('kiosk-key');
  });

  it('falls back to kiosk key when stored is not in the valid set', () => {
    expect(
      resolveEffectiveKioskSignagePreviewApiKey({
        kioskApiKey: 'kiosk-key',
        storedTarget: 'orphan-key',
        validSignageApiKeys: new Set(['sig-key']),
      })
    ).toBe('kiosk-key');
  });
});
