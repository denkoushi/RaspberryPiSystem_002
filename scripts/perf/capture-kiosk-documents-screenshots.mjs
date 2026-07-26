#!/usr/bin/env node
/**
 * キオスク要領書関連ページのスクリーンショット取得。
 */

import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '../..');
const outDir = path.join(repoRoot, 'tmp/perf-results/screenshots');

const WEB_BASE = (process.env.PERF_WEB_BASE_URL ?? 'http://localhost:4173').replace(/\/$/, '');
const CLIENT_KEY = process.env.PERF_CLIENT_KEY?.trim() ?? 'client-key-raspberrypi4-kiosk1';
const CLIENT_KEY_STORAGE = 'kiosk-client-key';
const NAV_TIMEOUT_MS = 180_000;

async function withKioskPage(run) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  await context.addInitScript(
    ({ key, storageKey }) => {
      localStorage.setItem(storageKey, key);
    },
    { key: CLIENT_KEY, storageKey: CLIENT_KEY_STORAGE },
  );
  const page = await context.newPage();
  try {
    await run(page);
  } finally {
    await browser.close();
  }
}

async function main() {
  await mkdir(outDir, { recursive: true });

  await withKioskPage(async (page) => {
    await page.goto(`${WEB_BASE}/kiosk-documents`, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
    await page.getByRole('button').first().waitFor({ timeout: NAV_TIMEOUT_MS });
    await page.screenshot({ path: path.join(outDir, 'kiosk-documents-tab.png'), fullPage: true });
    console.log('saved kiosk-documents-tab.png');
  });

  await withKioskPage(async (page) => {
    await page.goto(`${WEB_BASE}/kiosk/assembly/library?focus=templates&modelCode=PERF-MACHINE-A`, {
      waitUntil: 'domcontentloaded',
      timeout: NAV_TIMEOUT_MS,
    });
    await page.getByRole('heading', { name: '組立 手順書/テンプレート管理' }).waitFor({
      timeout: NAV_TIMEOUT_MS,
    });
    await page.screenshot({ path: path.join(outDir, 'assembly-template-library.png'), fullPage: true });
    console.log('saved assembly-template-library.png');
  });

  await withKioskPage(async (page) => {
    const manifest = await import('node:fs/promises').then((m) =>
      m.readFile(path.join(repoRoot, 'tmp/perf-storage/perf-seed-manifest.json'), 'utf8').then(JSON.parse),
    );
    const sessionId = manifest.assemblyWorkSessionId;
    await page.goto(`${WEB_BASE}/kiosk/assembly/work-sessions/${sessionId}`, {
      waitUntil: 'domcontentloaded',
      timeout: NAV_TIMEOUT_MS,
    });
    await page.locator('img').first().waitFor({ timeout: NAV_TIMEOUT_MS });
    await page.screenshot({ path: path.join(outDir, 'assembly-work-session.png'), fullPage: true });
    console.log('saved assembly-work-session.png');
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
