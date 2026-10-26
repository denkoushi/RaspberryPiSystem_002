import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let register: ReturnType<typeof vi.fn>;
let persist: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.resetModules();
  vi.stubEnv('DEV', false);
  localStorage.clear();
  register = vi.fn().mockResolvedValue({});
  persist = vi.fn().mockResolvedValue(true);
  vi.stubGlobal('isSecureContext', true);
  vi.stubGlobal('navigator', { serviceWorker: { register }, storage: { persist }, onLine: true });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  document.head.querySelector('meta[name="mobile-app-shell-offline"]')?.remove();
});

describe('mobile app shell registration', () => {
  it('does not register or request persistence in development', async () => {
    vi.stubEnv('DEV', true);
    const { registerMobileAppShell } = await import('./registerMobileAppShell');
    registerMobileAppShell('/kiosk/mobile-placement');
    expect(register).not.toHaveBeenCalled();
    expect(persist).not.toHaveBeenCalled();
  });

  it.each(['/kiosk/mobile-placement', '/kiosk/mobile-placement/part-search', '/kiosk/purchase-order-lookup', '/kiosk/purchase-order-lookup/'])('registers only once on %s', async (path) => {
    const { registerMobileAppShell } = await import('./registerMobileAppShell');
    registerMobileAppShell(path);
    registerMobileAppShell(path);
    expect(register).toHaveBeenCalledExactlyOnceWith('/sw.js', { scope: '/kiosk/' });
    expect(persist).toHaveBeenCalledOnce();
  });

  it.each(['/kiosk', '/kiosk/tag', '/admin', '/kiosk/mobile-placement-other', '/kiosk/purchase-order-lookup/other'])('ignores %s', async (path) => {
    const { registerMobileAppShell } = await import('./registerMobileAppShell');
    registerMobileAppShell(path);
    expect(register).not.toHaveBeenCalled();
    expect(persist).not.toHaveBeenCalled();
  });

  it('registers when SPA navigation first reaches a target', async () => {
    const { registerMobileAppShell } = await import('./registerMobileAppShell');
    registerMobileAppShell('/kiosk/tag');
    registerMobileAppShell('/kiosk/mobile-placement');
    expect(register).toHaveBeenCalledOnce();
  });

  it.each(['insecure', 'unsupported'])('does nothing when %s', async (mode) => {
    if (mode === 'insecure') vi.stubGlobal('isSecureContext', false);
    else vi.stubGlobal('navigator', { storage: { persist } });
    const { registerMobileAppShell } = await import('./registerMobileAppShell');
    registerMobileAppShell('/kiosk/mobile-placement');
    expect(register).not.toHaveBeenCalled();
    expect(persist).not.toHaveBeenCalled();
  });

  it('ignores registration and persistence rejections', async () => {
    register.mockRejectedValue(new Error('denied'));
    persist.mockRejectedValue(new Error('denied'));
    const { registerMobileAppShell } = await import('./registerMobileAppShell');
    expect(() => registerMobileAppShell('/kiosk/mobile-placement')).not.toThrow();
    await Promise.resolve();
  });

  it('requests persistence only once across document loads', async () => {
    (await import('./registerMobileAppShell')).registerMobileAppShell('/kiosk/mobile-placement');
    vi.resetModules();
    (await import('./registerMobileAppShell')).registerMobileAppShell('/kiosk/purchase-order-lookup');
    expect(persist).toHaveBeenCalledOnce();
  });

  it('works without the storage persistence API', async () => {
    vi.stubGlobal('navigator', { serviceWorker: { register } });
    const { registerMobileAppShell } = await import('./registerMobileAppShell');
    expect(() => registerMobileAppShell('/kiosk/mobile-placement')).not.toThrow();
    expect(register).toHaveBeenCalledOnce();
  });

  it('recognizes fallback HTML even if the browser reports online, only on target paths', async () => {
    const meta = document.createElement('meta');
    meta.name = 'mobile-app-shell-offline';
    document.head.append(meta);
    const { isOfflineMobileAppShell } = await import('./registerMobileAppShell');
    expect(isOfflineMobileAppShell('/kiosk/mobile-placement')).toBe(true);
    expect(isOfflineMobileAppShell('/kiosk/tag')).toBe(false);
  });
});
