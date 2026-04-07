import { describe, expect, it } from 'vitest';

import { buildSignageCurrentImageUrl } from './buildSignageCurrentImageUrl';

describe('buildSignageCurrentImageUrl', () => {
  it('builds URL with key and cache bust', () => {
    expect(
      buildSignageCurrentImageUrl({
        clientKey: 'client-key-android-signage-01',
        cacheBust: 42,
      })
    ).toMatch(/\/signage\/current-image\?key=client-key-android-signage-01&t=42$/);
  });

  it('omits key when empty', () => {
    expect(
      buildSignageCurrentImageUrl({
        clientKey: '   ',
        cacheBust: 1,
      })
    ).toMatch(/\/signage\/current-image\?t=1$/);
  });

  it('includes current-image path and key query', () => {
    const u = buildSignageCurrentImageUrl({ clientKey: 'client-key-x', cacheBust: 0 });
    expect(u).toContain('/signage/current-image');
    expect(u).toContain('key=client-key-x');
  });
});
