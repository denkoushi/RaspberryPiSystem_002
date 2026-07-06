#!/usr/bin/env node
/**
 * キオスク UI パフォーマンス計測ハーネス（Playwright + fetch）
 *
 * 実行例:
 *   node scripts/perf/measure-kiosk-perf.mjs
 *   node scripts/perf/measure-kiosk-perf.mjs tmp/perf-results/after.json
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '../..');

const WEB_BASE = (process.env.PERF_WEB_BASE_URL ?? 'http://localhost:4173').replace(/\/$/, '');
const API_BASE = (process.env.PERF_API_BASE_URL ?? 'http://localhost:8080/api').replace(/\/$/, '');
const CLIENT_KEY = process.env.PERF_CLIENT_KEY?.trim() ?? 'client-key-raspberrypi4-kiosk1';
const CLIENT_KEY_STORAGE = 'kiosk-client-key';

const DEFAULT_OUTPUT = path.join(repoRoot, 'tmp/perf-results/baseline.json');
const MANIFEST_PATH = path.join(repoRoot, 'tmp/perf-storage/perf-seed-manifest.json');

const RUNS = 3;
const NAV_TIMEOUT_MS = 180_000;
const WAIT_TIMEOUT_MS = 180_000;
const VIEWPORT = { width: 1280, height: 720 };
/** Pi キオスク相当（Mac UA だと leader board が targetDeviceScopeKey を付与して API 400 になる） */
const KIOSK_USER_AGENT =
  'Mozilla/5.0 (X11; Linux aarch64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const PERF_RESOURCE_CDS = ['1', '2', '3', '4', '5', '6'];

/** @typedef {{ siteKey: string; deviceScopeKey: string; resourceCds: string[]; slotsStorageKey: string; deviceScopeStorageKey: string }} LeaderBoardBootstrap */

/** @typedef {{ cold: number; warm: number[]; median: number; unit?: string }} MsScenarioResult */
/** @typedef {{ ttfbMs: number; totalMs: number; bytes: number }} ApiTimingSample */
/** @typedef {{ cold: ApiTimingSample; warm: ApiTimingSample[]; median: ApiTimingSample }} ApiScenarioResult */

/**
 * @param {number[]} values
 */
function median(values) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * @param {ApiTimingSample[]} samples
 */
function medianApiSample(samples) {
  return {
    ttfbMs: Math.round(median(samples.map((s) => s.ttfbMs))),
    totalMs: Math.round(median(samples.map((s) => s.totalMs))),
    bytes: Math.round(median(samples.map((s) => s.bytes))),
  };
}

/**
 * @param {number[]} samples
 * @returns {MsScenarioResult}
 */
function buildMsScenarioResult(samples) {
  const cold = samples[0] ?? 0;
  const warm = samples.slice(1);
  return {
    cold: Math.round(cold),
    warm: warm.map((v) => Math.round(v)),
    median: Math.round(median(samples)),
    unit: 'ms',
  };
}

/**
 * @param {ApiTimingSample[]} samples
 * @returns {ApiScenarioResult}
 */
function buildApiScenarioResult(samples) {
  return {
    cold: samples[0],
    warm: samples.slice(1),
    median: medianApiSample(samples),
  };
}

/**
 * @returns {Promise<LeaderBoardBootstrap>}
 */
async function resolveLeaderBoardBootstrap() {
  const candidateSites = ['工場入口', '第2工場', 'トークプラザ', '第1工場'];
  for (const siteKey of candidateSites) {
    const res = await fetch(
      `${API_BASE}/kiosk/production-schedule/manual-order/site-devices?siteKey=${encodeURIComponent(siteKey)}`,
      { headers: { 'x-client-key': CLIENT_KEY } },
    );
    if (!res.ok) continue;
    const data = await res.json();
    const deviceScopeKey = data.deviceScopeKeys?.[0]?.trim?.() ?? '';
    if (!deviceScopeKey) continue;
    const slotsScopeKey = `${siteKey}\0${deviceScopeKey}`;
    return {
      siteKey,
      deviceScopeKey,
      resourceCds: PERF_RESOURCE_CDS,
      slotsStorageKey: `kiosk-leader-order-board-resource-slots:${slotsScopeKey}`,
      deviceScopeStorageKey: `kiosk-leader-order-board-active-device-scope:${siteKey}`,
    };
  }
  throw new Error('順位ボード用の siteKey / deviceScopeKey を API から解決できませんでした');
}

