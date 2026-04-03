import { env } from '../../../../config/env.js';
import { logger } from '../../../../lib/logger.js';
import type { LoanGridLayerResult, LoanGridRasterizerPort, LoanGridRenderRequest } from '../loan-grid-rasterizer.port.js';
import { buildLoanGridHtmlDocument } from '../html/loan-grid-document.js';
import { getSharedChromium } from './playwright-browser-pool.js';

/**
 * HTML/CSS layout in headless Chromium, PNG for embedding in parent SVG.
 *
 * Integration / E2E: requires Chromium installed (`pnpm exec playwright install chromium`).
 * CI may stay on svg_legacy; see create-loan-grid-rasterizer.ts.
 */
export class PlaywrightLoanGridRasterizer implements LoanGridRasterizerPort {
  async render(request: LoanGridRenderRequest): Promise<LoanGridLayerResult> {
    const { config, layout } = request;
    const w = Math.max(1, Math.ceil(config.width));
    const h = Math.max(1, Math.ceil(config.height));
    const html = buildLoanGridHtmlDocument(request);

    const browser = await getSharedChromium();
    const context = await browser.newContext({
      viewport: { width: w, height: h },
      deviceScaleFactor: env.SIGNAGE_PLAYWRIGHT_DEVICE_SCALE_FACTOR,
    });

    const page = await context.newPage();
    try {
      await page.setContent(html, { waitUntil: 'domcontentloaded' });
      const pngBuffer = await page.screenshot({
        type: 'png',
        omitBackground: true,
      });
      return {
        kind: 'raster_png',
        pngBuffer: Buffer.isBuffer(pngBuffer) ? pngBuffer : Buffer.from(pngBuffer),
        overflowCount: layout.overflowCount,
      };
    } catch (err) {
      logger.error({ err, w, h }, 'Playwright loan grid raster failed');
      throw err;
    } finally {
      await page.close().catch(() => undefined);
      await context.close().catch(() => undefined);
    }
  }
}
