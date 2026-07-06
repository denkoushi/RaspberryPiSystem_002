#!/usr/bin/env node
/**
 * 自主検査セッションで ?w= 付き図面リクエストを確認する Playwright スクリプト。
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '../..');
const outputDir = path.join(repoRoot, 'tmp/perf-results/browser-verify');

const WEB_BASE = (process.env.PERF_WEB_BASE_URL ?? 'http://localhost:4173').replace(/\/$/, '');
const SESSION_ID = process.env.PERF_SELF_INSPECTION_SESSION_ID ?? '7b94d3b0-6778-44ac-a646-6fa988aa8966';
const CLIENT_KEY = process.env.PERF_CLIENT_KEY?.trim() ?? 'client-key-raspberrypi4-kiosk1';
const CLIENT_KEY_STORAGE = 'kiosk-client-key';

async function main() {
  await mkdir(outputDir, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    userAgent:
      'Mozilla/5.0 (X11; Linux aarch64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  });

  const drawingRequests = [];
  context.on('request', (request) => {
    const url = request.url();
    if (url.includes('/api/storage/part-measurement-drawings/')) {
      drawingRequests.push({
        url,
        method: request.method(),
      });
    }
  });

  const page = await context.newPage();
  await page.addInitScript(
    ({ storageKey, clientKey }) => {
      localStorage.setItem(storageKey, JSON.stringify(clientKey));
    },
    { storageKey: CLIENT_KEY_STORAGE, clientKey: CLIENT_KEY },
  );

  const targetUrl = `${WEB_BASE}/kiosk/part-measurement/self-inspection/sessions/${SESSION_ID}`;
  await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 120_000 });
  await page.waitForFunction(
    () => {
      const isVisibleLoadedImage = (img) => {
        if (!(img instanceof HTMLImageElement)) return false;
        if (img.naturalWidth <= 0 || img.naturalHeight <= 0) return false;
        const rect = img.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return false;
        const style = window.getComputedStyle(img);
        if (style.visibility === 'hidden' || style.display === 'none') return false;
        if (parseFloat(style.opacity) <= 0) return false;
        return true;
      };
      for (const img of document.querySelectorAll('img')) {
        if (isVisibleLoadedImage(img)) return true;
      }
      return false;
    },
    undefined,
    { timeout: 120_000 },
  );

  const screenshotPath = path.join(outputDir, 'self-inspection-drawing.png');
  await page.screenshot({ path: screenshotPath, fullPage: false });

  const networkLogPath = path.join(outputDir, 'drawing-network.json');
  await writeFile(networkLogPath, JSON.stringify(drawingRequests, null, 2));

  await browser.close();

  const derivativeRequests = drawingRequests.filter((r) => r.url.includes('?w='));
  console.log(`target=${targetUrl}`);
  console.log(`screenshot=${screenshotPath}`);
  console.log(`networkLog=${networkLogPath}`);
  console.log(`drawingRequests=${drawingRequests.length}`);
  console.log(`derivativeRequests=${derivativeRequests.length}`);
  for (const req of drawingRequests) {
    console.log(`  ${req.method} ${req.url}`);
  }

  if (derivativeRequests.length === 0) {
    process.exitCode = 1;
    console.error('ERROR: no ?w= drawing request observed');
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
