import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { chromium, type Route } from 'playwright';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../signage/loan-grid/playwright/playwright-browser-pool.js', () => ({
  getSharedChromium: vi.fn(),
}));
vi.mock('../../../lib/logger.js', () => ({ logger: { error: vi.fn() } }));

import { getSharedChromium } from '../../signage/loan-grid/playwright/playwright-browser-pool.js';
import { probePlaywrightChromiumAvailability } from '../../signage/loan-grid/playwright/playwright-chromium-availability.js';
import { PlaywrightHtmlToPdfAdapter } from '../adapters/playwright-html-to-pdf.adapter.js';

const availability = await probePlaywrightChromiumAvailability();

describe('PlaywrightHtmlToPdfAdapter', () => {
  const pdfBuffer = Buffer.from('%PDF-1.4 mock');
  const page = {
    setContent: vi.fn(),
    pdf: vi.fn(),
    close: vi.fn(),
  };
  const context = {
    route: vi.fn(),
    newPage: vi.fn(),
    close: vi.fn(),
  };
  const browser = { newContext: vi.fn() };

  beforeEach(() => {
    vi.resetAllMocks();
    page.setContent.mockResolvedValue(undefined);
    page.pdf.mockResolvedValue(pdfBuffer);
    page.close.mockResolvedValue(undefined);
    context.route.mockResolvedValue(undefined);
    context.newPage.mockResolvedValue(page);
    context.close.mockResolvedValue(undefined);
    browser.newContext.mockResolvedValue(context);
    vi.mocked(getSharedChromium).mockResolvedValue(browser as unknown as Awaited<ReturnType<typeof getSharedChromium>>);
  });

  it('disables scripts and blocks every request before loading mail HTML', async () => {
    const html = '<html><body><p>hello</p></body></html>';

    await expect(new PlaywrightHtmlToPdfAdapter().convert(html)).resolves.toBe(pdfBuffer);

    expect(browser.newContext).toHaveBeenCalledWith({
      viewport: { width: 1280, height: 720 },
      javaScriptEnabled: false,
    });
    expect(context.route).toHaveBeenCalledWith('**/*', expect.any(Function));
    const handler = context.route.mock.calls[0][1] as (route: Route) => Promise<void>;
    const abort = vi.fn().mockResolvedValue(undefined);
    await handler({ abort } as unknown as Route);
    expect(abort).toHaveBeenCalledWith('blockedbyclient');
    expect(context.route.mock.invocationCallOrder[0]).toBeLessThan(page.setContent.mock.invocationCallOrder[0]);
    expect(page.setContent).toHaveBeenCalledWith(html, {
      waitUntil: 'domcontentloaded',
      timeout: expect.any(Number),
    });
    expect(page.pdf).toHaveBeenCalledWith({
      format: 'A4',
      printBackground: true,
      margin: { top: '8mm', bottom: '8mm', left: '8mm', right: '8mm' },
    });
    expect(page.close).toHaveBeenCalledOnce();
    expect(context.close).toHaveBeenCalledOnce();
  });

  it('closes the page and context even when PDF generation throws', async () => {
    const error = new Error('PDF generation failed');
    page.pdf.mockRejectedValue(error);

    await expect(new PlaywrightHtmlToPdfAdapter().convert('<p>hello</p>')).rejects.toBe(error);

    expect(page.close).toHaveBeenCalledOnce();
    expect(context.close).toHaveBeenCalledOnce();
  });

  it.skipIf(!availability.available)('renders a PDF without sending requests to a local server', async () => {
    let requests = 0;
    const server = createServer((_request, response) => {
      requests += 1;
      response.end('unexpected network request');
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    let realBrowser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
    try {
      realBrowser = await chromium.launch({ headless: true });
      vi.mocked(getSharedChromium).mockResolvedValue(realBrowser);
      const port = (server.address() as AddressInfo).port;
      const html = `<html><body><img src="http://127.0.0.1:${port}/x.png"><script>document.body.innerHTML='pwned'</script><p>hello</p></body></html>`;

      const result = await new PlaywrightHtmlToPdfAdapter().convert(html);

      expect(Buffer.isBuffer(result)).toBe(true);
      expect(result.subarray(0, 4).toString()).toBe('%PDF');
      expect(requests).toBe(0);
    } finally {
      await realBrowser?.close();
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });
});
