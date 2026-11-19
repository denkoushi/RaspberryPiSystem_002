import type { ProcedureManualPrintPayload } from '@raspi-system/shared-types';
import sharp from 'sharp';
import { afterAll, describe, expect, it, vi } from 'vitest';

import { AssemblyProcedureImageStorage } from '../../../lib/assembly-procedure-image-storage.js';
import { closeSharedChromium, getSharedChromium } from '../../signage/loan-grid/playwright/playwright-browser-pool.js';
import { assembleProcedureManualPdf, procedureManualPdfRenderer } from '../procedure-manual-pdf.js';

function expectImageOnlyA4(pdf: Buffer) {
  const contents = pdf.toString('latin1');
  expect(contents.startsWith('%PDF-')).toBe(true);
  expect(contents).not.toMatch(/\/(?:JavaScript|JS|EmbeddedFile|AcroForm|Annots|URI|Font)\b/);
  expect(contents.match(/\/Subtype \/Image\b/g)).toHaveLength(2);
  expect(contents.match(/\/Type \/Page\b/g)).toHaveLength(2);
  const sizes = Array.from(contents.matchAll(/\/MediaBox\s*\[0\s+0\s+([\d.]+)\s+([\d.]+)\]/g),
    ([, width, height]) => [Number(width), Number(height)]);
  expect(sizes).toHaveLength(2);
  expect(sizes[0]![0]).toBeCloseTo(595, -1);
  expect(sizes[0]![1]).toBeCloseTo(842, -1);
  expect(sizes[1]![0]).toBeCloseTo(842, -1);
  expect(sizes[1]![1]).toBeCloseTo(595, -1);
}

describe('procedure manual image-only PDF', () => {
  afterAll(closeSharedChromium);

  it('gives the PDF context only inline JPEGs and disables script, external requests and tagging', async () => {
    const jpeg = Buffer.from('jpeg bytes');
    const page = { setContent: vi.fn(), pdf: vi.fn(), close: vi.fn().mockResolvedValue(undefined) };
    const context = { route: vi.fn(), newPage: async () => page, close: vi.fn() };
    const browser = { newContext: vi.fn(async () => context) } as unknown as Awaited<ReturnType<typeof getSharedChromium>>;
    await assembleProcedureManualPdf(browser, [{ jpeg, landscape: false }, { jpeg, landscape: true }]);
    expect(browser.newContext).toHaveBeenCalledWith({ javaScriptEnabled: false, serviceWorkers: 'block' });
    expect(context.route).toHaveBeenCalledWith('**/*', expect.any(Function));
    const abort = vi.fn();
    await context.route.mock.calls[0]?.[1]({ abort });
    expect(abort).toHaveBeenCalledOnce();
    const html = page.setContent.mock.calls[0]?.[0] as string;
    expect(html.match(/<img src="data:image\/jpeg;base64,/g)).toHaveLength(2);
    expect(html).not.toMatch(/<(?:script|a|form|object|embed)\b/);
    expect(page.pdf).toHaveBeenCalledWith(expect.objectContaining({ tagged: false, outline: false, preferCSSPageSize: true }));
    expect(page.close).toHaveBeenCalledOnce();
    expect(context.close).toHaveBeenCalledOnce();
  });

  // API unit CI does not install Chromium. Run this with the bundled browser available.
  it.runIf(process.env.PROCEDURE_MANUAL_PDF_BROWSER_TEST === '1')('creates a real image-only mixed A4 PDF', async () => {
    const browser = await getSharedChromium();
    const jpeg = await sharp({ create: { width: 42, height: 60, channels: 3, background: '#227766' } }).jpeg().toBuffer();
    const wideJpeg = await sharp({ create: { width: 60, height: 42, channels: 3, background: '#771122' } }).jpeg().toBuffer();
    expectImageOnlyA4(await assembleProcedureManualPdf(browser, [
      { jpeg, landscape: false },
      { jpeg: wideJpeg, landscape: true },
    ]));
  });

  it.runIf(Boolean(process.env.PROCEDURE_MANUAL_PRINT_TEST_BASE_URL))('captures the real Web print entry without an authenticated storage request', async () => {
    const env = (await import('../../../config/env.js')).env;
    const originalBaseUrl = env.SIGNAGE_WEB_CAPTURE_BASE_URL;
    env.SIGNAGE_WEB_CAPTURE_BASE_URL = process.env.PROCEDURE_MANUAL_PRINT_TEST_BASE_URL;
    const pageUrl = '/api/storage/assembly-procedure-images/print-test.png';
    const widePageUrl = '/api/storage/assembly-procedure-images/print-test-wide.png';
    const readImage = vi.spyOn(AssemblyProcedureImageStorage, 'readImage').mockImplementation(async (url) => {
      const landscape = url === widePageUrl;
      return {
        contentType: 'image/png',
        buffer: await sharp({ create: {
          width: landscape ? 360 : 240, height: landscape ? 240 : 360, channels: 3, background: '#207555',
        } }).png().toBuffer(),
      };
    });
    const payload: ProcedureManualPrintPayload = {
      title: '組立要領書', revisionLabel: '第2版(改版 2026-11-18)', pageLabel: '1 / 2',
      informationLabel: '2026-11-19 10:01 時点の情報です。最新版はキオスクで確認してください。',
      outputLabel: '出力 2026-11-19 10:01 社員番号 001 組立端末 山田 花子',
      watermark: '控え 2026-11-19 社員番号 001',
      pageUrl, crop: null, overlays: [], assets: {},
    };
    try {
      const pdf = await procedureManualPdfRenderer.render([
        payload,
        { ...payload, pageUrl: widePageUrl, pageLabel: '2 / 2', crop: { xRatio: 0.2, yRatio: 0, widthRatio: 0.3, heightRatio: 1 } },
      ], { quality: 90, scale: 1 });
      expectImageOnlyA4(pdf);
      expect(readImage.mock.calls).toEqual([[pageUrl], [widePageUrl]]);
    } finally {
      readImage.mockRestore();
      env.SIGNAGE_WEB_CAPTURE_BASE_URL = originalBaseUrl;
    }
  });
});
