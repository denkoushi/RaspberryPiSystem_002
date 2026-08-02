#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright';
import { renderKioskSopHtml, validateKioskSopDefinition, validateKioskSopManifest } from '../../packages/kiosk-sop-core/dist/index.js';
import { sha256, stableJson } from '../../packages/kiosk-sop-core/dist/node.js';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '../..');
const sourceDefinitionPath = join(repoRoot, 'apps/web/src/features/part-measurement/inspection-drawing/inspection-drawing-sop.definition.json');
const committedRoot = join(repoRoot, 'apps/web/src/generated/kiosk-sop/inspection-drawing');
const docsPreviewPath = join(repoRoot, 'docs/design-previews/kiosk-inspection-drawing-edit-existing-sop.html');
const mode = process.argv[2] ?? 'generate';
const skipCapture = process.argv.includes('--skip-capture');
const outputArgIndex = process.argv.indexOf('--output-root');
const outputRoot = outputArgIndex >= 0 ? resolve(process.argv[outputArgIndex + 1]) : committedRoot;
const generatorVersion = '1.0.0';
const chromiumLaunchOptions = {
  headless: true,
  args: [
    '--disable-gpu',
    '--disable-skia-runtime-opts',
    '--disable-lcd-text',
    '--font-render-hinting=none',
    '--force-color-profile=srgb'
  ]
};

const visualTemplate = {
  id: 'sop-visual-1', name: '図面71-A61', searchDigits: '7161',
  drawingImageRelativePath: '/api/storage/part-measurement-drawings/sop-visual-1.svg',
  isActive: true, createdAt: '2026-07-28T00:00:00.000Z', updatedAt: '2026-07-28T00:00:00.000Z'
};
const template = {
  id: 'sop-template-1', fhincd: 'PART-9000', resourceCd: 'R001', processGroup: 'cutting',
  templateScope: 'three_key', candidateFhinmei: null, name: '図面71-A61 テンプレート', version: 3,
  isActive: true, selfInspectionMode: 'fixed_count', selfInspectionFixedCount: 3,
  selfInspectionSampleSize: 3, visualTemplateId: visualTemplate.id, visualTemplate,
  siblingGroupId: 'sop-group-1', siblingGroup: {
    id: 'sop-group-1', displayName: 'PART-9000 切削', fhincd: 'PART-9000', processGroup: 'cutting',
    activeResourceCds: ['R001', 'R002'], createdAt: '2026-07-01T00:00:00.000Z', updatedAt: '2026-07-28T00:00:00.000Z'
  },
  items: [
    { id: 'item-1', sortOrder: 0, datumSurface: 'A', measurementPoint: '外径', measurementLabel: '外径', displayMarker: '1', unit: 'mm', allowNegative: true, decimalPlaces: 3, markerXRatio: '0.35', markerYRatio: '0.42', calloutTipXRatio: null, calloutTipYRatio: null, nominalValue: '20', lowerLimit: '19.98', upperLimit: '20.02', depthMode: 'measured', valueKind: 'numeric' },
    { id: 'item-2', sortOrder: 1, datumSurface: 'B', measurementPoint: '全長', measurementLabel: '全長', displayMarker: '2', unit: 'mm', allowNegative: true, decimalPlaces: 2, markerXRatio: '0.67', markerYRatio: '0.55', calloutTipXRatio: '0.73', calloutTipYRatio: '0.48', nominalValue: '71', lowerLimit: '70.9', upperLimit: '71.1', depthMode: 'measured', valueKind: 'numeric' }
  ]
};
const summaryTemplate = { ...template, itemCount: template.items.length, updatedAt: '2026-07-28T00:00:00.000Z' };
delete summaryTemplate.items;

