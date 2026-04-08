import { logger } from '../../../lib/logger.js';
import { getSharedChromium } from '../../signage/loan-grid/playwright/playwright-browser-pool.js';
import type { HtmlToPdfPort } from '../ports/html-to-pdf.port.js';

function resolveTimeoutMs(): number {
  const raw = process.env.KIOSK_DOCUMENT_HTML_TO_PDF_TIMEOUT_MS;
  if (!raw) {
    return 120000;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 120000;
}

/**
 * Playwright / Chromium で HTML をレンダリングし PDF 化する。
 * API イメージでは `playwright install chromium` 済みを前提（サイネージ `playwright_html` と同系）。
 */
export class PlaywrightHtmlToPdfAdapter implements HtmlToPdfPort {
  async convert(html: string): Promise<Buffer> {
    const browser = await getSharedChromium();
    const context = await browser.newContext({
      viewport: { width: 1280, height: 720 },
    });
    const page = await context.newPage();
    try {
      await page.setContent(html, {
        waitUntil: 'domcontentloaded',
        timeout: resolveTimeoutMs(),
      });
      const pdfBuffer = await page.pdf({
        format: 'A4',
        printBackground: true,
        margin: { top: '8mm', bottom: '8mm', left: '8mm', right: '8mm' },
      });
      return Buffer.isBuffer(pdfBuffer) ? pdfBuffer : Buffer.from(pdfBuffer);
    } catch (err) {
      logger?.error({ err }, '[PlaywrightHtmlToPdf] conversion failed');
      throw err;
    } finally {
      await page.close().catch(() => undefined);
      await context.close().catch(() => undefined);
    }
  }
}
