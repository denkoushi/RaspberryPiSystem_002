import { afterEach, describe, expect, it, vi } from 'vitest';

import { pageZoom } from './pageZoom';

describe('pageZoom', () => {
  afterEach(() => vi.restoreAllMocks());

  it.each(['', 'normal', '1', '0'])('defaults to unzoomed coordinates for %s', (zoom) => {
    vi.spyOn(window, 'getComputedStyle').mockReturnValue({ zoom } as CSSStyleDeclaration);
    expect(pageZoom()).toBe(1);
    expect(140 / pageZoom()).toBe(140);
  });

  it('converts visual pixels into layout CSS pixels using the root computed zoom', () => {
    const computed = vi.spyOn(window, 'getComputedStyle').mockReturnValue({ zoom: '0.7' } as CSSStyleDeclaration);
    expect(pageZoom()).toBe(0.7);
    expect(140 / pageZoom()).toBe(200);
    expect(computed).toHaveBeenCalledWith(document.documentElement);
  });
});
