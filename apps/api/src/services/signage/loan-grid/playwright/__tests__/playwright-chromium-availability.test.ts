import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const accessSyncMock = vi.fn();
const executablePathMock = vi.fn();

vi.mock('node:fs', () => ({
  accessSync: (...args: unknown[]) => accessSyncMock(...args),
  constants: { X_OK: 1 },
}));

vi.mock('playwright', () => ({
  chromium: {
    executablePath: () => executablePathMock(),
  },
}));

import { probePlaywrightChromiumAvailability } from '../playwright-chromium-availability.js';

describe('probePlaywrightChromiumAvailability', () => {
  beforeEach(() => {
    accessSyncMock.mockReset();
    executablePathMock.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('Chromium が実行可能なら available=true', () => {
    executablePathMock.mockReturnValue('/ms-playwright/chromium-1234/chrome');
    accessSyncMock.mockReturnValue(undefined);

    const result = probePlaywrightChromiumAvailability();

    expect(result.available).toBe(true);
    expect(result.executablePath).toBe('/ms-playwright/chromium-1234/chrome');
    expect(accessSyncMock).toHaveBeenCalledWith('/ms-playwright/chromium-1234/chrome', 1);
  });

  it('executablePath 解決失敗時は available=false', () => {
    executablePathMock.mockImplementation(() => {
      throw new Error('Executable not found');
    });

    const result = probePlaywrightChromiumAvailability();

    expect(result.available).toBe(false);
    expect(result.message).toContain('Executable not found');
    expect(result.message).toContain('kiosk document HTML→PDF');
  });

  it('実行権限が無い場合は available=false', () => {
    executablePathMock.mockReturnValue('/ms-playwright/chromium-1234/chrome');
    accessSyncMock.mockImplementation(() => {
      throw new Error('EACCES');
    });

    const result = probePlaywrightChromiumAvailability();

    expect(result.available).toBe(false);
    expect(result.message).toContain('EACCES');
  });
});
