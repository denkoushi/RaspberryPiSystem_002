#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright';
import {
  computeNormalizedBottomRightAnchor,
  renderKioskSopHtml,
  validateKioskSopDefinition,
  validateKioskSopManifest
} from '../../packages/kiosk-sop-core/dist/index.js';
import { sha256, stableJson } from '../../packages/kiosk-sop-core/dist/node.js';

import { assertNoManualTarget, resolveSingleVisibleTarget } from './capture-contract.mjs';
import { chromiumLaunchOptions, generatorVersion } from './capture-runtime.mjs';
import { resolveInspectionDrawingCaptureAdapter } from './inspection-drawing-capture-adapter.mjs';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '../..');
const sourceDefinitionPath = join(repoRoot, 'apps/web/src/features/part-measurement/inspection-drawing/inspection-drawing-sop.definition.json');
const committedRoot = join(repoRoot, 'apps/web/src/generated/kiosk-sop/inspection-drawing');
const docsPreviewPath = join(repoRoot, 'docs/design-previews/kiosk-inspection-drawing-edit-existing-sop.html');
const mode = process.argv[2] ?? 'generate';
const outputArgIndex = process.argv.indexOf('--output-root');
const outputRoot = outputArgIndex >= 0 ? resolve(process.argv[outputArgIndex + 1]) : committedRoot;
async function waitForServer(url, timeoutMs = 60000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try { if ((await fetch(url)).ok) return; } catch { /* server is starting */ }
    await new Promise((done) => setTimeout(done, 250));
  }
  throw new Error(`Timed out waiting for ${url}`);
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
      const capturesBySheet = {};
      for (const scenario of definition.scenarios) {
        const adapter = resolveInspectionDrawingCaptureAdapter(scenario.fixtureId);
        for (const sheet of scenario.sheets) {
          adapter.assertSupportedSheet(sheet.id);
          const unexpected = new Set();
          const context = await browser.newContext({ viewport: scenario.viewport, deviceScaleFactor: 1, locale: 'ja-JP', timezoneId: 'Asia/Tokyo', reducedMotion: 'reduce' });
          try {
            const page = await context.newPage();
            await page.addInitScript(() => {
              localStorage.setItem('kiosk-client-key', JSON.stringify('client-key-raspberrypi4-kiosk1'));
              Date.now = () => 1785510000000;
              const nativeSetTimeout = window.setTimeout.bind(window);
              const nativeClearTimeout = window.clearTimeout.bind(window);
              const trackedTimeouts = new Map();
              window.setTimeout = (handler, delay = 0, ...args) => {
                let timeoutId;
                timeoutId = nativeSetTimeout((...handlerArgs) => {
                  trackedTimeouts.delete(timeoutId);
                  if (typeof handler === 'function') handler(...handlerArgs);
                }, delay, ...args);
                trackedTimeouts.set(timeoutId, delay);
                return timeoutId;
              };
              window.clearTimeout = (timeoutId) => {
                trackedTimeouts.delete(timeoutId);
                nativeClearTimeout(timeoutId);
              };
              window.__clearKioskSopTimeoutsByDelay = (delay) => {
                for (const [timeoutId, timeoutDelay] of trackedTimeouts) {
                  if (timeoutDelay !== delay) continue;
                  trackedTimeouts.delete(timeoutId);
                  nativeClearTimeout(timeoutId);
                }
              };
            });
            await adapter.installApiFixtures(page, sheet.id, unexpected);
            const pageErrors = [];
            page.on('pageerror', (error) => pageErrors.push(error.message));
            await page.goto(`http://127.0.0.1:4173${scenario.productionRoute}`, { waitUntil: 'networkidle' });
            await page.addStyleTag({
              content: '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important;border-radius:0!important}'
            });
            // KioskLayout intentionally renders the maintenance screen until
            // the initial deploy-status authority is known. Do not mistake
            // that fail-closed placeholder for the routed SOP page.
            await page.getByRole('heading', { name: 'メンテナンス中', exact: true }).waitFor({ state: 'hidden' });
            await adapter.waitForPageReady(page, sheet.id);
            await page.locator('h1').first().waitFor({ state: 'visible' });
            await adapter.prepareSheet(page, sheet.id);
            await page.evaluate(async () => {
              await document.fonts.ready;
              await new Promise((resolveFrame) => requestAnimationFrame(() => requestAnimationFrame(resolveFrame)));
            });
            const targets = {};
            for (const step of sheet.steps) {
              const captureContext = { scenarioId: scenario.id, sheetId: sheet.id, targetId: step.targetId };
              assertNoManualTarget(step, captureContext);
              const rows = await page.locator(`[data-kiosk-sop-target="${step.targetId}"]`).evaluateAll((elements) => elements.map((element) => {
                const rect = element.getBoundingClientRect();
                let styleVisible = true;
                for (let current = element; current; current = current.parentElement) {
                  const style = window.getComputedStyle(current);
                  if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse' || style.opacity === '0') {
                    styleVisible = false;
                    break;
                  }
                }
                return {
                  rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
                  visible: styleVisible && rect.width > 0 && rect.height > 0 && rect.right > 0 && rect.bottom > 0 && rect.left < window.innerWidth && rect.top < window.innerHeight
                };
              }));
              const rect = resolveSingleVisibleTarget(rows, captureContext);
              try {
                targets[step.targetId] = computeNormalizedBottomRightAnchor(rect, scenario.viewport);
              } catch (error) {
                throw new Error(`${error instanceof Error ? error.message : String(error)} rect=${JSON.stringify(rect)} viewport=${JSON.stringify(scenario.viewport)} (scenario=${scenario.id} sheet=${sheet.id} targetId=${step.targetId})`);
              }
            }
            const coverageErrors = await page.locator('[data-kiosk-sop-coverage]').evaluateAll((boundaries, declaredExclusions) => {
              const interactiveSelector = 'button,a,input,select,textarea,[role="button"]';
              return boundaries.flatMap((boundary) => Array.from(boundary.querySelectorAll(interactiveSelector)).flatMap((element) => {
                if (element.closest('[data-kiosk-sop-target]')) return [];
                const ignoreId = element.closest('[data-kiosk-sop-ignore-id]')?.getAttribute('data-kiosk-sop-ignore-id');
                if (ignoreId && declaredExclusions.includes(ignoreId)) return [];
                return [`${element.tagName.toLowerCase()}${element.getAttribute('aria-label') ? `[aria-label="${element.getAttribute('aria-label')}"]` : ''}`];
              }));
            }, definition.exclusions.map(({ id }) => id));
            if (coverageErrors.length) throw new Error(`Unclassified interactive controls in scenario=${scenario.id} sheet=${sheet.id}: ${coverageErrors.join(', ')}`);
            await page.screenshot({ path: join(targetRoot, 'screens', `${sheet.id}.png`), animations: 'disabled' });
            if (unexpected.size) throw new Error(`Unexpected API requests in scenario=${scenario.id} sheet=${sheet.id}: ${[...unexpected].join(', ')}`);
            if (pageErrors.length) throw new Error(`Page errors in scenario=${scenario.id} sheet=${sheet.id}: ${pageErrors.join('; ')}`);
            capturesBySheet[sheet.id] = { targets };
          } finally {
            await context.close();
          }
        }
      }
      return { browserVersion: browser.version(), capturesBySheet };
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
  const capture = await captureScreens(source, targetRoot);
  const browserVersion = capture.browserVersion;
  const capturesBySheet = capture.capturesBySheet;
  const hydrated = {
    ...source,
    scenarios: await Promise.all(source.scenarios.map(async (scenario) => ({
      ...scenario,
      sheets: await Promise.all(scenario.sheets.map(async (sheet) => ({
        ...sheet,
        steps: sheet.steps.map((step) => ({
          ...step,
          target: capturesBySheet[sheet.id].targets[step.targetId]
        })),
        screenImageDataUrl: `data:image/png;base64,${(await readFile(join(targetRoot, 'screens', `${sheet.id}.png`))).toString('base64')}`
      })))
    })))
  };
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