/**
 * @param {LeaderBoardBootstrap} bootstrap
 */
function buildLeaderBoardLocalStoragePayload(bootstrap) {
  const slotsScopeKey = `${bootstrap.siteKey}\0${bootstrap.deviceScopeKey}`;
  return {
    'manual-order-page-site': bootstrap.siteKey,
    [bootstrap.deviceScopeStorageKey]: JSON.stringify({
      schemaVersion: 1,
      deviceScopeKey: bootstrap.deviceScopeKey,
    }),
    [`kiosk-leader-order-board-resource-slots:${slotsScopeKey}`]: JSON.stringify({
      schemaVersion: 1,
      slotCount: bootstrap.resourceCds.length,
      resourceCdBySlotIndex: bootstrap.resourceCds,
    }),
    'leader-order-board-search-conditions': JSON.stringify({
      schemaVersion: 1,
      conditions: {
        activeQueries: [],
        activeResourceCds: [],
        activeResourceAssignedOnlyCds: [],
        hasNoteOnlyFilter: false,
        hasDueDateOnlyFilter: false,
        // 研削/切削を両方 ON にすると resourceCategory なしで全 PERF 行を取得できる
        showGrindingResources: true,
        showCuttingResources: true,
        selectedMachineName: '',
        selectedPartName: '',
        inputQuery: '',
      },
    }),
  };
}

/**
 * @param {import('playwright').Browser} browser
 * @param {Record<string, string>} leaderBoardStorage
 * @param {(page: import('playwright').Page) => Promise<void>} fn
 */
async function withFreshKioskPage(browser, leaderBoardStorage, fn) {
  const context = await browser.newContext({
    viewport: VIEWPORT,
    userAgent: KIOSK_USER_AGENT,
  });
  await context.addInitScript(
    ({ storageKey, key, leaderBoardEntries }) => {
      window.localStorage.setItem(storageKey, JSON.stringify(key));
      for (const [entryKey, entryValue] of Object.entries(leaderBoardEntries)) {
        window.localStorage.setItem(entryKey, entryValue);
      }
    },
    {
      storageKey: CLIENT_KEY_STORAGE,
      key: CLIENT_KEY,
      leaderBoardEntries: leaderBoardStorage,
    },
  );
  const page = await context.newPage();
  page.setDefaultTimeout(WAIT_TIMEOUT_MS);
  page.setDefaultNavigationTimeout(NAV_TIMEOUT_MS);
  try {
    await fn(page);
  } finally {
    await context.close();
  }
}

/** @returns {Promise<number>} elapsed ms from navigation start */
async function gotoAndMeasure(page, url) {
  const start = Date.now();
  await page.goto(url, { waitUntil: 'commit' });
  return start;
}

function countLeaderboardRowsScript() {
  let count = 0;
  for (const body of document.querySelectorAll('[data-testid="leader-order-resource-card-body"]')) {
    const virtualRows = body.querySelectorAll('[data-testid="leader-order-resource-card-virtual-row"]');
    if (virtualRows.length > 0) {
      count += virtualRows.length;
      continue;
    }
    count += body.querySelectorAll(':scope > div.pb-1, :scope > div.relative > div.pb-1').length;
  }
  return count;
}

function isDrawingImageReadyScript() {
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
}

/**
 * @param {import('playwright').Page} page
 * @param {number} navStartMs
 */
async function waitForFirstLeaderboardRow(page, navStartMs) {
  await page.waitForFunction(countLeaderboardRowsScript, undefined, { timeout: WAIT_TIMEOUT_MS });
  return Date.now() - navStartMs;
}

/**
 * @param {import('playwright').Page} page
 * @param {number} navStartMs
 */
async function waitForLeaderboardFullStable(page, navStartMs) {
  await page.waitForFunction(countLeaderboardRowsScript, undefined, { timeout: WAIT_TIMEOUT_MS });
  await page.waitForFunction(
    () => {
      const text = document.body.innerText;
      if (text.includes('一覧を更新中です。')) return false;
      if (text.includes('詳細情報を更新中です。')) return false;
      const main = document.querySelector('main');
      if (main?.textContent?.includes('読み込み中…')) return false;
      let count = 0;
      for (const body of document.querySelectorAll('[data-testid="leader-order-resource-card-body"]')) {
        const virtualRows = body.querySelectorAll('[data-testid="leader-order-resource-card-virtual-row"]');
        if (virtualRows.length > 0) {
          count += virtualRows.length;
          continue;
        }
        count += body.querySelectorAll(':scope > div.pb-1, :scope > div.relative > div.pb-1').length;
      }
      return count > 0;
    },
    undefined,
    { timeout: WAIT_TIMEOUT_MS, polling: 200 },
  );
  return Date.now() - navStartMs;
}

