import { describe, expect, it } from 'vitest';

import { normalizeVideoPointer, validPointer } from './pointer';

describe('contained video pointer', () => {
  const rect = { left: 10, top: 20, width: 400, height: 400 };
  it('normalizes wide video, excluding top/bottom letterboxes', () => {
    expect(normalizeVideoPointer(110, 170, rect, 400, 200)).toEqual({ x: .25, y: .25 });
    expect(normalizeVideoPointer(210, 119, rect, 400, 200)).toBeNull();
    expect(normalizeVideoPointer(210, 321, rect, 400, 200)).toBeNull();
    expect(normalizeVideoPointer(410, 320, rect, 400, 200)).toEqual({ x: 1, y: 1 });
  });
  it('normalizes tall video, excluding side letterboxes', () => {
    expect(normalizeVideoPointer(160, 320, rect, 200, 400)).toEqual({ x: .25, y: .75 });
    expect(normalizeVideoPointer(109, 220, rect, 200, 400)).toBeNull();
    expect(normalizeVideoPointer(311, 220, rect, 200, 400)).toBeNull();
  });
  it('ignores unloaded video and invalid coordinates', () => {
    expect(normalizeVideoPointer(210, 220, rect, 0, 0)).toBeNull();
    expect(normalizeVideoPointer(NaN, 220, rect, 400, 400)).toBeNull();
    expect(validPointer({ x: Infinity, y: 0 })).toBe(false);
    expect(validPointer({ x: .5, y: '0' })).toBe(false);
  });
});
