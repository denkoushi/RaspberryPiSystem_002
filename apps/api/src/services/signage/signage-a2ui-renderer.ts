import { chromium } from 'playwright';

import type { SignageA2uiProposal } from './signage-a2ui.js';

const PRINT_PAYLOAD_KEY = '__business_hermes_a2ui_print__';

/** Captures the official preview surface for the existing JPEG delivery path. */
export class SignageA2uiRenderer {
  async renderImage(proposal: SignageA2uiProposal): Promise<Buffer> {
    const browser = await chromium.launch({
      headless: true,
      ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
    });
    try {
      const baseUrl = process.env.BUSINESS_HERMES_WEB_BASE_URL?.trim() || 'http://127.0.0.1:4173';
      const parsedBaseUrl = new URL(baseUrl);
      const page = await browser.newPage({
        viewport: { width: 1920, height: 1080 },
        deviceScaleFactor: 1,
        // Only the standard internal gateway uses the existing local
        // certificate. Other configured HTTPS origins keep certificate checks.
        ignoreHTTPSErrors: parsedBaseUrl.protocol === 'https:' && parsedBaseUrl.hostname === 'gateway',
      });
      const allowedOrigin = parsedBaseUrl.origin;
      await page.route('**/*', (route) => new URL(route.request().url()).origin === allowedOrigin ? route.continue() : route.abort());
      await page.goto(`${baseUrl.replace(/\/$/u, '')}/a2ui-print.html`, { waitUntil: 'domcontentloaded' });
      await page.evaluate(({ key, value }: { key: string; value: unknown }) => window.localStorage.setItem(key, JSON.stringify(value)), { key: PRINT_PAYLOAD_KEY, value: { a2ui: proposal } });
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.locator('[data-testid="signage-a2ui-preview"]').waitFor();
      await page.waitForFunction(() => {
        const screen = document.querySelector('[data-testid="signage-a2ui-preview"]');
        return screen && !/\[Loading .+?\.\.\.\]/u.test(screen.textContent ?? '');
      });
      await page.evaluate(() => document.fonts?.ready);
      await page.waitForFunction(() => Array.from(document.images).every((image) => image.complete));
      const imagesLoaded = await page.evaluate(() => Array.from(document.images).every((image) => image.naturalWidth > 0));
      if (!imagesLoaded) throw new Error('公開写真を描画できません');
      await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
      if (await page.locator('[data-testid="signage-a2ui-error"]').count()) throw new Error('表示定義を描画できません');
      return await page.screenshot({ type: 'jpeg', quality: 90 });
    } finally {
      await browser.close();
    }
  }
}
