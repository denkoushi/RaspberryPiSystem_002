import { describe, expect, it } from 'vitest';

import { resolveEffectiveKioskSignagePreviewDeviceId } from '../kiosk-signage-preview-target.js';

describe('resolveEffectiveKioskSignagePreviewDeviceId', () => {
  it('uses stored target when it is in the valid signage set', () => {
    expect(
      resolveEffectiveKioskSignagePreviewDeviceId({
        kioskDeviceId: 'kiosk-key',
        storedTarget: 'sig-key',
        validSignageDeviceIds: new Set(['sig-key']),
      })
    ).toBe('sig-key');
  });

  it('falls back to kiosk key when stored is absent', () => {
    expect(
      resolveEffectiveKioskSignagePreviewDeviceId({
        kioskDeviceId: 'kiosk-key',
        storedTarget: null,
        validSignageDeviceIds: new Set(['sig-key']),
      })
    ).toBe('kiosk-key');
  });

  it('falls back to kiosk key when stored is not in the valid set', () => {
    expect(
      resolveEffectiveKioskSignagePreviewDeviceId({
        kioskDeviceId: 'kiosk-key',
        storedTarget: 'orphan-key',
        validSignageDeviceIds: new Set(['sig-key']),
      })
    ).toBe('kiosk-key');
  });
});
