import { afterEach, describe, expect, it, vi } from 'vitest';

import { isHaizenNativeAvailable, scanFseibanNative } from './haizenNative';

const ok = { status: 'ok' as const, fseiban: 'BA1S3332', tokens: ['BA1S3332'], text: '製番 BA1S3332' };

afterEach(() => {
  window.__haizenNativeScanResult?.({ status: 'cancelled' });
  delete window.HaizenNative;
  delete window.__haizenNativeScanResult;
});

describe('Haizen native bridge', () => {
  it('is unavailable in a normal browser or when the bridge refuses access', async () => {
    expect(isHaizenNativeAvailable()).toBe(false);
    await expect(scanFseibanNative()).rejects.toThrow('利用できません');
    window.HaizenNative = { isAvailable: () => false, scanFseiban: vi.fn() };
    expect(isHaizenNativeAvailable()).toBe(false);
    window.HaizenNative.isAvailable = () => { throw new Error('origin'); };
    expect(isHaizenNativeAvailable()).toBe(false);
  });

  it('registers the callback before starting and cleans it up on success', async () => {
    window.HaizenNative = {
      isAvailable: () => true,
      scanFseiban: vi.fn(() => window.__haizenNativeScanResult?.(ok))
    };
    expect(isHaizenNativeAvailable()).toBe(true);
    await expect(scanFseibanNative()).resolves.toEqual(ok);
    expect(window.HaizenNative.scanFseiban).toHaveBeenCalledOnce();
    expect(window.__haizenNativeScanResult).toBeUndefined();
  });

  it('allows only one pending request and permits another after cancellation', async () => {
    window.HaizenNative = { isAvailable: () => true, scanFseiban: vi.fn() };
    const first = scanFseibanNative();
    await expect(scanFseibanNative()).rejects.toThrow('既に実行中');
    expect(window.HaizenNative.scanFseiban).toHaveBeenCalledOnce();
    window.__haizenNativeScanResult?.({ status: 'cancelled' });
    await expect(first).resolves.toEqual({ status: 'cancelled' });
    expect(window.__haizenNativeScanResult).toBeUndefined();
    const next = scanFseibanNative();
    window.__haizenNativeScanResult?.(ok);
    await expect(next).resolves.toEqual(ok);
  });

  it('cleans up after a native exception so retry is possible', async () => {
    window.HaizenNative = {
      isAvailable: () => true,
      scanFseiban: () => { throw new Error('camera failed'); }
    };
    await expect(scanFseibanNative()).rejects.toThrow('camera failed');
    expect(window.__haizenNativeScanResult).toBeUndefined();
    window.HaizenNative.scanFseiban = () => window.__haizenNativeScanResult?.(ok);
    await expect(scanFseibanNative()).resolves.toEqual(ok);
  });
});
