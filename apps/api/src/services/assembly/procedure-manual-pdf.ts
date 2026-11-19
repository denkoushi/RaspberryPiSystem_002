import { projectOverlayElementToCrop, type ProcedureManualPrintPayload } from '@raspi-system/shared-types';
import sharp from 'sharp';
import type { Browser } from 'playwright';

import { env } from '../../config/env.js';
import { AssemblyProcedureImageStorage } from '../../lib/assembly-procedure-image-storage.js';
import { ASSEMBLY_PROCEDURE_ASSET_URL_PREFIX } from '../assembly-procedure-assets/assembly-procedure-asset-storage.port.js';
import { getAssemblyProcedureAssetStorage } from '../assembly-procedure-assets/local-assembly-procedure-asset-storage.adapter.js';
import { getSharedChromium } from '../signage/loan-grid/playwright/playwright-browser-pool.js';

export type PdfProfile = { quality: number; scale: number };
export type PdfPageImage = { jpeg: Buffer; landscape: boolean };
type ImageResponse = { buffer: Buffer; contentType: string };

export interface ProcedureManualPdfRenderer {
  render(pages: ProcedureManualPrintPayload[], profile: PdfProfile): Promise<Buffer>;
}

const imagePrefix = '/api/storage/assembly-procedure-images/';
const portraitViewport = { width: 794, height: 1123 };
const landscapeViewport = { width: 1123, height: 794 };

export async function assembleProcedureManualPdf(browser: Browser, images: PdfPageImage[]): Promise<Buffer> {
  const context = await browser.newContext({ javaScriptEnabled: false, serviceWorkers: 'block' });
  try {
    await context.route('**/*', (route) => route.abort());
    const page = await context.newPage();
    try {
      const tags = images.map(({ jpeg, landscape }) =>
        `<section class="${landscape ? 'landscape' : 'portrait'}"><img src="data:image/jpeg;base64,${jpeg.toString('base64')}"></section>`
      ).join('');
      await page.setContent(`<!doctype html><meta charset="utf-8"><style>
        @page portrait { size: A4 portrait; margin: 0; }
        @page landscape { size: A4 landscape; margin: 0; }
        html, body { margin: 0; padding: 0; }
        section { break-after: page; }
        section:last-child { break-after: auto; }
        .portrait { page: portrait; }
        .landscape { page: landscape; }
        img { display: block; width: 100%; height: 296.5mm; }
        .landscape img { height: 209.5mm; }
        </style>${tags}`, { waitUntil: 'load' });
      return await page.pdf({ preferCSSPageSize: true, printBackground: true, tagged: false, outline: false });
    } finally {
      await page.close().catch(() => undefined);
    }
  } finally {
    await context.close();
  }
}

