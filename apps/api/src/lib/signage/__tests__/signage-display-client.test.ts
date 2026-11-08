import { describe, expect, it } from 'vitest';
import { isSignageDisplayClientDevice } from '../signage-display-client.js';

describe('isSignageDisplayClientDevice', () => {
  it('uses the explicit signage flag', () => {
    expect(isSignageDisplayClientDevice({ isSignage: true })).toBe(true);
    expect(isSignageDisplayClientDevice({ isSignage: false })).toBe(false);
  });
});
