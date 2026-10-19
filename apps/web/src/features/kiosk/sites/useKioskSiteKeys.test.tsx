import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const useKioskSitesMock = vi.fn();
vi.mock('../../../api/hooks', () => ({
  useKioskSites: (options?: { enabled?: boolean }) => useKioskSitesMock(options)
}));

import { KIOSK_DEFAULT_SITE_KEY, KIOSK_FALLBACK_SITE_KEYS, useKioskSiteKeys } from './useKioskSiteKeys';

describe('useKioskSiteKeys', () => {
  beforeEach(() => useKioskSitesMock.mockReset());

  it('keeps the previous fixed choices until the server list arrives', () => {
    useKioskSitesMock.mockReturnValue({ data: undefined });
    const { result } = renderHook(() => useKioskSiteKeys({ enabled: false }));
    expect(result.current).toEqual(['第2工場', 'トークプラザ', '第1工場']);
    expect(result.current).toBe(KIOSK_FALLBACK_SITE_KEYS);
    expect(KIOSK_DEFAULT_SITE_KEY).toBe('第2工場');
    expect(useKioskSitesMock).toHaveBeenCalledWith({ enabled: false });
  });

  it('uses the sites registered on the server, including newly added ones', () => {
    useKioskSitesMock.mockReturnValue({
      data: [
        { key: '第2工場', displayName: '第2工場', sortOrder: 0 },
        { key: '新工場', displayName: '新工場', sortOrder: 5 }
      ]
    });
    const { result } = renderHook(() => useKioskSiteKeys());
    expect(result.current).toEqual(['第2工場', '新工場']);
  });

  it('falls back when the server list is empty', () => {
    useKioskSitesMock.mockReturnValue({ data: [] });
    const { result } = renderHook(() => useKioskSiteKeys());
    expect(result.current).toBe(KIOSK_FALLBACK_SITE_KEYS);
  });
});