async function capturePages(
  browser: Browser,
  printUrl: URL,
  pages: ProcedureManualPrintPayload[],
  profile: PdfProfile
): Promise<PdfPageImage[]> {
  const context = await browser.newContext({
    viewport: portraitViewport,
    deviceScaleFactor: profile.scale,
    serviceWorkers: 'block',
    ignoreHTTPSErrors: printUrl.protocol === 'https:' && printUrl.hostname === 'gateway',
  });
  let sources = new Map<string, () => Promise<ImageResponse>>();
  let storageError: unknown;

  try {
    await context.routeWebSocket('**/*', (socket) => socket.close());
    await context.route('**/*', async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.origin !== printUrl.origin || request.method() !== 'GET') return route.abort();

      const readImage = sources.get(url.pathname);
      if (readImage) {
        try {
          const { buffer, contentType } = await readImage();
          return await route.fulfill({ body: buffer, contentType });
        } catch (error) {
          storageError = error;
          return route.abort();
        }
      }

      if (url.href !== printUrl.href
        && !['script', 'stylesheet', 'font'].includes(request.resourceType())) return route.abort();
      if (url.pathname.startsWith('/api/')) return route.abort();

      // Keep redirects inside the same interception boundary.
      const response = await route.fetch({
        maxRedirects: 0,
        timeout: 15_000,
        // Avoid serving decompressed bytes with the Web slot's encoding header.
        headers: { ...request.headers(), 'accept-encoding': 'identity' },
      });
      try {
        if (response.status() >= 300 && response.status() < 400) return route.abort();
        await route.fulfill({ response });
      } finally {
        await response.dispose();
      }
    });

    const page = await context.newPage();
    page.setDefaultTimeout(15_000);
    try {
      await page.goto(printUrl.href, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => 'renderProcedureManualPrint' in window);
      const captures: PdfPageImage[] = [];
      for (const print of pages) {
        if (!print.pageUrl.startsWith(imagePrefix)) throw new Error('Invalid procedure page image URL');
        const image = await AssemblyProcedureImageStorage.readImage(print.pageUrl);
        const { width, height } = (await sharp(image.buffer).metadata()).autoOrient;
        const landscape = width > height;
        await page.setViewportSize(landscape ? landscapeViewport : portraitViewport);
        sources = new Map([[print.pageUrl, async () => image]]);
        const visibleImageIds: string[] = [];
        for (const overlay of print.overlays) {
          if (overlay.kind !== 'IMAGE' || !overlay.assetId) continue;
          if (print.crop && !projectOverlayElementToCrop(overlay, print.crop)) continue;

          const asset = print.assets[overlay.assetId];
          if (!asset?.url.startsWith(ASSEMBLY_PROCEDURE_ASSET_URL_PREFIX) || !asset.contentType.startsWith('image/')) {
            throw new Error('Missing procedure overlay image');
          }
          sources.set(asset.url, async () => ({
            buffer: await getAssemblyProcedureAssetStorage().read({ storageKey: asset.storageKey }),
            contentType: asset.contentType,
          }));
          visibleImageIds.push(overlay.id);
        }

        await page.evaluate((payload) => {
          (window as typeof window & {
            renderProcedureManualPrint: (page: typeof payload) => void;
          }).renderProcedureManualPrint(payload);
        }, print);
        await page.waitForFunction((overlayIds) => {
          const root = document.querySelector('[data-procedure-print]');
          const image = root?.querySelector<HTMLImageElement>('[data-testid="assembly-procedure-crop-view"] img, [data-testid="assembly-procedure-full-page-view"] img');
          const loaded = (img?: HTMLImageElement | null) => Boolean(img?.complete && img.naturalWidth > 0);
          if (!loaded(image)) return false;
          const overlays = new Map(Array.from(root!.querySelectorAll<HTMLElement>('[data-overlay-id]'),
            (element) => [element.dataset.overlayId, element]));
          return overlayIds.every((id) => loaded(overlays.get(id)?.querySelector('img')));
        }, visibleImageIds);
        await page.evaluate(async () => {
          await document.fonts.ready;
          await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
        });
        const jpeg = await page.screenshot({ type: 'jpeg', quality: profile.quality, animations: 'disabled' });
        captures.push({ jpeg, landscape });
      }
      return captures;
    } catch (error) {
      throw storageError ?? error;
    } finally {
      await page.close().catch(() => undefined);
    }
  } finally {
    await context.close();
  }
}

export const procedureManualPdfRenderer: ProcedureManualPdfRenderer = {
  async render(pages, profile) {
    const baseUrl = env.SIGNAGE_WEB_CAPTURE_BASE_URL || process.env.BUSINESS_HERMES_WEB_BASE_URL?.trim();
    if (!baseUrl) throw new Error('Procedure print Web base URL is not configured');
    const printUrl = new URL('/assembly-procedure-print.html', baseUrl);
    const browser = await getSharedChromium();
    const images = await capturePages(browser, printUrl, pages, profile);
    return assembleProcedureManualPdf(browser, images);
  }
};