async function waitForServer(url, timeoutMs = 60000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try { if ((await fetch(url)).ok) return; } catch { /* server is starting */ }
    await new Promise((done) => setTimeout(done, 250));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function installApiFixtures(page, unexpected) {
  await page.route((url) => url.pathname.startsWith('/api/'), async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/system/deploy-status') return route.fulfill({ json: { isMaintenance: false } });
    if (path === '/api/kiosk/config') return route.fulfill({ json: { defaultMode: 'tag', clientStatus: null } });
    if (path === '/api/kiosk/call/targets') return route.fulfill({ json: { selfClientId: 'sop-generator', targets: [] } });
    if (path === '/api/kiosk/employees') return route.fulfill({ json: { employees: [] } });
    if (path === '/api/kiosk/production-schedule/resources') return route.fulfill({ json: { resources: ['R001', 'R002', 'R003'], resourceNameMap: { R001: ['旋盤1号'], R002: ['旋盤2号'] } } });
    if (path === '/api/part-measurement/inspection-drawing/templates') return route.fulfill({ json: { templates: [summaryTemplate] } });
    if (path === '/api/part-measurement/inspection-drawing/templates/sop-template-1') return route.fulfill({ json: { template } });
    if (path === '/api/part-measurement/inspection-drawing/measurement-label-settings') return route.fulfill({ json: { settings: [] } });
    if (path === '/api/part-measurement/visual-templates') return route.fulfill({ json: { visualTemplates: [visualTemplate] } });
    if (path === '/api/part-measurement/visual-templates/sop-visual-1/ocr') return route.fulfill({ status: 404, json: { message: 'OCR fixtureなし' } });
    if (path === visualTemplate.drawingImageRelativePath) return route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="600"><rect width="1000" height="600" fill="#f8fafc"/><g stroke="#334155" fill="none" stroke-width="4"><path d="M120 180h700v240H120z"/><circle cx="300" cy="300" r="95"/><circle cx="650" cy="300" r="60"/><path d="M205 300h190M300 205v190M590 300h120"/></g><g fill="#0f172a" font-family="sans-serif" font-size="36"><text x="120" y="130">PART-9000  検査図面</text><text x="240" y="520">φ20 ±0.02</text><text x="610" y="520">71 ±0.10</text></g></svg>' });
    unexpected.add(`${route.request().method()} ${path}`);
    return route.fulfill({ status: 404, json: { message: `Unexpected SOP generator API request: ${path}` } });
  });
}