function assemblyImageReadyScript() {
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

  const el = document.querySelector('img[src*="pdf-pages"]');
  if (!(el instanceof HTMLImageElement)) return false;
  if (isVisibleLoadedImage(el)) return true;

  return new Promise((resolve) => {
    const src = el.currentSrc || el.src;
    if (!src) {
      resolve(false);
      return;
    }
    const probe = new Image();
    probe.onload = () => resolve(isVisibleLoadedImage(probe));
    probe.onerror = () => resolve(false);
    probe.src = src;
  });
}

/**
 * @param {import('playwright').Page} page
 * @param {number} navStartMs
 */
async function waitForDrawingImageReady(page, navStartMs) {
  await page.waitForFunction(isDrawingImageReadyScript, undefined, { timeout: WAIT_TIMEOUT_MS });
  return Date.now() - navStartMs;
}

/**
 * @param {import('playwright').Page} page
 * @param {number} navStartMs
 */
async function waitForAssemblyFirstPage(page, navStartMs) {
  await page.waitForFunction(assemblyImageReadyScript, undefined, {
    timeout: WAIT_TIMEOUT_MS,
    polling: 200,
  });
  return Date.now() - navStartMs;
}

/**
 * @param {import('playwright').Page} page
 */
async function waitForAssemblyNextPage(page) {
  const clickStart = Date.now();
  const prevSrc = await page.locator('img[src*="pdf-pages"]').first().getAttribute('src');
  const nextButton = page.getByRole('button', { name: '次頁' });
  await nextButton.waitFor({ state: 'visible', timeout: WAIT_TIMEOUT_MS });
  await nextButton.click();
  await page.waitForFunction(
    (expectedPrev) => {
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

      const el = document.querySelector('img[src*="pdf-pages"]');
      if (!(el instanceof HTMLImageElement)) return false;
      const src = el.currentSrc || el.src;
      if (!src || src === expectedPrev) return false;
      if (isVisibleLoadedImage(el)) return true;

      return new Promise((resolve) => {
        const probe = new Image();
        probe.onload = () => resolve(isVisibleLoadedImage(probe));
        probe.onerror = () => resolve(false);
        probe.src = src;
      });
    },
    prevSrc,
    { timeout: WAIT_TIMEOUT_MS, polling: 200 },
  );
  return Date.now() - clickStart;
}

/**
 * @param {string} urlPath
 * @returns {Promise<ApiTimingSample>}
 */
async function measureApiFetch(urlPath) {
  const url = `${API_BASE}${urlPath.startsWith('/') ? urlPath : `/${urlPath}`}`;
  const start = Date.now();
  const res = await fetch(url, {
    headers: { 'x-client-key': CLIENT_KEY },
  });
  const ttfbMs = Date.now() - start;
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API ${url} failed: ${res.status} ${text.slice(0, 200)}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  const totalMs = Date.now() - start;
  return { ttfbMs, totalMs, bytes: buf.length };
}

/**
 * @param {import('playwright').Browser} browser
 * @param {Record<string, string>} ids
 * @param {Record<string, string>} leaderBoardStorage
 */
async function warmup(browser, ids, leaderBoardStorage) {
  console.log('\n## ウォームアップ（Vite dev 初回コンパイル回避）\n');
  const urls = [
    `${WEB_BASE}/kiosk/production-schedule/leader-order-board`,
    `${WEB_BASE}/kiosk/part-measurement/inspection/edit/${ids.sheetId}`,
    `${WEB_BASE}/kiosk/part-measurement/self-inspection/sessions/${ids.selfInspectionSessionId}`,
    `${WEB_BASE}/kiosk/assembly/work-sessions/${ids.assemblyWorkSessionId}`,
  ];
  await withFreshKioskPage(browser, leaderBoardStorage, async (page) => {
    for (const url of urls) {
      process.stdout.write(`  warmup: ${url.replace(WEB_BASE, '')} ... `);
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
      await page.waitForTimeout(1500);
      console.log('ok');
    }
  });
}

/**
 * @param {Record<string, string>} ids
 */
