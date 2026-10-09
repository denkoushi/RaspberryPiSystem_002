import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as buildConfig from '../../config/productionBuildConfig';

import { scheduleKioskPreload, startBrowserKioskWebUpdate } from './browserKioskSeamlessUpdate';
import { startKioskLazyPreload } from './kioskLazyPreload';
import { useKioskSeamlessWebUpdate } from './useKioskSeamlessWebUpdate';

vi.mock('./browserKioskSeamlessUpdate', () => ({ scheduleKioskPreload: vi.fn(), startBrowserKioskWebUpdate: vi.fn() }));
vi.mock('./kioskLazyPreload', () => ({ startKioskLazyPreload: vi.fn() }));
const config = buildConfig.readProductionBuildConfig();

describe('kiosk seamless update hook', () => {
  const stopPreload = vi.fn();
  const stopUpdate = vi.fn();
  beforeEach(() => {
    vi.spyOn(buildConfig, 'readProductionBuildConfig').mockReturnValue({ ...config, isDevelopment: false });
    vi.mocked(startKioskLazyPreload).mockReturnValue(stopPreload);
    vi.mocked(startBrowserKioskWebUpdate).mockReturnValue(stopUpdate);
    window.history.replaceState(null, '', '/kiosk/tag');
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    window.history.replaceState(null, '', '/');
  });

  it('starts once across kiosk navigation and cleans up outside kiosk', () => {
    const { rerender, unmount } = renderHook(({ path }) => useKioskSeamlessWebUpdate(path, false), { initialProps: { path: '/kiosk/tag' } });
    expect(startKioskLazyPreload).toHaveBeenCalledWith('/kiosk/tag', false, scheduleKioskPreload);
    rerender({ path: '/kiosk/photo' });
    expect(startKioskLazyPreload).toHaveBeenCalledTimes(1);
    expect(startBrowserKioskWebUpdate).toHaveBeenCalledTimes(1);
    rerender({ path: '/admin' });
    expect(stopPreload).toHaveBeenCalledTimes(1);
    expect(stopUpdate).toHaveBeenCalledTimes(1);
    unmount();
  });

  it('delays preload during maintenance and exposes fresh maintenance to the existing controller', () => {
    const { rerender, unmount } = renderHook(({ maintenance }) => useKioskSeamlessWebUpdate('/kiosk/tag', maintenance), { initialProps: { maintenance: true } });
    const isMaintenance = vi.mocked(startBrowserKioskWebUpdate).mock.calls[0][0];
    expect(isMaintenance()).toBe(true);
    expect(startKioskLazyPreload).not.toHaveBeenCalled();
    rerender({ maintenance: false });
    expect(isMaintenance()).toBe(false);
    expect(startKioskLazyPreload).toHaveBeenCalledTimes(1);
    rerender({ maintenance: true });
    expect(isMaintenance()).toBe(true);
    expect(stopPreload).toHaveBeenCalledTimes(1);
    expect(startBrowserKioskWebUpdate).toHaveBeenCalledTimes(1);
    unmount();
  });

  it.each(['development', 'admin'])('starts neither mechanism in %s', (condition) => {
    if (condition === 'development') vi.spyOn(buildConfig, 'readProductionBuildConfig').mockReturnValue({ ...config, isDevelopment: true });
    const { unmount } = renderHook(() => useKioskSeamlessWebUpdate(condition === 'admin' ? '/admin' : '/kiosk/tag', false));
    expect(startKioskLazyPreload).not.toHaveBeenCalled();
    expect(startBrowserKioskWebUpdate).not.toHaveBeenCalled();
    unmount();
  });
});
