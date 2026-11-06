import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { cpus, tmpdir, platform } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { build } from 'vite';
import tailwind from 'tailwindcss';
import loadConfig from 'tailwindcss/loadConfig.js';
import autoprefixer from 'autoprefixer';
import react from '@vitejs/plugin-react';

const here = dirname(fileURLToPath(import.meta.url));
const web = resolve(here, '../../../../../..');
const cpuRate = Number(process.env.CPU_RATE ?? 4);
const output = resolve(process.env.PERF_OUTPUT ?? resolve(tmpdir(), 'planning-board-browser-perf.json'));
const screenshotDir = process.env.SCREENSHOT_DIR ? resolve(process.env.SCREENSHOT_DIR) : null;
const traceEnabled = process.env.TRACE !== '0';
assert(Number.isFinite(cpuRate) && cpuRate >= 1, 'CPU_RATE must be >= 1');
const outDir = await mkdtemp(resolve(tmpdir(), 'planning-board-browser-'));
const samples = {};
let browser;
let stage = 'build';
const settle = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const gantt = '[data-testid="planning-board-gantt"]';
const viewport = '[aria-label="ガントの日付と工程"]';
const bars = '[data-testid^="planning-gantt-bar-"]';
const legend = '[aria-label="製番の色分け凡例"] button';
const metrics = async cdp => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(({ name, value }) => [name, value]));

async function endTrace(cdp) {
  const complete = new Promise(resolve => cdp.once('Tracing.tracingComplete', resolve));
  await cdp.send('Tracing.end');
  const { stream } = await complete;
  let data = '';
  for (;;) {
    const chunk = await cdp.send('IO.read', { handle: stream });
    data += chunk.base64Encoded ? Buffer.from(chunk.data, 'base64').toString() : chunk.data;
    if (chunk.eof) break;
  }
  await cdp.send('IO.close', { handle: stream });
  const events = JSON.parse(data).traceEvents;
  // Sum complete events, across threads. These can overlap; they are not wall time.
  const sum = names => events.filter(e => e.ph === 'X' && names.includes(e.name)).reduce((total, e) => total + (e.dur ?? 0) / 1000, 0);
  const count = names => events.filter(e => e.ph === 'X' && names.includes(e.name)).length;
  return { paintMs: sum(['Paint']), compositeMs: sum(['CompositeLayers']),
    paintEvents: count(['Paint']), compositeEvents: count(['CompositeLayers']) };
}

async function inventory(page) {
  return page.evaluate(selector => {
    const root = document.querySelector(selector);
    const nodes = [...root.querySelectorAll('*')];
    const normalize = id => id.replace(/item-\d+(?:-segment-\d+)?/g, 'item-#').replace(/(planning-forward-lane-).+/, '$1#');
    const testIds = {}, ownedDescendants = {};
    const css = { boxShadow: 0, filter: 0, mask: 0, backdropFilter: 0, sticky: 0, transform: 0, largeTransform: 0 };
    for (const node of nodes) {
      if (node.dataset.testid) {
        const key = normalize(node.dataset.testid);
        testIds[key] = (testIds[key] ?? 0) + 1;
      }
      const owner = normalize(node.closest('[data-testid]')?.getAttribute('data-testid') ?? '(none)');
      ownedDescendants[owner] = (ownedDescendants[owner] ?? 0) + 1;
      const style = getComputedStyle(node);
      if (style.boxShadow !== 'none') css.boxShadow++;
      if (style.filter !== 'none') css.filter++;
      if (style.maskImage !== 'none' || style.webkitMaskImage !== 'none') css.mask++;
      if (style.backdropFilter && style.backdropFilter !== 'none') css.backdropFilter++;
      if (style.position === 'sticky') css.sticky++;
      if (style.transform !== 'none' || (style.translate && style.translate !== 'none') || (style.scale && style.scale !== 'none')) {
        css.transform++;
        // Explicit threshold: transformed border box area >= 1920*1080/4 CSS px².
        if (node.offsetWidth * node.offsetHeight >= 1920 * 1080 / 4) css.largeTransform++;
      }
    }
    const sorted = counts => Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 30);
    const scroll = document.querySelector('[aria-label="ガントの日付と工程"]');
    return { bodyElements: document.body.querySelectorAll('*').length, ganttElements: nodes.length,
      testIds: sorted(testIds), ownedDescendants: sorted(ownedDescendants), css,
      scroll: { width: scroll.clientWidth, height: scroll.clientHeight, scrollWidth: scroll.scrollWidth, scrollHeight: scroll.scrollHeight },
      capabilities: { monthlyUptime: root.textContent.includes('月平均'), processChips: root.textContent.includes('済'),
        sendOutStars: !!root.querySelector('[data-testid="planning-gantt-send-out-star"]') } };
  }, gantt);
}