async function measureApiTimings(ids) {
  const endpoints = {
    'leaderboard-board':
      '/kiosk/production-schedule/leaderboard-board?boardResourceCds=1,2,3,4,5,6&pageSize=160&allowResourceOnly=true&includeDecorations=false',
    'kiosk-documents': '/kiosk-documents',
    'assembly-procedure-sequence': `/assembly/work-sessions/${ids.assemblyWorkSessionId}/procedure-sequence`,
    'drawing-jpg': '/storage/part-measurement-drawings/perf-drawing-0.jpg',
  };

  /** @type {Record<string, ApiScenarioResult>} */
  const results = {};

  for (const [name, pathSuffix] of Object.entries(endpoints)) {
    /** @type {ApiTimingSample[]} */
    const samples = [];
    for (let i = 0; i < RUNS; i++) {
      samples.push(await measureApiFetch(pathSuffix));
      process.stdout.write(`  api ${name} run ${i + 1}/${RUNS}: ${samples[i].totalMs}ms\n`);
    }
    results[name] = buildApiScenarioResult(samples);
  }

  return results;
}

/**
 * @param {import('playwright').Browser} browser
 * @param {Record<string, string>} ids
 * @param {Record<string, string>} leaderBoardStorage
 */
async function measureBrowserScenarios(browser, ids, leaderBoardStorage) {
  const leaderboardUrl = `${WEB_BASE}/kiosk/production-schedule/leader-order-board`;
  const inspectionUrl = `${WEB_BASE}/kiosk/part-measurement/inspection/edit/${ids.sheetId}`;
  const selfInspectionUrl = `${WEB_BASE}/kiosk/part-measurement/self-inspection/sessions/${ids.selfInspectionSessionId}`;
  const assemblyUrl = `${WEB_BASE}/kiosk/assembly/work-sessions/${ids.assemblyWorkSessionId}`;

  /** @type {Record<string, number[]>} */
  const samples = {
    'leaderboard-first-rows': [],
    'leaderboard-full': [],
    'inspection-drawing': [],
    'self-inspection-drawing': [],
    'assembly-procedure-first-page': [],
    'assembly-procedure-next-page': [],
  };

  const scenarios = [
    {
      name: 'leaderboard-first-rows',
      run: async (page) => {
        const navStart = await gotoAndMeasure(page, leaderboardUrl);
        return waitForFirstLeaderboardRow(page, navStart);
      },
    },
    {
      name: 'leaderboard-full',
      run: async (page) => {
        const navStart = await gotoAndMeasure(page, leaderboardUrl);
        return waitForLeaderboardFullStable(page, navStart);
      },
    },
    {
      name: 'inspection-drawing',
      run: async (page) => {
        const navStart = await gotoAndMeasure(page, inspectionUrl);
        return waitForDrawingImageReady(page, navStart);
      },
    },
    {
      name: 'self-inspection-drawing',
      run: async (page) => {
        const navStart = await gotoAndMeasure(page, selfInspectionUrl);
        return waitForDrawingImageReady(page, navStart);
      },
    },
    {
      name: 'assembly-procedure',
      run: async (page) => {
        const navStart = await gotoAndMeasure(page, assemblyUrl);
        const firstPageMs = await waitForAssemblyFirstPage(page, navStart);
        const nextPageMs = await waitForAssemblyNextPage(page);
        return { firstPageMs, nextPageMs };
      },
    },
  ];

  for (const scenario of scenarios) {
    console.log(`\n### ${scenario.name}`);
    for (let i = 0; i < RUNS; i++) {
      await withFreshKioskPage(browser, leaderBoardStorage, async (page) => {
        const result = await scenario.run(page);
        if (typeof result === 'number') {
          samples[scenario.name].push(result);
          console.log(`  run ${i + 1}/${RUNS}: ${Math.round(result)}ms (${i === 0 ? 'cold' : 'warm'})`);
        } else {
          samples['assembly-procedure-first-page'].push(result.firstPageMs);
          samples['assembly-procedure-next-page'].push(result.nextPageMs);
          console.log(
            `  run ${i + 1}/${RUNS}: first=${Math.round(result.firstPageMs)}ms next=${Math.round(result.nextPageMs)}ms (${i === 0 ? 'cold' : 'warm'})`,
          );
        }
      });
    }
  }

  /** @type {Record<string, MsScenarioResult>} */
  const results = {};
  for (const [name, values] of Object.entries(samples)) {
    if (values.length > 0) {
      results[name] = buildMsScenarioResult(values);
    }
  }
  return results;
}

