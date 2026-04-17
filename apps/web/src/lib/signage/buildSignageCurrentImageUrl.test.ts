import { describe, expect, it } from 'vitest';

import { buildSignageCurrentImageUrl, buildSignageCurrentImageUrlSearchParams } from './buildSignageCurrentImageUrl';

describe('buildSignageCurrentImageUrlSearchParams', () => {
  it('matches URL query rules used by buildSignageCurrentImageUrl', () => {
    const sp = buildSignageCurrentImageUrlSearchParams({
      clientKey: 'client-key-android-signage-01',
      cacheBust: 42,
    });
    expect(sp.get('key')).toBe('client-key-android-signage-01');
    expect(sp.get('t')).toBe('42');
  });

  it('omits key when clientKey is whitespace only', () => {
    const sp = buildSignageCurrentImageUrlSearchParams({ clientKey: '   ', cacheBust: 1 });
    expect(sp.has('key')).toBe(false);
    expect(sp.get('t')).toBe('1');
  });
});

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
