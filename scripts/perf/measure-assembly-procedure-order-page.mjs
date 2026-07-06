#!/usr/bin/env node
/**
 * 組立閲覧順設定ページの一覧表示時間（Playwright）。
 *
 * 実行例:
 *   node scripts/perf/measure-assembly-procedure-order-page.mjs
 */

import { chromium } from 'playwright';

const WEB_BASE = (process.env.PERF_WEB_BASE_URL ?? 'http://localhost:4173').replace(/\/$/, '');
const CLIENT_KEY = process.env.PERF_CLIENT_KEY?.trim() ?? 'client-key-raspberrypi4-kiosk1';
const CLIENT_KEY_STORAGE = 'kiosk-client-key';
const RUNS = 3;
const NAV_TIMEOUT_MS = 180_000;

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

async function measureOnce(page) {
  const url = `${WEB_BASE}/kiosk/assembly/procedure-order-settings?machineName=PERF-MACHINE-A`;
  const navStart = performance.now();
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
  await page.getByPlaceholder('パスワード').fill('2520');
  await page.getByRole('button', { name: '認証' }).click();
  await page.getByRole('heading', { name: 'PDF要領書' }).waitFor({ timeout: NAV_TIMEOUT_MS });
  await page.getByRole('button').filter({ hasText: /PERF-DOC-/ }).first().waitFor({ timeout: NAV_TIMEOUT_MS });
  return Math.round(performance.now() - navStart);
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const samples = [];
  for (let i = 0; i < RUNS; i += 1) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    await context.addInitScript(
      ({ key, storageKey }) => {
        localStorage.setItem(storageKey, key);
      },
      { key: CLIENT_KEY, storageKey: CLIENT_KEY_STORAGE },
    );
    const page = await context.newPage();
    const ms = await measureOnce(page);
    samples.push(ms);
    console.log(`run ${i + 1}/${RUNS}: ${ms}ms`);
    await context.close();
  }
  await browser.close();
  console.log(`median: ${Math.round(median(samples))}ms`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