async function captureScreens(definition, targetRoot) {
  const server = spawn('pnpm', ['--filter', '@raspi-system/web', 'dev', '--host', '127.0.0.1', '--port', '4173'], { cwd: repoRoot, env: { ...process.env, VITE_KIOSK_SOP_POPUP_ENABLED: 'true' }, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  let serverLog = '';
  server.stdout.on('data', (chunk) => { serverLog += chunk; });
  server.stderr.on('data', (chunk) => { serverLog += chunk; });
  try {
    await waitForServer('http://127.0.0.1:4173/');
    const browser = await chromium.launch(chromiumLaunchOptions);
    try {
      await mkdir(join(targetRoot, 'screens'), { recursive: true });
      const targetsByScenario = {};
      for (const scenario of definition.scenarios) {
        const unexpected = new Set();
        const context = await browser.newContext({ viewport: scenario.viewport, deviceScaleFactor: 1, locale: 'ja-JP', timezoneId: 'Asia/Tokyo', reducedMotion: 'reduce' });
        const page = await context.newPage();
        await page.addInitScript(() => {
          localStorage.setItem('kiosk-client-key', JSON.stringify('client-key-raspberrypi4-kiosk1'));
          Date.now = () => 1785510000000;
        });
        await installApiFixtures(page, unexpected);
        const pageErrors = [];
        page.on('pageerror', (error) => pageErrors.push(error.message));
        await page.goto(`http://127.0.0.1:4173${scenario.productionRoute}`, { waitUntil: 'networkidle' });
        await page.addStyleTag({
          content: '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important;border-radius:0!important}'
        });
        await page.locator('h1').first().waitFor({ state: 'visible' });
        await page.evaluate(async () => {
          await document.fonts.ready;
          await new Promise((resolveFrame) => requestAnimationFrame(() => requestAnimationFrame(resolveFrame)));
        });
        const targetRows = await page.locator('[data-kiosk-sop-target]').evaluateAll((elements) => elements.map((element) => {
          const rect = element.getBoundingClientRect();
          return { id: element.getAttribute('data-kiosk-sop-target'), x: (rect.left + rect.width / 2) / window.innerWidth, y: (rect.top + rect.height / 2) / window.innerHeight, visible: rect.width > 0 && rect.height > 0 };
        }));
        const coverageErrors = await page.locator('[data-kiosk-sop-coverage]').evaluateAll((boundaries, declaredExclusions) => {
          const interactiveSelector = 'button,a,input,select,textarea,[role="button"]';
          return boundaries.flatMap((boundary) => Array.from(boundary.querySelectorAll(interactiveSelector)).flatMap((element) => {
            if (element.closest('[data-kiosk-sop-target]')) return [];
            const ignoreId = element.closest('[data-kiosk-sop-ignore-id]')?.getAttribute('data-kiosk-sop-ignore-id');
            if (ignoreId && declaredExclusions.includes(ignoreId)) return [];
            return [`${element.tagName.toLowerCase()}${element.getAttribute('aria-label') ? `[aria-label="${element.getAttribute('aria-label')}"]` : ''}`];
          }));
        }, definition.exclusions.map(({ id }) => id));
        if (coverageErrors.length) throw new Error(`Unclassified interactive controls in ${scenario.id}: ${coverageErrors.join(', ')}`);
        targetsByScenario[scenario.id] = Object.fromEntries(targetRows.filter(({ id, visible }) => id && visible).map(({ id, x, y }) => [id, { x, y }]));
        await page.screenshot({ path: join(targetRoot, 'screens', `${scenario.screen}.png`), animations: 'disabled' });
        if (unexpected.size) throw new Error(`Unexpected API requests: ${[...unexpected].join(', ')}`);
        if (pageErrors.length) throw new Error(`Page errors: ${pageErrors.join('; ')}`);
        await context.close();
      }
      return { browserVersion: browser.version(), targetsByScenario };
    } finally { await browser.close(); }
  } catch (error) {
    throw new Error(`${error instanceof Error ? error.message : String(error)}\nVite output:\n${serverLog}`);
  } finally {
    if (server.pid) {
      try { process.kill(-server.pid, 'SIGTERM'); } catch { server.kill('SIGTERM'); }
    }
  }
}

function globRegex(pattern) {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '§§').replace(/\*/g, '[^/]*').replace(/§§/g, '.*');
  return new RegExp(`^${escaped}$`);
}

async function listFiles(root, prefix = '') {
  const result = [];
  for (const name of await readdir(join(root, prefix))) {
    const path = join(prefix, name);
    const entry = await stat(join(root, path));
    if (entry.isDirectory()) result.push(...await listFiles(root, path)); else result.push(path);
  }
  return result;
}

async function sourceDigest(definition) {
  const roots = new Set();
  for (const pattern of definition.supplementalWatchGlobs) {
    const wildcardAt = pattern.search(/[?*]/);
    const prefix = wildcardAt < 0 ? pattern : pattern.slice(0, wildcardAt);
    roots.add(prefix.endsWith('/') ? prefix.replace(/\/$/, '') : dirname(prefix));
  }
  const files = [];
  for (const root of roots) {
    const entry = await stat(join(repoRoot, root));
    if (entry.isDirectory()) files.push(...await listFiles(repoRoot, root)); else files.push(root);
  }
  const patterns = definition.supplementalWatchGlobs.map(globRegex);
  const selected = new Set(definition.entrySources);
  for (const file of files) if (patterns.some((pattern) => pattern.test(file))) selected.add(file);
  const chunks = [];
  for (const file of [...selected].sort()) chunks.push(`${file}\0${await readFile(join(repoRoot, file), 'utf8')}\0`);
  return sha256(chunks.join(''));
}

async function composeSheets(html, definition, targetRoot) {
  const browser = await chromium.launch(chromiumLaunchOptions);
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
    await page.setContent(html, { waitUntil: 'load' });
    await mkdir(join(targetRoot, 'sheets'), { recursive: true });
    for (const sheet of definition.scenarios.flatMap(({ sheets }) => sheets)) {
      const sheetLocator = page.locator(`.sheet[data-sheet="${sheet.id}"]`);
      await sheetLocator.waitFor({ state: 'visible' });
      await page.waitForFunction((sheetId) =>
        document.querySelector(`.sheet[data-sheet="${sheetId}"]`)?.getAttribute('data-kiosk-sop-layout-ready') === 'true',
      sheet.id);
      await sheetLocator.screenshot({ path: join(targetRoot, 'sheets', `${sheet.id}.png`), animations: 'disabled' });
    }
  } finally { await browser.close(); }
}

