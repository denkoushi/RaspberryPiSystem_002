import { describe, expect, it } from 'vitest';

import { isSignageDisplayClientDeviceApiKey } from '../signage-display-client.js';

describe('isSignageDisplayClientDeviceApiKey', () => {
  it('returns true when apiKey contains signage (case-insensitive)', () => {
    expect(isSignageDisplayClientDeviceApiKey('client-key-pi3-SIGNAGE-1')).toBe(true);
    expect(isSignageDisplayClientDeviceApiKey('...-android-signage-161')).toBe(true);
  });

  it('returns false otherwise', () => {
    expect(isSignageDisplayClientDeviceApiKey('client-key-raspberrypi4-kiosk1')).toBe(false);
  });
});