try {
  // No app config, proxy, .env loading, HMR, or development React instrumentation.
  const config = { configFile: false, envFile: false, envDir: false, root: here, base: '/',
    plugins: [react()], resolve: { alias: [
      { find: /^.*\/api\/hooks(?:\/machine-signal|\/production-schedule\/d-schedule-minutes)?$/, replacement: resolve(here, 'hooks.jsx') }
    ] }, css: { postcss: { plugins: [tailwind({ ...loadConfig(resolve(web, 'tailwind.config.ts')), content: [resolve(web, 'src/**/*.{ts,tsx}')] }), autoprefixer()] } }, build: { outDir, emptyOutDir: false, minify: process.env.PROFILE !== '1' }, logLevel: 'warn' };
  await build(config);
  // Serve built bytes via routing, so no listening socket or upstream server is needed.
  const origin = 'http://127.0.0.1:4173';
  stage = 'browser_launch';
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE || undefined,
      args: (process.env.CHROME_ARGS ?? '').split(' ').filter(Boolean) });
  stage = 'measurement';
  const environment = { node: process.version, chromium: browser.version(), cpu: cpus()[0]?.model,
    platform: platform(), cpuRate, viewport: { width: 1920, height: 1080 }, warmups: 1, repetitions: 3,
    traceEnabled, react: 'production Vite build', date: '2026-11-05T08:00:00+09:00' };
  let dom;
  for (let iteration = 0; iteration < 4; iteration++) {
    console.error(`sequence ${iteration + 1}/4${iteration === 0 ? ' (warmup)' : ''}`);
    const context = await browser.newContext({ viewport: environment.viewport, serviceWorkers: 'block' });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    // Fail closed: no requests to external servers or real APIs.
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.origin !== origin || url.pathname.startsWith('/api/')) {
        errors.push(`blocked request: ${url.origin}${url.pathname}`);
        return route.abort();
      }
      const path = resolve(outDir, '.' + (url.pathname === '/' ? '/index.html' : url.pathname));
      assert(path.startsWith(outDir + '/'), 'invalid asset path');
      const contentType = path.endsWith('.html') ? 'text/html' : path.endsWith('.js') ? 'application/javascript' : path.endsWith('.css') ? 'text/css' : 'application/octet-stream';
      return readFile(path).then(body => route.fulfill({ body, contentType }));
    });
    await page.clock.install({ time: new Date(environment.date) });
    if (screenshotDir && iteration === 1) await page.clock.setFixedTime(new Date(environment.date));
    const cdp = await context.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpuRate });
    await cdp.send('Performance.enable');
    async function measure(name, action) {
      if (traceEnabled) await cdp.send('Tracing.start', { categories: 'devtools.timeline', transferMode: 'ReturnAsStream' });
      const before = await metrics(cdp);
      const start = performance.now();
      await action();
      await settle(page);
      const wallMs = performance.now() - start;
      const after = await metrics(cdp);
      const trace = traceEnabled ? await endTrace(cdp) : { paintMs: null, compositeMs: null };
      const sample = { wallMs, ...Object.fromEntries(['ScriptDuration', 'RecalcStyleDuration', 'LayoutDuration', 'TaskDuration'].map(key => [key, (after[key] - before[key]) * 1000])),
        ...trace, nodes: await page.locator('body *').count() };
      if (iteration) (samples[name] ??= []).push(sample);
      console.error(`  ${name}: ${wallMs.toFixed(1)}ms`);
    }
    await measure('initial_display', async () => {
      await page.goto(origin, { waitUntil: 'load' });
      await page.locator(`${gantt} [data-gantt-track]`).first().waitFor();
    });
    if (iteration === 1) {
      dom = await inventory(page);
      assert(dom.capabilities.monthlyUptime && dom.capabilities.processChips, 'fixture capabilities missing');
      assert(dom.scroll.scrollWidth > dom.scroll.width && dom.scroll.scrollHeight > dom.scroll.height, 'both scroll axes required');
    }
    const button = label => page.locator('button').filter({ hasText: new RegExp(`^\\s*${label}\\s*$`) });
    const point = async locator => {
      await locator.scrollIntoViewIfNeeded();
      const box = await locator.boundingBox();
      assert(box && box.width && box.height, 'target has no box');
      return { x: box.x + Math.min(box.width / 2, 15), y: box.y + box.height / 2 };
    };
    if (screenshotDir && iteration === 1) {
      await mkdir(screenshotDir, { recursive: true });
      const initialLeft = await page.locator(viewport).evaluate(el => el.scrollLeft);
      for (const [name, ratio] of [['initial', null], ['middle', 0.5], ['right', 0.95]]) {
        await page.locator(viewport).evaluate((el, left) => { el.scrollLeft = left; el.scrollTop = 0; },
          ratio === null ? initialLeft : await page.locator(viewport).evaluate((el, ratio) => el.scrollWidth * ratio, ratio));
        await page.mouse.move(1, 1);
        await settle(page);
        await page.screenshot({ path: resolve(screenshotDir, `${name}.png`), animations: 'disabled', caret: 'hide' });
        if (name !== 'initial') continue;
        // Overscan includes offscreen buttons: pick a bar actually visible below the date heading.
        const visibleId = await page.locator(bars).evaluateAll(nodes => {
          const viewport = document.querySelector('[aria-label="ガントの日付と工程"]');
          const bounds = viewport.getBoundingClientRect();
          return nodes.find(node => {
            const rect = node.getBoundingClientRect();
            return rect.right > bounds.left + 180 && rect.left < bounds.right - 32
              && rect.top >= bounds.top + 36 && rect.bottom <= bounds.bottom;
          })?.getAttribute('data-testid');
        });
        assert(visibleId, `no visible bar for ${name} drag screenshot`);
        const source = page.getByTestId(visibleId);
        const box = await source.boundingBox();
        const bounds = await page.locator(viewport).boundingBox();
        const x = Math.min(box.x + box.width - 1, Math.max(box.x, bounds.x + 168) + 5);
        const y = box.y + box.height / 2;
        await page.mouse.move(x, y);
        await page.mouse.down();
        await page.mouse.move(x + 20, y + 10);
        await settle(page);
        assert.equal(await page.getByTestId('planning-gantt-drag-ghost').count(), 1);
        await page.screenshot({ path: resolve(screenshotDir, `${name}-drag.png`), animations: 'disabled', caret: 'hide' });
        await page.mouse.move(1, 1);
        await page.mouse.up();
        await settle(page);
      }
      assert.equal(await page.evaluate(() => window.perfHarness.mutations.length), 0);
      await page.clock.setSystemTime(new Date(environment.date));
      await page.locator(viewport).evaluate((el, left) => { el.scrollLeft = left; el.scrollTop = 0; }, initialLeft);
      await settle(page);
    }
    async function click(name, locator) {
      const { x, y } = await point(locator);
      await settle(page);
      await measure(name, () => page.mouse.click(x, y));
    }
    await click('gantt_off', button('ガント'));
    assert.equal(await page.locator(gantt).count(), 0);
    await click('gantt_on', button('ガント'));
    await page.locator(gantt).waitFor();
    const legendButton = page.locator(legend).first();
    await click('focus_seiban_on', legendButton);
    assert.equal(await legendButton.getAttribute('aria-pressed'), 'true');
    await click('focus_seiban_off', legendButton);
    assert.equal(await legendButton.getAttribute('aria-pressed'), 'false');
    // Use the first bar, scrolling it into the viewport before timing input.
    const bar = page.locator(bars).first();
    for (const [name, pressed] of [['item_selection_on', 'true'], ['item_selection_off', 'false']]) {
      const { x, y } = await point(bar);
      await page.mouse.move(x, y);
      await settle(page);
      await measure(name, async () => {
        await page.mouse.down();
        await page.waitForTimeout(550); // Deliberate 500ms long-press threshold is included.
        await page.mouse.up();
      });
      assert.equal(await bar.getAttribute('aria-pressed'), pressed);
    }
    const countBeforeArrival = await page.locator(bars).count();
    await click('arrival_on', button('着'));
    await click('arrival_off', button('着'));
    assert.equal(await page.locator(bars).count(), countBeforeArrival);
    assert.equal(await bar.getAttribute('data-drag-disabled'), 'false', 'bar dragging disabled');
    const startPoint = await point(bar);
    await page.mouse.move(startPoint.x, startPoint.y);
    await settle(page);
    await measure('drag_start', async () => {
      await page.mouse.down();
      await page.mouse.move(startPoint.x + 20, startPoint.y + 10);
    });
    assert.equal(await page.getByTestId('planning-gantt-drag-ghost').count(), 1);
    await measure('drag_hover_20', async () => {
      for (let i = 0; i < 20; i++) {
        await page.mouse.move(startPoint.x + 30 + i * 5, startPoint.y + 10 + (i % 5) * 18);
        await settle(page);
      }
    });
    assert.equal(await page.getByTestId('planning-gantt-drag-ghost').count(), 1);
    // Outside the board is an invalid drop target; real pointer-up cleanup, no writes.
    await page.mouse.move(1, 1);
    await settle(page);
    await measure('drag_drop', () => page.mouse.up());
    assert.equal(await page.getByTestId('planning-gantt-drag-ghost').count(), 0);
    assert.equal(await page.evaluate(() => window.perfHarness.mutations.length), 0, 'drop unexpectedly wrote data');
    await page.locator(viewport).evaluate(el => { el.scrollLeft = 0; el.scrollTop = 0; });
    await settle(page);
    await measure('scroll_20', async () => {
      for (let i = 1; i <= 20; i++) {
        await page.locator(viewport).evaluate((el, n) => { el.scrollLeft = n * 40; el.scrollTop = n * 10; }, i);
        await settle(page);
      }
    });
    const scroll = await page.locator(viewport).evaluate(el => [el.scrollLeft, el.scrollTop]);
    assert(scroll.every(value => value > 0), 'scroll did not move both axes');
    if (process.env.SWITCH === '1') {
      for (const generation of [1, 2]) await measure(`switch_paged_${generation}`, () => page.evaluate(g => window.perfHarness.swapPaged(g, 0), generation));
      if (process.env.PROFILE === '1' && iteration === 1) {
        await cdp.send('Profiler.enable');
        await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
        await cdp.send('Profiler.start');
        await page.evaluate(() => window.perfHarness.swapPaged(3, 0));
        await settle(page);
        const { profile } = await cdp.send('Profiler.stop');
        await writeFile(resolve(dirname(output), 'switch.cpuprofile'), JSON.stringify(profile));
      }
    }
    for (const [name, label, pressed] of [['cutting_on', '切削', 'true'], ['grinding_off', '研削', 'false'], ['grinding_on', '研削', 'true'], ['cutting_off', '切削', 'false']]) {
      await click(name, button(label));
      assert.equal(await button(label).getAttribute('aria-pressed'), pressed);
    }
    for (const key of ['board', 'chips', 'minutes', 'uptime']) {
      assert((await page.evaluate(() => window.perfHarness.listenerCounts()))[key] > 0, `${key} has no subscribers`);
      await measure(`refetch_${key}`, () => page.evaluate(key => window.perfHarness.refresh([key]), key));
    }
    await measure('refetch_all', () => page.evaluate(() => window.perfHarness.refresh(['board', 'chips', 'minutes', 'uptime'])));
    const beforeNow = await page.locator('[data-testid="planning-gantt-now"]').first().getAttribute('style');
    await measure('now_tick_30s', () => page.clock.fastForward(30_000));
    assert.notEqual(await page.locator('[data-testid="planning-gantt-now"]').first().getAttribute('style'), beforeNow);
    // Additional piece scenarios run after the unchanged, piece-free sequence.
    const targetId = await page.evaluate(() => window.perfHarness.enablePieces());
    await settle(page);
    await button('切削').click();
    await button('研削').click();
    await button('ガント').click();
    await settle(page);
    const targetRow = page.getByTestId(`planning-board-item-${targetId}`);
    const quantity = targetRow.locator('[data-planning-board-quantity-item]');
    await quantity.scrollIntoViewIfNeeded();
    await measure('pieces_popup_open', () => quantity.click());
    const dialog = page.getByRole('dialog', { name: '数量', exact: true });
    await dialog.waitFor();
    await page.clock.fastForward(350);
    const beforePieces = await page.evaluate(() => window.perfHarness.board().items.length);
    await measure('pieces_split_success', async () => {
      await dialog.getByRole('button', { name: '分ける', exact: true }).click();
      await dialog.waitFor({ state: 'detached' });
      await page.waitForFunction(before => window.perfHarness.board().items.length === before + 1, beforePieces);
    });
    const newPieceId = await page.evaluate(() => window.perfHarness.board().items.find(item => item.kind === 'piece' && item.pieceSetVersion === 2 && item.plannedQuantity === 1).itemId);
    const complete = page.getByTestId(`planning-board-item-${newPieceId}`).getByRole('button', { name: '完了にする', exact: true });
    await complete.scrollIntoViewIfNeeded();
    await measure('pieces_piece_complete', async () => {
      await complete.click();
      await page.waitForFunction(id => window.perfHarness.board().items.find(item => item.itemId === id)?.isCompleted, newPieceId);
    });
    assert.deepEqual(await page.evaluate(() => window.perfHarness.mutations.slice(-2).map(entry => entry.operation)), ['split', 'completion']);
    assert.deepEqual(errors, []);
    await context.close();
  }
  const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
  const medians = Object.fromEntries(Object.entries(samples).map(([name, values]) => [name,
    Object.fromEntries(Object.keys(values[0]).map(key => [key, values[0][key] === null ? null : median(values.map(value => value[key]))]))]));
  const result = { status: 'complete', environment, fixture: { items: 1500, seibans: 80, resources: 20, processChipsPerPart: 6 },
    notes: ['wallMs includes Playwright/CDP transport and two requestAnimationFrames; not a physical display presentation timestamp.',
      'initial_display includes navigation, local asset loading and mount; new context each sequence, OS cache not cleared.',
      'item_selection includes intentional 550ms hold; drag_hover_20 and scroll_20 include two frames per move.',
      'refetch clones the same hook-store payload; no HTTP, query-cache or server latency.',
      'Paint/CompositeLayers are sums of complete trace events across threads, may overlap. Zero means no matching events, not zero compositor work.',
      'DOM/CSS inventory is outside timed operations; CSS counts are declarations in computed styles, not measured cost.',
      'drag_drop is pointer-up at (1,1), outside the board, with zero mutation calls asserted.'],
    unavailable: [], dom, medians, samples };
  await writeFile(output, JSON.stringify(result, null, 2) + '\n');
  console.log('| 操作 | 全体ms | Script | Style | Layout | Paint | DOM要素 |');
  console.log('|---|---:|---:|---:|---:|---:|---:|');
  for (const [name, v] of Object.entries(medians)) console.log(`| ${name} | ${[v.wallMs, v.ScriptDuration, v.RecalcStyleDuration, v.LayoutDuration, v.paintMs].map(x => x === null ? 'n/a' : x.toFixed(1)).join(' | ')} | ${v.nodes} |`);
  console.log('DOM/CSS:', JSON.stringify(dom, null, 2));
  console.log(`JSON: ${output}`);
} catch (error) {
  await writeFile(output, JSON.stringify({ status: 'incomplete', stage, error: String(error),
    environment: { node: process.version, cpuRate, chromiumExecutable: process.env.CHROMIUM_EXECUTABLE ?? 'Playwright default' }, samples }, null, 2) + '\n');
  console.error(`Incomplete run; diagnostic JSON: ${output}`);
  throw error;
} finally {
  await browser?.close();
  await rm(outDir, { recursive: true, force: true }); // Only the temporary build created above.
}
