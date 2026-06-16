import { accessSync, constants } from 'node:fs';

import { chromium } from 'playwright';

export type PlaywrightChromiumAvailability = {
  available: boolean;
  executablePath?: string;
  message: string;
};

/**
 * Playwright Chromium の同梱有無を起動時・health で参照する。
 * `INSTALL_PLAYWRIGHT_CHROMIUM=false` ビルドや install 失敗時は available=false。
 */
export function probePlaywrightChromiumAvailability(): PlaywrightChromiumAvailability {
  try {
    const executablePath = chromium.executablePath();
    accessSync(executablePath, constants.X_OK);
    return {
      available: true,
      executablePath,
      message: 'Chromium is installed',
    };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return {
      available: false,
      message:
        `Chromium is not installed (${detail}). ` +
        'Playwright-dependent features (signage playwright_html, kiosk document HTML→PDF) will fail at runtime.',
    };
  }
}
