import { chromium } from 'playwright';

export type PlaywrightChromiumAvailability = {
  available: boolean;
  browserVersion?: string;
  message: string;
};

let cachedProbe: Promise<PlaywrightChromiumAvailability> | undefined;

/**
 * Playwright Chromium の同梱有無を起動時・health で参照する。
 * `INSTALL_PLAYWRIGHT_CHROMIUM=false` ビルドや install 失敗時は available=false。
 */
export function probePlaywrightChromiumAvailability(): Promise<PlaywrightChromiumAvailability> {
  cachedProbe ??= launchHeadlessChromiumProbe();
  return cachedProbe;
}

async function launchHeadlessChromiumProbe(): Promise<PlaywrightChromiumAvailability> {
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    browser = await chromium.launch({ headless: true });
    const browserVersion = browser.version();
    await browser.close();
    browser = undefined;
    return {
      available: true,
      browserVersion,
      message: 'Headless Chromium launched successfully',
    };
  } catch {
    if (browser) {
      await browser.close().catch(() => undefined);
    }
    return {
      available: false,
      message:
        'Headless Chromium could not be launched. ' +
        'Playwright-dependent features (signage playwright_html, kiosk document HTML→PDF) will fail at runtime.',
    };
  }
}

export function resetPlaywrightChromiumAvailabilityProbeForTests(): void {
  cachedProbe = undefined;
}