/**
 * @param {Record<string, MsScenarioResult>} browser
 * @param {Record<string, ApiScenarioResult>} api
 */
function printMarkdownTables(browser, api) {
  console.log('\n## ブラウザ計測（ms）\n');
  console.log('| シナリオ | cold | warm[1] | warm[2] | median |');
  console.log('| --- | ---: | ---: | ---: | ---: |');
  for (const [name, r] of Object.entries(browser)) {
    console.log(
      `| ${name} | ${r.cold} | ${r.warm[0] ?? '-'} | ${r.warm[1] ?? '-'} | ${r.median} |`,
    );
  }

  console.log('\n## API 計測\n');
  console.log('| エンドポイント | cold TTFB | cold total | cold bytes | median TTFB | median total | median bytes |');
  console.log('| --- | ---: | ---: | ---: | ---: | ---: | ---: |');
  for (const [name, r] of Object.entries(api)) {
    console.log(
      `| ${name} | ${r.cold.ttfbMs} | ${r.cold.totalMs} | ${r.cold.bytes} | ${r.median.ttfbMs} | ${r.median.totalMs} | ${r.median.bytes} |`,
    );
  }
}

async function loadManifestIds() {
  try {
    const raw = await readFile(MANIFEST_PATH, 'utf8');
    const manifest = JSON.parse(raw);
    return {
      sheetId: manifest.partMeasurementSheetIds?.[0] ?? 'b8883b87-d774-4af8-8e12-f2174857754c',
      selfInspectionSessionId:
        manifest.selfInspectionSessionIds?.[0] ?? '7b94d3b0-6778-44ac-a646-6fa988aa8966',
      assemblyWorkSessionId:
        manifest.assemblyWorkSessionId ?? 'c206cfc6-3b67-4304-af5b-17612e7e3c17',
    };
  } catch {
    return {
      sheetId: 'b8883b87-d774-4af8-8e12-f2174857754c',
      selfInspectionSessionId: '7b94d3b0-6778-44ac-a646-6fa988aa8966',
      assemblyWorkSessionId: 'c206cfc6-3b67-4304-af5b-17612e7e3c17',
    };
  }
}

function resolveOutputPath(argv) {
  const positional = argv.find((a) => !a.startsWith('-'));
  if (positional) return path.resolve(positional);
  const outIdx = argv.indexOf('--output');
  if (outIdx >= 0 && argv[outIdx + 1]) return path.resolve(argv[outIdx + 1]);
  return DEFAULT_OUTPUT;
}

async function main() {
  const outputPath = resolveOutputPath(process.argv.slice(2));
  const ids = await loadManifestIds();
  const leaderBoardBootstrap = await resolveLeaderBoardBootstrap();
  const leaderBoardStorage = buildLeaderBoardLocalStoragePayload(leaderBoardBootstrap);

  console.log('キオスク UI パフォーマンス計測');
  console.log(`  WEB_BASE=${WEB_BASE}`);
  console.log(`  API_BASE=${API_BASE}`);
  console.log(`  CLIENT_KEY=${CLIENT_KEY}`);
  console.log(`  leaderBoardSite=${leaderBoardBootstrap.siteKey}`);
  console.log(`  leaderBoardDevice=${leaderBoardBootstrap.deviceScopeKey}`);
  console.log(`  output=${outputPath}`);
  console.log(`  viewport=${VIEWPORT.width}x${VIEWPORT.height}`);

  const browser = await chromium.launch({ headless: true });

  try {
    await warmup(browser, ids, leaderBoardStorage);

    console.log('\n## API 計測\n');
    const apiTimings = await measureApiTimings(ids);

    console.log('\n## ブラウザ計測\n');
    const browserScenarios = await measureBrowserScenarios(browser, ids, leaderBoardStorage);

    const payload = {
      measuredAt: new Date().toISOString(),
      environment: {
        webBase: WEB_BASE,
        apiBase: API_BASE,
        clientKey: CLIENT_KEY,
        viewport: VIEWPORT,
        userAgent: KIOSK_USER_AGENT,
        runsPerScenario: RUNS,
        leaderBoardBootstrap,
      },
      ids,
      browserScenarios,
      apiTimings,
    };

    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
    console.log(`\n結果を保存: ${outputPath}`);

    printMarkdownTables(browserScenarios, apiTimings);
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