async function generate(targetRoot) {
  await mkdir(targetRoot, { recursive: true });
  const sourceText = await readFile(sourceDefinitionPath, 'utf8');
  const source = JSON.parse(sourceText);
  let browserVersion = 'chromium-unknown';
  let targetsByScenario = {};
  if (!skipCapture) {
    const capture = await captureScreens(source, targetRoot);
    browserVersion = capture.browserVersion;
    targetsByScenario = capture.targetsByScenario;
  }
  else {
    await mkdir(join(targetRoot, 'screens'), { recursive: true });
    for (const scenario of source.scenarios) {
      const from = join(committedRoot, 'screens', `${scenario.screen}.png`);
      await writeFile(join(targetRoot, 'screens', `${scenario.screen}.png`), await readFile(from));
    }
  }
  const hydrated = {
    ...source,
    scenarios: await Promise.all(source.scenarios.map(async (scenario) => ({
      ...scenario,
      sheets: await Promise.all(scenario.sheets.map(async (sheet) => ({
        ...sheet,
        steps: sheet.steps.map((step) => ({
          ...step,
          target: targetsByScenario[scenario.id]?.[step.targetId] ?? step.target
        })),
        screenImageDataUrl: `data:image/png;base64,${(await readFile(join(targetRoot, 'screens', `${scenario.screen}.png`))).toString('base64')}`
      })))
    })))
  };
  for (const scenario of hydrated.scenarios) delete scenario.screen;
  const validated = validateKioskSopDefinition(hydrated);
  const html = renderKioskSopHtml(validated);
  await writeFile(join(targetRoot, 'manual.html'), html);
  await composeSheets(html, validated, targetRoot);
  const artifactFiles = (await listFiles(targetRoot)).filter((file) => extname(file) === '.png' || file === 'manual.html').sort();
  const artifacts = Object.fromEntries(await Promise.all(artifactFiles.map(async (file) => [file, sha256(await readFile(join(targetRoot, file)))])));
  const manifest = validateKioskSopManifest({
    schemaVersion: 1,
    generatorVersion,
    browserVersion,
    definitionSha256: sha256(stableJson(source)),
    sourceSha256: await sourceDigest(source),
    htmlSha256: sha256(html),
    geometry: Object.fromEntries(validated.scenarios.flatMap(({ sheets }) => sheets).map((sheet) => [sheet.id, sheet.steps.map(({ id, targetId, target }) => ({ id, targetId, target }))])),
    artifacts
  });
  await writeFile(join(targetRoot, 'manifest.json'), stableJson(manifest));
  return html;
}

async function compareTrees(expected, actual) {
  const expectedFiles = (await listFiles(expected)).sort();
  const actualFiles = (await listFiles(actual)).sort();
  if (stableJson(expectedFiles) !== stableJson(actualFiles)) throw new Error('Generated file list is stale. Run pnpm kiosk-sop:generate --all.');
  const changed = [];
  for (const file of expectedFiles) if (sha256(await readFile(join(expected, file))) !== sha256(await readFile(join(actual, file)))) changed.push(file);
  if (changed.length) throw new Error(`Generated kiosk SOP is stale: ${changed.join(', ')}. Run pnpm kiosk-sop:generate --all.`);
}

if (mode === 'generate') {
  const html = await generate(outputRoot);
  if (outputRoot === committedRoot) await writeFile(docsPreviewPath, html);
  console.log(`Generated inspection-drawing SOP in ${relative(repoRoot, outputRoot)}`);
} else if (mode === 'check') {
  const temp = await mkdtemp(join(tmpdir(), 'kiosk-sop-check-'));
  try {
    await generate(temp);
    await compareTrees(committedRoot, temp);
    const html = await readFile(join(temp, 'manual.html'));
    if (sha256(html) !== sha256(await readFile(docsPreviewPath))) throw new Error('Documentation preview is stale.');
    console.log('Generated kiosk SOP is current.');
  } finally { await rm(temp, { recursive: true, force: true }); }
} else {
  throw new Error(`Unknown mode: ${mode}`);
}
