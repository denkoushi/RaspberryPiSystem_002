import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useIsPhoneViewport } from './useIsPhoneViewport';

afterEach(() => vi.unstubAllGlobals());

describe('useIsPhoneViewport', () => {
  it('matchMediaがないテスト環境ではdesktopを返す', () => {
    vi.stubGlobal('matchMedia', undefined);
    expect(renderHook(useIsPhoneViewport).result.current).toBe(false);
  });
  it('767pxの境界で切り替わり、購読を解除する', () => {
    let change = () => {};
    const media = { matches: true, addEventListener: vi.fn((_event, cb) => { change = cb; }), removeEventListener: vi.fn() };
    const matchMedia = vi.fn(() => media);
    vi.stubGlobal('matchMedia', matchMedia);
    const { result, unmount } = renderHook(useIsPhoneViewport);
    expect(matchMedia).toHaveBeenCalledWith('(max-width: 767px)');
    expect(result.current).toBe(true);
    act(() => { media.matches = false; change(); });
    expect(result.current).toBe(false);
    act(() => { media.matches = true; change(); });
    expect(result.current).toBe(true);
    unmount();
    expect(media.removeEventListener).toHaveBeenCalledWith('change', change);
  });
});
