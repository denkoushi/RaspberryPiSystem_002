import { expect, test, type Page } from '@playwright/test';

import { mockKioskLayoutApis } from './helpers/inspectionDrawingCreateHeaderLayout';

const CLIENT_KEY = 'client-key-raspberrypi4-kiosk1';

const visualTemplate = {
  id: 'sop-visual-1',
  name: '図面71-A61',
  drawingImageRelativePath: '/api/storage/part-measurement-drawings/sop-visual-1.svg',
  isActive: true,
  createdAt: '2026-07-28T00:00:00.000Z',
  updatedAt: '2026-07-28T00:00:00.000Z'
};

const drawingTemplate = {
  id: 'sop-template-1',
  fhincd: 'PART-9000',
  resourceCd: 'R001',
  processGroup: 'cutting',
  name: '図面71-A61 テンプレート',
  version: 1,
  isActive: true,
  selfInspectionMode: 'full',
  selfInspectionFixedCount: null,
  selfInspectionSampleSize: null,
  visualTemplateId: visualTemplate.id,
  visualTemplate,
  siblingGroupId: null,
  siblingGroup: null,
  itemCount: 1,
  updatedAt: '2026-07-28T00:00:00.000Z'
};

async function installLibraryApiMocks(page: Page): Promise<void> {
  await page.route((url) => url.pathname.startsWith('/api/'), async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;

    if (path === '/api/system/deploy-status') {
      await route.fulfill({ json: { isMaintenance: false } });
      return;
    }
    if (path === '/api/kiosk/config') {
      await route.fulfill({ json: { defaultMode: 'tag', clientStatus: null } });
      return;
    }
    if (path === '/api/kiosk/call/targets') {
      await route.fulfill({ json: { selfClientId: 'sop-e2e', targets: [] } });
      return;
    }
    if (path === '/api/kiosk/production-schedule/resources') {
      await route.fulfill({ json: { resources: ['R001'], resourceNameMap: {} } });
      return;
    }
    if (path === '/api/part-measurement/inspection-drawing/templates') {
      await route.fulfill({ json: { templates: [drawingTemplate] } });
      return;
    }
    if (path === '/api/part-measurement/visual-templates') {
      await route.fulfill({ json: { visualTemplates: [visualTemplate] } });
      return;
    }
    if (path === visualTemplate.drawingImageRelativePath) {
      await route.fulfill({
        contentType: 'image/svg+xml',
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="640" height="360" fill="#e2e8f0"/></svg>'
      });
      return;
    }

    await route.fulfill({ status: 404, json: { message: `Unexpected E2E API request: ${path}` } });
  });
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.addInitScript((clientKey) => {
    window.localStorage.setItem('kiosk-client-key', JSON.stringify(clientKey));
  }, CLIENT_KEY);
});

for (const viewport of [
  { width: 1280, height: 800 },
  { width: 1536, height: 864 }
] as const) {
  test(`@production-smoke ${viewport.width}x${viewport.height}: 一覧の取説はオフラインでも1/2だけを安全に表示する`, async ({
    page,
    context
  }) => {
    await page.setViewportSize(viewport);
    await installLibraryApiMocks(page);
    await page.goto('/kiosk/part-measurement/inspection', { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('図面71-A61').first()).toBeVisible();

    const openButton = page.getByRole('button', { name: 'この画面の操作手順を開く' });
    await expect(openButton).toBeVisible();
    expect(await openButton.evaluate((element) => element.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);

    const titleBar = page.getByRole('heading', { name: '検査図面', exact: true }).locator('..').locator('..');
    const titleBarMetrics = await titleBar.evaluate((element) => ({
      height: element.getBoundingClientRect().height,
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth
    }));
    expect(titleBarMetrics.height).toBe(60);
    expect(titleBarMetrics.scrollWidth).toBeLessThanOrEqual(titleBarMetrics.clientWidth + 1);

    const iframeRequests: string[] = [];
    page.on('request', (request) => {
      if (request.frame().parentFrame()) iframeRequests.push(request.url());
    });

    await context.setOffline(true);
    try {
      await openButton.click();
      const frameElement = page.getByTestId('kiosk-sop-frame');
      await expect(frameElement).toHaveAttribute('sandbox', 'allow-scripts');
      await expect(frameElement).toHaveAttribute('referrerpolicy', 'no-referrer');

      const frame = page.frameLocator('[data-testid="kiosk-sop-frame"]');
      await expect(frame.locator('.sheet[data-sheet="library"]')).toBeVisible();
      await expect(frame.locator('.sheet[data-sheet="edit"]')).toBeHidden();
      await expect(frame.getByText('検査図面を開く')).toBeVisible();
      await expect(frame.locator('.leader-layer line.is-on')).toHaveCount(0);

      await frame.locator('.step-item[data-step="1"]').focus();
      await expect(frame.locator('.leader-layer line.is-on')).toHaveCount(1);

      const closeButton = page.getByRole('button', { name: '閉じる' });
      expect(await closeButton.evaluate((element) => element.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
      await closeButton.click();
      await expect(openButton).toBeFocused();
    } finally {
      await context.setOffline(false);
    }

    expect(iframeRequests).toEqual([]);
  });
}

for (const scenario of ['revise', 'fixed_count'] as const) {
  const viewport =
    scenario === 'revise'
      ? { width: 1280, height: 800 }
      : { width: 1536, height: 864 };

  test(`${scenario} ${viewport.width}x${viewport.height}: 改版プレビューは取説2/2を表示して画面状態を維持する`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await mockKioskLayoutApis(page);
    await page.goto(`/dev/kiosk-inspection-drawing-create?scenario=${scenario}`, {
      waitUntil: 'domcontentloaded'
    });

    const testInputButton = page.getByRole('button', { name: 'テスト入力' });
    await testInputButton.click();
    await expect(testInputButton).toHaveAttribute('aria-pressed', 'true');

    await page.getByRole('button', { name: 'この画面の操作手順を開く' }).click();
    const frame = page.frameLocator('[data-testid="kiosk-sop-frame"]');
    await expect(frame.locator('.sheet[data-sheet="library"]')).toBeHidden();
    await expect(frame.locator('.sheet[data-sheet="edit"]')).toBeVisible();
    await expect(frame.getByText('直す点を選ぶ')).toBeVisible();
    await expect(frame.getByText('一覧に戻る')).toBeVisible();

    await page.getByRole('button', { name: '閉じる' }).click();
    await expect(testInputButton).toHaveAttribute('aria-pressed', 'true');
  });
}

test('create_new: 新規作成プレビューには取説を表示しない', async ({ page }) => {
  await mockKioskLayoutApis(page);
  await page.goto('/dev/kiosk-inspection-drawing-create?scenario=create_new', {
    waitUntil: 'domcontentloaded'
  });

  await expect(page.getByTestId('inspection-drawing-create-header-band')).toBeVisible();
  await expect(page.getByRole('button', { name: 'この画面の操作手順を開く' })).toHaveCount(0);
});
