import { expect, test, type Page, type Route } from '@playwright/test';

const TARGET_PATH = '/kiosk/part-measurement/inspection';
const LAZY_CHUNK_NAME = 'KioskInspectionDrawingLibraryPage';
const STORAGE_KEY = 'raspi:web-runtime-recovery:v1';
const RELEASE_SHA = 'c'.repeat(40);

function isTargetLazyChunk(route: Route): boolean {
  const url = new URL(route.request().url());
  return url.pathname.includes(LAZY_CHUNK_NAME) && url.pathname.endsWith('.js');
}

async function isolateApi(page: Page): Promise<void> {
  await page.route('**/api/**', async (route) => {
    await route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ message: 'runtime recovery browser contract' })
    });
  });
}

function trackTargetDocuments(page: Page): string[] {
  const documents: string[] = [];
  page.on('request', (request) => {
    if (request.resourceType() !== 'document') return;
    const url = new URL(request.url());
    if (url.pathname === TARGET_PATH) documents.push(url.href);
  });
  return documents;
}

test('recovers one transient lazy-chunk failure with exactly one reload', async ({ page }) => {
  await isolateApi(page);
  const documents = trackTargetDocuments(page);
  let chunkRequests = 0;

  await page.route('**/*', async (route) => {
    if (!isTargetLazyChunk(route)) return route.fallback();
    chunkRequests += 1;
    if (chunkRequests === 1) return route.abort('connectionfailed');
    return route.continue();
  });

  await page.goto(TARGET_PATH, { waitUntil: 'domcontentloaded' });

  await expect(page.getByRole('heading', { name: '検査図面', exact: true })).toBeVisible();
  await expect.poll(() => documents.length).toBe(2);
  expect(chunkRequests).toBe(2);
  expect(new URL(page.url()).searchParams.has('__raspi_web_runtime_recovery')).toBe(true);
  expect(await page.locator('#root').evaluate((root) => root.childElementCount)).toBeGreaterThan(0);
  expect(await page.evaluate((key) => JSON.parse(sessionStorage.getItem(key) ?? 'null'), STORAGE_KEY)).toEqual({
    version: 1,
    pathname: TARGET_PATH,
    releaseSha: RELEASE_SHA,
    attemptedAtMs: expect.any(Number)
  });
});

test('stops at recovery controls when the lazy chunk keeps failing', async ({ page }) => {
  await isolateApi(page);
  const documents = trackTargetDocuments(page);
  let chunkRequests = 0;

  await page.route('**/*', async (route) => {
    if (!isTargetLazyChunk(route)) return route.fallback();
    chunkRequests += 1;
    return route.abort('connectionfailed');
  });

  await page.goto(TARGET_PATH, { waitUntil: 'domcontentloaded' });

  await expect(page.getByRole('heading', { name: '画面を表示できませんでした' })).toBeVisible();
  await expect(page.getByRole('button', { name: '画面を再読み込み' })).toBeVisible();
  await page.waitForTimeout(500);
  expect(documents).toHaveLength(2);
  expect(chunkRequests).toBe(2);
  expect(await page.locator('#root').evaluate((root) => root.childElementCount)).toBeGreaterThan(0);
});
