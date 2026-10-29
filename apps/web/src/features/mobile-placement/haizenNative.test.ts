import { afterEach, describe, expect, it, vi } from 'vitest';

import { isHaizenNativeAvailable, isHaizenSpeechAvailable, recognizeSpeechNative, scanFseibanNative, stopSpeechNative } from './haizenNative';

const ok = { status: 'ok' as const, fseiban: 'BA1S3332', tokens: ['BA1S3332'], text: '製番 BA1S3332' };

afterEach(() => {
  window.__haizenNativeScanResult?.({ status: 'cancelled' });
  window.__haizenNativeSpeechResult?.({ status: 'cancelled' });
  delete window.HaizenNative;
  delete window.__haizenNativeScanResult;
  delete window.__haizenNativeSpeechResult;
});

describe('Haizen native speech bridge', () => {
  const spoken = { status: 'ok' as const, texts: ['テーブル', 'DAD3350'] };
  const bridge = () => ({
    isAvailable: () => true, scanFseiban: vi.fn(),
    isSpeechAvailable: () => true, startSpeech: vi.fn(), stopSpeech: vi.fn()
  });

  it('is hidden in browsers, old shells, incomplete bridges and unavailable services', async () => {
    expect(isHaizenSpeechAvailable()).toBe(false);
    await expect(recognizeSpeechNative()).rejects.toThrow('利用できません');
    window.HaizenNative = { isAvailable: () => true, scanFseiban: vi.fn() };
    expect(isHaizenSpeechAvailable()).toBe(false);
    window.HaizenNative = { ...bridge(), startSpeech: undefined };
    expect(isHaizenSpeechAvailable()).toBe(false);
    window.HaizenNative = { ...bridge(), stopSpeech: undefined };
    expect(isHaizenSpeechAvailable()).toBe(false);
    window.HaizenNative = { ...bridge(), isSpeechAvailable: () => false };
    expect(isHaizenSpeechAvailable()).toBe(false);
    window.HaizenNative.isSpeechAvailable = () => { throw new Error('origin'); };
    expect(isHaizenSpeechAvailable()).toBe(false);
  });

  it('registers before starting and cleans up the successful result', async () => {
    window.HaizenNative = { ...bridge(), startSpeech: vi.fn(() => window.__haizenNativeSpeechResult?.(spoken)) };
    expect(isHaizenSpeechAvailable()).toBe(true);
    await expect(recognizeSpeechNative()).resolves.toEqual(spoken);
    expect(window.HaizenNative.startSpeech).toHaveBeenCalledOnce();
    expect(window.__haizenNativeSpeechResult).toBeUndefined();
  });

  it('serializes speech and scan requests and permits retry after cancellation', async () => {
    window.HaizenNative = bridge();
    const first = recognizeSpeechNative();
    await expect(recognizeSpeechNative()).rejects.toThrow('既に実行中');
    await expect(scanFseibanNative()).rejects.toThrow('既に実行中');
    expect(window.HaizenNative.startSpeech).toHaveBeenCalledOnce();
    window.__haizenNativeSpeechResult?.({ status: 'cancelled' });
    await expect(first).resolves.toEqual({ status: 'cancelled' });
    expect(window.__haizenNativeSpeechResult).toBeUndefined();
    const scan = scanFseibanNative();
    await expect(recognizeSpeechNative()).rejects.toThrow('既に実行中');
    window.__haizenNativeScanResult?.(ok);
    await scan;
    const next = recognizeSpeechNative();
    window.__haizenNativeSpeechResult?.(spoken);
    await expect(next).resolves.toEqual(spoken);
  });

  it('stops early but waits for the native result', async () => {
    window.HaizenNative = bridge();
    stopSpeechNative();
    expect(window.HaizenNative.stopSpeech).not.toHaveBeenCalled();
    const pending = recognizeSpeechNative();
    stopSpeechNative();
    expect(window.HaizenNative.stopSpeech).toHaveBeenCalledOnce();
    expect(window.__haizenNativeSpeechResult).toBeTypeOf('function');
    window.__haizenNativeSpeechResult?.(spoken);
    await expect(pending).resolves.toEqual(spoken);
  });

  it('cleans up a start exception and allows another request', async () => {
    window.HaizenNative = { ...bridge(), startSpeech: () => { throw new Error('mic failed'); } };
    await expect(recognizeSpeechNative()).rejects.toThrow('mic failed');
    expect(window.__haizenNativeSpeechResult).toBeUndefined();
    window.HaizenNative.startSpeech = () => window.__haizenNativeSpeechResult?.(spoken);
    await expect(recognizeSpeechNative()).resolves.toEqual(spoken);
  });

  it('cleans up a stop exception as cancellation', async () => {
    window.HaizenNative = { ...bridge(), stopSpeech: () => { throw new Error('mic failed'); } };
    const pending = recognizeSpeechNative();
    stopSpeechNative();
    await expect(pending).resolves.toEqual({ status: 'cancelled' });
    expect(window.__haizenNativeSpeechResult).toBeUndefined();
  });
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
