import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const launchMock = vi.fn();

vi.mock('playwright', () => ({
  chromium: {
    launch: (...args: unknown[]) => launchMock(...args),
  },
}));

import {
  probePlaywrightChromiumAvailability,
  resetPlaywrightChromiumAvailabilityProbeForTests,
} from '../playwright-chromium-availability.js';

describe('probePlaywrightChromiumAvailability', () => {
  beforeEach(() => {
    launchMock.mockReset();
    resetPlaywrightChromiumAvailabilityProbeForTests();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('headless Chromium を起動して終了できれば available=true', async () => {
    const close = vi.fn().mockResolvedValue(undefined);
    launchMock.mockResolvedValue({
      close,
      version: () => '123.0.0',
    });

    const result = await probePlaywrightChromiumAvailability();

    expect(result.available).toBe(true);
    expect(result.browserVersion).toBe('123.0.0');
    expect(launchMock).toHaveBeenCalledWith({ headless: true });
    expect(close).toHaveBeenCalledOnce();
  });

  it('起動失敗時は詳細を公開せず available=false', async () => {
    launchMock.mockRejectedValue(new Error('/secret/runtime/path: executable not found'));

    const result = await probePlaywrightChromiumAvailability();

    expect(result.available).toBe(false);
    expect(result.message).not.toContain('/secret/runtime/path');
    expect(result.message).toContain('kiosk document HTML→PDF');
  });

  it('並行呼び出しでも起動確認を一度だけ実行する', async () => {
    const close = vi.fn().mockResolvedValue(undefined);
    launchMock.mockResolvedValue({
      close,
      version: () => '123.0.0',
    });

    const [first, second] = await Promise.all([
      probePlaywrightChromiumAvailability(),
      probePlaywrightChromiumAvailability(),
    ]);

    expect(first).toBe(second);
    expect(launchMock).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
  });

  it('終了失敗時は残ったブラウザを再度閉じて unavailable にする', async () => {
    const close = vi
      .fn()
      .mockRejectedValueOnce(new Error('close failed'))
      .mockResolvedValueOnce(undefined);
    launchMock.mockResolvedValue({
      close,
      version: () => '123.0.0',
    });

    const result = await probePlaywrightChromiumAvailability();

    expect(result.available).toBe(false);
    expect(close).toHaveBeenCalledTimes(2);
  });
});
